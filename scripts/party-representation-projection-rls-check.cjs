/* Isolated read projection/RLS regression. No production DB access. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync(path.join(__dirname,'..','supabase/migrations/20261029141000_party_representation_projection_invoker.sql'),'utf8');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const game=id(900),foreign=id(901);
assert(sql.includes('security invoker')&&!sql.includes('security definer'),'Projection MUST use caller table RLS');
assert(sql.includes('private.is_game_member(p_game_id)'),'Projection must deny non-members');
assert(sql.includes('revoke all on function public.get_party_representation_projection(uuid) from public, anon'),'Anonymous role must be denied');
async function run(){
 const db=new PGlite();
 try{
  await db.exec("create role authenticated;create role anon;create schema auth;create schema private;");
  await db.exec("create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;");
  await db.exec("create table public.game_members(game_id uuid,user_id uuid,kind text,primary key(game_id,user_id));");
  await db.exec("create table public.game_parties(id uuid primary key,game_id uuid,leader_user_id uuid);");
  await db.exec("create function private.is_game_member(g uuid) returns boolean language sql stable security definer set search_path='' as $$select auth.uid() is not null and exists(select 1 from public.game_members m where m.game_id=g and m.user_id=auth.uid())$$;");
  await db.exec("create function private.is_game_teacher(g uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.game_members m where m.game_id=g and m.user_id=auth.uid() and m.kind='teacher')$$;");
  await db.exec("create table public.party_invitations(id uuid,game_id uuid,party_id uuid,invited_user_id uuid,invited_by uuid,status text,created_at timestamptz);");
  await db.exec("create table public.party_member_mandates(game_id uuid,party_id uuid,user_id uuid,base_mandates int,ghost_loss int,effective_mandates int,updated_at timestamptz,representation_loss int);");
  await db.exec("create table public.party_agreements(id uuid,game_id uuid,title text,terms text,created_at timestamptz);");
  for(const t of ['party_invitations','party_member_mandates','party_agreements'])await db.exec('alter table public.'+t+' enable row level security;');
  await db.exec("create policy invitation_visibility on public.party_invitations for select to authenticated using(private.is_game_teacher(game_id) or invited_user_id=auth.uid() or exists(select 1 from public.game_parties p where p.id=party_id and p.leader_user_id=auth.uid()));");
  await db.exec("create policy mandate_visibility on public.party_member_mandates for select to authenticated using(private.is_game_member(game_id));");
  await db.exec("create policy agreement_visibility on public.party_agreements for select to authenticated using(private.is_game_member(game_id));");
  await db.exec("grant usage on schema public,private,auth to authenticated;grant usage on schema public to anon;grant select on all tables in schema public to authenticated;grant execute on function auth.uid() to authenticated;grant execute on function private.is_game_member(uuid),private.is_game_teacher(uuid) to authenticated;");
  for(let n=1;n<=42;n++)await db.query('insert into public.game_members values($1,$2,$3)',[game,id(n),n===41?'teacher':n===42?'observer':'student']);
  await db.query("insert into public.game_parties values($1,$2,$3)",[id(700),game,id(2)]);
  await db.query("insert into public.party_invitations values($1,$2,$3,$4,$5,'pending','2026-10-27')",[id(101),game,id(700),id(1),id(2)]);
  await db.query("insert into public.party_invitations values($1,$2,$3,$4,$5,'pending','2026-10-28')",[id(102),foreign,id(700),id(3),id(2)]);
  await db.query("insert into public.party_member_mandates values($1,$2,$3,4,1,3,'2026-10-27',0)",[game,id(700),id(1)]);
  await db.query("insert into public.party_member_mandates values($1,$2,$3,10,0,10,'2026-10-27',0)",[foreign,id(700),id(3)]);
  await db.query("insert into public.party_agreements values($1,$2,'Agreement A','Terms A','2026-10-27')",[id(300),game]);
  await db.query("insert into public.party_agreements values($1,$2,'Agreement B','Terms B','2026-10-27')",[id(301),foreign]);
  await db.exec(sql);
  async function as(n){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[n?id(n):'']);await db.exec('set role authenticated');}
  async function project(g=game){return(await db.query('select public.get_party_representation_projection($1) value',[g])).rows[0].value;}
  for(let n=1;n<=42;n++){
   await as(n);const snapshot=await project();
   assert.equal(Object.keys(snapshot).length,3);
   assert.equal(snapshot.invitations.length,[1,2,41].includes(n)?1:0,'Invitations RLS for member '+n);
   assert.equal(snapshot.mandates.length,1,'All members retain their visible mandate count');
   assert.equal(snapshot.agreements.length,1,'All members retain their visible agreements');
   assert.equal(snapshot.mandates[0].effective_mandates,3,'Mandate formula stays unchanged');
   assert.equal(snapshot.mandates[0].game_id,game,'No other game mandate');
   assert.equal(snapshot.agreements[0].game_id,game,'No other game agreements');
  }
  await as(1);await assert.rejects(project(foreign),e=>e.code==='42501','Foreign room blocked');
  await as(null);await assert.rejects(project(),e=>e.code==='42501','Missing JWT blocked');
  await db.exec('reset role');await db.exec('set role anon');await assert.rejects(project(),e=>e.code==='42501','Anon execute blocked');
  console.log('PASS 40 students + teacher + observer: invitations isolated; mandates and agreements identical; foreign room, no JWT and anon blocked (PGlite)');
 }finally{await db.close()}
}
run().catch(e=>{console.error(e);process.exitCode=1});
