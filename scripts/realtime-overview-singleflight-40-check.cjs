/* Step 6: deterministic in-flight deduplication; no production traffic. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const vm=require('node:vm');
const source=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
const helper=fs.readFileSync('components/game/coalesceInFlight.ts','utf8');
assert(source.includes("return coalesceInFlight(chatOverviewReads.current,scope,async()=>"),
 'Chat overview must share in-flight RPCs');
assert(source.includes("const scope=gameId+':'+uid+':'+readEpoch.current"),
 'Never share RPCs across games, users or auth generations');
assert(source.includes('chatOverviewReads.current.clear()'),
 'Sign-out/role change must clear the pending map');
assert(source.includes("if(liveConnected&&now-lastChatRecoveryAt<60000)return"),
 'Connected chat recovery must remain low frequency');
assert(source.includes('chatRecovery=setInterval(recoverVisibleChatAndBallots,6000)'),
 'Disconnected recovery must retain six-second cadence');
const module={exports:{}};
const js=ts.transpileModule(helper,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext('(function(module,exports){'+js+'})',{})(module,module.exports);
const {coalesceInFlight}=module.exports;
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}};
(async()=>{
 let actual=0;
 const sessions=Array.from({length:40},(_,i)=>({reads:new Map(),uid:'student-'+i}));
 const held=sessions.map(()=>deferred());
 const batches=sessions.map((s,i)=>{
  const key='game-a:'+s.uid+':1';
  const read=()=>{actual++;return held[i].promise};
  return [coalesceInFlight(s.reads,key,read),coalesceInFlight(s.reads,key,read),coalesceInFlight(s.reads,key,read)];
 });
 assert.equal(actual,0,'Creation happens in a microtask');
 await Promise.resolve();
 assert.equal(actual,40,'40 overlapping sets of 3 triggers must issue just 40 RPCs, not 120');
 held.forEach(x=>x.resolve([{channel_id:'general',unread_count:0}]));
 await Promise.all(batches.flat());
 await Promise.resolve();
 assert.equal(sessions.reduce((n,s)=>n+s.reads.size,0),0,'Resolved requests are never cached');
 await Promise.all(sessions.map(s=>coalesceInFlight(s.reads,'game-a:'+s.uid+':1',async()=>{actual++;return []})));
 assert.equal(actual,80,'A later recovery still reads fresh values');
 const same=sessions[0],pending=deferred();
 const p=coalesceInFlight(same.reads,'game-a:'+same.uid+':1',()=>{actual++;return pending.promise});
 const q=coalesceInFlight(same.reads,'game-b:'+same.uid+':1',async()=>{actual++;return []});
 await q;pending.resolve([]);await p;
 assert.equal(actual,82,'Separate rooms must never share pending reads');
 console.log(JSON.stringify({status:'PASS',clients:40,triggersPerClient:3,uncoalescedRPCs:120,actualRPCs:40,avoidedRPCs:80,reductionPercent:67,scenario:'synthetic overlapping RPC requests, no network or database traffic, no actual players'}));
})().catch(e=>{console.error(e);process.exitCode=1});
