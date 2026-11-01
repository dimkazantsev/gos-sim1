'use strict';
// Executes the real game hook against a bounded synthetic transport.
// No production Auth, database or network requests.
const assert=require('node:assert/strict');
const {harness}=require('./republic-game-resilience-check.cjs');
(async()=>{
 const clients=Array.from({length:40},(_,i)=>{
  const h=harness({effects:true});h.setUser('student-'+i);return h;
 });
 try{
  await Promise.all(clients.map(h=>h.settle()));
  for(const h of clients){
   assert.equal(h.render().coreLoaded,false);
   assert.equal(h.rpcCount('get_game_entry_v5'),0);
   h.render().setChatOpen(true);
  }
  await Promise.all(clients.map(h=>h.settle()));
  for(const h of clients){
   assert.equal(h.rpcCount('get_game_entry_v5'),0,'Opening chat must not scan 12 game projections');
   assert.equal(h.render().coreLoaded,false,'Chat is separate from full game bootstrap');
   assert.equal(h.readCount('chat_channels'),1,'Exactly one RLS chat-directory read per player');
   assert.equal(h.readCount('game_members'),1,'Exactly one narrow roster read for mentions');
   assert.equal(h.render().chatDirectoryLoaded,true,'Chat directory is ready');
   assert(h.rpcCount('get_my_chat_overview')>=1,'Chat overview must load');
  }
  const first=clients[0];
  first.render().setActiveView('stages');await first.settle();
  assert.equal(first.rpcCount('get_game_entry_v5'),1,'Opening a real game workspace still obtains full data');
  assert.equal(first.render().coreLoaded,true);
  for(const h of clients.slice(1))assert.equal(h.rpcCount('get_game_entry_v5'),0);
  console.log(JSON.stringify({result:'PASS',clients:40,chatOpenBulkReads:0,chatDirectories:40,
   messageOverviews:40,selectedStageBulkReads:1,unchangedChatOnlySessions:39,serverCalls:0}));
 }finally{clients.forEach(h=>h.dispose())}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
