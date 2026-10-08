const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const {renderToStaticMarkup}=require('react-dom/server');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(process.argv[2]||path.join(root,'components/game/GameReadinessMatrix.tsx'),'utf8');
const transpile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const ready=(label='')=>Array.from({length:16},(_,i)=>({stage_no:i+1,ready:true,blockers:[],warnings:label?[label]:[],override:null}));
function harness(){
 const slots=[],effects=[],timers=new Map(),listeners=new Map(),channels=[],responses=[],calls=[];let cursor=0,dirty=false,tree,clock=0;
 const g={game:{id:'game-a'},stages:Array.from({length:16},(_,i)=>({stage_no:i+1,title:'Этап '+(i+1)})),teacher:true};
 const react={useState(initial){const i=cursor++;slots[i]??={value:typeof initial==='function'?initial():initial};return[slots[i].value,next=>{const value=typeof next==='function'?next(slots[i].value):next;if(!Object.is(slots[i].value,value)){slots[i].value=value;dirty=true;}}];},useRef(initial){const i=cursor++;return(slots[i]??={value:{current:initial}}).value;},useId(){const i=cursor++;return 'qa-'+i;},useEffect(effect,deps){const i=cursor++,old=slots[i];if(!old||!deps||deps.some((v,j)=>!Object.is(v,old.deps?.[j]))){slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=effect();});}}};
 const eventTarget={addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},removeEventListener(name,fn){listeners.get(name)?.delete(fn);}};
 const supabase={rpc:async(name,args)=>{calls.push({name,args});const response=responses.shift();return typeof response==='function'?response():response??{data:ready(),error:null};},channel(name){const ch={name,handlers:[],on(event,filter,callback){this.handlers.push({filter,callback});return this;},subscribe(callback){callback?.('SUBSCRIBED');return this;}};channels.push(ch);return ch;},removeChannel:async ch=>{ch.removed=true;}};
 let context;const loaded=new Map();
 function requireFor(request){
  if(request==='react')return react;
  if(request==='react/jsx-runtime')return require(request);
  if(request==='@/lib/supabase')return{supabase};
  if(['./useGameTableSync','./stageSystem','./stageRealtimeTables'].includes(request)){
   if(!loaded.has(request)){const module={exports:{}};const code=transpile(fs.readFileSync(path.join(root,'components/game',request.slice(2)+'.ts'),'utf8'));vm.runInContext('(function(require,module,exports){'+code+'\n})',context)(requireFor,module,module.exports);loaded.set(request,module.exports);}return loaded.get(request);
  }
  throw Error('Unexpected fixture import '+request);
 }
 context=vm.createContext({console,Promise,Error,Object,Number,Array,Set,Map,window:eventTarget,document:{...eventTarget,visibilityState:'visible'},setTimeout:fn=>{const id=++clock;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)});
 const module={exports:{}};vm.runInContext('(function(require,module,exports){'+transpile(source)+'\n})',context)(requireFor,module,module.exports);
 function render(){cursor=0;dirty=false;tree=module.exports.default({g});while(effects.length)effects.shift()();return tree;}
 async function flush(){for(let i=0;i<24;i++){render();await Promise.resolve();await Promise.resolve();await Promise.resolve();}return tree;}
 function nodes(type,node=tree,out=[]){if(!node||typeof node!=='object')return out;if(node.type===type)out.push(node);for(const child of [node.props?.children].flat(Infinity))if(child!==undefined)nodes(type,child,out);return out;}
 function runTimers(){const batch=[...timers.values()];timers.clear();batch.forEach(fn=>fn());}
 return{g,flush,render,responses,calls,nodes,html:()=>renderToStaticMarkup(tree),refresh:()=>nodes('button').find(x=>x.props.className==='secondary').props.onClick(),event:name=>{for(const fn of listeners.get(name)||[])fn({});runTimers();},change(payload){for(const ch of channels.filter(x=>!x.removed))ch.handlers[0].callback(payload);runTimers();},dispose(){slots.forEach(x=>x?.cleanup?.());}};
}
async function main(){
 const failures=[];async function check(name,fn){try{await fn();console.log('PASS '+name);}catch(error){failures.push(name);console.error('FAIL '+name+': '+error.stack);}}
 await check('RPC error removes previously green rows and retry restores all 16 stages',async()=>{
  const h=harness();await h.flush();assert.equal(h.nodes('article').filter(x=>x.props.className==='ready').length,16);assert.match(h.html(),/<b>16<\/b> готовы/);
  h.responses.push({data:null,error:{message:'QA readiness unavailable'}});h.refresh();await h.flush();assert.equal(h.nodes('article').filter(x=>x.props.className==='ready').length,0);assert.equal(h.nodes('article').filter(x=>x.props.className==='unavailable').length,16);assert.match(h.html(),/role="alert"/);assert.match(h.html(),/<b>—<\/b> готовы/);
  h.refresh();await h.flush();assert.equal(h.nodes('article').filter(x=>x.props.className==='ready').length,16);h.dispose();
 });
 await check('Shared focus, online and realtime recovery preserves teacher overrides',async()=>{
  const h=harness();await h.flush();const override=ready();override[8]={...override[8],warnings:['QA teacher override'],override:{reason:'QA teacher override'}};
  h.responses.push({data:override,error:null});h.event('focus');await h.flush();assert.match(h.html(),/QA teacher override/);assert.equal(h.nodes('article')[8].props.className,'warning');
  h.responses.push(()=>{throw Error('QA network offline');});h.refresh();await h.flush();assert.equal(h.nodes('article').filter(x=>x.props.className==='ready').length,0);h.event('online');await h.flush();assert.equal(h.nodes('article').filter(x=>x.props.className==='ready').length,16);
  const n=h.calls.length;h.change({eventType:'UPDATE',new:{game_id:'other-game'}});await h.flush();assert.equal(h.calls.length,n);h.change({eventType:'UPDATE',new:{game_id:'game-a'}});await h.flush();assert.ok(h.calls.length>n);h.dispose();
 });
 await check('Incomplete or malformed matrix never implies readiness',async()=>{
  const duplicate=ready();duplicate[15].stage_no=1;const wrongWarning=ready();wrongWarning[0].warnings=null;
  for(const data of [null,[],ready().slice(0,15),duplicate,wrongWarning]){const h=harness();await h.flush();h.responses.push({data,error:null});h.refresh();await h.flush();assert.equal(h.nodes('article').filter(x=>x.props.className==='ready').length,0);assert.match(h.html(),/полную проверку 16 этапов/);h.dispose();}
 });
 await check('Game switch clears old labels immediately and ignores an older RPC response',async()=>{
  const h=harness();await h.flush();let resolveOld,resolveNew;
  h.responses.push(()=>new Promise(resolve=>{resolveOld=resolve;}));h.refresh();await h.flush();
  h.responses.push(()=>new Promise(resolve=>{resolveNew=resolve;}));h.g.game={id:'game-b'};h.render();assert.equal(h.nodes('article').filter(x=>x.props.className==='loading').length,16);assert.doesNotMatch(h.html(),/<b>16<\/b> готовы/);await h.flush();
  resolveOld({data:ready('QA old game response'),error:null});await h.flush();assert.doesNotMatch(h.html(),/QA old game response/);assert.equal(h.nodes('article').filter(x=>x.props.className==='loading').length,16);
  resolveNew({data:ready('QA new game response'),error:null});await h.flush();assert.match(h.html(),/QA new game response/);assert.equal(h.nodes('article').filter(x=>x.props.className==='warning').length,16);h.dispose();
 });
 if(failures.length)process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
