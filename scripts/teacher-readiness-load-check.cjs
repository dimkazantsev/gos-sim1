// Actual component effects, synthetic data, virtual time; no network or server capacity test.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),ref=process.env.PERFORMANCE_BASELINE_REF;
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const file='components/game/TeacherStageManager.tsx',sync=compile(read('components/game/useGameTableSync.ts'));
const tick=async()=>{for(let i=0;i<40;i++)await Promise.resolve()};
function realm({old=false,hidden=false,teacher=true}={}){
 let now=1000000,cursor=0,next=0,hold=false,fail=false,props,revision=0;
 const hooks=[],effects=[],timers=new Map(),calls=[],pending=[],channels=new Set(),listeners={window:new Map(),document:new Map()};
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const react={
  useRef(value){const i=cursor++;if(!hooks[i])hooks[i]={current:value};return hooks[i]},
  useState(value){const i=cursor++;if(!hooks[i])hooks[i]={value:typeof value==='function'?value():value};return[hooks[i].value,v=>{hooks[i].value=typeof v==='function'?v(hooks[i].value):v}]},
  useEffect(fn,deps){const i=cursor++;if(!hooks[i]||!same(hooks[i].deps,deps)){hooks[i]?.cleanup?.();hooks[i]={deps};effects.push(()=>hooks[i].cleanup=fn())}}
 };
 function target(kind){return{addEventListener(n,fn){if(!listeners[kind].has(n))listeners[kind].set(n,new Set());listeners[kind].get(n).add(fn)},removeEventListener(n,fn){listeners[kind].get(n)?.delete(fn)},dispatchEvent(e){for(const fn of [...listeners[kind].get(e.type)||[]])fn(e)}}}
 const document={...target('document'),visibilityState:hidden?'hidden':'visible'},window=target('window');
 const schedule=(fn,delay,interval=0)=>{const id=++next;timers.set(id,{fn,at:now+delay,interval});return id};
 Object.assign(window,{setTimeout:(fn,d)=>schedule(fn,d),clearTimeout:id=>timers.delete(id),setInterval:(fn,d)=>schedule(fn,d,d),clearInterval:id=>timers.delete(id),confirm:()=>true});
 const supabase={rpc(name,args){let promise;const builder={abortSignal(){return builder},then(resolve,reject){
  if(!promise){calls.push({name,args,at:now});const result={data:Array.from({length:16},(_,i)=>({stage_no:i+1,ready:revision>0,blockers:[],warnings:[],metrics:{}})),error:fail?{message:'synthetic failure'}:null};promise=hold?new Promise(done=>pending.push(()=>done(result))):Promise.resolve(result)}return promise.then(resolve,reject);
 }};return builder},channel(){const handlers=[];const ch={on(_,filter,fn){handlers.push({filter,fn});return ch},subscribe(){channels.add(ch);return ch},handlers};return ch},removeChannel(ch){channels.delete(ch)}};
 const jsx=(type,props)=>({type,props}),math=Object.create(Math);math.random=()=>0.5;
 class ClockDate extends Date{static now(){return now}}
 const context={exports:{},console,Date:ClockDate,Math:math,window,document,AbortController,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail}},setTimeout:window.setTimeout,clearTimeout:window.clearTimeout,setInterval:window.setInterval,clearInterval:window.clearInterval};
 let house;context.require=name=>name==='react'?react:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='@/lib/supabase'?{supabase}:name==='@/lib/userError'?{userError:e=>e?.message||String(e)}:name==='./useGameTableSync'?house:name==='../ui/useDialog'?{useDialog:()=>({current:null})}:{};
 vm.createContext(context);vm.runInContext('(function(exports,require){'+sync+'})(exports,require)',context);house={...context.exports};context.exports={};
 vm.runInContext('(function(exports,require){'+compile(old?execFileSync('git',['show',ref+':'+file],{cwd:root,encoding:'utf8'}):read(file))+'})(exports,require)',context);
 props={g:{game:{id:'A',current_round:1},me:{user_id:'teacher-A',kind:teacher?'teacher':'observer'},teacher,stages:Array.from({length:16},(_,i)=>({id:'s'+i,stage_no:i+1,title:'Этап '+(i+1),status:i?'locked':'open'}))},onOpenStage(){}};
 return{calls,render(change){if(change)props={...props,g:{...props.g,...change}};cursor=0;const tree=context.exports.default(props);while(effects.length)effects.shift()();return tree},
  event(table='formal_documents',gameId='A'){if(old){for(const ch of channels)for(const h of ch.handlers)if(h.filter.table===table&&gameId==='A')h.fn()}else house.notifyGameDataRefresh(gameId,table)},
  visible(value){document.visibilityState=value?'visible':'hidden';document.dispatchEvent({type:'visibilitychange'})},hold(value){hold=value},fail(value){fail=value},revision(value){revision=value},release(){for(const done of pending.splice(0))done()},
  async advance(ms){const end=now+ms;for(;;){const due=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;now=due[1].at;if(due[1].interval)due[1].at+=due[1].interval;else timers.delete(due[0]);due[1].fn();await tick()}now=end;await tick()},
  close(){for(const hook of hooks)hook?.cleanup?.();assert.equal(timers.size,0);assert.equal(channels.size,0);for(const map of Object.values(listeners))for(const set of map.values())assert.equal(set.size,0)}
 };
}
function find(tree,predicate){if(!tree)return;if(Array.isArray(tree)){for(const node of tree){const result=find(node,predicate);if(result)return result}}else if(typeof tree==='object'){if(predicate(tree))return tree;return find(tree.props?.children,predicate)}}
const button=tree=>find(tree,n=>n.props?.['aria-label']==='Перепроверить готовность всех этапов');
async function traffic(old){const r=realm({old});r.render();await tick();for(let i=0;i<1200;i++){r.event();await r.advance(1000)}const result=r.calls.length;r.close();return result}
async function main(){
 const after=await traffic(false),before=ref?await traffic(true):null;assert(after<=242);if(before!==null)assert(before>after*4);
 const hidden=realm({hidden:true});hidden.render();await tick();await hidden.advance(20*60000);assert.equal(hidden.calls.length,0);hidden.visible(true);await hidden.advance(1000);assert.equal(hidden.calls.length,1);hidden.close();
 const slow=realm();slow.hold(true);let tree=slow.render();await tick();for(let i=0;i<10;i++)button(tree).props.onClick();await tick();assert.equal(slow.calls.length,1);slow.hold(false);slow.revision(1);slow.release();await tick();assert.equal(slow.calls.length,2);tree=slow.render();assert(find(tree,n=>n.props?.compactReadiness)?.props.compactReadiness.ready);slow.close();
 const stuck=realm();stuck.hold(true);tree=stuck.render();await tick();await stuck.advance(12001);tree=stuck.render();assert.equal(button(tree).props.disabled,false,'Ignoring abort cannot hold loading forever');stuck.hold(false);stuck.revision(1);button(tree).props.onClick();await tick();stuck.release();await tick();tree=stuck.render();assert(find(tree,n=>n.props?.compactReadiness)?.props.compactReadiness.ready,'Late timed-out response cannot replace retry');stuck.fail(true);button(tree).props.onClick();await tick();tree=stuck.render();assert.equal(find(tree,n=>n.props?.compactChecked!==undefined).props.compactChecked,false,'A failed check cannot authorize completion');stuck.close();
 const foreign=realm();foreign.render();await tick();for(let i=0;i<20;i++){foreign.event('political_posts');foreign.event('formal_documents','B')}await foreign.advance(6000);assert.equal(foreign.calls.length,1);foreign.hold(true);button(foreign.render()).props.onClick();await tick();foreign.render({game:{id:'B'},me:{user_id:'teacher-B',kind:'teacher'}});foreign.hold(false);await tick();foreign.release();await tick();tree=foreign.render();assert.equal(foreign.calls.at(-1).args.p_game_id,'B');foreign.close();
 const observer=realm({teacher:false});assert.equal(observer.render(),null);await tick();assert.equal(observer.calls.length,0);observer.close();
 const sf=ts.createSourceFile('Governance.tsx',read('components/game/GovernanceStageWorkspace.tsx'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let handler;
 function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(sf)==='update'&&node.initializer?.getText(sf).includes('stage_deadline_rules'))handler=node.initializer.getText(sf);ts.forEachChild(node,visit)}visit(sf);assert(handler);
 let ruleReads=0;const callback={exports:{},gameId:'A',stage:{stage_no:4},load(){ruleReads++}};vm.runInNewContext(compile('const update='+handler+';exports.update=update'),callback);const update=callback.exports.update;
 for(let i=0;i<100;i++)update({detail:{gameId:'A',table:'political_posts'}});assert.equal(ruleReads,0);
 update({detail:{gameId:'B',table:'stage_deadline_rules'}});update({detail:{gameId:'A',stageNo:5,table:'stage_deadline_rules'}});assert.equal(ruleReads,0);
 update({detail:{gameId:'A',table:'stage_deadline_rules'}});update({detail:{gameId:'A',stageNo:4}});assert.equal(ruleReads,2);
 console.log(JSON.stringify({environment:'One teacher, 1200 document invalidations in 20 virtual minutes; synthetic replies, no network',before,after,checks:['hidden/recovery','single-flight/trailing','12s ignored-abort release','late timeout reply','failure blocks completion','foreign table/game isolation','observer no RPC','rule callback table/stage isolation']},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1});
