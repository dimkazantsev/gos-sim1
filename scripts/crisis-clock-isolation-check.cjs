/* Real CrisisRoom, synthetic clock and data; no network. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
let now=Date.parse('2026-10-28T00:00:00Z'),nextId=0,rootRenders=0,dirty=false,rootDirty=true,current=null,cursor=0;
const timers=new Map(),scopes=new Map(),effects=[],listeners=new Map();
class FakeDate extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}}
function schedule(fn,delay,interval=0){const id=++nextId;timers.set(id,{fn,at:now+Math.max(0,delay),interval});return id}
const react={
 useState(initial){const scope=current,i=cursor++;if(!(i in scope))scope[i]={value:typeof initial==='function'?initial():initial};return [scope[i].value,v=>{const next=typeof v==='function'?v(scope[i].value):v;if(!Object.is(next,scope[i].value)){scope[i].value=next;dirty=true;if(scope===scopes.get('root:CrisisRoom'))rootDirty=true}}]},
 useRef(value){const i=cursor++;return current[i]||(current[i]={current:value})},
 useMemo(fn){cursor++;return fn()},useId(){cursor++;return 'id'},
 useEffect(fn,deps){const scope=current,i=cursor++,old=scope[i];if(!old||deps?.some((v,j)=>!Object.is(v,old.deps[j]))){scope[i]={deps,cleanup:old?.cleanup};effects.push(()=>{scope[i].cleanup?.();scope[i].cleanup=fn()})}}
};
const jsx=(type,props)=>({type,props}),header=({stats=[]})=>jsx('header',{children:stats.map(x=>x.value)}),styles=new Proxy({},{get:(_,key)=>String(key)});
const requireStub=name=>name==='react'?react:name==='react/jsx-runtime'?{jsx,jsxs:jsx,Fragment:'fragment'}:name==='lucide-react'?{}:name.includes('StageModuleHeader')?{__esModule:true,default:header}:name==='./constants'?{CRISES:[{id:'one',source:'rules',type:'One',levels:{low:'',medium:'',high:'',ultra:''}}],INTENSITY_LABEL:{low:'Low'}}:name==='./useGameTableSync'?{useGameTableSync:()=>{}}:name.endsWith('.css')?{__esModule:true,default:styles}:{};
const context={Date:FakeDate,Math,console,setInterval:(fn,delay)=>schedule(fn,delay,delay),clearInterval:id=>timers.delete(id),setTimeout:(fn,delay)=>schedule(fn,delay),clearTimeout:id=>timers.delete(id),document:{visibilityState:'visible',addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:(type,fn)=>{if(listeners.get(type)===fn)listeners.delete(type)}}};context.window=context;
const source=ts.transpileModule(fs.readFileSync('components/game/CrisisRoom.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const mod={exports:{}};vm.runInNewContext('(function(require,module,exports){'+source+'})',context)(requireStub,mod,mod.exports);
const Room=mod.exports.default;
const active={id:'crisis',status:'active',created_at:new Date(now).toISOString(),response_deadline:new Date(now+5000).toISOString(),intensity:'low',stage_no:15};
const members=Array.from({length:100},(_,i)=>({user_id:'user'+i,full_name:'User '+i,kind:'student',role_title:'Minister'}));
const g={game:{id:'game',current_round:15},me:{user_id:'teacher'},teacher:true,crises:[active],members,triggerCrisis:()=>{},setError:()=>{}};
let tree;
function expand(node,path='root'){
 if(Array.isArray(node))return node.map((n,i)=>expand(n,path+':'+i));
 if(!node||typeof node!=='object')return node;
 if(typeof node.type==='function'){
  const saved=current,savedCursor=cursor,key=path+':'+(node.type.name||'component');current=scopes.get(key)||[];scopes.set(key,current);cursor=0;
  if(node.type===Room&&rootDirty){rootRenders++;rootDirty=false}
  const result=node.type(node.props||{});current=saved;cursor=savedCursor;return expand(result,key);
 }
 return {...node,props:{...node.props,children:expand(node.props?.children,path+':children')}};
}
function render(){do{dirty=false;tree=expand(jsx(Room,{g}));while(effects.length)effects.shift()()}while(dirty)}
function text(node){if(Array.isArray(node))return node.map(text).join(' ');if(node&&typeof node==='object')return text(node.props?.children);return node==null?'':String(node)}
function advance(ms){const end=now+ms;for(;;){const item=[...timers.entries()].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!item)break;const [id,t]=item;now=t.at;if(t.interval)t.at+=t.interval;else timers.delete(id);t.fn();if(dirty)render()}now=end;if(dirty)render()}
render();
const rootScope=[...scopes.entries()].find(([key])=>key.endsWith(':CrisisRoom'))[1];
rootScope[3].value=[{user_id:'user0',status:'suspended',until_at:new Date(now+3000).toISOString()}];render();
assert.match(text(tree),/00:05/);assert.match(text(tree),/Отстранён/);
const before=rootRenders;advance(2000);assert.match(text(tree),/00:03/);
assert.equal(rootRenders-before,0,'Countdown must not rerender the whole crisis room');
advance(2000);assert.match(text(tree),/Полномочия активны/);assert.doesNotMatch(text(tree),/Отстранён/);
assert.equal(rootRenders-before,1,'The room updates once when the role restriction expires');
advance(2000);assert.match(text(tree),/Срок истёк/);
assert.equal(rootRenders-before,1,'An expired countdown does not rerender the room');
active.response_deadline=new Date(now+10000).toISOString();render();assert.match(text(tree),/00:10/);
advance(2000);assert.match(text(tree),/00:08/);
rootScope[3].value=[{user_id:'user0',status:'suspended',until_at:new Date(now+2000).toISOString()}];render();
assert.match(text(tree),/Отстранён/);now+=3000;listeners.get('visibilitychange')();render();
assert.doesNotMatch(text(tree),/Отстранён/,'Returning to the tab immediately updates expired restrictions');
for(const scope of scopes.values())for(const slot of scope)slot?.cleanup?.();
assert.equal(timers.size,0,'Unmount clears all timers');assert.equal(listeners.size,0,'Unmount removes visibility listeners');
console.log('PASS: 0 whole-room timer updates in 2 seconds (before fix: 2); role expiry, visibility, deadline changes and cleanup; 100 roles, synthetic clock.');
