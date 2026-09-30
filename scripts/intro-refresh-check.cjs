const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'components/GameClient.tsx'),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const noop=()=>{};
function gameState(user='user-a',game='game-a'){
 const me={user_id:user,game_id:game,kind:'student',full_name:'Тестовый Участник Игры',role_title:'Участник'};
 const g={game:{id:game,title:'Проверка',game_code:'QA',current_round:1},me,teacher:false,loading:false,profilesLoaded:true,error:'',profiles:[],members:[me],names:{[user]:me.full_name},channelId:'',secondsLeft:0,realtimeState:'connected'};
 for(const key of ['metrics','events','actions','channels','messages','stages','parties','votes','ballots','evaluations','crises','documents','activities','presence','partyDocuments','partyInvitations','partyMandates','partyAgreements','formalDocuments','formalHistory','politicalPosts','politicalMedia','postFormalLinks','politicalDecisions','metricHistory','partySupportHistory','impactRules','impactLedger','myEvaluations','chatPins','pinnedMessages'])g[key]=[];
 for(const key of ['setError','setChatOpen','setChannelId','logout','touchPresence','logActivity'])g[key]=noop;
 g.refresh=async()=>{};
 return g;
}
function harness(g,storage=new Map(),rpc=async()=>({error:null})){
 const slots=[],pending=[],timers=new Map(),listeners=new Map();let cursor=0,dirty=false,tree,clock=0;
 const react={useState(value){const i=cursor++;if(!slots[i])slots[i]={value:typeof value==='function'?value():value};return[slots[i].value,next=>{const v=typeof next==='function'?next(slots[i].value):next;if(!Object.is(v,slots[i].value)){slots[i].value=v;dirty=true;}}];},useRef(value){const i=cursor++;return(slots[i]??={value:{current:value}}).value;},useEffect(effect,deps){const i=cursor++,old=slots[i];if(!old||!deps||deps.some((v,j)=>!Object.is(v,old.deps?.[j]))){slots[i]={deps,cleanup:old?.cleanup};pending.push(()=>{slots[i].cleanup?.();slots[i].cleanup=effect();});}},useMemo(fn){cursor++;return fn();},useCallback(fn){cursor++;return fn;}};
 const tags=new Map();function tag(name){if(!tags.has(name))tags.set(name,Object.assign(noop.bind(null),{displayName:name}));return tags.get(name);}
 const chain={select(){return this},eq(){return this},then(resolve){return Promise.resolve({count:0,error:null}).then(resolve)}};
 const channel={on(){return this},subscribe(){return this}};
 const supabase={from(){return Object.create(chain)},channel(){return Object.create(channel)},removeChannel:async()=>{},rpc};
 const win={matchMedia:()=>({matches:true}),localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)},addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name)},location:{reload:noop}};
 const doc={addEventListener:noop,removeEventListener:noop,getElementById:()=>({focus:noop}),visibilityState:'visible'};
 const jsx=(type,props)=>({type,props:props||{}});
 const loaded=new Map();let context;
 function requireFor(request){
  if(request==='react')return react;
  if(request==='react/jsx-runtime')return{jsx,jsxs:jsx,Fragment:'fragment'};
  if(request==='./game/useRepublicGame')return{useRepublicGame:()=>g};
  if(request==='@/lib/supabase')return{supabase};
  if(request==='./ui/useDialog')return{useDialog:()=>({current:null})};
  if(request==='./game/constants')return{initials:()=> 'ТУ'};
  if(request==='./game/introProgress'){
   if(!loaded.has(request)){const file=path.join(root,'components/game/introProgress.ts');const m={exports:{}};const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInContext('(function(require,module,exports){'+js+'\n})',context)(requireFor,m,m.exports);loaded.set(request,m.exports);}
   return loaded.get(request);
  }
  return new Proxy({__esModule:true,default:tag(path.basename(request))},{get:(object,key)=>key in object?object[key]:tag(String(key))});
 }
 context=vm.createContext({console,window:win,document:doc,navigator:{onLine:true},localStorage:win.localStorage,Date,Promise,Map,Set,Object,Math,setInterval:()=>++clock,clearInterval:noop,setTimeout:(fn)=>{const id=++clock;timers.set(id,fn);return id},clearTimeout:id=>timers.delete(id),requestAnimationFrame:fn=>{fn();return++clock},cancelAnimationFrame:noop});
 const module={exports:{}};vm.runInContext('(function(require,module,exports){'+code+'\n})',context)(requireFor,module,module.exports);
 function render(){cursor=0;dirty=false;tree=module.exports.default({gameId:g.game?.id||'game-a'});while(pending.length)pending.shift()();return tree;}
 async function flush(){for(let i=0;i<12;i++){render();await Promise.resolve();await Promise.resolve();await Promise.resolve();if(!dirty)break;}return tree;}
 function findComic(node){if(!node||typeof node!=='object')return null;if(node.type?.displayName==='RepublicComic')return node;for(const child of [node.props?.children].flat(Infinity)){const found=findComic(child);if(found)return found;}return null;}
 return {g,storage,flush,comic:()=>findComic(tree),online:()=>listeners.get('online')?.(),dispose(){for(const s of slots)s?.cleanup?.();}};
}
async function main(){
 const failures=[];
 async function check(name,fn){try{await fn();console.log('PASS '+name)}catch(error){failures.push(name);console.error('FAIL '+name+': '+error.message)}}
 await check('Viewed intro stays closed after delayed profile loading on refresh',async()=>{
  const g=gameState();g.loading=true;g.profilesLoaded=false;const h=harness(g);await h.flush();
  g.profiles=[{user_id:g.me.user_id,intro_seen_at:'2026-09-30T00:00:00Z',onboarding_completed_at:'2026-09-30T00:00:00Z'}];g.loading=false;g.profilesLoaded=true;await h.flush();
  assert.equal(h.comic().props.open,false);h.dispose();
 });
 await check('Completed profile does not replay legacy intro without timestamp',async()=>{
  const g=gameState();g.profiles=[{user_id:g.me.user_id,intro_seen_at:null,onboarding_completed_at:'2026-09-30T00:00:00Z'}];const h=harness(g);await h.flush();assert.equal(h.comic().props.open,false);h.dispose();
 });
 await check('Intro waits for a confirmed profile response',async()=>{
  const g=gameState();g.profilesLoaded=false;const h=harness(g);await h.flush();assert.equal(h.comic().props.open,false);g.profilesLoaded=true;await h.flush();assert.equal(h.comic().props.open,true);h.dispose();
 });
 await check('Finished intro survives offline refresh and stays scoped to user and game',async()=>{
  const storage=new Map();const g=gameState();let calls=0;const offline=harness(g,storage,async()=>{calls++;return{error:{message:'Network unavailable'}}});await offline.flush();assert.equal(offline.comic().props.open,true);await offline.comic().props.onClose();await offline.flush();assert.equal(offline.comic().props.open,false);assert.ok(calls>0);offline.dispose();
  const second=harness(gameState(),storage,async()=>({error:{message:'Network unavailable'}}));await second.flush();assert.equal(second.comic().props.open,false);second.dispose();
  const otherGame=harness(gameState('user-a','other-game'),storage);await otherGame.flush();assert.equal(otherGame.comic().props.open,false);otherGame.dispose();
  for(const other of [gameState('other-user')]){const fresh=harness(other,storage);await fresh.flush();assert.equal(fresh.comic().props.open,true);fresh.dispose();}
 });
 await check('Guest never receives the automatic intro',async()=>{const g=gameState();g.me.kind='observer';const h=harness(g);await h.flush();assert.equal(h.comic().props.open,false);h.dispose();});
 if(failures.length)process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1});
