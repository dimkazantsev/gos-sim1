const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const source=fs.readFileSync('components/game/turnCountdown.ts','utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const compiledModule={exports:{}};
vm.runInNewContext(compiled,{module:compiledModule,exports:compiledModule.exports});
const {turnCountdown,turnMinuteSnapshot}=compiledModule.exports;
function check(seconds,days,hours,minutes,fragment){
 const actual=turnCountdown(seconds);
 assert.equal(actual.days,days,'days for '+seconds);
 assert.equal(actual.hours,hours,'hours for '+seconds);
 assert.equal(actual.minutes,minutes,'minutes for '+seconds);
 assert(actual.ariaLabel.includes(fragment),'Russian pronunciation for '+seconds+': '+actual.ariaLabel);
}
check(0,0,0,0,'0 дней, 0 часов, 0 минут');
check(1,0,0,1,'1 минута');
check(59,0,0,1,'1 минута');
check(60,0,0,1,'1 минута');
check(61,0,0,2,'2 минуты');
check(3599,0,1,0,'1 час');
check(3600,0,1,0,'1 час');
check(86399,1,0,0,'1 день');
check(86400,1,0,0,'1 день');
check(86400*11,11,0,0,'11 дней');
check(86400*12,12,0,0,'12 дней');
check(86400*21,21,0,0,'21 день');
check(86400*24,24,0,0,'24 дня');
check(23921*60+24,16,14,42,'16 дней, 14 часов, 42 минуты');
check(-100,0,0,0,'0 минут');
check(NaN,0,0,0,'0 минут');
const client=fs.readFileSync('components/GameClient.tsx','utf8');
const clock=fs.readFileSync('components/game/TurnClock.tsx','utf8');
assert(!client.includes('fmtTimer('),'Old unbounded minutes:seconds representation must be removed');
assert(client.includes('headerStageOpen&&headerStage?.deadline&&<TurnCountdownPill endAt={headerStage.deadline}/>'),'Game shell must show the named stage countdown');
assert(clock.includes('turnCountdown(useTurnMinutes(endAt))'),'Minute pill uses the isolated minute clock');
assert(clock.includes('const seconds=useTurnSeconds(endAt),minutes='),'Public seconds countdown is unchanged');
for(const label of ['ДНИ','ЧАСЫ','МИНУТЫ'])assert(clock.includes(label),'Missing visual label '+label);
console.log('PASS: time boundaries, countdown rounding and Russian days/hours/minutes labels');

function checkMinuteScheduler(snapshot){
 let callbacks=0,remaining=3600000,previous=Infinity;
 while(remaining>=0){
  const next=snapshot(remaining);
  assert.equal(next.seconds,Math.ceil(Math.max(0,Math.floor(remaining/1000))/60)*60);
  assert(next.seconds<previous,'Only a changed visible minute schedules another tick');
  previous=next.seconds;callbacks++;
  if(!next.delay){assert.equal(next.seconds,0);break;}
  assert(next.delay>=1&&next.delay<=60000);
  assert.equal(snapshot(remaining-next.delay+1).seconds,next.seconds,'No premature boundary');
  assert.equal(snapshot(remaining-next.delay).seconds,next.seconds-60,'Exact next boundary');
  remaining-=next.delay;
 }
 assert.equal(callbacks,61,'An hour needs 61 snapshots including initial and zero');
 return callbacks;
}
for(const ms of [NaN,-1,0,999,1000,59999,60000,60999,61000,61001,86400000,86400001]){
 const next=turnMinuteSnapshot(ms);
 assert.equal(next.seconds,Math.ceil((Number.isFinite(ms)?Math.max(0,Math.floor(ms/1000)):0)/60)*60);
 if(next.seconds===0)assert.equal(next.delay,0);
}
const callbacks=checkMinuteScheduler(turnMinuteSnapshot);
const hookStart=clock.indexOf('function useTurnMinutes('),hookEnd=clock.indexOf('export function TurnCountdownPill');
assert(hookStart>=0&&hookEnd>hookStart);
const hookJS=ts.transpileModule(clock.slice(hookStart,hookEnd),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
let now=100000,deadline=now+3600000,state=0,updates=0,cleanup,visible=true,nextId=0;
const timers=new Map(),listeners=new Map(),focus=new Map();
const eventTarget=map=>({addEventListener:(name,fn)=>map.set(name,fn),removeEventListener:(name,fn)=>{if(map.get(name)===fn)map.delete(name)}});
const doc={...eventTarget(listeners),get visibilityState(){return visible?'visible':'hidden'}};
class FakeDate extends Date{static now(){return now}}
const hookContext={useState:initial=>[initial,value=>{if(value!==state)updates++;state=value}],useEffect:fn=>{cleanup=fn()},Date:FakeDate,turnMinuteSnapshot,document:doc,window:eventTarget(focus),setTimeout:(fn,delay)=>{const id=++nextId;timers.set(id,{fn,at:now+delay});return id},clearTimeout:id=>timers.delete(id)};
vm.runInNewContext(hookJS+';useTurnMinutes('+JSON.stringify(new Date(deadline).toISOString())+')',hookContext);
assert.equal(state,3600);assert.equal(timers.size,1);
function advance(ms){const end=now+ms;while(timers.size){const [id,t]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(t.at>end)break;now=t.at;timers.delete(id);t.fn()}now=end}
advance(30000);assert.equal(updates,1);
visible=false;listeners.get('visibilitychange')();assert.equal(timers.size,0);
advance(120000);assert.equal(updates,1);
visible=true;listeners.get('visibilitychange')();assert.equal(state,3480);assert.equal(timers.size,1);
focus.get('focus')();assert.equal(timers.size,1);assert.equal(updates,2);
advance(3600000);assert.equal(state,0);assert.equal(timers.size,0);
cleanup();assert.equal(listeners.size,0);assert.equal(focus.size,0);
console.log('PASS: minute clock, '+callbacks+' snapshots/hour instead of 3601, hidden pause, focus recovery, deadline stop and cleanup');
