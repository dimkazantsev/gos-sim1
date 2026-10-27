/* Real useSectionUpdates hook, virtual timer and synthetic RPC. Never uses production. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const name='components/game/useSectionUpdates.ts',source=fs.readFileSync(name,'utf8');
const parsed=ts.createSourceFile(name,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
assert.equal(parsed.parseDiagnostics.length,0,'Hook source must parse');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
let now=1_000_000;
function session(n){
 const timers=[],events=new Map(),docs=new Map(),calls=[],cleanups=[];
 const registered=(map,key,fn)=>{const list=map.get(key)||[];list.push(fn);map.set(key,list)};
 const removed=(map,key,fn)=>map.set(key,(map.get(key)||[]).filter(x=>x!==fn));
 const window={addEventListener:(k,f)=>registered(events,k,f),removeEventListener:(k,f)=>removed(events,k,f)};
 const document={visibilityState:'visible',addEventListener:(k,f)=>registered(docs,k,f),removeEventListener:(k,f)=>removed(docs,k,f)};
 const schedule=(f,delay,period=0)=>{const t={f,due:now+delay,period,cancelled:false};timers.push(t);return t};
 const supabase={rpc:async function(method,args){calls.push({at:now,method,args});return{status:200,data:{documents:0,votes:0,events:0},error:null}}};
 const react={useState:v=>[v,()=>{}],useEffect:f=>{const cleanup=f();if(typeof cleanup==='function')cleanups.push(cleanup)}};
 const mod={exports:{}};
 const env={module:mod, exports:mod.exports,window,document,console,Math,Promise,Set,Date:class extends Date{static now(){return now}},
  setTimeout:(f,ms)=>schedule(f,ms),clearTimeout:t=>{if(t)t.cancelled=true},
  setInterval:(f,ms)=>schedule(f,ms,ms),clearInterval:t=>{if(t)t.cancelled=true}};
 const requireMock=p=>p==='react'?react:p==='@/lib/supabase'?{supabase}:p==='./useGameTableSync'?{
  GAME_DATA_REFRESH_EVENT:'gos-sims:refresh',SECTION_UPDATES_REFRESH_EVENT:'gos-sims:section-updates',
  gameRealtimeConnected:()=>true,notifySectionUpdates:()=>{}
 }:null;
 vm.runInNewContext('(function(require,module,exports){'+js+'})',env)(requireMock,mod,mod.exports);
 mod.exports.useSectionUpdates('game-a','student-'+n,'chat',false);
 return {calls,document,
  event(type='gos-sims:refresh',table='game_votes'){for(const f of events.get(type)||[])f({type,detail:{gameId:'game-a',table}})},
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
 await tick([one],25);one.event();await tick([one],1);
 assert.equal(one.calls.length,original+1,'First relevant notification after quiet period must refresh promptly');
 one.visible(false);const beforeHidden=one.calls.length;
 for(let i=0;i<90;i++){one.event();await tick([one],1)}
 assert.equal(one.calls.length,beforeHidden,'Hidden tab sends no badge RPC under events');
 one.visible(true);await tick([one],2);
 assert.equal(one.calls.length,beforeHidden+1,'A returning tab reconciles badges');
 await tick([one],25);one.event('gos-sims:section-updates');await tick([one],1);
 assert.equal(one.calls.length,beforeHidden+2,'Explicit section-read invalidation stays immediate');
 one.dispose();
 console.log(JSON.stringify({status:'PASS',clients:40,events:24000,virtual_seconds:600,section_rpc_calls:reads,source:'actual useSectionUpdates transpiled TS',network:'synthetic',hidden_tab:'paused',on_return:'reconciled'},null,2));
})().catch(error=>{console.error(error);process.exitCode=1});
