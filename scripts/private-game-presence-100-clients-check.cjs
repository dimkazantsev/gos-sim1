/* ГОС.ID step 4/9: private Presence on the existing game room.
 * PGlite policies and 100 synthetic clients only: zero production writes. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {harness}=require('./republic-game-resilience-check.cjs');
const root=path.resolve(__dirname,'..');
const old=fs.readFileSync(path.join(root,'supabase/migrations/20261029180000_private_game_broadcast_documents.sql'),'utf8');
const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261029200000_private_room_presence_track.sql'),'utf8');
const hook=fs.readFileSync(path.join(root,'components/game/useRepublicGame.ts'),'utf8');
const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const game=uid(900),other=uid(901),topic='gos-id-live:'+game;
assert(sql.includes("extension = 'presence'"),'Only Presence extension must be writable');
assert(!sql.includes("extension in ('presence','broadcast')"),'Cannot grant client Broadcast write');
assert(sql.includes('private.is_game_member'),'Room membership must remain server-side');
assert(sql.includes('private.is_game_member(substring(realtime.topic() from')&&sql.includes('gos-id-live:([0-9a-f]{8}'),'Regex extraction must reject malformed rooms without throwing');
assert(hook.includes('channel.track({connected:true})'),'Track minimal anonymous state');
assert(hook.includes('channel.untrack()'),'Hidden client must cease presence');
assert(!hook.includes('channel.track({user_id:')&&!hook.includes('channel.track({full_name:'),'Never expose names or identifiers');
assert(hook.includes("const channel=supabase.channel('gos-id-live:'+gameId,{config:{private:true}})"),'No second channel or public fallback');
assert(hook.includes('record_my_game_presence'),'Persist existing authoritative SQL and navigation ledger');

async function verifyRls(){
 const db=new PGlite();
 try{
  await db.exec("create role authenticated;create role anon;create schema auth;create schema private;create schema realtime;");
  await db.exec("create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;");
  await db.exec("create function realtime.topic() returns text language sql stable as $$select current_setting('request.jwt.claim.realtime_topic',true)$$;");
  await db.exec("create table public.game_members(game_id uuid,user_id uuid,kind text,primary key(game_id,user_id));");
  await db.exec("create function private.is_game_member(g uuid) returns boolean language sql stable security definer set search_path='' as $$select auth.uid() is not null and exists(select 1 from public.game_members m where m.game_id=g and m.user_id=auth.uid())$$;");
  await db.exec("create table realtime.messages(id bigint generated always as identity primary key,topic text,event text,payload jsonb,extension text,private boolean);alter table realtime.messages enable row level security;");
  await db.exec("create function realtime.send(p_payload jsonb,p_event text,p_topic text,p_private boolean) returns void language plpgsql security definer set search_path='' as $$begin insert into realtime.messages(topic,event,payload,extension,private) values(p_topic,p_event,p_payload,'broadcast',p_private);end;$$;");
  await db.exec("create table public.party_documents(id uuid primary key,game_id uuid,status text);");
  await db.exec("grant usage on schema auth,private,realtime,public to authenticated;grant usage on schema realtime to anon;grant select,insert on realtime.messages to authenticated;grant execute on function auth.uid(),private.is_game_member(uuid),realtime.topic() to authenticated;");
  await db.exec(old);await db.exec(sql);
  await db.query('insert into public.game_members select $1::uuid,(\'00000000-0000-4000-8000-\'||lpad(i::text,12,\'0\'))::uuid,case when i=101 then \'teacher\' when i=102 then \'observer\' else \'student\' end from generate_series(1,102) i',[game]);
  await db.query("insert into public.game_members values($1,$2,'student')",[other,uid(103)]);
  async function send(n,room,extension){
   await db.exec('reset role');
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[n===null?'':uid(n)]);
   await db.query("select set_config('request.jwt.claim.realtime_topic',$1,false)",[room]);
   await db.exec('set role authenticated');
   return db.query('insert into realtime.messages(topic,event,payload,extension,private) values($1,$2,$3,$4,true)',[room,'presence',JSON.stringify({connected:true}),extension]);
  }
  for(let n=1;n<=102;n++)await send(n,topic,'presence');
  await assert.rejects(send(1,topic,'broadcast'),error=>error.code==='42501','Broadcast must remain denied');
  await assert.rejects(send(1,'gos-id-live:'+other,'presence'),error=>error.code==='42501','Other game denied');
  await assert.rejects(send(103,topic,'presence'),error=>error.code==='42501','Foreign member denied');
  await assert.rejects(send(null,topic,'presence'),error=>error.code==='42501','No JWT denied');
  await assert.rejects(send(1,'gos-id-live:not-a-uuid','presence'),error=>error.code==='42501','Malformed topic denied');
  await db.exec('reset role');
  const messages=(await db.query('select topic,extension,payload,private from realtime.messages')).rows;
  assert.equal(messages.length,102);
  assert(messages.every(row=>row.topic===topic&&row.extension==='presence'&&row.private));
  assert(messages.every(row=>JSON.stringify(row.payload)==='{"connected":true}'),'Never leak user data in presence');
  console.log('PASS: server RLS for 100 players, teacher and observer; foreign game, anon and client Broadcast denied');
 }finally{await db.close()}
}
async function verifyClients(){
 const N=100,tabs=Array.from({length:N},(_,i)=>{const h=harness({effects:true});h.setUser('student-'+i);return h});
 try{
  await Promise.all(tabs.map(h=>h.settle()));
  for(const h of tabs){
   const c=h.channelsInfo();assert.equal(c.length,1,'Only existing private channel, no second WebSocket');
   assert.equal(c[0].private,true);
   assert.equal(c[0].tracked,1,'One track after authenticated subscription');
   assert.equal(c[0].untracked,0);
   assert.equal(JSON.stringify(c[0].presencePayloads),'[{"connected":true}]','No identity, view or private content');
  }
  const before=tabs.map(h=>h.stats().requests);
  await Promise.all(tabs.map(h=>h.advance(60000)));
  assert(tabs.every((h,i)=>h.stats().requests>=before[i]),'Existing background work remains intact');
  assert(tabs.every(h=>h.channelsInfo()[0].tracked===1),'No repeated track on stage updates or heartbeat timers');
  tabs.forEach(h=>h.visible('hidden'));
  await Promise.all(tabs.map(h=>h.settle()));
  assert(tabs.every(h=>h.channelsInfo()[0].untracked===1),'Hidden tabs untrack');
  tabs.forEach(h=>h.visible('visible'));
  await Promise.all(tabs.map(h=>h.settle()));
  assert(tabs.every(h=>h.channelsInfo()[0].tracked===2),'Returning tabs track exactly once');
  tabs.forEach(h=>h.channelStatus('CHANNEL_ERROR'));
  await Promise.all(tabs.map(h=>h.settle()));
  tabs.forEach(h=>h.channelStatus('SUBSCRIBED'));
  await Promise.all(tabs.map(h=>h.settle()));
  assert(tabs.every(h=>h.channelsInfo()[0].tracked===3),'Reconnect retries once, without extra channel');
  assert(tabs.every(h=>h.channelsInfo().length===1));
  // When a previous socket's track acknowledgement arrives only after a
  // subsequent reconnect, it cannot suppress tracking on the new socket.
  tabs.forEach(h=>h.holdNextPresenceTrack());
  tabs.forEach(h=>h.channelStatus('CHANNEL_ERROR'));
  tabs.forEach(h=>h.channelStatus('SUBSCRIBED'));
  await Promise.all(tabs.map(h=>h.settle()));
  assert(tabs.every(h=>h.channelsInfo()[0].tracked===4),'One delayed track per tab');
  tabs.forEach(h=>h.channelStatus('CHANNEL_ERROR'));
  tabs.forEach(h=>h.channelStatus('SUBSCRIBED'));
  await Promise.all(tabs.map(h=>h.settle()));
  assert(tabs.every(h=>h.channelsInfo()[0].tracked===4),'Do not overlap track calls during reconnect');
  tabs.forEach(h=>h.releasePresenceTrack());
  await Promise.all(tabs.map(h=>h.settle()));
  assert(tabs.every(h=>h.channelsInfo()[0].tracked===5),'A stale ACK cannot mark the new socket as tracked');
  assert(tabs.every(h=>h.channelsInfo().length===1),'No duplicate connection when recovering from a stale ACK');
  for(const h of tabs){
   assert.equal(h.rpcCount('record_my_game_presence'),0,'Network presence does not generate SQL heartbeat');
  }
  console.log('PASS: 100 synthetic tabs; 1 private channel; track once, hidden untrack, restored reconnect; no extra RPC');
 }finally{tabs.forEach(h=>h.dispose())}
 const failed=harness({effects:true});
 try{
  failed.failPresenceTrack();
  await failed.settle();
  assert.equal(failed.channelsInfo()[0].tracked,1);
  await failed.advance(30000);
  assert.equal(failed.channelsInfo()[0].tracked,1,'Rejected track cannot cause a retry storm');
  failed.visible('hidden');await failed.settle();
  failed.visible('visible');await failed.settle();
  assert.equal(failed.channelsInfo()[0].tracked,2,'Explicit focus can retry after failure');
 }finally{failed.dispose()}
}
(async()=>{await verifyRls();await verifyClients()})().catch(error=>{console.error(error);process.exitCode=1});
