/* Isolated PostgreSQL RLS read-model test; never connects to production. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync(path.join(__dirname,'..','supabase/migrations/20261029133000_event_workspace_projection_invoker.sql'),'utf8');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const game=id(900),other=id(901);
assert(sql.includes('security invoker'),'RLS cannot be bypassed by the projection');
assert(sql.includes('private.is_game_member(p_game_id)'),'Require game membership before reading');
assert(!sql.includes('security definer'),'Projection must not be privileged');
const columns={
 event_assignments:"id uuid,case_id uuid,game_id uuid,recipient_id uuid,status text,created_at timestamptz",
 event_decisions:"id uuid,case_id uuid,game_id uuid,actor_id uuid,choice text,role_snapshot text",
 event_case_outcomes:"case_id uuid,game_id uuid,winner text,trust_delta numeric,votes_count int,assignments_count int,media_post_id uuid,requested_trust_delta numeric,resolution_kind text",
 event_collaboration_invites:"id uuid,case_id uuid,game_id uuid,inviter_id uuid,recipient_id uuid,status text",
 event_authority_evidence:"decision_id uuid,case_id uuid,game_id uuid,actor_id uuid,authority_ok boolean,lawful boolean,strategy_point boolean,role_snapshot text,legal_basis text",
 event_cases:"id uuid,game_id uuid,status text"
};
async function main(){
 const db=new PGlite();
 try{
  await db.exec("create role authenticated;create role anon;create schema auth;create schema private;");
  await db.exec("create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;");
  await db.exec("create table public.game_members(game_id uuid,user_id uuid,kind text,primary key(game_id,user_id));");
  await db.exec("create function private.is_game_member(g uuid) returns boolean language sql stable security definer set search_path='' as $$select auth.uid() is not null and exists(select 1 from public.game_members m where m.game_id=g and m.user_id=auth.uid())$$;");
  await db.exec("create function private.is_game_teacher(g uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.game_members m where m.game_id=g and m.user_id=auth.uid() and m.kind='teacher')$$;");
  for(const [table,cols] of Object.entries(columns)){
   await db.exec('create table public.'+table+'('+cols+');alter table public.'+table+' enable row level security;');
   let check="private.is_game_member(game_id)";
   if(table==='event_authority_evidence')check="private.is_game_teacher(game_id) or actor_id=auth.uid()";
   if(table==='event_cases')check="private.is_game_teacher(game_id)";
   await db.exec('create policy scoped_read on public.'+table+' for select to authenticated using ('+check+');');
  }
  await db.exec("grant usage on schema public,auth,private to authenticated;grant usage on schema public to anon;grant execute on function auth.uid() to authenticated;grant execute on function private.is_game_member(uuid),private.is_game_teacher(uuid) to authenticated;grant select on all tables in schema public to authenticated;");
  for(let n=1;n<=42;n++)await db.query('insert into public.game_members values ($1,$2,$3)',[game,id(n),n===41?'teacher':n===42?'observer':'student']);
  const caseId=id(100),foreignId=id(101);
  await db.query("insert into public.event_assignments values ($1,$2,$3,$4,'pending',now()),($5,$6,$7,$8,'pending',now())",[id(110),caseId,game,id(1),id(111),foreignId,other,id(2)]);
  await db.query("insert into public.event_decisions values ($1,$2,$3,$4,'option_1','Министр'),($5,$6,$7,$8,'option_2','Министр')",[id(120),caseId,game,id(1),id(121),foreignId,other,id(2)]);
  await db.query("insert into public.event_case_outcomes values ($1,$2,'option_1',2,1,1,null,2,'majority'),($3,$4,'option_2',0,1,1,null,0,'majority')",[caseId,game,foreignId,other]);
  await db.query("insert into public.event_collaboration_invites values ($1,$2,$3,$4,$5,'pending'),($6,$7,$8,$9,$10,'pending')",[id(130),caseId,game,id(2),id(1),id(131),foreignId,other,id(2),id(3)]);
  await db.query("insert into public.event_authority_evidence values ($1,$2,$3,$4,true,true,true,'Министр','Закон'),($5,$6,$7,$8,false,false,false,'Депутат','Иная норма')",[id(120),caseId,game,id(1),id(121),foreignId,other,id(2)]);
  await db.query("insert into public.event_cases values ($1,$2,'ready'),($3,$4,'ready')",[caseId,game,foreignId,other]);
  await db.exec(sql);
  async function as(n){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[n?id(n):'']);await db.exec('set role authenticated');}
  async function projection(g=game,withCount=true){return(await db.query('select public.get_event_workspace_projection($1,$2) state',[g,withCount])).rows[0].state;}
  let count=0;
  for(let n=1;n<=42;n++){
   await as(n);const state=await projection();
   for(const key of ['assignments','decisions','outcomes','invitations'])assert.equal(state[key].length,1,'Visible room records for '+key+', user '+n);
   assert.equal(state.authority.length,n===1||n===41?1:0,'Authority evidence keeps actor/teacher RLS');
   assert.equal(state.ready_case_count,n===41?1:0,'Case readiness keeps teacher-only RLS');
   assert.equal(state.assignments[0].game_id,game,'No cross-game rows');
   assert.equal(state.decisions[0].choice,'option_1','Choice is unchanged');
   assert.equal(state.outcomes[0].trust_delta,2,'Trust formula inputs unchanged');
   const withoutCount=await projection(game,false);assert.equal(withoutCount.ready_case_count,null,'No unneeded bank count');
   count++;
  }
  await as(1);await assert.rejects(projection(other),e=>e.code==='42501','Foreign game must be rejected');
  await as(null);await assert.rejects(projection(),e=>e.code==='42501','Missing session must be rejected');
  await db.exec('reset role');await db.exec('set role anon');
  await assert.rejects(projection(),e=>e.code==='42501','No EXECUTE for anonymous Postgres role');
  console.log('PASS: '+count+' individual JWT actors; RLS for six sources, secret evidence/ready cases, foreign game, anon, optional count (isolated PGlite)');
 }finally{await db.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1});
