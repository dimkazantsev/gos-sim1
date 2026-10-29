/* ГОС.ID Step 3: private room Broadcast + tenant isolation.
 * Isolated PGlite RLS model and 100 synthetic hook clients; no production writes. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {harness}=require('./republic-game-resilience-check.cjs');
const repo=path.join(__dirname,'..');
const migration=fs.readFileSync(path.join(repo,'supabase/migrations/20261029180000_private_game_broadcast_documents.sql'),'utf8');
const hook=fs.readFileSync(path.join(repo,'components/game/useRepublicGame.ts'),'utf8');
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const game=uuid(900),another=uuid(901),topic='gos-id-live:'+game;
assert(migration.includes('on realtime.messages')&&migration.includes('private.is_game_member'),'Room membership required in Realtime RLS');
assert(migration.includes('case\n    when realtime.topic() ~'),'Malformed topic must never cast to UUID');
assert(migration.includes("jsonb_build_object('table','party_documents')"),'Only table name may be sent');
assert(!migration.includes('realtime.broadcast_changes'),'Full row/old row must never be sent');
assert(migration.includes('set search_path = \'\''),'SECURITY DEFINER must use empty search_path');
assert(migration.includes('revoke all on function private.broadcast_party_document_invalidation()'),'Trigger helper must not be callable');
assert(hook.includes("supabase.channel('gos-id-live:'+gameId,{config:{private:true}})"),'Single private room channel required');
assert(hook.includes("supabase.realtime.setAuth()"),'JWT must be set before joining');
assert(hook.includes("channel.on('broadcast',{event:'party_documents_changed'}"),'Browser must listen to private Broadcast');
assert(!hook.includes("channel.on('postgres_changes',{event:'*',schema:'public',table:'party_documents'"),'Remove old direct subscription for same table');
assert(hook.includes("if(partyDocs&&(activeViewRef.current==='parties'||activeViewRef.current==='teacher'))void loadPartyDocuments()"),'Only active party/teacher screens load changed document rows');

async function sqlTest(){
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
  await db.exec("grant usage on schema auth,private,realtime,public to authenticated;grant usage on schema realtime to anon;");
  await db.exec("grant execute on function auth.uid(),private.is_game_member(uuid),realtime.topic() to authenticated;grant select on realtime.messages to authenticated;");
  for(let i=1;i<=42;i++)await db.query('insert into public.game_members values($1,$2,$3)',[game,uuid(i),i===41?'teacher':i===42?'observer':'student']);
  await db.query("insert into public.game_members values($1,$2,'teacher')",[another,uuid(43)]);
  await db.exec(migration);
  const doc=uuid(501),foreign=uuid(502);
  await db.query('insert into public.party_documents values($1,$2,$3)',[doc,game,'draft']);
  await db.query('update public.party_documents set status=$2 where id=$1',[doc,'accepted']);
  await db.query('delete from public.party_documents where id=$1',[doc]);
  await db.query('insert into public.party_documents values($1,$2,$3)',[foreign,another,'draft']);
  const sent=(await db.query('select topic,event,payload,is_private from realtime.messages order by id')).rows;
  assert.equal(sent.length,4,'One private Broadcast per persisted INSERT, UPDATE, DELETE');
  assert(sent.slice(0,3).every(x=>x.topic===topic));
  assert.equal(sent[3].topic,'gos-id-live:'+another,'Different game has separate topic');
  assert(sent.every(x=>x.event==='party_documents_changed'&&x.is_private===true),'Private channel required');
  assert(sent.every(x=>JSON.stringify(x.payload)==='{"table":"party_documents"}'),'No private data or document IDs in payload');
  async function role(n,rt=topic,dbRole='authenticated'){
   await db.exec('reset role');
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[n?uuid(n):'']);
   await db.query("select set_config('request.jwt.claim.realtime_topic',$1,false)",[rt]);
   await db.exec('set role '+dbRole);
   return (await db.query('select count(*)::int as total from realtime.messages where topic=$1',[rt])).rows[0].total;
  }
  for(let n=1;n<=42;n++)assert.equal(await role(n),3,'Valid room member may subscribe: '+n);
  assert.equal(await role(1,'gos-id-live:'+another),0,'No cross-game authorization');
  assert.equal(await role(43,topic),0,'Foreign game teacher blocked');
  assert.equal(await role(43,'gos-id-live:'+another),1,'Foreign game teacher sees only own topic');
  assert.equal(await role(null),0,'Unsigned client blocked');
  assert.equal(await role(1,'gos-id-live:not-a-uuid'),0,'Malformed topic denied without cast error');
  await assert.rejects(role(1,topic,'anon'),e=>e.code==='42501','Anonymous Postgres role lacks SELECT');
  console.log('PASS: SQL: 40 students, teacher, guest, other game, anon, malformed topic; 4 private metadata-only triggers');
 }finally{await db.close()}
}

async function hookTest(){
 const clients=Array.from({length:100},(_,i)=>{const h=harness({effects:true});h.setUser('student-'+i);return h});
 try{
  await Promise.all(clients.map(async h=>{await h.settle();h.render().setActiveView('parties');await h.settle()}));
  for(const h of clients){
   const rooms=h.channelsInfo();
   assert.equal(rooms.length,1,'One shared game channel per tab');
   assert.equal(rooms[0].topic,'gos-id-live:game-a','Room topic is game-scoped, never user-scoped');
   assert.equal(rooms[0].private,true,'Room channel must be private');
   assert.equal(rooms[0].handlers.filter(x=>x.kind==='broadcast'&&x.event==='party_documents_changed').length,1);
   assert.equal(rooms[0].handlers.filter(x=>x.kind==='postgres_changes'&&x.table==='party_documents').length,0);
  }
  const before=clients.map(h=>h.readCount('party_documents'));
  clients.forEach(h=>h.broadcast('gos-id-live:game-b','party_documents_changed',{table:'party_documents'}));
  await Promise.all(clients.map(h=>h.settle()));
  assert(clients.every((h,i)=>h.readCount('party_documents')===before[i]),'Cross-room Broadcast ignored');
  clients.forEach(h=>h.broadcast('gos-id-live:game-a','party_documents_changed',{table:'party_documents'}));
  await Promise.all(clients.map(h=>h.settle()));
  assert(clients.every((h,i)=>h.readCount('party_documents')===before[i]),'No premature 100-client reads before the 600ms coalescing window');
  await Promise.all(clients.map(h=>h.advance(650)));
  assert(clients.every((h,i)=>h.readCount('party_documents')===before[i]+1),'Every party screen reconciles exactly once after the first delta');
  const snapshot=clients.map(h=>h.readCount('party_documents'));
  clients.forEach(h=>h.broadcast('gos-id-live:game-a','party_documents_changed',{table:'unexpected_table'}));
  await Promise.all(clients.map(h=>h.settle()));
  assert(clients.every((h,i)=>h.readCount('party_documents')===snapshot[i]),'Unknown Broadcast payload ignored');
  // Eight separate events 50ms apart (<600ms) previously could trigger
  // 8 reads per interested client. Bounded coalescing must issue exactly one.
  const burstBaseline=clients.map(h=>h.readCount('party_documents'));
  for(let n=0;n<8;n++){
   clients.forEach(h=>h.broadcast('gos-id-live:game-a','party_documents_changed',{table:'party_documents'}));
   await Promise.all(clients.map(h=>h.advance(50)));
  }
  assert(clients.every((h,i)=>h.readCount('party_documents')===burstBaseline[i]),'Eight events remain queued until first broadcast window');
  await Promise.all(clients.map(h=>h.advance(250)));
  const burstReads=clients.reduce((total,h,i)=>total+h.readCount('party_documents')-burstBaseline[i],0);
  assert.equal(burstReads,100,'8 broadcasts across 100 viewers need only 100 document reads, not 800');
  // A pending flag must survive visibility changes; a suspended tab never
  // reads in the background and returns to an up-to-date party view.
  const one=clients[0],hiddenBefore=one.readCount('party_documents');
  one.visible('hidden');
  one.broadcast('gos-id-live:game-a','party_documents_changed',{table:'party_documents'});
  await one.advance(800);
  assert.equal(one.readCount('party_documents'),hiddenBefore,'Hidden party screen may not load documents');
  one.visible('visible');await one.settle();
  assert.equal(one.readCount('party_documents'),hiddenBefore+1,'Visibility recovery reconciles pending broadcast');
  console.log(JSON.stringify({status:'PASS',clients:100,burstEventsPerClient:8,expectedUnbatchedReads:800,measuredSyntheticReads:burstReads,reductionPct:87.5,wrongRoomReads:0,hiddenRecovered:true,transport:'synthetic; not a 100-JWT real network load test'}));
 }finally{clients.forEach(h=>h.dispose())}
}
(async()=>{await sqlTest();await hookTest()})().catch(e=>{console.error(e);process.exitCode=1});
