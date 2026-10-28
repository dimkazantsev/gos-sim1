/* Real useSectionUpdates hook, virtual timer and synthetic RPC. Never uses production. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const name='components/game/useSectionUpdates.ts',source=fs.readFileSync(name,'utf8');
const parsed=ts.createSourceFile(name,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
assert.equal(parsed.parseDiagnostics.length,0,'Hook source must parse');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
let now=1_000_000;
function session(n,view='chat',realtimeConnected=true){
 const timers=[],events=new Map(),docs=new Map(),calls=[],cleanups=[];
 let state={},marked=false,lateVote=false,readNotices=0;
 const registered=(map,key,fn)=>{const list=map.get(key)||[];list.push(fn);map.set(key,list)};
 const removed=(map,key,fn)=>map.set(key,(map.get(key)||[]).filter(x=>x!==fn));
 const window={addEventListener:(k,f)=>registered(events,k,f),removeEventListener:(k,f)=>removed(events,k,f)};
 const document={visibilityState:'visible',addEventListener:(k,f)=>registered(docs,k,f),removeEventListener:(k,f)=>removed(docs,k,f)};
 const schedule=(f,delay,period=0)=>{const t={f,due:now+delay,period,cancelled:false};timers.push(t);return t};
 const supabase={rpc:async function(method,args){
  calls.push({at:now,method,args});
  if(method==='mark_section_read'){marked=true;return{status:200,error:null}}
  return{status:200,data:{documents:0,votes:lateVote?4:marked?0:4,events:0},error:null}
 }};
 const react={
  useState:v=>{state=v;return[v,updater=>{state=typeof updater==='function'?updater(state):updater}]},
  useRef:v=>({current:v}),
  useEffect:f=>{const cleanup=f();if(typeof cleanup==='function')cleanups.push(cleanup)}
 };
 const mod={exports:{}};
 const env={module:mod, exports:mod.exports,window,document,console,Math,Promise,Set,Date:class extends Date{static now(){return now}},
  setTimeout:(f,ms)=>schedule(f,ms),clearTimeout:t=>{if(t)t.cancelled=true},
  setInterval:(f,ms)=>schedule(f,ms,ms),clearInterval:t=>{if(t)t.cancelled=true}};
 const requireMock=p=>p==='react'?react:p==='@/lib/supabase'?{supabase}:p==='./useGameTableSync'?{
  GAME_DATA_REFRESH_EVENT:'gos-sims:refresh',SECTION_UPDATES_REFRESH_EVENT:'gos-sims:section-updates',
  gameRealtimeConnected:()=>realtimeConnected,notifySectionUpdates:(gameId)=>{readNotices++;for(const f of events.get('gos-sims:section-updates')||[])f({type:'gos-sims:section-updates',detail:{gameId}})}
 }:null;
 vm.runInNewContext('(function(require,module,exports){'+js+'})',env)(requireMock,mod,mod.exports);
 mod.exports.useSectionUpdates('game-a','student-'+n,view,false);
 return {calls,document,
  getCounts(){return state},getReadNotices(){return readNotices},setLateVote(){lateVote=true},
  event(type='gos-sims:refresh',table='game_votes'){if(type==='gos-sims:refresh')lateVote=true;for(const f of events.get(type)||[])f({type,detail:{gameId:'game-a',table}})},
  visible(next){document.visibilityState=next?'visible':'hidden';for(const f of docs.get('visibilitychange')||[])f()},
  tick(){for(const t of timers){if(t.cancelled||t.due>now)continue;
   if(t.period){t.due+=t.period;while(t.due<=now)t.due+=t.period}else t.cancelled=true;
   t.f();
  }
  // Timer lists compact after elapsed tests; callbacks may append new timers.
  },
  dispose(){cleanups.forEach(f=>f());assert.equal((events.get('gos-sims:refresh')||[]).length,0,'Listeners removed')}
 };
}
async function tick(clients,steps=1){for(let i=0;i<steps;i++){now+=1000;for(const c of clients)c.tick();await Promise.resolve();await Promise.resolve()}}
(async()=>{
 const clients=Array.from({length:40},(_,i)=>session(i));
 await tick(clients,12);
 assert(clients.every(c=>c.calls.filter(x=>x.method==='get_section_updates').length===1),'Every client starts with one staggered badge read');
 for(let second=0;second<600;second++){
  clients.forEach(c=>c.event());
  await tick(clients);
 }
 const reads=clients.reduce((total,c)=>total+c.calls.filter(x=>x.method==='get_section_updates').length,0);
 assert(reads<=2000,'Burst of Realtime invalidations created too many section counter RPC calls: '+reads);
 assert(reads>=1000,'The refresh cap cannot disable badge reconciliation entirely: '+reads);
 for(const c of clients)c.dispose();
 const one=session(77);await tick([one],12);
 const original=one.calls.length;one.event('gos-sims:refresh','chat_messages');await tick([one],3);
 assert.equal(one.calls.length,original,'Unrelated tables do not refresh unread section badges');
 await tick([one],25);one.event();await tick([one],11);
 assert.equal(one.calls.length,original+1,'First relevant notification after quiet period must reconcile within 10 seconds');
 one.visible(false);const beforeHidden=one.calls.length;
 for(let i=0;i<90;i++){one.event();await tick([one],1)}
 assert.equal(one.calls.length,beforeHidden,'Hidden tab sends no badge RPC under events');
 one.visible(true);await tick([one],2);
 assert.equal(one.calls.length,beforeHidden+1,'A returning tab reconciles badges');
 await tick([one],25);one.event('gos-sims:section-updates');await tick([one],11);
 assert.equal(one.calls.length,beforeHidden+2,'Explicit section-read invalidation reconciles within the bounded stagger window');
 one.dispose();
 // A confirmed read removes the old badge locally. The server read should
 // not be duplicated while the staggered initial request is still pending.
 const acknowledged=session(777,'votes');
 await tick([acknowledged],2);
 assert(acknowledged.calls.some(x=>x.method==='mark_section_read'),'The section read must be acknowledged by the server');
 assert.equal(acknowledged.getCounts().votes,0,'Confirmed read must clear old local badge immediately');
 await tick([acknowledged],10);
 assert.equal(acknowledged.calls.filter(x=>x.method==='get_section_updates').length,1,'No duplicate initial RPC when read is acknowledged before initial stagger');
 acknowledged.dispose();
 // Realtime changes after opening must not be hidden by the old read timestamp.
 const concurrent=session(778,'votes');
 await tick([concurrent],1);
 concurrent.event();
 await tick([concurrent],11);
 assert.equal(concurrent.getCounts().votes,4,'Newly arrived notifications remain unread after marking an earlier timestamp');
 concurrent.dispose();
 // In a connected class, a successful read clears only its own local badge;
 // the next Realtime event and periodic fallback are already responsible for
 // reconciliation, so 100 page entries must not schedule 100 redundant reads.
 const connectedReaders=Array.from({length:100},(_,i)=>session(3000+i,'votes',true));
 await tick(connectedReaders,32);
 assert(connectedReaders.every(c=>c.calls.filter(x=>x.method==='mark_section_read').length===1),'Every connected student must acknowledge a visited section');
 assert(connectedReaders.every(c=>c.calls.filter(x=>x.method==='get_section_updates').length===1),'Successful local reads cannot cause a second badge RPC while Realtime is healthy');
 assert(connectedReaders.every(c=>c.getReadNotices()===0),'A confirmed connected read needs no extra invalidation');
 connectedReaders.forEach(c=>c.dispose());
 // When disconnected, preserve the existing recovery request after the
 // server write. When a new event races a read, reconciliation is still sent.
 const offline=session(5555,'votes',false);await tick([offline],3);
 assert.equal(offline.getReadNotices(),1,'Disconnected tabs still invalidate the badge after read acknowledgement');offline.dispose();
 const raced=session(5666,'votes',true);await tick([raced],1);raced.event();await tick([raced],3);
 assert.equal(raced.getReadNotices(),1,'A Realtime update after entering a section cannot be silently discarded');raced.dispose();
 // 100 clients receive 60 explicit read invalidations each. These previously
 // bypassed the ordinary 15-second budget, causing a synchronized RPC flood.
 const hundred=Array.from({length:100},(_,i)=>session(1000+i));
 await tick(hundred,12);
 const initialReads=hundred.reduce((total,c)=>total+c.calls.filter(x=>x.method==='get_section_updates').length,0);
 assert.equal(initialReads,100,'The 100 participants must each obtain initial badges');
 for(let second=0;second<60;second++){
  hundred.forEach(c=>c.event('gos-sims:section-updates'));
  await tick(hundred);
 }
 const burstReads=hundred.reduce((total,c)=>total+c.calls.filter(x=>x.method==='get_section_updates').length,0)-initialReads;
 assert(burstReads<=500,'Repeated read acknowledgements must respect the 15s counter limit: '+burstReads);
 assert(burstReads>=250,'Counter reconciliation must remain active: '+burstReads);
 const perSecond=new Map();for(const c of hundred)for(const call of c.calls.filter(x=>x.method==='get_section_updates'))perSecond.set(call.at,(perSecond.get(call.at)||0)+1);
 const peak=Math.max(...perSecond.values());
 assert(peak<=25,'Initial stagger must avoid a 100-client 1-second burst: '+peak);
 hundred.forEach(c=>c.dispose());
 console.log(JSON.stringify({status:'PASS',clients:100,burstEvents:6000,burstSeconds:60,burstRpcCalls:burstReads,initialBadgeReads:initialReads,peakReadsPerSecond:peak,baselineClients:40,baselineInvalidations:24000,baselineRpcCalls:reads,source:'actual useSectionUpdates transpiled TS',network:'synthetic',liveDatabaseReads:0,hidden_tab:'paused',on_return:'reconciled',confirmedRead:'optimistic',concurrentNotification:'preserved'},null,2));
})().catch(error=>{console.error(error);process.exitCode=1});
