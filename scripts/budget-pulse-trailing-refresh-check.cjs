// Exercise the production hook with a deterministic clock and mocked transport.
// No real Supabase requests, React DOM, or browser are needed for this contract.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../components/game/useBudgetPulse.ts'), 'utf8');
const js = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;

function target(){
 const listeners = new Map();
 return {addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn)},removeEventListener(type,fn){listeners.get(type)?.delete(fn)},emit(type,event={}){for(const fn of listeners.get(type)||[])fn(event)}};
}
async function fixture(){
 let now=0,seq=0,calls=0,cleanup=()=>{};
 const timers=new Map(),window=target(),document=Object.assign(target(),{visibilityState:'visible'}),exports={};
 const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve()};
 const react={useState:v=>[v,()=>{}],useRef:v=>({current:v}),useCallback:f=>f,useEffect:f=>{cleanup=f()}};
 const supabase={rpc:async()=>{calls++;return {data:{game_id:'game',calculation:{revenue:1},history:[]},error:null}}};
 vm.runInNewContext(js,{exports,require:name=>{if(name==='react')return react;if(name==='@/lib/supabase')return {supabase};if(name==='@/lib/userError')return {userError:String};if(name==='./useGameTableSync')return {GAME_DATA_REFRESH_EVENT:'refresh'};throw Error(name)},window,document,Date:{now:()=>now},setTimeout(fn,delay){const id=++seq;timers.set(id,{at:now+Math.max(0,delay),fn});return id},clearTimeout:id=>timers.delete(id)});
 exports.useBudgetPulse('game',true);await flush();
 const advance=async end=>{while(true){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();await flush()}now=end;await flush()};
 return {advance,calls:()=>calls,change:(table='state_metrics',gameId='game')=>window.emit('refresh',{detail:{gameId,table}}),visible:value=>{document.visibilityState=value;document.emit('visibilitychange')},online:()=>window.emit('online'),cleanup:()=>cleanup()};
}
(async()=>{
 let f=await fixture();assert.equal(f.calls(),1);await f.advance(1000);f.change();await f.advance(3000);assert.equal(f.calls(),1,'cooldown should prevent early fetch');await f.advance(8000);assert.equal(f.calls(),2,'last invalidation must survive the cooldown');await f.advance(20000);assert.equal(f.calls(),2,'no idle polling');f.cleanup();
 f=await fixture();for(let t=100;t<=7000;t+=100){await f.advance(t);f.change()}await f.advance(8000);assert.equal(f.calls(),2,'70 invalidations should coalesce into one trailing fetch');await f.advance(20000);assert.equal(f.calls(),2);f.cleanup();
 f=await fixture();await f.advance(1000);f.change('game_votes');f.change('state_metrics','other-game');await f.advance(20000);assert.equal(f.calls(),1,'ignore other games and unrelated tables');f.cleanup();
 f=await fixture();await f.advance(1000);f.change();f.visible('hidden');await f.advance(10000);assert.equal(f.calls(),1,'no hidden-tab fetch');f.visible('visible');await f.advance(10000);assert.equal(f.calls(),2,'reconcile when visible');await f.advance(20000);assert.equal(f.calls(),2);f.cleanup();
 f=await fixture();await f.advance(1000);f.change();await f.advance(2000);f.online();await f.advance(20000);assert.equal(f.calls(),2,'online recovery should satisfy queued refresh');f.cleanup();
 f=await fixture();await f.advance(1000);f.change();f.cleanup();await f.advance(20000);assert.equal(f.calls(),1,'no request after unmount');
 console.log('PASS: 6 budget refresh scenarios; 70 invalidations coalesced into 1 trailing request; no idle polling.');
})().catch(error=>{console.error(error);process.exitCode=1});
