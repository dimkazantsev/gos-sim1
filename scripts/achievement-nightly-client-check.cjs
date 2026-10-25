const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const file=path.resolve(__dirname,'../components/game/Achievements.tsx');
const source=fs.readFileSync(file,'utf8');
const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const rpcNames=[];
function visit(node){
 if(ts.isCallExpression(node)){
  assert.notEqual(node.expression.getText(ast),'setInterval','Awards must not poll in the background');
  if(node.expression.getText(ast)==='supabase.rpc')rpcNames.push(node.arguments[0].text);
 }
 ts.forEachChild(node,visit);
}
visit(ast);
assert.deepEqual(rpcNames.sort(),['claim_achievement_notification','get_achievement_catalog_counts','get_game_achievements']);
assert(source.includes('loadedScope===scope?items:[]'),'Changing profile must hide the old result before its effect runs');
assert(source.includes("event==='SIGNED_OUT'"),'Signing out must clear displayed private results');
assert(source.includes("'gos:achievement-notice:'+gameId+':'+userId"),'Daily notification receipts must be scoped to game and current user');
assert(!source.includes('awardConnectionNotice'),'Optional reward checks must not cover game controls');

let now=Date.parse('2026-10-25T12:00:00Z'),sequence=0,timerSequence=0;
const timers=new Map(),listeners=new Set();
const document={visibilityState:'visible',addEventListener:(name,fn)=>{assert.equal(name,'visibilitychange');listeners.add(fn)},removeEventListener:(_name,fn)=>listeners.delete(fn)};
class ClockDate extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}}
const testMath=Object.create(Math);testMath.random=()=>((sequence++*37)%997)/997;
const context={exports:{},require:()=>({}),Date:ClockDate,Math:testMath,document,
 setTimeout:(fn,delay)=>{const id=++timerSequence;assert(delay>=0&&delay<=86460000);timers.set(id,{fn,at:now+delay});return id},
 clearTimeout:id=>timers.delete(id)
};
vm.createContext(context);
vm.runInContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,context);
const {achievementRefreshDay,watchAchievementMorningRefresh}=context.exports;
assert.equal(achievementRefreshDay(Date.parse('2026-10-25T20:59:59.999Z')),'2026-10-25');
assert.equal(achievementRefreshDay(Date.parse('2026-10-25T21:00:00Z')),'2026-10-26','04:00 Novosibirsk starts the next snapshot day regardless of the browser timezone');
function advance(target){
 while(true){
  const due=[...timers.entries()].filter(([,t])=>t.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];
  if(!due)break;
  now=due[1].at;timers.delete(due[0]);due[1].fn();
 }
 now=target;
}
function visible(value){document.visibilityState=value;for(const fn of [...listeners])fn()}
const calls=Array.from({length:40},()=>[]);
const stops=calls.map(record=>watchAchievementMorningRefresh(()=>record.push(now)));
advance(now+20*60*1000);
assert(calls.every(record=>record.length===0),'Forty clients must make no periodic award refresh in a 20-minute daytime session');
advance(Date.parse('2026-10-25T21:02:00Z'));
assert(calls.every(record=>record.length===1),'Every already-open client receives one morning refresh');
assert(new Set(calls.map(record=>record[0])).size>1,'Morning refreshes must be spread rather than synchronized');
visible('visible');visible('visible');advance(now+20*60*1000);
assert(calls.every(record=>record.length===1),'Repeated foreground events must not refresh an unchanged snapshot day');
visible('hidden');advance(Date.parse('2026-10-26T21:02:00Z'));
assert(calls.every(record=>record.length===1),'Hidden clients must make no morning request');
visible('visible');visible('visible');advance(now+61000);
assert(calls.every(record=>record.length===2),'Returning after the nightly window refreshes exactly once');
for(const stop of stops)stop();
assert.equal(timers.size,0,'Unmount must cancel all morning timers');
assert.equal(listeners.size,0,'Unmount must release all visibility listeners');
advance(now+2*86400000);
assert(calls.every(record=>record.length===2));
console.log('PASS: no client evaluation or polling; 40 daytime schedulers stay idle, morning reads stagger once daily, hidden tabs and cleanup are bounded');
