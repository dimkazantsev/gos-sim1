/* ГОС.ID: hidden-page suspension and one coordinated recovery for 100 users.
 * No real HTTP calls, no database writes, no extra websocket subscriptions. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {harness}=require('./republic-game-resilience-check.cjs');
const core=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
const widgets=fs.readFileSync('components/game/useGameTableSync.ts','utf8');
const budget=fs.readFileSync('components/game/useBudgetPulse.ts','utf8');

assert(core.includes('function stopPeriodicPolling()')&&core.includes('function startPeriodicPolling()'),
 'The game shell must stop and restart its TWO periodic timers');
assert(core.includes('if(poll!==null){clearInterval(poll);poll=null}'),
 'The 30-40 second authority safety interval must stop while hidden');
assert(core.includes('if(chatRecovery!==null){clearInterval(chatRecovery);chatRecovery=null}'),
 'The six-second chat timer must stop while hidden');
assert(core.includes("reconcileTables.add('session_recovery')"),
 'Returning viewers still check RLS authority, not a stale local cache');
assert(core.includes('lastPollAt=now; // Prevent a redundant 30-40s fallback read.'),
 'One foreground reconciliation should skip the next duplicate safety check');
assert(core.includes('stopPeriodicPolling();\n    if(realtimeReloadTimer.current!==null)'),
 'One-shot pending reads must remain queued instead of running offscreen');
assert(core.includes('syncNetworkPresence(); // Untrack ephemeral presence once, not Auth.'),
 'Only ephemeral Presence untracks; the authenticated channel stays alive');
assert(widgets.includes('function pausePolling()')&&widgets.includes('function startPolling()'),
 'Visible stage widget polls should not wake hidden tabs');
assert(widgets.includes("if(document.visibilityState!=='visible'){\n    if(!hiddenAt)hiddenAt=Date.now();"),
 'Unmounted or inactive stage widgets retain their queued work');
assert(budget.includes('function stopPolling()')&&budget.includes('dirtyWhileHidden'),
 'Expensive budget refreshes must not poll when hidden');
assert(!/removeChannel\(channel\)[\s\S]*visibilitychange/.test(core),
 'Do not disconnect the game socket on each visibility event');

async function main(){
 const clients=Array.from({length:100},(_,i)=>{
  const h=harness({effects:true});h.setUser('student-'+i);return h;
 });
 try{
  await Promise.all(clients.map(async h=>{await h.settle();await h.advance(7400)}));
  const before=clients.map(h=>({
   requests:h.stats().requests,
   identity:h.rpcCount('get_my_game_identity'),
   entry:h.rpcCount('get_game_entry_v5')
  }));
  assert(clients.every(h=>h.channelsInfo().length===1&&h.channelsInfo()[0].private),
   '100 members retain one private socket each');
  assert(clients.every(h=>h.stats().activeIntervals>=2),
   'While visible, the authority and chat safety intervals exist');

  for(const h of clients)h.visible('hidden');
  assert(clients.every(h=>h.stats().activeIntervals===0),
   'Backgrounding stops all of the game shell periodic intervals');
  await Promise.all(clients.map(h=>h.advance(600001)));
  for(let i=0;i<clients.length;i++){
   const h=clients[i];
   assert.equal(h.stats().requests,before[i].requests,
    '10 minutes hidden must not cause a single unnecessary REST/RPC request');
   assert.equal(h.rpcCount('get_game_entry_v5'),before[i].entry,
    'Never re-bootstrap the entire game while hidden');
   assert.equal(h.stats().activeIntervals,0,
    'Hidden tabs do not wake up for periodic game or chat polls');
  }
  for(const h of clients){
   h.visible('visible');h.signal('focus');h.signal('online');
  }
  await Promise.all(clients.map(h=>h.advance(7400)));
  for(let i=0;i<clients.length;i++){
   const h=clients[i];
   assert.equal(h.rpcCount('get_my_game_identity'),before[i].identity+1,
    'Visibility, focus and online must coalesce into ONE RLS identity check');
   assert.equal(h.rpcCount('get_game_entry_v5'),before[i].entry,
    'Restore only the needed data, not a full entry');
   assert.equal(h.channelsInfo().length,1,
    'Background and resume must never open a second socket');
   assert(h.stats().activeIntervals>=2,
    'Timers resume only after the page is visible');
  }
  console.log('PASS: 100 clients, 10 minutes hidden, 0 new REST requests, 0 polling intervals.');
  console.log('PASS: 3 resume signals -> 1 identity read per user; no re-entry or extra channel.');
 }finally{clients.forEach(h=>h.dispose());}
}
main().catch(e=>{console.error(e);process.exitCode=1});
