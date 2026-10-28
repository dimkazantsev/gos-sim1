/* Executes the real election/policy components and shared hook with synthetic replies.
 * Virtual time is not an Auth, HTTP, Realtime fanout or database capacity test. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),compareRef=process.env.PERFORMANCE_BASELINE_REF;
const source=file=>fs.readFileSync(path.join(root,file),'utf8');
const transpile=code=>ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const compiled=new Map(),tick=async()=>{for(let i=0;i<24;i++)await Promise.resolve()};
const tables={duma:['office_elections','office_candidates','office_ballots','office_personal_ballots','party_member_mandates','game_votes','institution_session_registrations'],party:['party_chair_ballots'],deadline:['stage_deadline_rules'],ghost:['ghost_voting_policies','game_votes']};
const files={duma:'DumaLeadershipElection',party:'PartyChairElection',deadline:'DeadlineControl',ghost:'GhostPolicyLab'};
function componentCode(kind,old){
 const file='components/game/'+files[kind]+'.tsx',key=String(old)+file;
 if(!compiled.has(key))compiled.set(key,transpile(old?execFileSync('git',['show',compareRef+':'+file],{cwd:root,encoding:'utf8'}):source(file)));
 return compiled.get(key);
}
const syncCode=transpile(source('components/game/useGameTableSync.ts'));
function realm(kind,old=false,{hidden=false,subscription='immediate',secretTransition=false}={}){
 let now=Date.parse('2026-10-26T12:00:00Z'),cursor=0,nextId=0,revision=0,holdReads=false,holdMutation=false,mutationError=null,currentProps,lastMutation='',clockUpdates=0,openedVotes=0;
 let reads=0,mutations=0,inflight=0,maxInflight=0,bytes=0,rawSubscriptions=0,tree;
 const hooks=[],effects=[],timers=new Map(),channels=new Set(),held=[],heldMutations=[],errors=[],failures=new Set(),counts=new Map(),starts=[];
 const listeners={window:new Map(),document:new Map()},same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const react={
  useState(value){const i=cursor++;if(!hooks[i])hooks[i]={value:typeof value==='function'?value():value};return[hooks[i].value,v=>{if(kind==='deadline'&&i===8)clockUpdates++;hooks[i].value=typeof v==='function'?v(hooks[i].value):v}]},
  useRef(value){const i=cursor++;if(!hooks[i])hooks[i]={current:value};return hooks[i]},
  useMemo(fn,deps){const i=cursor++;if(!hooks[i]||!same(hooks[i].deps,deps))hooks[i]={deps,value:fn()};return hooks[i].value},
  useEffect(fn,deps){const i=cursor++;if(!hooks[i]||!same(hooks[i].deps,deps)){hooks[i]?.cleanup?.();hooks[i]={deps};effects.push(()=>{hooks[i].cleanup=fn()})}}
 };
 function target(kind){return{addEventListener(name,fn){if(!listeners[kind].has(name))listeners[kind].set(name,new Set());listeners[kind].get(name).add(fn)},removeEventListener(name,fn){listeners[kind].get(name)?.delete(fn)},dispatchEvent(event){for(const fn of [...listeners[kind].get(event.type)||[]])fn(event)}}}
 const window=target('window'),document={...target('document'),visibilityState:hidden?'hidden':'visible'};
 const schedule=(fn,delay,interval=0)=>{const id=++nextId;timers.set(id,{fn,at:now+Math.max(0,Number(delay)||0),interval});return id};
 Object.assign(window,{setTimeout:(fn,d)=>schedule(fn,d),clearTimeout:id=>timers.delete(id),setInterval:(fn,d)=>schedule(fn,d,d),clearInterval:id=>timers.delete(id)});
 function reply(name,filters,rev){
  const game=filters.game_id||'game-A',party=filters.party_id||'party-A';
  const rows={
   office_elections:[{id:'election-'+game,game_id:game,office_key:'gd_chair',office_title:'Председатель ГД',round_no:1,vote_mode:secretTransition?'secret':'open',status:secretTransition&&rev?'closed':'open',ballot_mode:'personal',winner_candidate_id:null,created_at:'2026-10-26'}],
   office_candidates:[{id:'candidate-'+game,election_id:'election-'+game,user_id:'student-A',party_id:'party-A'}],
   office_ballots:[],office_personal_ballots:rev?[{election_id:'election-'+game,voter_id:'student-A',party_id:'party-A',candidate_id:'candidate-'+game}]:[],
   party_member_mandates:[{user_id:'student-A',party_id:'party-A',base_mandates:15,effective_mandates:15}],
   institution_session_registrations:[{user_id:'student-A',stage_no:4,institution_key:'gd',present_mandates:15}],
   game_votes:[{id:'procedure',status:'closed',result_code:'passed'}],
   party_chair_ballots:[{voter_id:'student-B',candidate_id:party==='party-A'?'student-B':'other-party'},...(rev?[{voter_id:'student-A',candidate_id:'student-A'}]:[])],
   get_my_institution_meeting_permissions:{can_coordinate:true},
   stage_deadline_rules:{game_id:game,stage_no:Number(filters.stage_no||4),deadline_at:'2026-10-25T12:00:00Z',inclusive:true,penalty_points:2,penalty_description:'Утверждённое правило этапа',consequence_type:'representation_loss',consequence_magnitude:2},
   stage_deadline_incidents:[{id:'incident-'+game,game_id:game,stage_no:Number(filters.stage_no||4),party_id:'party-A',user_id:null,consequence_type:'representation_loss',magnitude:2,note:'accepted-'+rev,status:rev?'reverted':'active',created_at:'2026-10-25T13:00:00Z'}],
   ghost_voting_policies:[{id:'policy-'+game,game_id:game,policy_mode:'prohibited',rationale:'accepted-'+rev,status:lastMutation==='open_ghost_voting_policy_vote'?'vote_open':'draft',vote_id:lastMutation==='open_ghost_voting_policy_vote'?'procedure':null,proposed_by:'student-A',created_at:'2026-10-25T12:00:00Z'}]
  };
  return{data:failures.has(name)?null:rows[name]??null,error:failures.has(name)?{message:'synthetic read failure'}:null};
 }
 function query(name,args,isMutation=false){
  const filters={},state={signal:null},builder=new Proxy({then(resolve,reject){
   const operation=(async()=>{
    counts.set(name,(counts.get(name)||0)+1);
    if(isMutation){mutations++;if(holdMutation)await new Promise(r=>heldMutations.push(r));if(mutationError)throw mutationError;revision++;lastMutation=name;return{data:null,error:null}}
    reads++;inflight++;maxInflight=Math.max(maxInflight,inflight);
    const response=reply(name,filters,revision);if(starts.length<40)starts.push({name,filters:{...filters},signal:state.signal});
    try{if(holdReads)await new Promise(r=>held.push(r));else await Promise.resolve();bytes+=Buffer.byteLength(JSON.stringify(response));return response}
    finally{inflight--}
   })();return operation.then(resolve,reject);
  }},{get(object,key){if(key==='then')return object.then;if(key==='eq')return(k,v)=>{filters[k]=v;return builder};if(key==='abortSignal')return signal=>{state.signal=signal;return builder};return()=>builder}});
  return builder;
 }
 const supabase={
  from:name=>query(name),rpc:(name,args)=>query(name,args,name!=='get_my_institution_meeting_permissions'),
  channel(name){const ch={name,handlers:[],on(_event,filter,fn){this.handlers.push({filter,fn});return this},subscribe(callback){rawSubscriptions+=this.handlers.length;channels.add(this);this.status=callback;if(subscription==='immediate')callback?.('SUBSCRIBED');return this}};return ch},
  removeChannel(ch){channels.delete(ch);return Promise.resolve()}
 };
 const jsx=(type,props)=>({type,props}),math=Object.create(Math);math.random=()=>0.5;
 class ClockDate extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}}
 const context={exports:{},console:{...console,error:(...args)=>errors.push(args)},Date:ClockDate,Math:math,AbortController,window,document,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail}},setTimeout:window.setTimeout,clearTimeout:window.clearTimeout,setInterval:window.setInterval,clearInterval:window.clearInterval};
 let sync;
 context.require=name=>name==='react'?react:name==='react/jsx-runtime'?{jsx,jsxs:jsx,Fragment:'fragment'}:name==='@/lib/supabase'?{supabase}:name==='@/lib/userError'?{userError:e=>e?.message||String(e)}:name==='./useGameTableSync'?sync:name==='./stageWorkStatus'?{isStageWorkOpen:(game,stage)=>game?.status==='running'&&stage?.status==='open'}:name==='../ui/useDialog'?{useDialog:()=>({current:null})}:name==='lucide-react'?new Proxy({},{get:(_,name)=>name}):{};
 vm.createContext(context);vm.runInContext('(function(exports,require){'+syncCode+'})(exports,require)',context);sync={...context.exports};sync.setGameRealtimeConnection('game-A',true);sync.setGameRealtimeConnection('game-B',true);context.exports={};
 vm.runInContext('(function(exports,require){'+componentCode(kind,old)+'})(exports,require)',context);
 const api={errors,starts,failures,
  props(gameId='game-A',user='student-A',memberKind='student',partyId='party-A'){
   const members=[{user_id:user,kind:memberKind,role_title:'Депутат Государственной Думы',team:'Партия',full_name:'Анна Студентова'},{user_id:'student-B',kind:'student',team:'Партия',full_name:'Борис Студентов'}];
   const party={id:partyId,game_id:gameId,name:'Партия',registration_status:'registered',leader_user_id:null};
   const g={game:{id:gameId,status:'running'},me:members[0],teacher:memberKind==='teacher',members,parties:[party],profiles:[],partyInvitations:[],votes:[],stages:[{stage_no:1,status:'open'},{stage_no:4,status:'open'},{stage_no:5,status:'open'}],gdMandateCapacity:()=>15,gdEffectivePresence:(_uid,n)=>n??15,setError:error=>errors.push(error),refresh:async()=>{},voteForPartyChair:async(id,choice)=>{const result=await supabase.rpc('vote_for_party_chair',{p_party_id:id,p_candidate_id:choice});if(result.error)return false;sync.notifyGameDataRefresh(gameId,'party_chair_ballots');return true}};
   return{g,party,stageNo:4,onOpenVotes:()=>{openedVotes++}};
  },
  render(props=currentProps){currentProps=props;cursor=0;tree=context.exports.default(props);while(effects.length)effects.shift()();return tree},
  state:i=>hooks[i]?.value,
  async settle(){await tick();api.render();await tick()},
  async advance(ms){const end=now+ms;for(;;){const due=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;now=due[1].at;if(due[1].interval)due[1].at+=due[1].interval;else timers.delete(due[0]);due[1].fn();await tick()}now=end;await tick()},
  emit(table,gameId='game-A',partyId='party-A'){
   // Match the verified live publication, including historical dead subscriptions.
   if(!['stage_deadline_incidents','ghost_voting_policies'].includes(table))for(const ch of channels)for(const {filter,fn} of ch.handlers)if(filter.table===table&&(filter.filter==='game_id=eq.'+gameId||filter.filter==='party_id=eq.'+partyId))fn();
   if(['game_votes','institution_session_registrations','party_chair_ballots','stage_deadline_rules'].includes(table))sync.notifyGameDataRefresh(gameId,table);
  },
  local:(table,gameId='game-A')=>sync.notifyGameDataRefresh(gameId,table),
  status:value=>{for(const ch of channels)ch.status?.(value)},revision:()=>revision++,
  visible(value){document.visibilityState=value?'visible':'hidden';document.dispatchEvent({type:'visibilitychange'})},
  event:type=>window.dispatchEvent({type}),hold(value=true){holdReads=value},holdWrite(value=true){holdMutation=value},errorWrite(value){mutationError=value},
  policy:(stageNo=4,gameId='game-A')=>window.dispatchEvent({type:'gos-stage-policy-updated',detail:{gameId,stageNo}}),
  clock:()=>clockUpdates,openedVotes:()=>openedVotes,
  release(){holdReads=false;for(const resolve of held.splice(0))resolve()},releaseWrites(){holdMutation=false;for(const resolve of heldMutations.splice(0))resolve()},
  metrics:()=>({reads,mutations,maxInflight,bytes,rawSubscriptions}),count:name=>counts.get(name)||0,
  close(){for(const h of hooks)h?.cleanup?.();assert.equal(timers.size,0,'Unmount cancels every panel timer');assert.equal(channels.size,0,'Unmount removes panel channels');for(const map of Object.values(listeners))for(const callbacks of map.values())assert.equal(callbacks.size,0,'Unmount removes listeners')}
 };
 api.render(api.props());return api;
}
function find(tree,predicate){if(Array.isArray(tree)){for(const node of tree){const found=find(node,predicate);if(found)return found}}else if(tree&&typeof tree==='object'){if(predicate(tree))return tree;return find(tree.props?.children,predicate)}}
function text(tree){if(Array.isArray(tree))return tree.map(text).join(' ');if(tree&&typeof tree==='object')return text(tree.props?.children);return tree===undefined||tree===null||tree===false?'':String(tree)}
function voteButton(r,kind){return find(r.render(),n=>n.type==='button'&&(kind==='party'?n.props.className?.includes('gosPartyElectionSelfVote'):text(n).startsWith('Отдать ')))}
async function model(kind,old,mode){
 const sessions=Array.from({length:40},()=>realm(kind,old));await tick();for(const r of sessions)await r.settle();
 if(mode==='burst'){for(const r of sessions)for(let i=0;i<20;i++)r.emit(tables[kind][i%tables[kind].length]);await tick();for(const r of sessions)await r.advance(3001)}
 if(mode==='steady')for(let second=0;second<1200;second++){
  for(const r of sessions)for(let action=0;action<8;action++)r.emit(tables[kind][(second*8+action)%tables[kind].length]);
  for(const r of sessions)await r.advance(1000);
 }
 if(mode==='idle')for(const r of sessions)await r.advance(20*60000);
 const sum={reads:0,bytes:0,maxInflightPerClient:0,rawHandlers:0};if(kind==='deadline')sum.clockUpdates=0;
 for(const r of sessions){await tick();const m=r.metrics();sum.reads+=m.reads;sum.bytes+=m.bytes;sum.maxInflightPerClient=Math.max(sum.maxInflightPerClient,m.maxInflight);sum.rawHandlers+=m.rawSubscriptions;if(kind==='deadline')sum.clockUpdates+=r.clock();r.close()}
 return sum;
}
async function regressions(kind){
 const width=kind==='duma'?8:1;
 const hidden=realm(kind,false,{hidden:true});await tick();for(let i=0;i<20;i++)hidden.emit(tables[kind][0]);await hidden.advance(20*60000);assert.equal(hidden.metrics().reads,0,'Hidden panel does not read or reconcile');hidden.visible(true);await hidden.advance(3001);assert.equal(hidden.metrics().reads,width,'Visibility resumes one coalesced refresh');hidden.close();
 const scope=realm(kind);await scope.settle();const initial=scope.metrics().reads;for(let i=0;i<10;i++){scope.local('chat_messages');scope.local(tables[kind][0],'another-game');scope.emit(tables[kind][0],'another-game','another-party')}await scope.advance(3001);assert.equal(scope.metrics().reads,initial,'Foreign table/game events do not query this panel');scope.event('focus');await scope.advance(3001);const focused=scope.metrics().reads;scope.event('online');await scope.advance(3001);assert.equal(scope.metrics().reads,focused+width,'Online recovery retries despite a recent focus');scope.close();
 const late=realm(kind);await late.settle();late.hold();late.local(tables[kind][0]);await late.advance(3001);const oldSignals=late.starts.filter(x=>x.signal&&!x.signal.aborted);late.hold(false);const freshProps=late.props('game-B','new-student','student','party-B');assert.equal(late.render(freshProps),null,'New identity cannot render the previous identity data');await late.settle();late.release();await late.settle();assert(oldSignals.some(x=>x.signal.aborted),'Scope cleanup aborts old reads');assert.equal(late.state(0)[0][kind==='duma'?'game_id':'candidate_id'],kind==='duma'?'game-B':'other-party','Late old read cannot overwrite the new scope');late.close();
 const trailing=realm(kind);await trailing.settle();const before=trailing.metrics().reads;trailing.hold();trailing.emit(tables[kind][0]);await trailing.advance(3001);const button=voteButton(trailing,kind);assert(button,'Voting action must remain available');button.props.onClick();button.props.onClick();await tick();assert.equal(trailing.metrics().mutations,1,'Rapid double click sends one mutation');trailing.release();await trailing.settle();const result=trailing.state(kind==='duma'?3:0);assert(result.some(v=>v.voter_id==='student-A'),'Own action waits for a trailing read after an older in-flight pass');assert.equal(trailing.metrics().reads-before,width*2,'One older read plus one trailing read, without parallel read series');assert(trailing.metrics().maxInflight<=(kind==='duma'?4:1),'Read batches stay single-flight');trailing.close();
 const timeout=realm(kind);await timeout.settle();timeout.hold();timeout.local(tables[kind][0]);await timeout.advance(3001);await timeout.advance(12001);assert(timeout.starts.some(x=>x.signal?.aborted),'Deadline aborts a transport that ignores cancellation');timeout.hold(false);timeout.event('online');const timed=timeout.metrics().reads;await timeout.advance(3001);assert.equal(timeout.metrics().reads,timed+width,'Deadline releases own single-flight for later recovery');timeout.release();await timeout.settle();timeout.close();
 const action=realm(kind);await action.settle();const oldButton=voteButton(action,kind);action.render(action.props('game-A','student-A','observer'));await action.settle();oldButton.props.onClick();await tick();assert.equal(action.metrics().mutations,0,'A stale student handler cannot mutate after observer scope change');action.close();
 const closed=realm(kind);await closed.settle();const oldOpenButton=voteButton(closed,kind),closedProps=closed.props();closedProps.g.stages=closedProps.g.stages.map(stage=>({...stage,status:'closed'}));closed.render(closedProps);await closed.settle();oldOpenButton.props.onClick();await tick();assert.equal(closed.metrics().mutations,0,'A stale open-stage handler cannot mutate after stage closure');closed.close();
 const unmounted=realm(kind);await unmounted.settle();unmounted.hold();unmounted.local(tables[kind][0]);await unmounted.advance(3001);unmounted.close();await tick();unmounted.release();await tick();
 const failed=realm(kind);await failed.settle();failed.errorWrite(new Error('synthetic write failure'));voteButton(failed,kind).props.onClick();await failed.settle();assert.equal(failed.state(kind==='duma'?12:2),false,'Rejected mutation releases busy state');assert(failed.errors.length||failed.state(3),'Rejected mutation is visible');failed.close();
 if(kind==='duma'){
  const fallback=realm(kind,false,{subscription:'manual'});await fallback.advance(1600);await fallback.settle();assert.equal(fallback.metrics().reads,8,'An unavailable channel still loads the initial snapshot');fallback.status('SUBSCRIBED');await fallback.advance(4000);assert.equal(fallback.metrics().reads,16,'A late connection reconciles a snapshot started before subscription');fallback.status('SUBSCRIBED');await fallback.advance(4000);assert.equal(fallback.metrics().reads,24,'A reconnected channel reconciles again');fallback.close();
  const failedChannel=realm(kind,false,{subscription:'manual'});failedChannel.status('CHANNEL_ERROR');await failedChannel.settle();assert.equal(failedChannel.metrics().reads,8,'A reported connection error starts the initial snapshot immediately');failedChannel.status('SUBSCRIBED');await failedChannel.advance(4000);assert.equal(failedChannel.metrics().reads,16,'Recovery after a failed subscription reconciles the snapshot');failedChannel.close();
  const beforeConnect=realm(kind,false,{subscription:'manual'});beforeConnect.revision();beforeConnect.status('SUBSCRIBED');await beforeConnect.settle();await beforeConnect.advance(4000);assert.equal(beforeConnect.metrics().reads,8,'An update before subscribing is included in the first snapshot');assert.equal(beforeConnect.state(3).length,1);beforeConnect.close();
  const duringSnapshot=realm(kind,false,{subscription:'manual'});duringSnapshot.hold();duringSnapshot.status('SUBSCRIBED');await tick();duringSnapshot.revision();duringSnapshot.emit('office_personal_ballots');await duringSnapshot.advance(3001);duringSnapshot.release();await duringSnapshot.settle();await duringSnapshot.advance(3001);assert.equal(duringSnapshot.state(3).length,1,'An event during the first snapshot is reconciled');assert.equal(duringSnapshot.metrics().reads,16,'An in-flight event requires only one trailing snapshot');duringSnapshot.close();
  const secret=realm(kind,false,{subscription:'manual',secretTransition:true});secret.hold();secret.status('SUBSCRIBED');await tick();secret.revision();secret.release();await secret.settle();assert.equal(secret.state(0)[0].status,'closed','A vote closed during the initial read receives a coherent retry');assert.equal(secret.state(3).length,1,'The confirmed closed election is paired with the matching ballots');secret.close();
  const waitingHidden=realm(kind,false,{subscription:'manual'});waitingHidden.visible(false);waitingHidden.status('SUBSCRIBED');await waitingHidden.advance(4000);assert.equal(waitingHidden.metrics().reads,0,'A pending startup does not query after the tab is hidden');waitingHidden.visible(true);await waitingHidden.advance(4000);assert.equal(waitingHidden.metrics().reads,8,'A visible tab resumes its initial snapshot');waitingHidden.close();
  const switching=realm(kind,false,{subscription:'manual'});switching.render(switching.props('game-B','new-student'));switching.status('SUBSCRIBED');await switching.settle();await switching.advance(4000);assert.equal(switching.metrics().reads,8,'A pending startup does not query the previous game after a scope switch');assert.equal(switching.state(0)[0].game_id,'game-B');switching.close();
  const cancelled=realm(kind,false,{subscription:'manual'});cancelled.close();await tick();assert.equal(cancelled.metrics().reads,0,'Unmount cancels a pending initial snapshot');
  const partial=realm(kind);await partial.settle();const accepted=JSON.stringify(partial.state(1));partial.failures.add('office_candidates');partial.local('office_candidates');await partial.advance(3001);assert.equal(JSON.stringify(partial.state(1)),accepted,'Partial read failure preserves accepted candidates');assert(partial.errors.length,'Read errors are visible');assert(partial.count('get_my_institution_meeting_permissions')>=2,'Permission RPC is preserved in the second batch');partial.close();
 }
}
function policyButton(r,kind){return find(r.render(),n=>n.type==='button'&&text(n)===(kind==='deadline'?'Отменить':'Внести проект постановления'))}
async function policyRealm(kind,memberKind=kind==='deadline'?'teacher':'student'){
 const r=realm(kind);await r.settle();r.render(r.props('game-A','student-A',memberKind));await r.settle();return r;
}
async function policyRegressions(kind){
 const width=kind==='deadline'?2:1;
 const hidden=realm(kind,false,{hidden:true});await tick();const clock=hidden.clock();for(let i=0;i<20;i++)hidden.local(tables[kind][0]);await hidden.advance(20*60000);assert.equal(hidden.metrics().reads,0,'Hidden policy panels do not read');assert.equal(hidden.clock(),clock,'Hidden deadline clock does not re-render each second');hidden.visible(true);await hidden.advance(3001);assert.equal(hidden.metrics().reads,width);if(kind==='deadline')assert(hidden.clock()>clock,'Visible deadline clock resumes');hidden.close();
 const scope=await policyRealm(kind);const initial=scope.metrics().reads;
 for(let i=0;i<10;i++){scope.local('chat_messages');scope.local(tables[kind][0],'another-game');scope.policy(5);scope.policy(4,'another-game')}
 await scope.advance(3001);assert.equal(scope.metrics().reads,initial,'Foreign game/table/stage notifications do not read');
 if(kind==='deadline'){scope.policy(4);scope.emit('stage_deadline_rules');await scope.advance(3001);assert.equal(scope.metrics().reads,initial+width,'Policy editor and published rule notifications coalesce')}
 scope.event('focus');await scope.advance(3001);const focused=scope.metrics().reads;scope.event('online');await scope.advance(3001);assert.equal(scope.metrics().reads,focused+width,'Online policy recovery bypasses recent focus');scope.close();
 const late=await policyRealm(kind);late.hold();late.local(tables[kind][0]);await late.advance(3001);const signals=late.starts.filter(x=>x.signal&&!x.signal.aborted);late.hold(false);
 const fresh=late.props('game-B','new-student',kind==='deadline'?'teacher':'student');if(kind==='deadline')fresh.stageNo=5;
 assert.equal(late.render(fresh),null,'A new scope cannot render the previous policy/incident data');await late.settle();late.release();await late.settle();assert(signals.some(x=>x.signal.aborted));assert.equal(late.state(0)[0].game_id,'game-B','Late old-game rows are excluded');if(kind==='deadline')assert.equal(late.state(0)[0].stage_no,5,'Late old-stage incidents are excluded');late.close();
 const trailing=await policyRealm(kind),before=trailing.metrics().reads;trailing.hold();trailing.local(tables[kind][0]);await trailing.advance(3001);const button=policyButton(trailing,kind);assert(button);button.props.onClick();button.props.onClick();await tick();assert.equal(trailing.metrics().mutations,1,'Policy mutations are protected from rapid double submission');trailing.release();await trailing.settle();assert.equal(trailing.state(0)[0][kind==='deadline'?'note':'rationale'],'accepted-1','An explicit action waits for one trailing confirmed read');assert.equal(trailing.metrics().reads-before,width*2);assert.equal(trailing.metrics().maxInflight,width);trailing.close();
 const timeout=await policyRealm(kind);timeout.hold();timeout.local(tables[kind][0]);await timeout.advance(3001);await timeout.advance(12001);assert(timeout.starts.some(x=>x.signal?.aborted));timeout.hold(false);const timed=timeout.metrics().reads;timeout.event('online');await timeout.advance(3001);assert.equal(timeout.metrics().reads,timed+width,'A stalled policy read cannot block later recovery forever');timeout.release();await timeout.settle();timeout.close();
 const rights=await policyRealm(kind),oldButton=policyButton(rights,kind);rights.render(rights.props('game-A','student-A','observer'));await rights.settle();assert(!policyButton(rights,kind),'Observers retain reading without mutation controls');oldButton.props.onClick();await tick();assert.equal(rights.metrics().mutations,0,'An old policy action cannot mutate after a role change');assert(rights.state(0).length,'Observer can still read existing rows');rights.close();
 const failed=await policyRealm(kind);failed.errorWrite(new Error('synthetic write failure'));policyButton(failed,kind).props.onClick();await failed.settle();assert.equal(failed.state(kind==='deadline'?6:3),false,'A failed policy mutation clears busy state');assert(failed.errors.length);failed.close();
 const partial=await policyRealm(kind),accepted=JSON.stringify(partial.state(0));partial.failures.add(kind==='deadline'?'stage_deadline_incidents':'ghost_voting_policies');partial.local(tables[kind][0]);await partial.advance(3001);assert.equal(JSON.stringify(partial.state(0)),accepted,'A failed policy read preserves accepted rows');assert(partial.errors.length);partial.close();
 const unmounted=await policyRealm(kind);unmounted.hold();unmounted.local(tables[kind][0]);await unmounted.advance(3001);unmounted.close();await tick();unmounted.release();await tick();
 const draft=await policyRealm(kind);let tree=draft.render();
 if(kind==='deadline'){
  find(tree,n=>n.type==='button'&&n.props.className==='deadlineActionCard').props.onClick();tree=draft.render();find(tree,n=>n.type==='select').props.onChange({target:{value:'party-A'}});tree=draft.render();
 }
 find(tree,n=>n.type==='textarea').props.onChange({target:{value:'Первое обоснование'}});tree=draft.render();draft.holdWrite();
 find(tree,n=>n.type==='button'&&text(n)===(kind==='deadline'?'Применить правило':'Внести проект постановления')).props.onClick();await tick();tree=draft.render();find(tree,n=>n.type==='textarea').props.onChange({target:{value:'Новое обоснование во время сохранения'}});draft.render();draft.releaseWrites();await draft.settle();assert.equal(draft.state(kind==='deadline'?5:2),'Новое обоснование во время сохранения','A completed save preserves newer text in the same scope');draft.close();
 if(kind==='ghost'){
  const opened=await policyRealm(kind,'teacher');const open=find(opened.render(),n=>n.type==='button'&&text(n)==='Вынести в зал ГД →');assert(open);open.props.onClick();open.props.onClick();await opened.settle();assert.equal(opened.count('open_ghost_voting_policy_vote'),1);assert.equal(opened.openedVotes(),1,'Opening the policy vote still navigates to voting once');assert.equal(opened.state(0)[0].status,'vote_open');opened.close();
 }
}
async function main(){
 const startup=Array.from({length:100},()=>realm('duma'));await tick();for(const client of startup){await client.settle();await client.advance(4000)}
 const startup100Reads=startup.reduce((total,client)=>total+client.metrics().reads,0);assert.equal(startup100Reads,800,'A successful first subscription and initial snapshot do not duplicate reads');for(const client of startup)client.close();
 const before=compareRef?{}:null,after={};
 for(const kind of ['duma','party']){
  if(before){before[kind]={};for(const mode of ['burst','steady','idle'])before[kind][mode]=await model(kind,true,mode)}
  after[kind]={};for(const mode of ['burst','steady','idle'])after[kind][mode]=await model(kind,false,mode);
  await regressions(kind);
  assert(after[kind].steady.reads<=(kind==='duma'?129000:16200),'Steady reads are bounded by a 3s refresh floor');
  assert.equal(after[kind].burst.maxInflightPerClient,kind==='duma'?4:1);
  assert.equal(after[kind].burst.rawHandlers,kind==='duma'?200:0,'Only five Duma table handlers per mounted panel remain');
  if(before){assert(after[kind].burst.reads<before[kind].burst.reads/5);assert(after[kind].steady.reads<before[kind].steady.reads/10);assert(after[kind].idle.reads>before[kind].idle.reads,'Report the new low-frequency idle reconciliation honestly')}
 }
 for(const kind of ['deadline','ghost']){
  if(before){before[kind]={};for(const mode of ['burst','steady','idle'])before[kind][mode]=await model(kind,true,mode)}
  after[kind]={};for(const mode of ['burst','steady','idle'])after[kind][mode]=await model(kind,false,mode);
  await policyRegressions(kind);assert.equal(after[kind].steady.rawHandlers,0,'Policy panels do not add dead/duplicate subscriptions');assert.equal(after[kind].steady.maxInflightPerClient,kind==='deadline'?2:1);
  if(before){assert(after[kind].idle.reads>before[kind].idle.reads,'Unpublished tables need a previously absent fallback');if(kind==='deadline')assert(after[kind].steady.reads<before[kind].steady.reads/10);else assert(after[kind].steady.reads>before[kind].steady.reads,'Ghost baseline was stale: retain its newly working vote invalidation and fallback')}
 }
 console.log(JSON.stringify({environment:'Actual component effects; 40 isolated clients per panel; 20 virtual minutes; eight invalidation events/s, not vote RPCs; synthetic replies, no network or Auth. Idle reconciliation adds reads to the previous no-fallback panels. Ghost baseline cannot receive its unpublished table: added reads restore freshness after vote changes and at 180–195s reconciliation.',baseline:compareRef||null,startup100Reads,before,after,checks:['table/game/stage filtering','hidden suspension and visible recovery','hidden deadline clock paused','online recovery after focus','subscription-first snapshot without duplicate initial reads','offline startup fallback and reconnect recovery','pre-subscription and in-flight changes','secret vote closes during initial snapshot','hidden and unmounted pending startup','4+4 Duma concurrency','scope abort and late-read exclusion','double-submit suppression','own mutation trailing read','12s deadline recovery even if transport ignores abort','observer and closed-stage stale handlers blocked','partial error preserves accepted data','newer draft preserved during save','ghost vote opens once','unmount cancels in-flight deadline']},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1});
