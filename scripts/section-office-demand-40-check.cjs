'use strict';
// Isolated real-hook regressions, no production requests.
const assert=require('node:assert/strict');
const {harness}=require('./republic-game-resilience-check.cjs');
(async()=>{
 const clients=Array.from({length:40},(_,i)=>{const h=harness({effects:true});h.setUser('student-'+i);return h});
 try{
  await Promise.all(clients.map(h=>h.settle()));
  for(const h of clients){
   assert.equal(h.readCount('game_office_assignments'),0,'Initial lobby cannot read offices');
   h.render().openDetailedDashboard();
  }
  await Promise.all(clients.map(h=>h.settle()));
  for(const h of clients){
   assert.equal(h.rpcCount('get_game_entry_v5'),1,'Full overview must retain core projection');
   assert.equal(h.readCount('game_office_assignments'),0,'Dashboard has no reason to fetch office rows');
  }
  await Promise.all(clients.map(async(h,i)=>{
   h.render().setActiveView(i%2?'stages':'documents');await h.settle();
  }));
  for(let i=0;i<clients.length;i++){
   const rows=clients[i].readCount('game_office_assignments');
   assert.equal(rows,i%2?1:0,'Only role-dependent stages should load offices');
  }
  const forced=clients[0];
  await forced.render().refresh();
  assert.equal(forced.readCount('game_office_assignments'),1,'Explicit refresh still honours the force option');
  console.log(JSON.stringify({result:'PASS',syntheticClients:40,initialOfficeReads:0,
   overviewOfficeReads:0,stageOfficeReads:20,documentOfficeReads:0,
   manualRefreshRestoresOffices:true,backendCalls:0}));
 }finally{clients.forEach(h=>h.dispose())}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
