'use strict';
// Isolated real hook test with virtual timers; no production/backend requests.
const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm');
const hook=fs.readFileSync('components/game/useGameTableSync.ts','utf8');
const gameClient=fs.readFileSync('components/GameClient.tsx','utf8');
const js=ts.transpileModule(hook,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
assert(gameClient.includes("firstPresenceWriteDelay(me.user_id+':event-badge')+3000"));
assert(gameClient.includes("firstPresenceWriteDelay(me.user_id+':blitz-badge')+3000"));
assert(gameClient.includes("},counterScope,undefined,750,30000,firstEventBadgeDelay)"));
assert(gameClient.includes("},counterScope,undefined,750,60000,firstBlitzBadgeDelay)"));
function testClient(index,initialDelay){
 let clock=0,reads=0,cleanup;
 const timers=[],windowListeners=new Map(),docListeners=new Map();
 const on=(map,key,cb)=>map.set(key,cb);
 const off=(map,key,cb)=>{if(map.get(key)===cb)map.delete(key)};
 const api={
  module:{exports:{}},console,Promise,Math,
  Date:{now:()=>clock},
  window:{addEventListener:(k,f)=>on(windowListeners,k,f),removeEventListener:(k,f)=>off(windowListeners,k,f)},
  document:{visibilityState:'visible',addEventListener:(k,f)=>on(docListeners,k,f),removeEventListener:(k,f)=>off(docListeners,k,f)},
  setTimeout:(fn,ms)=>{const t={fn,at:clock+ms,cancelled:false};timers.push(t);return t},
  clearTimeout:t=>{if(t)t.cancelled=true},
  setInterval:()=>({interval:true}),clearInterval:()=>{}
 };
 const react={useRef:value=>({current:value}),useEffect:fn=>{cleanup=fn()}};
 const requireMock=p=>{if(p==='react')return react;throw Error('Unexpected import '+p)};
 api.exports=api.module.exports;
 vm.runInNewContext('(function(require,module,exports){'+js+'})',api)(requireMock,api.module,api.exports);
 api.module.exports.useGameTableSync('game-a',['event_assignments'],async()=>{reads++},'student-'+index,undefined,750,30000,initialDelay);
 const fire=(key='gos-sims:refresh')=>{
  const callback=windowListeners.get(key);
  assert(callback,'Refresh handler installed');
  callback({detail:{gameId:'game-a',table:'event_assignments'}});
 };
 const moveTo=async at=>{
  clock=at;
  for(let pass=0;pass<5;pass++){
   const ready=timers.filter(t=>!t.cancelled&&t.at<=clock);
   if(!ready.length)break;
   ready.forEach(t=>{t.cancelled=true;t.fn()});
   await Promise.resolve();await Promise.resolve();
  }
 };
 return {timers,fire,moveTo,get reads(){return reads},dispose:()=>cleanup?.()};
}
(async()=>{
 const clients=Array.from({length:100},(_,i)=>testClient(i,5000+i*100));
 assert(clients.every(c=>c.reads===0),'100 entrants must not start optional badge RPCs during entry');
 await Promise.all(clients.map(c=>c.moveTo(4999)));
 assert(clients.every(c=>c.reads===0),'Optional requests cannot start before the deadline');
 await Promise.all(clients.map(c=>c.moveTo(15000)));
 assert(clients.every(c=>c.reads===1),'Each participant must eventually obtain exactly one initial badge read');
 clients.forEach(c=>c.dispose());
 const changed=testClient(999,15000);
 changed.fire();
 await changed.moveTo(121);
 assert.equal(changed.reads,1,'New Realtime event must preempt delayed initial read');
 await changed.moveTo(18000);
 assert.equal(changed.reads,1,'The cancelled delayed initial request must not fire a duplicate');
 changed.dispose();
 console.log(JSON.stringify({result:'PASS',clients:100,initialOptionalReadsAtAdmission:0,
  finalReads:100,refreshPreemptsDelay:true,duplicateInitialQueries:0,
  serverRequests:0,scenario:'actual useGameTableSync hook with isolated virtual timers'}));
})().catch(e=>{console.error(e);process.exitCode=1});
