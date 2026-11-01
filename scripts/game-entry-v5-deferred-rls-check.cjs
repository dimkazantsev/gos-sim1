/* Isolated PGlite verification of v5 entry, RLS and deferred collections.
 * No production database writes; 40 synthetic students plus teacher/guest. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const game=id(900),foreign=id(901);
const sql=fs.readFileSync(path.join(__dirname,'..','supabase/migrations/20261101090000_game_entry_v5_deferred_collections.sql'),'utf8');
const client=fs.readFileSync(path.join(__dirname,'..','components/game/useRepublicGame.ts'),'utf8');
assert(sql.includes('security invoker')&&sql.includes('private.is_game_member(p_game_id)'), 'RLS and membership cannot be bypassed');
assert(sql.includes('revoke all on function public.get_game_entry_v5(uuid) from public,anon'));
assert(client.includes("supabase.rpc('get_game_entry_v5'"), 'Client should prefer v5');
assert(client.includes("supabase.rpc('get_game_entry_v4'"), 'v4 must remain only for schema-cache compatibility');
assert(client.includes("['PGRST202','42883'].includes(String(slim.error.code||''))"), 'No fallback under rate limits or transient backend errors');
const omitted=['events','evaluations','documents'];
for(const key of omitted)assert(!new RegExp("'"+key+"',\\s*\\(").test(sql),'Deferred table should not be queried in v5: '+key);
for(const key of omitted)assert(client.includes("cold.push('"+key+"')"),'Missing on-demand view hydration: '+key);
async function main(){
 const db=new PGlite();
 try{
  await db.exec("create role authenticated;create role anon;create schema auth;create schema private;");
  await db.exec("create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;");
  await db.exec("create table public.game_members(game_id uuid,user_id uuid,full_name text,group_name text,kind text,role_title text,team text,score int,joined_at timestamptz,party_joined_at timestamptz,roster_archived_at timestamptz,primary key(game_id,user_id));");
  await db.exec("create function private.is_game_member(g uuid) returns boolean language sql stable security definer set search_path='' as $$ select auth.uid() is not null and exists(select 1 from public.game_members m where m.game_id=g and m.user_id=auth.uid()) $$;");
  await db.exec("create function private.is_game_teacher(g uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.game_members m where m.game_id=g and m.user_id=auth.uid() and m.kind='teacher') $$;");
  await db.exec("create function public.has_seen_my_intro() returns boolean language sql stable as $$ select true $$;");
  await db.exec("create table public.games(id uuid primary key,title text);");
  await db.exec("create table public.state_metrics(game_id uuid,label text,value int);");
  await db.exec("create table public.chat_channels(game_id uuid,name text);");
  await db.exec("create table public.game_stages(game_id uuid,stage_no int);");
  await db.exec("create table public.game_votes(game_id uuid,opened_at timestamptz);");
  await db.exec("create table public.game_crises(game_id uuid,created_at timestamptz);");
  await db.exec("create table public.game_profiles(game_id uuid,user_id uuid,bio text);");
  await db.exec("create table public.formal_documents(game_id uuid,updated_at timestamptz,body_text text,metadata jsonb);");
  await db.exec("create table public.game_events(game_id uuid,published_at timestamptz,body text);");
  await db.exec("create table public.game_evaluations(game_id uuid,stage_no int,description text);");
  await db.exec("create table public.game_documents(game_id uuid,created_at timestamptz,body text);");
  await db.exec("create table public.game_parties(id uuid,game_id uuid,created_by uuid,name text,support int,mandates int,regions int,budget numeric,leader_user_id uuid,color text,logo_path text,ghost_loss_current int,ghost_active boolean,ghost_started_at timestamptz,representation_penalty numeric,regional_seat_penalty numeric,ghost_risk_weight numeric,presidential_rating_modifier numeric,registration_status text,registration_submitted_at timestamptz,registration_reviewed_at timestamptz,registration_reviewed_by uuid,mandate_allocation_mode text,regional_seats_awarded int,created_at timestamptz,rating numeric);");
  for(const table of ['games','game_members','state_metrics','chat_channels','game_stages','game_votes','game_crises','game_profiles','formal_documents','game_events','game_evaluations','game_documents','game_parties']){
   await db.exec('alter table public.'+table+' enable row level security;');
   const condition=table==='games'?'private.is_game_member(id)':
    'private.is_game_member(game_id)'+(table==='game_profiles'?' and (user_id=auth.uid() or private.is_game_teacher(game_id))':'');
   await db.exec('create policy visible on public.'+table+' for select to authenticated using ('+condition+');');
  }
  await db.exec('grant usage on schema public,auth,private to authenticated;grant usage on schema public to anon;grant execute on function auth.uid() to authenticated;grant execute on function private.is_game_member(uuid),private.is_game_teacher(uuid),public.has_seen_my_intro() to authenticated;grant select on all tables in schema public to authenticated;');
  await db.query('insert into public.games values ($1,$2),($3,$4)',[game,'Republic',foreign,'Foreign']);
  for(let n=1;n<=42;n++)await db.query(
   'insert into public.game_members(game_id,user_id,full_name,kind,role_title) values ($1,$2,$3,$4,$5)',
   [game,id(n),'Participant '+n,n===41?'teacher':n===42?'observer':'student',n===41?'Преподаватель':'Участник']);
  await db.query('insert into public.game_members(game_id,user_id,full_name,kind) values ($1,$2,$3,$4)',[foreign,id(43),'Foreign','student']);
  for(const key of [game,foreign]){
   await db.query('insert into public.state_metrics values ($1,$2,1)',[key,'Trust']);
   await db.query('insert into public.chat_channels values ($1,$2)',[key,'General']);
   await db.query('insert into public.game_stages values ($1,1)',[key]);
   await db.query('insert into public.game_votes values ($1,now())',[key]);
   await db.query('insert into public.game_crises values ($1,now())',[key]);
   await db.query('insert into public.game_profiles values ($1,$2,$3)',[key,key===game?id(1):id(43),repeat('private biography',100)]);
   await db.query('insert into public.formal_documents values ($1,now(),$2,$3)',[key,repeat('classified full document',200),{sensitive:repeat('X',1500)}]);
   await db.query('insert into public.game_parties(id,game_id,name,support,created_at) values ($1,$2,$3,1,now())',[key===game?id(800):id(801),key,'Party']);
   await db.query('insert into public.game_evaluations values ($1,1,$2)',[key,repeat('grades private',150)]);
   await db.query('insert into public.game_documents values ($1,now(),$2)',[key,repeat('old document',200)]);
  }
  await db.query("insert into public.game_events select $1::uuid,now()+n*interval '1 minute',repeat('Old long news ',150) from generate_series(1,130)n",[game]);
  await db.exec(sql);
  async function as(n){
   await db.exec('reset role');
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[n?id(n):'']);
   await db.exec('set role authenticated');
  }
  async function read(g=game){return (await db.query('select public.get_game_entry_v5($1) value',[g])).rows[0].value;}
  const expected=['game','metrics','channels','stages','votes','crises','profiles','formal_documents','member','roster','parties','intro'].sort();
  for(let n=1;n<=42;n++){
   await as(n);const v=await read();
   assert.deepEqual(Object.keys(v).sort(),expected,'Exactly 12 entry groups');
   assert.equal(v.game.title,'Republic');assert.equal(v.member.user_id,id(n));
   assert.equal(v.roster.length,42);assert.equal(v.parties.length,1);
   assert(v.profiles.every(x=>x.user_id===id(n)||n===41),'Private biographies/other users must not leak');
   assert(v.profiles.every(x=>x.bio===null),'Biography omitted');
   assert(v.formal_documents.every(x=>x.body_text===null&&JSON.stringify(x.metadata)==='{}'),'No full legal documents in entry');
   for(const name of ['metrics','channels','stages','votes','crises','profiles','formal_documents','roster','parties'])
    assert(v[name].every(x=>x.game_id===game),'No cross-game data from '+name);
   for(const key of omitted)assert(!Object.hasOwn(v,key),'Cold data not sent: '+key);
  }
  await as(1);await assert.rejects(read(foreign),e=>e.code==='42501','Other room denied');
  await as(null);await assert.rejects(read(),e=>e.code==='42501','Missing session denied');
  await db.exec('reset role');await db.exec('set role anon');
  await assert.rejects(read(),e=>e.code==='42501','Anonymous RPC denied');
  console.log('PASS: 40 synthetic players, teacher and guest; 12 RLS groups, 3 cold groups deferred, no cross-game/anonymous leakage');
 }finally{await db.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
