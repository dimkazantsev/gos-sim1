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
 'Short-hidden tabs untrack Presence before any channel suspension');
assert(core.includes('realtimeIdleWakeGame.current=gameId')&&core.includes('setRealtimeIdleSuspended(true)'),
 'Five-minute idle suspension is bounded to the current game');
assert(core.includes('realtimeLeavePending.current=supabase.removeChannel(channel)'),
 'Idle suspension removes server subscriptions, not Auth');
assert(core.includes('hiddenAt=Date.now()-30000;')&&core.includes('resumePending();'),
 'Foreground wake reconciles missed data without reloading the entire game');
assert(widgets.includes('function pausePolling()')&&widgets.includes('function startPolling()'),
 'Visible stage widget polls should not wake hidden tabs');
assert(widgets.includes("if(document.visibilityState!=='visible'){\n    if(!hiddenAt)hiddenAt=Date.now();"),
 'Unmounted or inactive stage widgets retain their queued work');
assert(budget.includes('function stopPolling()')&&budget.includes('dirtyWhileHidden'),
 'Expensive budget refreshes must not poll when hidden');
assert(core.includes('},300000);'),
 'Brief background switches must never disconnect the game socket');

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
  await Promise.all(clients.map(h=>h.advance(240000)));
  assert(clients.every(h=>h.channelsInfo().length===1),
   'A short four-minute background stay retains its existing private room');
  await Promise.all(clients.map(h=>h.advance(360001)));
  assert(clients.every(h=>h.channelsInfo().length===0),
   'After five minutes, all 100 hidden clients release their server subscriptions');
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
  // The old channel may take seconds to acknowledge its leave. In that case
  // no duplicate room may be constructed until the leave is complete.
  const delayed=harness({effects:true});
  try{
   await delayed.settle();
   delayed.holdRoomLeave();
   delayed.visible('hidden');
   await delayed.advance(300001);
   assert.equal(delayed.channelsInfo().length,1,'Old room remains until the server ACK');
   delayed.visible('visible');
   await delayed.settle();
   assert.equal(delayed.channelsInfo().length,1,'No replacement room while old leave is pending');
   delayed.releaseRoomLeave();
   await delayed.settle();
   assert.equal(delayed.channelsInfo().length,1,'Precisely one new private room after delayed leave');
   assert(delayed.channelsInfo()[0].private,'A rejoined room must still be private');
  }finally{delayed.releaseRoomLeave();delayed.dispose()}
  console.log('PASS: delayed unsubscribe acknowledgment cannot create overlapping same-topic rooms.');
  console.log('PASS: 100 clients, 4 minutes hidden retain push, 10 minutes hidden release 100 private subscriptions, 0 REST requests.');
  console.log('PASS: 100 clients reconnect one private game channel with scoped recovery and no full game bootstrap.');
 }finally{clients.forEach(h=>h.dispose());}
}
main().catch(e=>{console.error(e);process.exitCode=1});
