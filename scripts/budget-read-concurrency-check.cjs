/* Actual BudgetView with synthetic RPCs and virtual time; no network or database writes. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const source=fs.readFileSync('components/game/BudgetView.tsx','utf8');
const result=ts.transpileModule(source,{fileName:'BudgetView.tsx',reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}});
assert.equal(result.diagnostics.length,0,'BudgetView must transpile');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function realm(){
 const hooks=[],effects=[],calls=[],timers=new Map();
 let cursor=0,dirty=false,tree,load,now=0,timerId=0,revision=1,hold=false,ignoreAbort=false,fail=false,disposed=false,throwRpc=false;
 let props={g:{game:{id:'game-a'},me:{user_id:'student-a'},teacher:true},onOpenDocument(){},onOpenEvents(){}};
 const react={
  useRef(value){return(hooks[cursor++]??={current:value})},
  useState(value){const i=cursor++;if(!hooks[i])hooks[i]={value};return[hooks[i].value,next=>{assert(!disposed,'No state updates after unmount');const value=typeof next==='function'?next(hooks[i].value):next;if(!Object.is(value,hooks[i].value)){hooks[i].value=value;dirty=true}}]},
  useEffect(fn,deps){const i=cursor++,old=hooks[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){hooks[i]={deps,cleanup:old?.cleanup};effects.push(()=>{hooks[i].cleanup?.();hooks[i].cleanup=fn()})}}
 };
 const supabase={rpc(name,args){
  if(throwRpc)throw new Error('synthetic synchronous RPC failure');
  const call={name,args,revision,signal:null,done:false,release:null};calls.push(call);
  if(!name.startsWith('get_')){revision++;call.done=true;return Promise.resolve({data:null,error:null})}
  const response=()=>({data:name==='get_fiscal_budget'?{regions:[{region_code:'54',name:'Учебный регион',enterprises:call.revision,employees_per_firm:10,monthly_wage:1,profit_per_firm:1,consumption_per_firm:1,expenditure:1,transfer_in:0,debt:0,compliance:1}],rates:[],proposals:[],can_propose:true}:name==='get_fiscal_context'?{policy:{key_rate:call.revision}}:[],error:fail?{message:'synthetic budget outage'}:null});
  return{abortSignal(signal){call.signal=signal;return this},then(resolve,reject){
   call.release=()=>{call.done=true;resolve(response())};
   if(call.signal)call.signal.addEventListener('abort',()=>{if(!ignoreAbort){call.done=true;reject(new Error('aborted'))}},{once:true});
   if(!hold)call.release();
  }};
 }};
 const jsx=(type,props)=>({type,props});
 const mod={exports:{}};
 const requireMock=name=>{
  if(name==='react')return react;
  if(name==='react/jsx-runtime')return{jsx,jsxs:jsx,Fragment:'fragment'};
  if(name==='@/lib/supabase')return{supabase};
  if(name==='@/lib/userError')return{userError:e=>String(e?.message||e)};
  if(name==='./useGameTableSync')return{useGameTableSync:(_game,_tables,fn)=>{load=fn}};
  if(name==='@/data/taxes-2026.json')return{taxes:[{key:'vat',label:'Учебный налог',level:'federal',default_rate:22,min_rate:0,max_rate:100}]};
  if(name.endsWith('.css'))return{};
  if(name==='lucide-react')return new Proxy({},{get:(_,key)=>key});
  return{__esModule:true,default:name.split('/').at(-1)};
 };
 vm.runInNewContext('(function(require,module,exports){'+result.outputText+'})',{
  AbortController,console,Promise,Date,Object,Number,String,Map,Set,
  setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,at:now+delay});return id},clearTimeout:id=>timers.delete(id)
 })(requireMock,mod,mod.exports);
 function render(){cursor=0;dirty=false;tree=mod.exports.default(props);while(effects.length)effects.shift()();return tree}
 async function settle(){for(let i=0;i<10;i++){await tick();if(!dirty)break;render()}return tree}
 const find=(node,predicate)=>Array.isArray(node)?node.map(n=>find(n,predicate)).find(Boolean):node&&typeof node==='object'?(predicate(node)?node:find(node.props?.children,predicate)):undefined;
 const text=node=>Array.isArray(node)?node.map(text).join(' '):node&&typeof node==='object'?text(node.props?.children):node==null||node===false?'':String(node);
 render();
 return{
  calls,load(){const button=find(tree,n=>n.type==='button'&&text(n).includes('Обновить данные'));assert(button);button.props.onClick();return tick()},automatic:()=>load(),hold(value=true){hold=value},ignoreAbort(){ignoreAbort=true},fail(){fail=true},throwRpc(value){throwRpc=value},revision(value){revision=value},
  release(start=0){for(const call of calls.slice(start))if(!call.done)call.release?.()},settle,
  switch(game,user){props={...props,g:{...props.g,game:{id:game},me:{user_id:user}}};render()},
  click(label){const button=find(tree,n=>n.type==='button'&&text(n).includes(label));assert(button,'Missing button '+label);return button.props.onClick()},
  saved(){const simulator=find(tree,n=>n.type==='FederalBudgetSimulator');assert(simulator,'Simulator should be ready');return simulator.props.onSaved()},
  macro(){const panel=find(tree,n=>n.type==='FiscalMacroPanel');assert(panel);return panel.props.onSaved({key_rate:9})},
  macroCallback(){const panel=find(tree,n=>n.type==='FiscalMacroPanel');assert(panel);return panel.props.onSaved},
  context:()=>find(tree,n=>n.type==='FiscalMacroPanel')?.props.context,
  error:()=>text(find(tree,n=>n.props?.role==='alert')),
  async advance(ms){now+=ms;for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.fn()}await settle()},
  close(){for(const hook of hooks)hook?.cleanup?.();disposed=true;assert.equal(timers.size,0,'Unmount clears timeout')}
 };
}
(async()=>{
 const h=realm();h.hold();const first=h.load();for(let i=0;i<9;i++)void h.load();await tick();
 assert.equal(h.calls.length,3,'Ten concurrent manual/automatic loads must share one RPC triple');
 h.release();await first;await h.settle();assert.equal(h.context().policy.key_rate,1);
 h.hold();const delayed=h.load();await tick();await h.advance(18001);await delayed;
 assert(h.calls.slice(3).every(c=>c.signal?.aborted),'Timeout aborts every RPC');
 assert.match(h.error(),/18|вовремя/,'Timeout is visible');assert.equal(h.context().policy.key_rate,1,'Timeout retains accepted data');
 h.hold(false);h.revision(2);await h.load();await h.settle();assert.equal(h.context().policy.key_rate,2,'Timeout releases next refresh');
 h.fail();await h.load();await h.settle();assert.match(h.error(),/synthetic/);assert.equal(h.context().policy.key_rate,2,'Failure preserves last data');h.close();
 for(const [game,user] of [['game-b','student-a'],['game-a','student-b']]){
  const r=realm();r.hold();r.ignoreAbort();const old=r.load();await tick();r.switch(game,user);r.revision(3);const next=r.load();await tick();
  assert(r.calls.slice(0,3).every(c=>c.signal?.aborted),'Scope switch aborts old RPCs');
  r.release(3);await next;await r.settle();r.release(0);await old;await r.settle();
  assert.equal(r.calls[3].args.p_game_id,game);assert.equal(r.context().policy.key_rate,3,'Old scope cannot overwrite new scope snapshot');r.close();
 }
 const unmounted=realm();unmounted.hold();unmounted.ignoreAbort();const pending=unmounted.load();await tick();unmounted.close();assert(unmounted.calls.every(c=>c.signal?.aborted));unmounted.release();await pending;
 const pushed=realm();pushed.hold();pushed.ignoreAbort();void pushed.load();await tick();pushed.revision(4);const reconciled=pushed.automatic();await tick();
 assert.equal(pushed.calls.length,6,'A pushed change starts a post-event snapshot instead of joining an older manual read');assert(pushed.calls.slice(0,3).every(c=>c.signal?.aborted));
 pushed.release(3);await reconciled;await pushed.settle();pushed.release();await pushed.settle();assert.equal(pushed.context().policy.key_rate,4,'Late manual snapshot cannot hide a pushed change');pushed.close();
 for(const action of ['Подготовить налоговую инициативу','Сохранить параметры региона','simulator']){
  const r=realm();await r.load();await r.settle();r.hold();r.ignoreAbort();const stale=r.load();await tick();
  const saved=action==='simulator'?(r.revision(2),r.saved()):r.click(action);await tick();
  assert.equal(r.calls.filter(c=>c.name.startsWith('get_')).length,9,'Successful write must start a fresh triple: '+action);
  assert(r.calls.slice(3,6).every(c=>c.signal?.aborted),'Successful write aborts pre-write read');
  r.release(6);await saved;await r.settle();assert.equal(r.context().policy.key_rate,2,'Saved state replaces pre-write snapshot');
  r.release(3);await stale;await r.settle();assert.equal(r.context().policy.key_rate,2,'Late pre-write read cannot undo saved state');r.close();
 }
 const macro=realm();await macro.load();await macro.settle();macro.hold();macro.ignoreAbort();const obsolete=macro.load();await tick();macro.macro();await macro.settle();macro.release();await obsolete;await macro.settle();assert.equal(macro.context().policy.key_rate,9,'A confirmed macro edit survives stale read');macro.close();
 const oldMacro=realm();await oldMacro.load();await oldMacro.settle();const savedOldMacro=oldMacro.macroCallback();oldMacro.switch('game-b','student-b');oldMacro.hold();oldMacro.revision(5);void oldMacro.load();await tick();savedOldMacro({key_rate:99});
 assert(oldMacro.calls.slice(3).every(c=>!c.signal.aborted),'An old macro callback must not cancel the next game snapshot');oldMacro.release(3);await oldMacro.settle();assert.equal(oldMacro.context().policy.key_rate,5,'An old macro callback cannot patch the next game');oldMacro.close();
 const throwing=realm();throwing.throwRpc(true);await throwing.load();await throwing.settle();assert.match(throwing.error(),/synchronous/);throwing.throwRpc(false);await throwing.load();await throwing.settle();assert.equal(throwing.calls.length,3,'Synchronous failure releases pending read');assert(throwing.context());throwing.close();
 console.log('PASS budget reads: ten manual calls share three RPCs; fresh pushed changes; 18s abort/recovery; retained data/errors; game/user/unmount cancellation; fresh mutation/simulator and scoped macro results.');
})().catch(error=>{console.error(error);process.exitCode=1});

