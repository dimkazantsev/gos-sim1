/* ГОС.ID step 3/9: no-content private party Broadcast and 100 synthetic clients.
 * PGlite schema is isolated; never writes to live Supabase. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {harness}=require('./republic-game-resilience-check.cjs');
const root=path.join(__dirname,'..');
const first=fs.readFileSync(path.join(root,'supabase/migrations/20261029180000_private_game_broadcast_documents.sql'),'utf8');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261029194000_game_parties_private_broadcast.sql'),'utf8');
const hook=fs.readFileSync(path.join(root,'components/game/useRepublicGame.ts'),'utf8');
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const a=uuid(900),b=uuid(901),topic='gos-id-live:'+a;
assert(migration.includes("jsonb_build_object('table', 'game_parties')"),'Never send party data');
assert(!migration.includes('realtime.broadcast_changes'),'Do not send full NEW/OLD records');
assert(migration.includes("set search_path = ''"),'Definer search path must be fixed');
assert(migration.includes('revoke all on function private.broadcast_game_parties_invalidation()'),'The trigger must not be exposed as public RPC');
assert(hook.includes("channel.on('broadcast',{event:'game_parties_changed'}"),'Use the existing private game channel');
assert(!hook.includes("'game_stages','game_parties','party_invitations'"),'Remove the redundant Postgres Changes listener');
assert(hook.includes("reconcileTables.add('game_parties')"),'Preserve the authorised RLS refresh');
assert(hook.includes("invalidatePartyRows()"),'Old party presentation cache must be invalidated');

async function rls(){
 const db=new PGlite();
 try{
  await db.exec("create role authenticated;create role anon;create schema auth;create schema private;create schema realtime;");
  await db.exec("create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;");
  await db.exec("create function realtime.topic() returns text language sql stable as $$select current_setting('request.jwt.claim.realtime_topic',true)$$;");
  await db.exec("create table public.game_members(game_id uuid,user_id uuid,kind text,primary key(game_id,user_id));");
  await db.exec("create function private.is_game_member(g uuid) returns boolean language sql stable security definer set search_path='' as $$select auth.uid() is not null and exists(select 1 from public.game_members m where m.game_id=g and m.user_id=auth.uid())$$;");
  await db.exec("create table realtime.messages(id bigint generated always as identity primary key,topic text,event text,payload jsonb,is_private boolean);alter table realtime.messages enable row level security;");
  await db.exec("create function realtime.send(p_payload jsonb,p_event text,p_topic text,p_private boolean) returns void language plpgsql security definer set search_path='' as $$begin insert into realtime.messages(topic,event,payload,is_private) values(p_topic,p_event,p_payload,p_private);end;$$;");
  await db.exec("create table public.party_documents(id uuid primary key,game_id uuid,status text);");
  await db.exec("create table public.game_parties(id uuid primary key,game_id uuid,name text);");
  await db.exec("grant usage on schema auth,private,realtime,public to authenticated;grant usage on schema realtime to anon;grant select on realtime.messages to authenticated;grant execute on function auth.uid(),private.is_game_member(uuid),realtime.topic() to authenticated;");
  await db.exec(first);await db.exec(migration);
  await db.query("insert into public.game_members select $1::uuid,('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'student' from generate_series(1,100) i",[a]);
  await db.query("insert into public.game_members values($1,$2,'teacher'),($1,$3,'observer'),($4,$5,'teacher')",[a,uuid(101),uuid(102),b,uuid(103)]);
  const row=uuid(501);
  await db.query('insert into public.game_parties(id,game_id,name) values($1,$2,$3)',[row,a,'Private name not for Broadcast']);
  await db.query('update public.game_parties set name=$2 where id=$1',[row,'Second private name']);
  await db.query('update public.game_parties set game_id=$2 where id=$1',[row,b]);
  await db.query('delete from public.game_parties where id=$1',[row]);
  const items=(await db.query('select topic,event,payload,is_private from realtime.messages order by id')).rows;
  assert.equal(items.length,5,'Insert, update, cross-game update(2) and delete must publish 5 signals');
  assert.deepEqual(items.map(x=>x.topic),[topic,topic,'gos-id-live:'+b,topic,'gos-id-live:'+b],'Game move invalidates both sides');
  assert(items.every(x=>x.event==='game_parties_changed'&&x.is_private===true));
  assert(items.every(x=>JSON.stringify(x.payload)==='{"table":"game_parties"}'),'No name, leader, ID or other party data in Broadcast');
  async function count(id,target=topic,role='authenticated'){
   await db.exec('reset role');
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id?uuid(id):'']);
   await db.query("select set_config('request.jwt.claim.realtime_topic',$1,false)",[target]);
   await db.exec('set role '+role);
   return (await db.query('select count(*)::int n from realtime.messages where topic=$1',[target])).rows[0].n;
  }
  for(let id=1;id<=102;id++)assert.equal(await count(id),3,'Room members including teacher/observer can receive only their game topic');
  assert.equal(await count(103),0,'Another game teacher cannot read room');
  assert.equal(await count(103,'gos-id-live:'+b),2,'Another game teacher sees only their own room');
  assert.equal(await count(null),0,'Unsigned user receives no private events');
  assert.equal(await count(1,'gos-id-live:not-uuid'),0,'Malformed topic rejects without UUID exception');
  await assert.rejects(count(1,topic,'anon'),e=>e.code==='42501','Anonymous SQL role forbidden');
  console.log('PASS: RLS 100 students, teacher, observer, foreign teacher, anon; 5 private table-only game party events');
 }finally{await db.close()}
}

async function clients(){
 const N=100;
 const tabs=Array.from({length:N},(_,i)=>{const h=harness({effects:true});h.setUser('student-'+i);return h});
 try{
  await Promise.all(tabs.map(async h=>{await h.settle();h.render().setActiveView('parties');await h.settle()}));
  for(const h of tabs){
   const c=h.channelsInfo();assert.equal(c.length,1,'Only one channel per tab');
   assert.equal(c[0].private,true);
   assert.equal(c[0].handlers.filter(x=>x.kind==='broadcast'&&x.event==='game_parties_changed').length,1);
   assert.equal(c[0].handlers.filter(x=>x.kind==='postgres_changes'&&x.table==='game_parties').length,0);
  }
  const baseline=tabs.map(h=>h.readCount('game_parties')), core=tabs.map(h=>h.readCount('games'));
  tabs.forEach(h=>h.broadcast('gos-id-live:game-b','game_parties_changed',{table:'game_parties'}));
  await Promise.all(tabs.map(h=>h.settle()));
  assert(tabs.every((h,i)=>h.readCount('game_parties')===baseline[i]),'Foreign room ignored');
  tabs.forEach(h=>h.broadcast('gos-id-live:game-a','game_parties_changed',{table:'unknown'}));
  await Promise.all(tabs.map(h=>h.settle()));
  assert(tabs.every((h,i)=>h.readCount('game_parties')===baseline[i]),'Wrong table tag ignored');
  tabs.forEach(h=>{h.setRevision(2);h.broadcast('gos-id-live:game-a','game_parties_changed',{table:'game_parties'})});
  await Promise.all(tabs.map(h=>h.advance(3400)));
  assert(tabs.every((h,i)=>h.readCount('game_parties')>baseline[i]),'All 100 tabs refresh party rows after Broadcast');
  assert(tabs.every((h,i)=>h.readCount('games')===core[i]),'No full game bootstrap for party changes');
  assert(tabs.every(h=>h.render().parties.length===1),'Party presentation remains available');
  console.log('PASS: 100 synthetic clients, one private socket per tab, no duplicate table subscription, no full reload');
 }finally{tabs.forEach(h=>h.dispose())}
}
(async()=>{await rls();await clients()})().catch(e=>{console.error(e);process.exitCode=1});
