/* Executes the complete PresidentialElectionLab TSX and shared sync hook.
 * Synthetic replies and virtual time: this is not HTTP/Auth/Realtime or server capacity evidence. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
const compile=file=>ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const component=compile('components/game/PresidentialElectionLab.tsx'),shared=compile('components/game/useGameTableSync.ts'),assets=compile('components/game/scopedSignedAssetCache.ts');
const tick=async()=>{for(let i=0;i<100;i++)await Promise.resolve()};
const tables=['presidential_election_settings','presidential_candidates','presidential_candidate_program_points','presidential_candidate_documents','presidential_support_group','presidential_signature_batches','presidential_cec_decisions'];
function realm({teacher=false,hidden=false,candidateCount=2,media=true,holdOldPhotos=false}={}){
 let now=Date.parse('2026-10-26T12:00:00Z'),cursor=0,nextId=0,revision=0,holdReads=false,holdWrites=false,props,tree;
 let reads=0,writes=0,signs=0,dbRunning=0,signRunning=0,maxDb=0,maxSigns=0,maxTotal=0,bytes=0;
 const hooks=[],effects=[],timers=new Map(),pendingReads=[],pendingWrites=[],pendingPhotos=[],errors=[],calls=[],failures=new Set();
 const listeners={window:new Map(),document:new Map()},equal=(a,b)=>!!a&&!!b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const react={
  useState(initial){const i=cursor++;if(!hooks[i])hooks[i]={value:typeof initial==='function'?initial():initial};return[hooks[i].value,value=>{hooks[i].value=typeof value==='function'?value(hooks[i].value):value}]},
  useRef(value){const i=cursor++;if(!hooks[i])hooks[i]={current:value};return hooks[i]},
  useMemo(fn,deps){const i=cursor++;if(!hooks[i]||!equal(hooks[i].deps,deps))hooks[i]={deps,value:fn()};return hooks[i].value},
  useEffect(fn,deps){const i=cursor++;if(!hooks[i]||!equal(hooks[i].deps,deps)){hooks[i]?.cleanup?.();hooks[i]={deps};effects.push(()=>{hooks[i].cleanup=fn()})}}
 };
 function target(kind){return{addEventListener(name,fn){if(!listeners[kind].has(name))listeners[kind].set(name,new Set());listeners[kind].get(name).add(fn)},removeEventListener(name,fn){listeners[kind].get(name)?.delete(fn)},dispatchEvent(event){for(const fn of [...listeners[kind].get(event.type)||[]])fn(event)}}}
 const document={...target('document'),visibilityState:hidden?'hidden':'visible',getElementById:()=>({focus(){}})},window={...target('window'),confirm:()=>true};
 function schedule(fn,delay,interval=0){const id=++nextId;timers.set(id,{fn,at:now+Math.max(0,Number(delay)||0),interval});return id}
 Object.assign(window,{setTimeout:(fn,d)=>schedule(fn,d),clearTimeout:id=>timers.delete(id),setInterval:(fn,d)=>schedule(fn,d,d),clearInterval:id=>timers.delete(id)});
 const candidateId=(game,index)=>'candidate-'+game+'-'+index;
 function rows(game,rev){return Array.from({length:candidateCount},(_,i)=>({id:candidateId(game,i),game_id:game,user_id:game==='game-A'?'student-A':'student-B',party_id:null,display_name:'Кандидат '+game+' '+i,nomination_type:'self',registration_status:'submitted',program_summary:'Программа',campaign_statement:null,registration_attempts:1,legal_error_count:rev,rating_penalty:rev,created_by:game==='game-A'?'student-A':'student-B',registration_number:null,registration_decision_no:null,registration_decision_at:null,registration_public_summary:'Сервер '+rev,cec_submitted_at:'2026-10-26T00:00:00Z',cec_submission_version:1,archived_at:null,photo_path:media?game+'/photo-'+i+'-r'+rev+'.webp':null}));}
 function reply(name,filters,args,rev){
  const game=filters.game_id||(/game-B/.test(args?.p_candidate_id||'')?'game-B':'game-A'),candidates=rows(game,rev);
  const byTable={
   presidential_election_settings:{game_id:game,system_type:'relative',threshold_pct:50,poll_enabled:false,status:'setup',result:{}},
   presidential_candidates:candidates,
   presidential_candidate_program_points:rev?[{id:'point-'+game,candidate_id:candidateId(game,0),point_no:1,body:'Сохранённое положение программы '+rev}]:[],
   presidential_candidate_documents:candidates.map((c,i)=>({id:'doc-'+game+'-'+i,candidate_id:c.id,doc_kind:'consent',title:'Согласие',storage_path:game+'/doc-'+i+'.txt',file_name:'Согласие '+i+'.txt',status:'submitted',note:null,extracted_text:'Распознанный текст '+rev,extraction_status:'extracted',auto_check:{},is_submitted:true,submitted_at:'2026-10-26T00:00:00Z',archived_at:null})),
   presidential_support_group:[],presidential_signature_batches:[],presidential_cec_decisions:[],presidential_cec_private_notes:[],
   presidential_candidate_private_profiles:candidates.map(c=>({candidate_id:c.id,birth_date:'1980-01-01',birth_place:'Место '+rev,contact_phone:'Телефон '+rev,contact_email:'synthetic@example.invalid',address_text:'Адрес '+rev,passport_note:'Примечание '+rev})),
   get_presidential_student_system_vote:{closed:true},
   get_presidential_cec_auto_review:{ready:true,recommended_status:'registered',error_count:0,manual_count:1,issues:[],items:[],program_points:10,support_group:5,signatures:15,legal_basis:[]}
  };
  return failures.has(name)?{data:null,error:{message:'synthetic read failure: '+name}}:{data:byTable[name]??null,error:null};
 }
 const readRPC=new Set(['get_presidential_student_system_vote','get_presidential_cec_auto_review','get_presidential_candidate_readiness']);
 function query(name,args,isWrite=false){
  const filters={},state={signal:null};let operation;
  const builder=new Proxy({},{get(_,key){
   if(key==='then')return(resolve,reject)=>{
    if(!operation)operation=(async()=>{
     calls.push({name,args,filters:{...filters},signal:state.signal,at:now});
     if(isWrite){writes++;if(holdWrites)await new Promise(r=>pendingWrites.push(r));revision++;return{data:'synthetic-result',error:null}}
     reads++;dbRunning++;maxDb=Math.max(maxDb,dbRunning);maxTotal=Math.max(maxTotal,dbRunning+signRunning);
     const response=reply(name,filters,args,revision);
     try{if(holdReads)await new Promise(r=>pendingReads.push(r));else await Promise.resolve();bytes+=Buffer.byteLength(JSON.stringify(response));return response}
     finally{dbRunning--}
    })();return operation.then(resolve,reject);
   };
   if(key==='eq')return(k,v)=>{filters[k]=v;return builder};
   if(key==='abortSignal')return signal=>{state.signal=signal;return builder};
   return()=>builder;
  }});return builder;
 }
 const supabase={from:name=>query(name),rpc:(name,args)=>query(name,args,!readRPC.has(name)),channel(){throw Error('A presidential widget must not create its own Realtime channel')},removeChannel(){throw Error('No widget channel may exist')},storage:{from:()=>({async createSignedUrl(storagePath){signs++;signRunning++;maxSigns=Math.max(maxSigns,signRunning);maxTotal=Math.max(maxTotal,dbRunning+signRunning);try{if(holdOldPhotos&&/photo-\d+-r0\.webp$/.test(storagePath))await new Promise(resolve=>pendingPhotos.push(resolve));else await Promise.resolve();return{data:{signedUrl:'https://synthetic.invalid/'+storagePath},error:null}}finally{signRunning--}}})}};
 const jsx=(type,props)=>({type,props}),math=Object.create(Math);math.random=()=>0.5;
 class ClockDate extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}}
 const context={exports:{},console,Date:ClockDate,Math:math,AbortController,window,document,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail}},setTimeout:window.setTimeout,clearTimeout:window.clearTimeout,setInterval:window.setInterval,clearInterval:window.clearInterval,fetch:()=>{throw Error('Network is forbidden')}};
 let sync,assetCache;
 context.require=name=>name==='react'?react:name==='react/jsx-runtime'?{jsx,jsxs:jsx,Fragment:'fragment'}:name==='@/lib/supabase'?{supabase}:name==='@/lib/userError'?{userError:e=>e?.message||String(e)}:name==='./useGameTableSync'?sync:name==='./scopedSignedAssetCache'?assetCache:name==='./institutionEmblems'?{institutionEmblem:()=>'/synthetic-emblem.svg'}:name==='./cecOfficialWording'?{cecOfficialResolution:(_status,_name,summary)=>summary}:name==='../ui/IconAction'?{IconAction:'IconAction'}:{default:name};
 vm.createContext(context);
 for(const [code,receive] of [[shared,value=>{sync=value}],[assets,value=>{assetCache=value}],[component,()=>{}]]){context.exports={};vm.runInContext('(function(exports,require){'+code+'})(exports,require)',context);receive({...context.exports})}
 const api={calls,errors,failures,
  props(game='game-A',user='student-A',isTeacher=teacher){return{g:{game:{id:game,status:'running'},me:{user_id:user,game_id:game,full_name:'Участник',kind:isTeacher?'teacher':'student',role_title:isTeacher?'Преподаватель':'Депутат',team:'Партия'},teacher:isTeacher,members:[{user_id:user,kind:'student',full_name:'Участник',team:'Партия'}],parties:[],profiles:[],currentStage:{stage_no:6,status:'open'},setError:error=>errors.push(error)}}},
  render(changes=props){props=changes;cursor=0;tree=context.exports.default(props);while(effects.length)effects.shift()();return tree},
  async settle(){await tick();api.render();await tick();return api.render()},
  async advance(ms){const end=now+ms;for(;;){const due=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;now=due[1].at;if(due[1].interval)due[1].at+=due[1].interval;else timers.delete(due[0]);due[1].fn();await tick()}now=end;await tick()},
  local:(table,game='game-A')=>sync.notifyGameDataRefresh(game,table),
  visible(value){document.visibilityState=value?'visible':'hidden';document.dispatchEvent({type:'visibilitychange'})},
  event:type=>window.dispatchEvent({type}),
  hold(value=true){holdReads=value},release(){holdReads=false;for(const resolve of pendingReads.splice(0))resolve()},
  holdWrites(value=true){holdWrites=value},releaseWrites(){holdWrites=false;for(const resolve of pendingWrites.splice(0))resolve()},
  releasePhotos(){for(const resolve of pendingPhotos.splice(0))resolve()},
  revision:value=>{revision=value},
  count:name=>calls.filter(call=>call.name===name).length,
  metrics:()=>({reads,writes,signs,maxDb,maxSigns,maxTotal,bytes}),
  close(){for(const h of hooks)h?.cleanup?.();assert.equal(timers.size,0,'Unmount cancels timers');for(const map of Object.values(listeners))for(const callbacks of map.values())assert.equal(callbacks.size,0,'Unmount removes listeners')}
 };
 api.render(api.props());return api;
}
function find(tree,predicate){if(Array.isArray(tree)){for(const child of tree){const result=find(child,predicate);if(result)return result}}else if(tree&&typeof tree==='object'){if(predicate(tree))return tree;return find(tree.props?.children,predicate)}}
function text(tree){if(Array.isArray(tree))return tree.map(text).join(' ');if(tree&&typeof tree==='object')return text(tree.props?.children);return tree===undefined||tree===null||tree===false?'':String(tree)}
function all(tree,predicate,result=[]){if(Array.isArray(tree))for(const child of tree)all(child,predicate,result);else if(tree&&typeof tree==='object'){if(predicate(tree))result.push(tree);all(tree.props?.children,predicate,result)}return result}
const card=(tree,index=0)=>all(tree,n=>n.type==='article'&&n.props?.className?.startsWith('candidateCard '))[index];
function input(tree,label){const row=find(tree,n=>n.type==='label'&&text(n).startsWith(label));return row&&find(row,n=>['input','textarea','select'].includes(n.type))}
const recognizedText=tree=>find(tree,n=>n.type==='textarea'&&n.props.placeholder?.startsWith('Проверьте распознанный текст'));
const change=(control,value)=>{assert(control,'Required form control exists');control.props.onChange({target:{value}})};
function tab(r,name){const button=find(r.render(),n=>n.type==='button'&&text(n).startsWith(name));assert(button,'Required navigation exists: '+name);button.props.onClick();return r.render()}
function addPoint(r){const composer=find(card(r.render()),n=>n.props?.className==='candidatePointComposer');change(composer&&find(composer,n=>n.type==='textarea'||n.type==='input'),'Новое проверяемое положение программы');const button=find(find(card(r.render()),n=>n.props?.className==='candidatePointComposer'),n=>n.type==='button');assert(button);button.props.onClick()}
async function regressions(){
 const basic=realm({teacher:true,candidateCount:5});await basic.settle();assert.equal(basic.count('get_presidential_candidate_readiness'),0,'Unused candidate-readiness RPC is removed');assert.equal(basic.count('get_presidential_cec_auto_review'),5,'Teacher audit RPC remains for every candidate');const metrics=basic.metrics();assert(metrics.maxDb<=4,'Normal database/RPC batches never exceed four');assert(metrics.maxSigns<=4,'Signed asset cache has its independent four-request bound');assert(metrics.maxTotal<=8,'Combined normal requests respect the separate database and asset bounds');assert(metrics.signs>=10,'The concurrency test includes real photo/document signing paths');basic.close();
 const hidden=realm({hidden:true});await tick();await hidden.advance(20*60000);assert.equal(hidden.metrics().reads,0,'Hidden mount and reconciliation do not read');hidden.visible(true);await hidden.advance(3001);await hidden.settle();assert.equal(hidden.metrics().reads,10,'Visibility recovery performs one complete load');hidden.close();
 const filtered=realm();await filtered.settle();const beforeFiltered=filtered.metrics().reads;for(let i=0;i<10;i++){filtered.local('chat_messages');filtered.local(tables[0],'another-game')}await filtered.advance(3001);assert.equal(filtered.metrics().reads,beforeFiltered,'Foreign tables and games do not invalidate this panel');filtered.close();
 const trailing=realm();await trailing.settle();const before=trailing.metrics().reads;trailing.hold();trailing.local(tables[0]);await trailing.advance(3001);assert.equal(trailing.metrics().reads-before,4,'Only the first four reads start while transport is held');addPoint(trailing);await tick();assert.equal(trailing.metrics().writes,1,'The actual program-save handler executes');trailing.release();await trailing.settle();assert.equal(trailing.metrics().reads-before,20,'Own mutation waits for one trailing complete load');assert(text(trailing.render()).includes('Сохранённое положение программы 1'),'The result of the own mutation is rendered');assert(trailing.metrics().maxDb<=4,'Normal overlapping load requests remain single-flight');trailing.close();
 const late=realm({teacher:true});await late.settle();change(input(card(late.render()),'Телефон'),'OLD PRIVATE DRAFT');late.hold();late.local(tables[0]);await late.advance(3001);const pending=late.calls.filter(call=>call.signal&&!call.signal.aborted);late.hold(false);assert.equal(late.render(late.props('game-B','student-B',false)),null,'Scope transition hides all previous data before effects');await late.settle();late.release();await late.settle();assert(pending.some(call=>call.signal.aborted),'Changing identity aborts previous reads');const fresh=text(late.render());assert(!fresh.includes('Кандидат game-A'),'Late old results never enter the new game');assert(!JSON.stringify(late.render()).includes('OLD PRIVATE DRAFT'),'Old private drafts are cleared on identity change');assert(!fresh.includes('Автоматическая предварительная проверка'),'Old teacher-private audits are cleared on downgrade');late.close();
 const deadline=realm();await deadline.settle();deadline.hold();deadline.local(tables[0]);await deadline.advance(3001);await deadline.advance(12001);assert(deadline.calls.some(call=>call.signal?.aborted),'The deadline aborts its transport signal');assert(deadline.errors.length,'Read timeout is visible');deadline.hold(false);deadline.revision(5);const afterTimeout=deadline.metrics().reads;deadline.event('online');await deadline.advance(3001);await deadline.settle();assert.equal(deadline.metrics().reads,afterTimeout+10,'Logical single-flight releases even if old transport ignores abort');deadline.release();await deadline.settle();assert.equal(recognizedText(card(deadline.render()))?.props.value,'Распознанный текст 5','Late timed-out response cannot overwrite the recovered revision');deadline.close();
 const partial=realm();await partial.settle();const old=text(partial.render());partial.failures.add('presidential_candidates');partial.revision(4);partial.local(tables[0]);await partial.advance(3001);await partial.settle();assert(old.includes('Кандидат game-A'));assert(text(partial.render()).includes('Кандидат game-A'),'Partial failure preserves the accepted candidate list');assert(partial.errors.length,'Read errors remain visible');partial.close();
 const photo=realm({holdOldPhotos:true});await photo.settle();photo.revision(1);photo.local(tables[0]);await photo.advance(3001);await photo.settle();const photoURL=()=>find(card(photo.render()),n=>n.type==='img'&&n.props.alt==='Кандидат game-A 0')?.props.src;assert(photoURL()?.includes('photo-0-r1.webp'),'The newer candidate photo resolves while old signing is held');photo.releasePhotos();await photo.settle();assert(photoURL()?.includes('photo-0-r1.webp'),'Late old signed photo URL cannot replace the newer photo in the same scope');photo.close();
 const mutation=realm({teacher:true,candidateCount:0});await mutation.settle();change(input(mutation.render(),'Программа кандидата'),'Программа старой игры');mutation.holdWrites();find(mutation.render(),n=>n.type==='button'&&text(n)==='Создать черновик досье').props.onClick();await tick();assert.equal(mutation.metrics().writes,1);mutation.render(mutation.props('game-B','student-B',true));await mutation.settle();change(input(mutation.render(),'Программа кандидата'),'Новый черновик другой игры');mutation.releaseWrites();await mutation.settle();assert.equal(input(mutation.render(),'Программа кандидата')?.props.value,'Новый черновик другой игры','Completion of an old mutation cannot clear the new game draft');assert.equal(mutation.count('save_presidential_program_point'),0,'An old-scope nomination stops before subsequent mutation RPCs');mutation.close();
 const drafts=realm({teacher:true});await drafts.settle();let first=card(drafts.render());change(recognizedText(first),'Несохранённый распознанный текст');change(input(first,'Телефон'),'Мой черновик телефона');tab(drafts,'Подача в ЦИК');change(input(card(drafts.render()),'Резолютивная часть'),'Мой проект публичного решения');drafts.revision(2);drafts.local(tables[0]);await drafts.advance(3001);await drafts.settle();let tree=drafts.render();const reviewField=input(card(tree),'Резолютивная часть');assert.equal(reviewField?.props.value,'Мой проект публичного решения','Background refresh preserves the dirty decision draft');assert.equal(input(card(tree),'Число юридических ошибок')?.props.value,'0','Dirty decision remains one coherent form rather than mixing server revisions');assert.equal(input(card(tree,1),'Резолютивная часть')?.props.value,'Сервер 2','Clean decision entry adopts the server update');tab(drafts,'Моё досье');first=card(drafts.render());assert.equal(recognizedText(first)?.props.value,'Несохранённый распознанный текст','Background refresh preserves edited recognized text');assert.equal(input(first,'Телефон')?.props.value,'Мой черновик телефона','Background refresh preserves edited private profile');assert.equal(input(first,'Место рождения')?.props.value,'Место 0','Dirty private profile remains one coherent form');assert.equal(input(card(drafts.render(),1),'Телефон')?.props.value,'Телефон 2','Clean private profile adopts the server update');assert.equal(recognizedText(card(drafts.render(),1))?.props.value,'Распознанный текст 2','Clean document text adopts the server update');drafts.close();
 return metrics;
}
async function model(mode){
 const sessions=Array.from({length:40},()=>realm({candidateCount:2}));for(const r of sessions)await r.settle();
 if(mode==='burst'){for(const r of sessions)for(let i=0;i<20;i++)r.local(tables[i%tables.length]);for(const r of sessions)await r.advance(3001)}
 if(mode==='idle')for(const r of sessions)await r.advance(20*60000);
 const sum={reads:0,signs:0,bytes:0,maxDatabasePerClient:0,maxStoragePerClient:0,maxCombinedPerClient:0};
 for(const r of sessions){await r.settle();const m=r.metrics();sum.reads+=m.reads;sum.signs+=m.signs;sum.bytes+=m.bytes;sum.maxDatabasePerClient=Math.max(sum.maxDatabasePerClient,m.maxDb);sum.maxStoragePerClient=Math.max(sum.maxStoragePerClient,m.maxSigns);sum.maxCombinedPerClient=Math.max(sum.maxCombinedPerClient,m.maxTotal);r.close()}
 return sum;
}
async function main(){
 const checks=await regressions(),burst=await model('burst'),idle=await model('idle');
 assert.equal(burst.reads,800,'Forty initial loads plus one coalesced burst load each');assert.equal(idle.reads,2800,'Twenty virtual minutes include initial load plus six 3-minute reconciliation loads per client');
 console.log(JSON.stringify({environment:'Actual full TSX and hook; synthetic replies; 40 isolated virtual clients. No HTTP, Auth, Realtime delivery or database load.',normalTeacherConcurrency:checks,burst,idle,limits:'Database/RPC and signed assets each have a separate four-request bound. A 12s deadline releases only logical single-flight; a transport ignoring abort can still overlap on the server.',idleCost:'The previous unpublished-channel panel had no fallback. This new visible reconciliation intentionally adds six complete reads per client in 20 minutes.',checks:['unused readiness absent','teacher audits retained','separate I/O bounds with photos/documents','hidden suspension and visible recovery','foreign game/table filtering','own mutation trailing reload','scope abort and teacher downgrade','old mutation cannot clear a new-scope draft or continue RPCs','timeout release with ignored abort','partial errors preserve data','held old photo signing cannot overwrite a newer same-scope photo','dirty text/private/review retained atomically and clean entries updated','unmount cleanup']},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1});
