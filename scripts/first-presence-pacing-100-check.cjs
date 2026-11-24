'use strict';
// Isolated deterministic 100-student pacing check: no production traffic.
const assert=require('node:assert/strict');
const fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm'),crypto=require('node:crypto');
const delaySource=fs.readFileSync('components/game/firstPresenceWriteDelay.ts','utf8');
const entry=fs.readFileSync('components/GameClient.tsx','utf8');
const js=ts.transpileModule(delaySource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exported={exports:{}};
vm.runInNewContext('(function(module,exports){'+js+'})',{})(exported,exported.exports);
const delay=exported.exports.firstPresenceWriteDelay;
assert.equal(typeof delay,'function');
const bins=Array.from({length:15},()=>0);
const delays=Array.from({length:100},(_,i)=>{
 const hash=crypto.createHash('sha256').update('isolated-student-'+i).digest('hex');
 const userId=hash.slice(0,8)+'-'+hash.slice(8,12)+'-4'+hash.slice(13,16)+'-a'+hash.slice(17,20)+'-'+hash.slice(20,32);
 const v=delay(userId);
 assert.equal(v,delay(userId),'One student must keep a stable deadline across view changes');
 assert(v>=2000&&v<17000,'No optional SQL presence write is immediate');
 bins[Math.floor((v-2000)/1000)]++;
 return v;
});
assert(bins.filter(v=>v>0).length>=12,'Initial SQL writes must cover most seconds');
assert(Math.max(...bins)<=18,'No new single-second stampede for the isolated 100-user sample');
const hook=fs.readFileSync('components/game/usePresenceHeartbeat.ts','utf8');
assert(entry.includes('usePresenceHeartbeat({gameId,userId:me?.user_id,view,enabled:g.coreLoaded&&!previewMode,touchPresence})'));
assert(hook.includes('if(admission.current.scope!==scope)'),'View changes retain admission deadline');
assert(hook.includes('68000+firstPresenceWriteDelay(userId)%6000'));
assert(hook.includes("document.visibilityState==='visible'"));
assert(hook.includes("navigation?'Открыл раздел «'+labels[view]+'»':undefined"));
const schedulerSource=fs.readFileSync('components/game/presenceHeartbeat.ts','utf8');
const schedulerJS=ts.transpileModule(schedulerSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const schedulerModule={exports:{}};
vm.runInNewContext('(function(module,exports){'+schedulerJS+'})',{})(schedulerModule,schedulerModule.exports);
const schedulePresenceHeartbeat=schedulerModule.exports.schedulePresenceHeartbeat;
function verifyScheduler(schedulePresenceHeartbeat,delays){
 let totalHiddenCallbacks=0,oldHiddenCallbacks=0,peakTimers=0;
 for(const readyAt of delays){
  let now=0,visible=true,nextId=0,callbacks=0;const timers=new Map(),writes=[];
  const heartbeatMs=68000+readyAt%6000;
  const options={readyAt,heartbeatMs,write:navigation=>writes.push({at:now,navigation}),isVisible:()=>visible,now:()=>now,
   schedule:(fn,delay)=>{const id=++nextId;timers.set(id,{at:now+delay,fn});peakTimers=Math.max(peakTimers,timers.size);return id},
   cancel:id=>timers.delete(id)};
  function advance(ms){const until=now+ms;while(timers.size){const [id,t]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(t.at>until)break;now=t.at;timers.delete(id);callbacks++;t.fn()}now=until}
  let lifecycle=schedulePresenceHeartbeat(options);
  assert.equal(writes.length,0,'Staggered admission');
  advance(readyAt-1);assert.equal(writes.length,0);
  visible=false;lifecycle.visibilityChanged();const before=callbacks;
  advance(3600000);totalHiddenCallbacks+=callbacks-before;oldHiddenCallbacks+=Math.floor((now)/heartbeatMs);
  assert.equal(writes.length,0);assert.equal(timers.size,0);
  visible=true;lifecycle.visibilityChanged();assert.equal(writes.length,1);
  assert.equal(writes[0].navigation,true,'Preserve first journal entry after hidden admission');
  advance(heartbeatMs);assert.equal(writes.length,2);assert.equal(writes[1].navigation,false);
  const previous=writes[1].at;assert(previous-writes[0].at<=90000);
  lifecycle.dispose();assert.equal(timers.size,0);
  // Switching view keeps original admission deadline, records latest view.
  lifecycle=schedulePresenceHeartbeat(options);assert.equal(writes[2].navigation,true);
  lifecycle.dispose();advance(90000);assert.equal(writes.length,3);assert.equal(timers.size,0);
 }
 assert.equal(totalHiddenCallbacks,0);assert.equal(peakTimers,1);
 return {clients:delays.length,oldHiddenHeartbeatCallbacks:oldHiddenCallbacks,newHiddenCallbacks:totalHiddenCallbacks,peakTimers,productionRequests:0};
}
const visibilityResult=verifyScheduler(schedulePresenceHeartbeat,delays);
console.log(JSON.stringify({status:'PASS',scope:'isolated deterministic scheduling only, not Supabase Auth/DB performance',clients:100,delaysMs:{min:Math.min(...delays),max:Math.max(...delays)},perSecond:bins,peakPerSecond:Math.max(...bins),...visibilityResult}));
