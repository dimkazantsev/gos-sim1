// Execute the complete EventWorkspace and shared sync hook with synthetic data; no HTTP/Auth load.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
const compile=file=>ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const component=compile('components/game/EventWorkspace.tsx'),shared=compile('components/game/useGameTableSync.ts');
const feedSource=fs.readFileSync(path.join(root,'components/game/EventWorkspace.tsx'),'utf8');
const projections={
 event_assignments:'id,case_id,game_id,recipient_id,status,created_at',
 event_decisions:'id,case_id,actor_id,choice,role_snapshot',
 event_case_outcomes:'case_id,winner,trust_delta,votes_count,assignments_count,media_post_id,requested_trust_delta,resolution_kind',
 event_collaboration_invites:'id,case_id,inviter_id,recipient_id,status',
 event_authority_evidence:'decision_id,case_id,actor_id,authority_ok,lawful,strategy_point,role_snapshot,legal_basis'
};
for(const [table,columns] of Object.entries(projections)){
 assert(feedSource.includes("supabase.from('"+table+"').select('"+columns+"').eq('game_id',game.id)"),
  'Feed must select only consumed columns of '+table);
 assert(!feedSource.includes("supabase.from('"+table+"').select('*')"),
  'No wildcard fields in hot event feed '+table);
}

assert(feedSource.includes("supabase.rpc('get_event_workspace_projection'"),'Event panels must use the unified server read model');
const tick=async()=>{for(let i=0;i<100;i++)await Promise.resolve()};
function realm({hidden=false,hold='',teacher=false,answered=false,fault=''}={}){
 let now=1000000,cursor=0,nextId=0,held=false,release,props;
 const hooks=[],effects=[],calls=[],timers=new Map(),listeners={window:new Map(),document:new Map()},completed=new Set();
 const equal=(a,b)=>!!a&&!!b&&a.length===b.length&&a.every((x,i)=>Object.is(x,b[i]));
 const react={
  useState(value){const i=cursor++;if(!hooks[i])hooks[i]={value:typeof value==='function'?value():value};return[hooks[i].value,next=>{hooks[i].value=typeof next==='function'?next(hooks[i].value):next}]},
  useRef(value){const i=cursor++;if(!hooks[i])hooks[i]={current:value};return hooks[i]},
  useMemo(factory,deps){const i=cursor++;if(!hooks[i]||!equal(hooks[i].deps,deps))hooks[i]={value:factory(),deps};return hooks[i].value;},
  useEffect(fn,deps){const i=cursor++;if(!hooks[i]||!equal(hooks[i].deps,deps)){hooks[i]?.cleanup?.();hooks[i]={deps};effects.push(()=>{hooks[i].cleanup=fn()})}}
 };
 function target(kind){return{addEventListener(name,fn){if(!listeners[kind].has(name))listeners[kind].set(name,new Set());listeners[kind].get(name).add(fn)},removeEventListener(name,fn){listeners[kind].get(name)?.delete(fn)},dispatchEvent(event){for(const fn of [...listeners[kind].get(event.type)||[]])fn(event)}}}
 const document={...target('document'),visibilityState:hidden?'hidden':'visible'},window=target('window');
 function set(fn,delay,interval){const id=++nextId;timers.set(id,{fn,at:now+delay,interval});return id}
 Object.assign(window,{confirm:()=>true,setTimeout:(fn,delay)=>set(fn,delay,0),clearTimeout:id=>timers.delete(id),setInterval:(fn,delay)=>set(fn,delay,delay),clearInterval:id=>timers.delete(id)});
 async function wait(name,game){if(!held&&hold===name&&game==='game-A'){held=true;await new Promise(resolve=>{release=resolve})}}
 const assignments=game=>[{id:'assignment-'+game,game_id:game,case_id:'case-'+game,recipient_id:props.g.me.user_id,status:completed.has(game)?'resolved':'pending',created_at:'2026-10-26T00:00:00Z'}];
 const decision=game=>({id:'decision-'+game,case_id:'case-'+game,actor_id:props.g.me.user_id,choice:'option_1'});
 function result(table,filters){
  const game=filters.game_id||'game-A';
  if(table==='event_assignments')return{data:assignments(game),error:null};
  if(table==='event_decisions')return{data:answered||completed.has(game)?[decision(game)]:[],error:null};
  if(table==='event_case_outcomes')return{data:completed.has(game)?[{case_id:'case-'+game,winner:'option_1',trust_delta:2,requested_trust_delta:2,votes_count:1,assignments_count:1,media_post_id:'post-'+game}]:[],error:null};
  if(table==='event_authority_evidence')return{data:[{decision_id:'decision-'+game,case_id:'case-'+game,actor_id:props.g.me.user_id,authority_ok:true,lawful:true,strategy_point:true,role_snapshot:'Министр',legal_basis:'Authority legal basis'}],error:null};
  if(table==='event_case_routing')return{data:[{case_id:'case-'+game,region_code:'region-'+game}],error:null};
  if(table==='fiscal_region_reference')return{data:(filters.code||[]).map(code=>({code,name:'Region '+code})),error:null};
  if(table==='game_region_party_control')return{data:[{region_code:'region-'+game,party_id:'party'}],error:null};
  if(table==='event_cases')return{data:null,count:3,error:null};
  return{data:[],error:null};
 }
 const supabase={from(table){const filters={};let reply;
  const query=new Proxy({},{get(_,key){
   if(key==='then')return(resolve,reject)=>{
    if(!reply){const snapshot={...filters};const value=result(table,snapshot);calls.push({name:table,filters:snapshot,at:now});reply=wait(table,snapshot.game_id).then(()=>value)}
    return reply.then(resolve,reject);
   };
   return(...args)=>{if(['eq','in'].includes(String(key)))filters[args[0]]=args[1];return query};
  }});return query},
  async rpc(name,args){const game=args.p_game_id||String(args.p_assignment_id||args.p_case_id||'').replace(/^(assignment|case)-/,'');calls.push({name,args,at:now});await wait(name,game);
   if(name==='get_event_workspace_feed_bootstrap'||name==='get_event_workspace_projection'){
    if(fault&&name==='get_event_workspace_feed_bootstrap')return{data:null,error:{code:fault,message:'Simulated '+fault},status:fault==='PGRST202'?404:503};
    const rows=name=>result(name,{game_id:game}).data;
    return{data:{assignments:rows('event_assignments'),decisions:rows('event_decisions'),
     outcomes:rows('event_case_outcomes'),invitations:rows('event_collaboration_invites'),
     authority:rows('event_authority_evidence'),ready_case_count:args.p_include_ready_count?3:null,
     compact:name==='get_event_workspace_feed_bootstrap'?{titles:[{id:'case-'+game,title:'Ситуация '+game}],positive:1,negative:0}:undefined},error:null};
   }
   if(name==='event_feed_compact_summary')return{data:{titles:[{id:'case-'+game,title:'Ситуация '+game}],positive:teacher?1:null,negative:teacher?0:null},error:null};
   if(name==='list_visible_event_cases')return{data:args.p_case_ids.map(id=>({id,game_id:args.p_game_id,case_key:id,title:id,situation:'Конкретные обстоятельства учебной ситуации.',category:'Право',seriousness:'serious',audience:'single',allowed_roles:[],status:'ready',source_url:null,decision_options:['Законный вариант','Альтернатива'],effect_plan:{options:[{key:'option_1',trust:2,description:'Подтверждённый результат',legal_basis:'Точная норма'},{key:'option_2',trust:0}]},comic_scene:{}})),error:null};
   if(name==='submit_event_decision'||name==='finalize_event_case')completed.add(game);
   return{data:{reason:'finalized'},error:null};
  },channel(){throw Error('Extra Realtime channel is forbidden')},removeChannel(){throw Error('No extra channel may exist')}};
 class ClockDate extends Date{static now(){return now}}
 const math=Object.create(Math);math.random=()=>0.5;
 const jsx=(type,props)=>({type,props});
 const context={exports:{},console,Date:ClockDate,Math:math,document,window,setTimeout:window.setTimeout,clearTimeout:window.clearTimeout,setInterval:window.setInterval,clearInterval:window.clearInterval,confirm:()=>true,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail}},fetch:()=>{throw Error('Network is forbidden')}};
 let sync;
 context.require=name=>name==='react'?react:name==='react/jsx-runtime'?{jsx,jsxs:jsx,Fragment:'fragment'}:name==='@/lib/supabase'?{supabase}:name==='./useGameTableSync'?sync:name==='@/lib/userError'?{userError:e=>e?.message||String(e)}:name==='../../lib/gameLabels'?{gameValueLabel:value=>value}:name==='./eventButtonSound'?{eventButtonSound(){}}:{default:name};
 vm.createContext(context);vm.runInContext('(function(exports,require){'+shared+'})(exports,require)',context);sync={...context.exports};context.exports={};vm.runInContext('(function(exports,require){'+component+'})(exports,require)',context);
 const g={game:{id:'game-A'},me:{user_id:'student-A',kind:teacher?'teacher':'student',role_title:'Министр'},teacher,members:[{user_id:'student-A',kind:'student',full_name:'Участник',role_title:'Министр'}],parties:[{id:'party',name:'Партия'}],profiles:[],names:{'student-A':'Участник'},refresh(){throw Error('Full game refresh is forbidden')},async refreshEventEffects(){calls.push({name:'refreshEventEffects',at:now})}};
 props={g};
 return{calls,render(changes){if(changes)props={...props,...changes,g:{...props.g,...changes.g}};cursor=0;const tree=context.exports.default(props);while(effects.length)effects.shift()();return tree},
  release(){release?.()},
  visible(value){document.visibilityState=value?'visible':'hidden';document.dispatchEvent({type:'visibilitychange'})},
  async advance(ms){const end=now+ms;for(;;){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;if(next[1].interval)next[1].at+=next[1].interval;else timers.delete(next[0]);next[1].fn();await tick()}now=end;await tick()},
  close(){for(const hook of hooks)hook?.cleanup?.();assert.equal(timers.size,0);for(const map of Object.values(listeners))for(const set of map.values())assert.equal(set.size,0)}
 };
}
function find(tree,predicate){if(!tree)return;if(Array.isArray(tree)){for(const node of tree){const found=find(node,predicate);if(found)return found}}else if(typeof tree==='object'){if(predicate(tree))return tree;return find(tree.props?.children,predicate)}}
const count=(r,name)=>r.calls.filter(c=>c.name===name).length;
const refreshButton=tree=>find(tree,n=>n.props?.['aria-label']==='Обновить список событий и результаты');
async function openCase(r){let tree=r.render();await tick();tree=r.render();find(tree,n=>n.props?.item?.id)?.props.onClick();return r.render()}
async function main(){
 const hidden=realm({hidden:true});let tree=hidden.render();await tick();await hidden.advance(20*60000);assert.equal(hidden.calls.length,0,'Initial/background reads pause while hidden');refreshButton(tree).props.onClick();await tick();tree=hidden.render();assert.equal(count(hidden,'get_event_workspace_feed_bootstrap'),1,'Explicit projection refresh is allowed while hidden');assert.equal(count(hidden,'event_cases'),0,'Ready-case counter is included in the server projection');assert(hidden.calls.some(c=>c.name==='get_event_workspace_feed_bootstrap'&&c.args.p_include_ready_count),'Manual refresh includes the ready-case count');const hiddenReads=hidden.calls.length;await hidden.advance(20*60000);assert.equal(hidden.calls.length,hiddenReads,'Hidden polling adds no reads');hidden.visible(true);await hidden.advance(1000);assert.equal(count(hidden,'get_event_workspace_feed_bootstrap'),2,'Visibility recovery reconciles the projection');hidden.close();
 const slow=realm({hold:'get_event_workspace_feed_bootstrap'});tree=slow.render();await tick();for(let i=0;i<8;i++)refreshButton(tree).props.onClick();await tick();assert.equal(count(slow,'get_event_workspace_feed_bootstrap'),1,'Concurrent refreshes share one projection read');slow.release();await tick();assert.equal(count(slow,'get_event_workspace_feed_bootstrap'),2,'A burst produces one trailing read');assert.equal(count(slow,'event_cases'),0,'Projected ready-count adds no extra HTTP request');slow.close();
 const late=realm({hold:'list_visible_event_cases'});late.render();await tick();late.render({g:{game:{id:'game-B'},me:{user_id:'student-B',kind:'student',role_title:'Депутат'}}});await tick();tree=late.render();assert(find(tree,n=>n.props?.item?.id==='case-game-B'));late.release();await tick();tree=late.render();assert(!find(tree,n=>n.props?.item?.id==='case-game-A'),'Late old-game response cannot enter the current feed');assert.equal(late.calls.filter(c=>c.name==='event_case_routing'&&c.filters.game_id==='game-A').length,0,'Old-scope work stops before additional routing reads');const beforeScope=count(late,'get_event_workspace_feed_bootstrap');late.render({g:{me:{user_id:'student-C',kind:'student',role_title:'Депутат'}}});await tick();late.render({g:{me:{user_id:'student-C',kind:'student',role_title:'Министр'}}});await tick();assert.equal(count(late,'get_event_workspace_feed_bootstrap'),beforeScope+2,'User and role changes independently reconcile under a fresh scope');late.close();
 const student=realm();tree=await openCase(student);find(tree,n=>typeof n.props?.onAnswer==='function').props.onAnswer('option_1');await tick();tree=student.render();assert.equal(count(student,'submit_event_decision'),1);assert.equal(count(student,'refreshEventEffects'),1,'Answer refreshes only event consequences');assert(JSON.stringify(tree).includes('Фактическое изменение доверия'),'Outcome remains visible after saving');assert(count(student,'get_event_workspace_feed_bootstrap')>=2&&count(student,'game_region_party_control')>=2,'Answer preserves authority and routing reloads');student.close();
 const instructor=realm({teacher:true,answered:true});tree=await openCase(instructor);assert(JSON.stringify(tree).includes('Authority legal basis'),'Authority evidence remains rendered');find(tree,n=>n.props?.className==='eventFinalize').props.onClick();await tick();tree=instructor.render();assert.equal(count(instructor,'finalize_event_case'),1);assert.equal(count(instructor,'refreshEventEffects'),1,'Finalization uses the same narrow refresh');assert(JSON.stringify(tree).includes('Фактическое изменение доверия'));instructor.close();
 const missing=realm({fault:'PGRST202'});tree=missing.render();await tick();assert.equal(count(missing,'get_event_workspace_feed_bootstrap'),1);assert.equal(count(missing,'get_event_workspace_projection'),1,'Old projection remains the compatibility fallback');assert.equal(count(missing,'event_assignments'),0,'One missing RPC must not trigger five table reads');missing.close();
 const overloaded=realm({fault:'PGRST003'});tree=overloaded.render();await tick();assert.equal(count(overloaded,'get_event_workspace_feed_bootstrap'),1);assert.equal(count(overloaded,'event_assignments'),0,'Overload never fans out into five legacy HTTP requests');overloaded.close();
 const classrooms=Array.from({length:40},()=>realm());for(const room of classrooms){room.render();await tick();assert.equal(count(room,'get_event_workspace_feed_bootstrap'),1);assert.equal(count(room,'event_assignments'),0);room.close()}
 console.log('PASS full EventWorkspace effect: hidden pause/manual override, visibility recovery, single-flight/trailing count, old game/user/role scopes, actual answer/finalize callbacks, outcomes/authority/routing preserved; no network/Auth load');
}
main().catch(error=>{console.error(error);process.exitCode=1});
