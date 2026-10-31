/* Isolated PGlite RLS/shape test. No production Supabase writes. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const game=id(900),other=id(901);
const sql=fs.readFileSync(path.join(__dirname,'..','supabase/migrations/20261029130000_game_bootstrap_v2_invoker.sql'),'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'..','supabase/migrations/20261031183000_game_bootstrap_v3_lightweight.sql'),'utf8');
assert(sql.includes('security invoker'),'Bundled data must never bypass per-table RLS');
assert(sql.includes('private.is_game_member(p_game_id)'),'Membership must be checked');
assert(sql.includes('revoke all on function public.get_game_bootstrap_v3(uuid) from public, anon'));
const feeds=[['state_metrics','label','metrics'],['game_events','published_at','events'],
 ['chat_channels','name','channels'],['game_stages','stage_no','stages'],
 ['game_votes','opened_at','votes'],['game_evaluations','stage_no','evaluations'],
 ['game_crises','created_at','crises'],['game_documents','created_at','documents'],
 ['game_profiles','user_id','profiles'],['formal_documents','updated_at','formal_documents']];
async function main(){
 const db=new PGlite();
 try{
  await db.exec("create role authenticated;create role anon;create schema auth;create schema private;");
  await db.exec("create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;");
  await db.exec("create table public.game_members(game_id uuid,user_id uuid,kind text,primary key(game_id,user_id));");
  await db.exec("create function private.is_game_member(g uuid) returns boolean language sql stable security definer set search_path='' as $$ select auth.uid() is not null and exists(select 1 from public.game_members m where m.game_id=g and m.user_id=auth.uid()) $$;");
  await db.exec("create function private.is_game_teacher(g uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.game_members m where m.game_id=g and m.user_id=auth.uid() and m.kind='teacher') $$;");
  await db.exec("create table public.games(id uuid primary key,title text);alter table public.games enable row level security;");
  await db.exec("create policy member_scope on public.games for select to authenticated using (private.is_game_member(id));");
  for(const [table,sort] of feeds){
   const type=sort==='stage_no'?'int':sort==='user_id'?'uuid':sort==='label'||sort==='name'?'text':'timestamptz';
   await db.exec('create table public.'+table+'(id uuid,game_id uuid,'+sort+' '+type+',description text);alter table public.'+table+' enable row level security;');
   const scope='private.is_game_member(game_id)'+(table==='game_profiles'?' and (user_id=auth.uid() or private.is_game_teacher(game_id))':'');
   await db.exec('create policy member_scope on public.'+table+' for select to authenticated using ('+scope+');');
  }
  await db.exec("alter table public.formal_documents add column body_text text;alter table public.formal_documents add column metadata jsonb;alter table public.game_profiles add column bio text;");
  await db.exec("grant usage on schema public,auth,private to authenticated;grant usage on schema public to anon;grant execute on function auth.uid() to authenticated;grant execute on function private.is_game_member(uuid),private.is_game_teacher(uuid) to authenticated;grant select on all tables in schema public to authenticated;");
  await db.exec("insert into public.games values ('"+game+"','Classroom'),('"+other+"','Other');");
  for(let n=1;n<=42;n++)await db.query('insert into public.game_members values ($1,$2,$3)',[game,id(n),n===41?'teacher':n===42?'observer':'student']);
  for(const [table,sort] of feeds){
   const value=sort==='stage_no'?'1':sort==='user_id'?"'"+id(1)+"'":
    sort==='label'||sort==='name'?"'Test'":"'2026-10-01T10:00:00Z'";
   const k=feeds.findIndex(item=>item[0]===table);
   await db.exec("insert into public."+table+" values ('"+id(500+k)+"','"+game+"',"+value+",'Visible'),('"+id(600+k)+"','"+other+"',"+value+",'Foreign');");
  }
  await db.exec("insert into public.game_events select ('00000000-0000-4000-8000-'||lpad((1000+n)::text,12,'0'))::uuid,'"+game+"'::uuid,'2026-10-01'::timestamptz+n*interval '1 minute','Event '||n from generate_series(1,120)n;");
  await db.exec("update public.formal_documents set body_text=repeat('Sensitive document ',500),metadata=jsonb_build_object('private_details',repeat('X',8000)) where game_id='"+game+"'");
  await db.exec("update public.game_profiles set bio=repeat('About participant ',300) where game_id='"+game+"'");
  await db.exec(sql);
  async function as(n){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[n?id(n):'']);await db.exec('set role authenticated');}
  async function get(g=game){return (await db.query('select public.get_game_bootstrap_v3($1) value',[g])).rows[0].value;}
  for(let n=1;n<=42;n++){
   await as(n);
   const result=await get();
   assert.equal(result.game.title,'Classroom');
   assert.equal(result.events.length,100,'Preserve cap on recent events');
   assert.equal(Object.keys(result).length,11,'Exact 11 game groups');
   for(const [table,,key] of feeds){
    if(key==='events')continue;
    const count=(await db.query('select count(*)::int n from public.'+table+' where game_id=$1',[game])).rows[0].n;
    assert.equal(result[key].length,count,'Match direct RLS read for '+table+', user '+n);
    assert(result[key].every(row=>row.game_id===game),'No other-game rows in '+table);
   }
   assert.equal(result.profiles.length,n===1||n===41?1:0,'Preserve private profile visibility');
   assert(result.profiles.every(p=>p.bio===null),'Bootstrap must not load biographies');
   assert(result.formal_documents.every(d=>d.body_text===null&&JSON.stringify(d.metadata)==='{}'),'Bootstrap must not load document bodies or metadata');
   if(n===41){
    const full=(await db.query('select public.get_game_bootstrap_v2($1) value',[game])).rows[0].value;
    const originalBytes=Buffer.byteLength(JSON.stringify(full)),lightBytes=Buffer.byteLength(JSON.stringify(result));
    assert(lightBytes<originalBytes*0.5,'Lightweight bootstrap should reduce synthetic full payload');
    console.log('Synthetic payload: '+originalBytes+' -> '+lightBytes+' bytes ('+Math.round((1-lightBytes/originalBytes)*100)+'% less)');
   }
  }
  await as(1);await assert.rejects(get(other),e=>e.code==='42501','Reject foreign room');
  await as(null);await assert.rejects(get(),e=>e.code==='42501','Reject missing authentication');
  await db.exec('reset role');await db.exec('set role anon');
  await assert.rejects(get(),e=>e.code==='42501','Revoke anonymous execute');
  console.log('PASS v3: 40 students, teacher, observer; 11 RLS groups; document bodies and biographies deferred; foreign game/anon denied (isolated PGlite)');
 }finally{await db.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1});
