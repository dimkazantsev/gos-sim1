/* Forty independent simulated browser sessions (no production writes). */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const files=[
 'components/game/useGameTableSync.ts',
 'components/game/useRepublicGame.ts',
 'components/GameClient.tsx'
];
const contents=files.map(x=>fs.readFileSync(x,'utf8'));
for(let i=0;i<files.length;i++){
 const sf=ts.createSourceFile(files[i],contents[i],ts.ScriptTarget.ES2022,true,files[i].endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 assert.equal(sf.parseDiagnostics.length,0,files[i]+' syntax regression');
}
const [sync,game,client]=contents;
assert(sync.includes('if(hasPushCoverage&&gameRealtimeConnected(gameId)&&now-lastFallbackAt<180000)return'));
assert(game.includes('setGameRealtimeConnection(gameId,liveConnected)'));
assert(game.includes('setGameRealtimeConnection(gameId,false)'));
assert(game.includes('if(liveConnected&&now-lastChatRecoveryAt<60000)return'));
assert(game.includes('},6000);'),'Disconnected chat recovery retained');
assert(client.includes('if(connected&&now-lastRecoveryAt<180000)return'),'Event badge should not poll every 30 seconds when connected');
assert(client.includes('if(connected&&now-lastRecoveryAt<120000)return'),'Blitz badge should not poll every 25 seconds when connected');
assert(!client.includes('},[game?.id,me?.user_id,previewMode,view]);'),'Section navigation must not resubscribe event badges');
assert(client.includes('setTimeout(()=>{pendingTimer=undefined;if(live)void count()},450)'),'Burst of event rows merged');

const js=ts.transpileModule(sync,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
let now=1_000_000;
function browserSession(index,widgets=3,table='game_stages'){
 const listeners={window:new Map(),document:new Map()};
 const counts={loads:0};
 const intervals=[],timeouts=[];
 let cleanups=[];
 const win={
  addEventListener:(event,fn)=>{const list=listeners.window.get(event)||[];list.push(fn);listeners.window.set(event,list)},
  removeEventListener:(event,fn)=>listeners.window.set(event,(listeners.window.get(event)||[]).filter(x=>x!==fn)),
  dispatchEvent:event=>(listeners.window.get(event.type)||[]).forEach(fn=>fn(event))
 };
 const document={
  visibilityState:'visible',
  addEventListener:(event,fn)=>{const list=listeners.document.get(event)||[];list.push(fn);listeners.document.set(event,list)},
  removeEventListener:(event,fn)=>listeners.document.set(event,(listeners.document.get(event)||[]).filter(x=>x!==fn))
 };
 const react={
  useRef:load=>({current:load}),
  useEffect:effect=>{cleanups.push(effect())}
 };
 const DateMock=class extends Date{static now(){return now}};
 const env={
  window:win,document,console,Promise,Date:DateMock,
  CustomEvent:class {constructor(type,props){this.type=type;this.detail=props.detail}},
  setTimeout(fn){const item={fn,cancelled:false};timeouts.push(item);return item},
  clearTimeout(item){if(item)item.cancelled=true},
  setInterval(fn,period){const item={fn,period,next:now+period,cancelled:false};intervals.push(item);return item},
  clearInterval(item){if(item)item.cancelled=true},
  Math:Object.assign(Object.create(Math),{random:()=>index/200})
 };
 const mod={exports:{}};
 const requireMock=name=>{assert.equal(name,'react');return react};
 vm.runInNewContext('(function(require,module,exports){'+js+'})',env)(requireMock,mod,mod.exports);
 for(let w=0;w<widgets;w++)mod.exports.useGameTableSync('test-game',[table],async()=>{counts.loads++},'widget-'+w);
 const settle=async()=>{for(let i=0;i<6;i++)await Promise.resolve()};
 return {
  counts,intervals,settle,
  connect:on=>mod.exports.setGameRealtimeConnection('test-game',on),
  tick:async()=>{
   for(const timer of intervals){if(!timer.cancelled&&now>=timer.next){timer.next+=timer.period;timer.fn()}}
   for(const timer of timeouts.splice(0)){if(!timer.cancelled)timer.fn()}
   await settle();
  },
  event:()=>mod.exports.notifyGameDataRefresh('test-game'),
  dispose:()=>cleanups.forEach(fn=>fn?.())
 };
}
(async()=>{
 const sessions=Array.from({length:40},(_,i)=>browserSession(i));
 await Promise.all(sessions.map(c=>c.settle()));
 assert.equal(sessions.reduce((sum,c)=>sum+c.counts.loads,0),120,'3 initial widgets x 40 users');
 sessions.forEach(c=>c.connect(true));
 for(let elapsed=5_000;elapsed<=120_000;elapsed+=5_000){
  now+=5000;
  await Promise.all(sessions.map(c=>c.tick()));
 }
 const reads120=sessions.reduce((sum,c)=>sum+c.counts.loads,0);
 assert.equal(reads120,120,'Healthy Realtime must NOT generate extra periodic REST reads in 2 minutes');
 for(let elapsed=125_000;elapsed<=240_000;elapsed+=5_000){
  now+=5000;
  await Promise.all(sessions.map(c=>c.tick()));
 }
 const reads240=sessions.reduce((sum,c)=>sum+c.counts.loads,0);
 assert(reads240>120&&reads240<=240,'Exactly one fallback read per widget after 3 minutes: '+reads240);
 sessions.forEach(c=>c.event());
 for(let i=0;i<2;i++){await Promise.all(sessions.map(c=>c.tick()))}
 const afterEvent=sessions.reduce((sum,c)=>sum+c.counts.loads,0);
 assert.equal(afterEvent,reads240+120,'Direct game invalidation still refreshes all affected widgets');
 sessions.forEach(c=>c.connect(false));
 for(let i=0;i<8;i++){now+=5000;await Promise.all(sessions.map(c=>c.tick()))}
 const disconnected=sessions.reduce((sum,c)=>sum+c.counts.loads,0);
 assert(disconnected>=afterEvent+120,'Every disconnected client resumes its fallback within 40 seconds');
 sessions.forEach(c=>c.dispose());
 // Unsupported per-widget tables must not lose their original refresh rate:
 // the shared WebSocket does not subscribe to their changes.
 const uncovered=browserSession(99,1,'unlisted_stage_table');
 await uncovered.settle();
 uncovered.connect(true);
 for(let elapsed=0;elapsed<40000;elapsed+=5000){now+=5000;await uncovered.tick()}
 assert(uncovered.counts.loads>=2,'Table without push invalidation retains normal 25–35s visible poll');
 uncovered.dispose();
 console.log('PASS: 40 independent browser sessions, 3 widgets each; 120 initial reads, '+reads120+' at 2m, '+reads240+' at 4m, '+afterEvent+' after direct event, '+disconnected+' after 40s offline recovery');
 console.log('NOTE: simulated REST load budget, not a live 40-user production stress test; actual Supabase API is currently 402 restricted');
})().catch(e=>{console.error(e);process.exitCode=1});
