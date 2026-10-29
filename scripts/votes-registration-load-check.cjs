/* The real VotesView effects with synthetic replies and virtual time; no server load. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const file=path.join(__dirname,'election-panels-load-check.cjs');
let fixture=fs.readFileSync(file,'utf8');
function replace(before,after){assert(fixture.includes(before),'Fixture matches: '+before);fixture=fixture.replace(before,after)}
replace("ghost:'GhostPolicyLab'","ghost:'GhostPolicyLab',votes:'VotesView',registration:'InstitutionRegistrationPanel'");
replace("kind==='deadline'&&i===8","kind==='deadline'&&i===8");
replace("institution_session_registrations:[{user_id:'student-A',stage_no:4,institution_key:'gd',present_mandates:15}]","institution_session_registrations:[{user_id:'student-A',stage_no:4,institution_key:'gd',present_mandates:rev?25:15}]");
replace("game_votes:[{id:'procedure'","institution_meeting_records:[{game_id:game,stage_no:4,institution_key:'gd',agenda_body:'agenda-'+rev,agenda_approved_at:null}],game_votes:[{id:'procedure'");
replace("const api={errors,starts,failures,","const api={errors,starts,failures,revision(value){revision=value},connection(value){sync.setGameRealtimeConnection('game-A',value)},");
replace("name==='./useGameTableSync'?sync:","name==='./useGameTableSync'?sync:name==='./useSavedGameState'?{useSavedGameState:(_game,_user,_key,value)=>react.useState(value),savedChoice:()=>()=>true}:name==='./votingBodies'?{VOTING_BODIES:[],bodyQuorum:()=>0}:");
replace("visibilityState:hidden?'hidden':'visible'","visibilityState:hidden?'hidden':'visible',getElementById:()=>null");
replace("name!=='get_my_institution_meeting_permissions'","name!=='get_my_institution_meeting_permissions'&&name!=='get_gd_session_attendance'");
replace("profiles:[],partyInvitations:[],votes:[]","profiles:[],partyInvitations:[],formalDocuments:[],ballots:[],votes:[],names:{}");
replace("main().catch(error=>{console.error(error);process.exitCode=1});","module.exports={realm,tick,find};");
const compiled=new Module(file,module);compiled.filename=file;compiled.paths=module.paths;compiled._compile(fixture,file);
const {realm,tick,find}=compiled.exports;
async function panelMutations(){
 const ts=require('typescript'),text=fs.readFileSync(path.join(__dirname,'../components/game/InstitutionRegistrationPanel.tsx'),'utf8');
 const source=ts.createSourceFile('InstitutionRegistrationPanel.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),functions={};
 function visit(node){if(ts.isFunctionDeclaration(node)&&['register','saveGdPresence'].includes(node.name?.text))functions[node.name.text]=node.getText(source);ts.forEachChild(node,visit)}visit(source);
 assert(functions.register&&functions.saveGdPresence);
 const js=ts.transpileModule('const currentScope=()=>mounted.current&&scopeRef.current===scope;\n'+Object.values(functions).join('\n')+'\nreturn {register,saveGdPresence}',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const make=new Function('supabase','g','canAttend','agendaReady','readOnly','meetingActionsLocked','busy','gdPresence','presenceDraft','presenceEdit','stage','body','setMeetingError','setNotice','setBusy','meetingErrorMessage','userError','onRegistrationChange','load','scopeRef','mounted','scope','reconcileStaleWrite=()=>{}',js);
 for(const name of ['register','saveGdPresence'])for(const fail of [false,true]){
  let callbacks=0,loads=0;
  const supabase={rpc:async()=>({error:fail?{message:'denied'}:null})},g={game:{id:'game-A'}},canAttend=true,agendaReady=true,readOnly=false,meetingActionsLocked=false,busy=false,gdPresence={my_capacity:20},presenceDraft='12',presenceEdit={current:{dirty:true,version:1}},stage=4,body='gd';
  const setMeetingError=()=>{},setNotice=()=>{},setBusy=()=>{},meetingErrorMessage=value=>String(value),userError=e=>e.message,onRegistrationChange=()=>callbacks++,load=async()=>{loads++};
  const scope={key:'game-A'};
  await make(supabase,g,canAttend,agendaReady,readOnly,meetingActionsLocked,busy,gdPresence,presenceDraft,presenceEdit,stage,body,setMeetingError,setNotice,setBusy,meetingErrorMessage,userError,onRegistrationChange,load,{current:scope},{current:true},scope)[name]();
  assert.equal(callbacks,fail?0:1,name+' notifies only after a successful write');assert.equal(loads,fail?0:1,name+' refreshes the panel only after success');
  if(name==='saveGdPresence')assert.equal(presenceEdit.current.dirty,fail,'Only a successful save clears the saved attendance draft');
 }
 for(const mode of ['newer-edit','new-scope']){
  let finish;const old={dirty:true,version:1},presenceEdit={current:old},supabase={rpc:()=>new Promise(resolve=>{finish=resolve})};
  const scope={key:'game-A'},action=make(supabase,{game:{id:'game-A'}},true,true,false,false,false,{my_capacity:20},'12',presenceEdit,4,'gd',()=>{},()=>{},()=>{},String,e=>e.message,()=>{},async()=>{},{current:scope},{current:true},scope).saveGdPresence();
  if(mode==='newer-edit')old.version++;else presenceEdit.current={dirty:true,version:1};
  finish({error:null});await action;
  assert.equal(presenceEdit.current.dirty,true,'A successful old save must preserve '+mode);
 }
 for(const name of ['register','saveGdPresence'])for(const fail of [false,true,'throw']){
  const scopes=[{key:'game-A'},{key:'game-B'}],scopeRef={current:scopes[0]},mounted={current:true},pending=[],events=[];let busy=false;
  const supabase={rpc:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))},presenceEdit={current:{dirty:true,version:1}},notice=value=>{if(value)events.push('notice')},error=value=>{if(value)events.push('error')},callback=()=>events.push('callback'),load=async()=>events.push('load');
  const run=scope=>make(supabase,{game:{id:scope.key}},true,true,false,false,false,{my_capacity:20},'12',presenceEdit,4,'gd',error,notice,value=>{if(scopeRef.current===scope)busy=value},String,e=>e.message,callback,load,scopeRef,mounted,scope)[name]();
  const first=run(scopes[0]);assert.equal(busy,true);scopeRef.current=scopes[1];busy=false;presenceEdit.current={dirty:true,version:1};const second=run(scopes[1]);assert.equal(busy,true);
  if(fail==='throw')pending[0].reject(new Error('old network failure'));else pending[0].resolve({error:fail?{message:'old failure'}:null});await first;assert.equal(busy,true,name+' keeps the newer action busy after an old completion');assert.deepEqual(events,[],name+' does not show or send old-scope results');
  pending[1].resolve({error:null});await second;assert.equal(busy,false);assert.deepEqual(events,['callback','load','notice'],name+' completes the new action');
 }
 for(const name of ['register','saveGdPresence']){
  const a={key:'game-A'},b={key:'game-B'},scopeRef={current:a},mounted={current:true},pending=[],events=[];let busy=false,finishOldLoad;
  const supabase={rpc:()=>new Promise(resolve=>pending.push(resolve))},presenceEdit={current:{dirty:true,version:1}},notice=value=>{if(value)events.push('notice')},callback=()=>events.push('callback');
  const run=(scope,load)=>make(supabase,{game:{id:scope.key}},true,true,false,false,false,{my_capacity:20},'12',presenceEdit,4,'gd',()=>{},notice,value=>{if(scopeRef.current===scope)busy=value},String,e=>e.message,callback,load,scopeRef,mounted,scope)[name]();
  const first=run(a,()=>new Promise(resolve=>{finishOldLoad=resolve}));pending[0]({error:null});await tick();assert(finishOldLoad,'Old successful action starts its refresh');scopeRef.current=b;busy=false;presenceEdit.current={dirty:true,version:1};const second=run(b,async()=>events.push('load'));assert.equal(busy,true);
  finishOldLoad();await first;assert.equal(busy,true,name+' does not clear busy after an old refresh');assert.deepEqual(events,['callback'],name+' omits old notice after switching during refresh');
  pending[1]({error:null});await second;assert.equal(busy,false);assert.deepEqual(events,['callback','callback','load','notice']);
  const stale=run(a,async()=>events.push('load'));await stale;assert.equal(pending.length,2,name+' blocks a stale event handler before the write');
 }
 for(const name of ['register','saveGdPresence']){
  const scope={key:'game-A'},scopeRef={current:scope},mounted={current:true},presenceEdit={current:{dirty:true,version:1}},events=[];let busy=false;
  await make({rpc:async()=>{throw new Error('network failure')}},{game:{id:'game-A'}},true,true,false,false,false,{my_capacity:20},'12',presenceEdit,4,'gd',value=>{if(value)events.push(value)},()=>{},value=>{busy=value},String,e=>e.message,()=>events.push('callback'),async()=>events.push('load'),scopeRef,mounted,scope)[name]();
  assert.equal(busy,false,name+' releases busy on a transport error');assert.deepEqual(events,['network failure'],name+' reports a transport error without a success callback');
 }
 for(const name of ['register','saveGdPresence']){
  const scope={key:'game-A'},scopeRef={current:scope},mounted={current:true},events=[];let finish;
  const action=make({rpc:()=>new Promise(resolve=>{finish=resolve})},{game:{id:'game-A'}},true,true,false,false,false,{my_capacity:20},'12',{current:{dirty:true,version:1}},4,'gd',()=>{},()=>{},()=>{},String,e=>e.message,()=>events.push('callback'),async()=>events.push('load'),scopeRef,mounted,scope,table=>events.push(table))[name]();
  scopeRef.current={key:'game-A'};finish({error:null});await action;assert.deepEqual(events,['institution_session_registrations'],name+' reconciles a successful write after returning to its original game');
 }
}
async function staleMeetingActions(){
 const ts=require('typescript'),text=fs.readFileSync(path.join(__dirname,'../components/game/InstitutionRegistrationPanel.tsx'),'utf8');
 const source=ts.createSourceFile('InstitutionRegistrationPanel.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),names=['saveMeetingDocument','approveMeeting','publishMeetingMinutes','assignMeetingDelegate','createBody','loadStage12Editor','saveStage12Editor'],functions={};
 let busyExpression,savingExpression,busySetter,savingSetter,snapshotExpression;
 function inspect(node){if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='busy')busyExpression=node.initializer.getText(source);if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='stage12Saving')savingExpression=node.initializer.getText(source);if(ts.isFunctionDeclaration(node)&&node.name?.text==='setBusy')busySetter=node.getText(source);if(ts.isFunctionDeclaration(node)&&node.name?.text==='setStage12Saving')savingSetter=node.getText(source);if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='snapshot')snapshotExpression=node.initializer.getText(source);ts.forEachChild(node,inspect)}inspect(source);
 assert(busyExpression&&savingExpression&&busySetter&&savingSetter&&snapshotExpression);
 const snapshot=new Function('g','stage','body','row','return '+ts.transpileModule('('+snapshotExpression+')',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText.replace(/;\s*$/,''));
 const studentA={game:{id:'game'},me:{user_id:'A'}},studentB={game:{id:'game'},me:{user_id:'B'}};
 assert.notEqual(snapshot(studentA,4,'gd',null).scope,snapshot(studentB,4,'gd',null).scope,'A different user cannot inherit a meeting draft');
 const evaluate=new Function('busyScope','stage12SavingScope','actionScope','actionKey','setBusyScope','setStage12SavingScope','currentScope',ts.transpileModule(busySetter+'\n'+savingSetter+'\nreturn {busy:'+busyExpression+',saving:'+savingExpression+',setBusy,setStage12Saving}',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText);
 let busyState=null,savingState=null;const storeBusy=update=>busyState=typeof update==='function'?update(busyState):update,storeSaving=update=>savingState=typeof update==='function'?update(savingState):update;
 const a={key:'game',body:'gd'},keyA='game:4:A:gd',first=evaluate(busyState,savingState,a,keyA,storeBusy,storeSaving,()=>true);first.setBusy(true);first.setStage12Saving(true);
 const b={key:'game',body:'ksrf'};let current=evaluate(busyState,savingState,b,'game:4:A:ksrf',storeBusy,storeSaving,()=>true);assert.equal(current.busy,false);assert.equal(current.saving,false);
 current=evaluate(busyState,savingState,{key:'game',body:'gd'},keyA,storeBusy,storeSaving,()=>true);
 assert.equal(current.busy,true,'Returning to an institution must retain its pending write lock');assert.equal(current.saving,true,'Returning to an institution must retain its pending stage 12 write lock');
 const pendingB=evaluate(busyState,savingState,b,'game:4:A:ksrf',storeBusy,storeSaving,()=>true);pendingB.setBusy(true);pendingB.setStage12Saving(true);
 first.setBusy(false);first.setStage12Saving(false);
 current=evaluate(busyState,savingState,{key:'game',body:'gd'},keyA,storeBusy,storeSaving,()=>true);assert.equal(current.busy,false,'A finished old write releases its own lock');assert.equal(current.saving,false);
 current=evaluate(busyState,savingState,b,'game:4:A:ksrf',storeBusy,storeSaving,()=>true);assert.equal(current.busy,true,'Finishing A must not release B');assert.equal(current.saving,true);
 let draftEffect;function findDraft(node){if(ts.isCallExpression(node)&&node.expression.getText(source)==='useEffect'&&node.arguments[0]?.getText(source).includes('lastMeetingDraftRef.current'))draftEffect=node.arguments[0].getText(source);ts.forEachChild(node,findDraft)}findDraft(source);assert(draftEffect);
 const draftFn=ts.transpileModule('('+draftEffect+')',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText.replace(/;\s*$/,'');
 const dirty={current:{agenda:true,minutes:true,stage12:true}},previous={current:snapshot(studentA,4,'gd',{agenda_body:'old',minutes_body:'old',delegate_user_id:'A'})},values={};
 const refreshDraft=new Function('meetingRows','body','g','stage','lastMeetingDraftRef','dirtyMeetingDraftRef','setAgendaText','setMinutesText','setDelegateUser','return '+draftFn);
 refreshDraft([{institution_key:'gd',agenda_body:'new',minutes_body:'new',delegate_user_id:'B'}],'gd',studentB,4,previous,dirty,value=>values.agenda=value,value=>values.minutes=value,value=>values.delegate=value)();
 assert.equal(dirty.current.agenda,false);assert.equal(dirty.current.minutes,false);assert.equal(dirty.current.stage12,false,'Changing user resets the previous stage 12 dirty flag');assert.equal(values.agenda,'new','The new user gets their own agenda');
 dirty.current.agenda=true;dirty.current.stage12=true;refreshDraft([{institution_key:'gd',agenda_body:'new',minutes_body:'new',delegate_user_id:'B'}],'gd',{...studentB,me:{user_id:'B',role_title:'new role'}},4,previous,dirty,()=>{},()=>{},()=>{})();assert.equal(dirty.current.agenda,true,'A role change preserves the same user draft');assert.equal(dirty.current.stage12,true);
 function visit(node){if(ts.isFunctionDeclaration(node)&&names.includes(node.name?.text))functions[node.name.text]=node.getText(source);ts.forEachChild(node,visit)}visit(source);
 for(const name of names)assert(functions[name],name+' exists');
 let scopeFunction;function findScope(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='currentScope')scopeFunction=node.getText(source);ts.forEachChild(node,findScope)}findScope(source);
 const scopeJs=ts.transpileModule(scopeFunction+'\nreturn currentScope',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const panel={key:'game'},action={key:'game',body:'gd'},actionRef={current:action},isCurrent=new Function('mounted','scopeRef','scope','actionRef','actionScope',scopeJs)({current:true},{current:panel},panel,actionRef,action);
 assert.equal(isCurrent(),true);actionRef.current={key:'game',body:'ksrf'};assert.equal(isCurrent(),false,'An old action cannot affect another selected institution');
 let reconcileFunction;function findReconcile(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='reconcileStaleWrite')reconcileFunction=node.getText(source);ts.forEachChild(node,findReconcile)}findReconcile(source);assert(reconcileFunction);
 const reconcileJs=ts.transpileModule(reconcileFunction+'\nreturn reconcileStaleWrite',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,notifications=[],mountedRef={current:true},contextRef={current:{gameId:'game',stage:4}};
 const reconcile=new Function('mounted','currentGameStageRef','actionGameId','stage','notifyGameDataRefresh',reconcileJs)(mountedRef,contextRef,'game',4,(game,table)=>notifications.push([game,table]));
 reconcile('institution_meeting_records');assert.deepEqual(notifications,[['game','institution_meeting_records']]);reconcile('institution_meeting_records');assert.equal(notifications.length,2,'A successful old write refreshes the same game and stage for the current user and institution');
 contextRef.current={gameId:'other',stage:4};reconcile('institution_meeting_records');assert.equal(notifications.length,2,'An old write does not invalidate another game');contextRef.current={gameId:'game',stage:5};reconcile('institution_meeting_records');assert.equal(notifications.length,2,'An old write does not invalidate another stage');contextRef.current={gameId:'game',stage:4};mountedRef.current=false;reconcile('institution_meeting_records');assert.equal(notifications.length,2,'An unmounted widget sends no event');
 let actualTables;function findSync(node){if(ts.isCallExpression(node)&&node.expression.getText(source)==='useGameTableSync')actualTables=node.arguments[1].elements.map(item=>item.text);ts.forEachChild(node,findSync)}findSync(source);
 for(const table of ['institution_meeting_records','institution_session_registrations','institution_units','formal_documents'])assert(actualTables.includes(table),table+' is subscribed by the panel');
 let resetEffect;function findReset(node){if(ts.isCallExpression(node)&&node.expression.getText(source)==='useEffect'&&node.arguments[0]?.getText(source).includes("setPresenceDraft('')"))resetEffect=node.arguments[0].getText(source);ts.forEachChild(node,findReset)}findReset(source);assert(resetEffect,'Context reset effect exists');
 const resets=[],reset=new Function('setPresenceDraft','setStage12Session','setAgendaEditorOpen','setStage12Text','setStage12InitialText','setStage12Reason','return ('+resetEffect+')')(...['presence','session','editor','text','initial','reason'].map(name=>value=>resets.push([name,value])));reset();
 assert(resets.some(([name,value])=>name==='session'&&value===null),'Changing game or participant clears the previous stage 12 session');
 assert(resets.some(([name,value])=>name==='editor'&&value===false),'Changing game or participant closes the previous stage 12 editor');
 const js=ts.transpileModule(Object.values(functions).join('\n')+'\nreturn {'+names.join(',')+'}',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const make=new Function('ctx','with(ctx){'+js+'}');
 for(const [name,table] of Object.entries({saveMeetingDocument:'institution_meeting_records',approveMeeting:'institution_meeting_records',publishMeetingMinutes:'institution_meeting_records',assignMeetingDelegate:'institution_meeting_records',createBody:'institution_units',saveStage12Editor:'formal_documents'}))for(const fail of [false,true]){
  let finish,active=true;const events=[];
  const ctx={currentScope:()=>active,reconcileStaleWrite:table=>events.push(table),g:{game:{id:'game'}},supabase:{rpc:()=>new Promise(resolve=>{finish=resolve})},busy:false,canPrepare:true,canWriteAgenda:true,meetingCoordinator:true,verifiedRights:{can_coordinate:true},readOnly:false,meetingActionsLocked:false,stage12Saving:false,stage12Session:{id:'session',status:'draft'},stage12Text:'x'.repeat(100),stage12InitialText:'old',stage12Reason:'',stage:4,body:'gd',agendaText:'draft',minutesText:'',delegateUser:'',newTitle:'body',seats:'1',users:[],head:'',editing:null,dirtyMeetingDraftRef:{current:{agenda:true}},meetingDraftVersion:{current:{agenda:0,stage12:0}},meetingErrorMessage:String,userError:e=>e.message,load:async()=>events.push('load')};
  ctx.setMeetingError=()=>{};ctx.setNotice=()=>{};ctx.setBusy=()=>{};ctx.setStage12Saving=()=>{};
  const task=make(ctx)[name]('agenda');active=false;finish({error:fail?{message:'failed'}:null,data:'unit'});await task;
  assert.deepEqual(events,fail?[]:[table],name+' reconciles only successful stale writes without an old success notice');
 }
 for(const name of names)for(const fail of [false,true])for(const change of ['game','body']){
  const old={key:'old'},scopeRef={current:old},mounted={current:true},events=[],action={key:'old',body:'gd'},actionRef={current:action};let resolve;
  const response=new Promise(r=>{resolve=r}),query={eq(){return this},order(){return this},limit(){return this},maybeSingle(){return response}};
  const ctx={scope:old,scopeRef,mounted,g:{game:{id:'old'},setError:()=>events.push('error')},supabase:{rpc:()=>response,from:()=>({select:()=>query})},busy:false,canPrepare:true,canWriteAgenda:true,meetingCoordinator:true,verifiedRights:{can_coordinate:true},readOnly:false,meetingActionsLocked:false,stage12Saving:false,stage12Session:{id:'old',status:'draft'},stage12Text:'x'.repeat(100),stage12InitialText:'old',stage12Reason:'',stage:4,body:'gd',agendaText:'agenda',minutesText:'minutes',delegateUser:'student',newTitle:'body',seats:'1',users:[],head:'',editing:null,sessionId:'s',dirtyMeetingDraftRef:{current:{agenda:true,minutes:true,stage12:true}},meetingErrorMessage:String,userError:e=>e.message,load:async()=>events.push('load')};
  ctx.currentScope=new Function('mounted','scopeRef','scope','actionRef','actionScope',scopeJs)(mounted,scopeRef,old,actionRef,action);
  ctx.reconcileStaleWrite=()=>{};
  ctx.meetingDraftVersion={current:{agenda:0,minutes:0,stage12:0}};
  for(const setter of ['setMeetingError','setNotice','setBusy','setStage12Saving','setStage12Session','setStage12InitialText','setStage12Text','setAgendaEditorOpen','setStage12Reason','setBody','setNewTitle','setUsers','setHead','setSeats','setEditing'])ctx[setter]=value=>{if(value!==''&&value!==true&&!((setter==='setBusy'||setter==='setStage12Saving')&&value===false))events.push(setter)};
  const task=make(ctx)[name](name==='saveMeetingDocument'||name==='approveMeeting'?'agenda':undefined);
  events.length=0;if(change==='game')scopeRef.current={key:'new'};else actionRef.current={key:'old',body:'ksrf'};
  resolve({data:name==='loadStage12Editor'?null:'new-unit',error:fail?{message:'old failure'}:null});await task;
  assert.deepEqual(events,[],name+' must not change a newer scope when an old request completes');
  assert.equal(ctx.dirtyMeetingDraftRef.current.agenda,true,name+' must not clear the new agenda draft');
  assert.equal(ctx.dirtyMeetingDraftRef.current.stage12,true,name+' must not clear the new stage 12 draft');
 }
 for(const name of ['saveMeetingDocument','saveStage12Editor']){
  let resolve;const response=new Promise(r=>{resolve=r}),draft={agenda:true,minutes:false,stage12:true},versions={agenda:1,minutes:0,stage12:1};
  const ctx={currentScope:()=>true,g:{game:{id:'game'}},supabase:{rpc:()=>response},busy:false,canPrepare:true,canWriteAgenda:true,meetingCoordinator:true,verifiedRights:{can_coordinate:true},readOnly:false,meetingActionsLocked:false,stage12Saving:false,stage12Session:{id:'session',status:'draft'},stage12Text:'x'.repeat(100),stage12InitialText:'old',stage12Reason:'',stage:4,body:'gd',agendaText:'first draft',minutesText:'',dirtyMeetingDraftRef:{current:draft},meetingDraftVersion:{current:versions},meetingErrorMessage:String,userError:e=>e.message,load:async()=>{}};
  for(const setter of ['setMeetingError','setNotice','setBusy','setStage12Saving','setAgendaEditorOpen','setStage12Reason','setStage12InitialText'])ctx[setter]=()=>{};
  const task=make(ctx)[name]('agenda');versions[name==='saveMeetingDocument'?'agenda':'stage12']++;resolve({error:null});await task;
  assert.equal(draft[name==='saveMeetingDocument'?'agenda':'stage12'],true,name+' preserves edits made after saving began');
 }
 for(const name of ['saveMeetingDocument','approveMeeting','publishMeetingMinutes','assignMeetingDelegate','createBody','saveStage12Editor']){
  let finish,active=true;const events=[];
  const ctx={currentScope:()=>active,g:{game:{id:'game'},setError:()=>events.push('error')},supabase:{rpc:async()=>({error:null,data:'unit'})},busy:false,canPrepare:true,canWriteAgenda:true,meetingCoordinator:true,verifiedRights:{can_coordinate:true},readOnly:false,meetingActionsLocked:false,stage12Saving:false,stage12Session:{id:'session',status:'draft'},stage12Text:'x'.repeat(100),stage12InitialText:'old',stage12Reason:'',stage:4,body:'gd',agendaText:'draft',minutesText:'',delegateUser:'',newTitle:'body',seats:'1',users:[],head:'',editing:null,dirtyMeetingDraftRef:{current:{agenda:true,minutes:false,stage12:true}},meetingDraftVersion:{current:{agenda:0,minutes:0,stage12:0}},meetingErrorMessage:String,userError:e=>e.message,load:()=>new Promise(resolve=>{finish=resolve})};
  for(const setter of ['setMeetingError','setNotice','setBusy','setStage12Saving','setStage12InitialText','setAgendaEditorOpen','setStage12Reason','setBody','setNewTitle','setUsers','setHead','setSeats','setEditing'])ctx[setter]=value=>{if(!((setter==='setBusy'||setter==='setStage12Saving')&&value===false))events.push(setter)};
  const task=make(ctx)[name]('agenda');await tick();assert(finish,name+' refreshes after saving');events.length=0;active=false;finish();await task;
  assert.deepEqual(events,[],name+' does not affect the new context after an old refresh');
 }
 for(const name of names){
  const errors=[];let busy=false,saving=false;
  const rejected=()=>Promise.reject(new Error('network failure')),query={eq(){return this},order(){return this},limit(){return this},maybeSingle:rejected};
  const ctx={currentScope:()=>true,g:{game:{id:'game'},setError:e=>errors.push(e)},supabase:{rpc:rejected,from:()=>({select:()=>query})},busy:false,canPrepare:true,canWriteAgenda:true,meetingCoordinator:true,verifiedRights:{can_coordinate:true},readOnly:false,meetingActionsLocked:false,stage12Saving:false,stage12Session:{id:'session',status:'draft'},stage12Text:'x'.repeat(100),stage12InitialText:'old',stage12Reason:'',stage:4,body:'gd',agendaText:'draft',minutesText:'',delegateUser:'',newTitle:'body',seats:'1',users:[],head:'',editing:null,sessionId:'s',dirtyMeetingDraftRef:{current:{agenda:true,minutes:false,stage12:true}},meetingDraftVersion:{current:{agenda:0,minutes:0,stage12:0}},meetingErrorMessage:String,userError:e=>e.message,load:async()=>{}};
  for(const setter of ['setNotice','setStage12Session','setStage12InitialText','setStage12Text','setAgendaEditorOpen','setStage12Reason','setBody','setNewTitle','setUsers','setHead','setSeats','setEditing'])ctx[setter]=()=>{};
  ctx.setMeetingError=value=>{if(value)errors.push(value)};ctx.setBusy=value=>{busy=value};ctx.setStage12Saving=value=>{saving=value};
  await make(ctx)[name]('agenda');assert.equal(busy,false,name+' releases busy on network failure');assert.equal(saving,false,name+' releases saving on network failure');assert.deepEqual(errors,['network failure'],name+' reports a network error');
 }
}
async function main(){
 async function model(old){const sessions=Array.from({length:40},()=>realm('votes',old));await tick();for(const r of sessions)await r.settle();for(let second=0;second<12;second++){for(const r of sessions)for(let i=0;i<8;i++)r.local('institution_session_registrations');for(const r of sessions)await r.advance(1000)}const reads=sessions.reduce((n,r)=>n+r.metrics().reads,0);for(const r of sessions)r.close();return reads}
 async function idle(old){const sessions=Array.from({length:40},()=>realm('votes',old));await tick();for(const r of sessions)await r.settle();for(const r of sessions)await r.advance(20*60000);const reads=sessions.reduce((n,r)=>n+r.metrics().reads,0);for(const r of sessions)r.close();return reads}
 const before=process.env.PERFORMANCE_BASELINE_REF?await model(true):null,reads=await model(false);
 const idleBefore=process.env.PERFORMANCE_BASELINE_REF?await idle(true):null,idleAfter=await idle(false);
 assert(reads<=240,'40 clients should coalesce frequent registration signals into at most one read per three seconds: '+reads);
 const r=realm('votes');await r.settle();r.hold();r.local('institution_session_registrations');await r.advance(3100);
 r.local('institution_session_registrations');await r.advance(3100);
 assert.equal(r.metrics().maxInflight,1,'Registration reads must not overlap');
 const own=find(r.render(),n=>typeof n.props?.onRegistrationChange==='function');assert(own,'VotesView passes the own-registration callback');r.revision(1);own.props.onRegistrationChange();r.release();await r.settle();await r.advance(3100);await r.settle();
 assert.equal(r.state(14).rows[0].present_mandates,25,'A later own registration replaces an older held snapshot without Realtime');
 const old=JSON.stringify(r.state(14));r.failures.add('institution_session_registrations');own.props.onRegistrationChange();await r.settle();assert.equal(JSON.stringify(r.state(14)),old,'A read error preserves confirmed data');r.failures.clear();r.close();
 const immediate=realm('votes');await immediate.settle();const callback=find(immediate.render(),n=>typeof n.props?.onRegistrationChange==='function');const prior=immediate.metrics().reads;immediate.revision(1);callback.props.onRegistrationChange();await tick();assert.equal(immediate.metrics().reads,prior+1,'Successful own change starts a read immediately without Realtime');await immediate.settle();assert.equal(immediate.state(14).rows[0].present_mandates,25);immediate.close();
 const hidden=realm('votes',false,{hidden:true});await tick();hidden.local('institution_session_registrations');await hidden.advance(10000);assert.equal(hidden.metrics().reads,0,'Hidden tabs do not poll');hidden.visible(true);await hidden.advance(3100);await hidden.settle();assert.equal(hidden.metrics().reads,1,'Returning to the tab reconciles attendance');hidden.close();
 const offline=realm('votes');await offline.settle();offline.connection(false);offline.revision(1);await offline.advance(38000);await offline.settle();assert.equal(offline.state(14).rows[0].present_mandates,25,'Lost WebSocket recovers through the short fallback without a focus event');assert.equal(offline.metrics().reads,2);offline.close();
 const timeout=realm('votes');await timeout.settle();timeout.hold();timeout.local('institution_session_registrations');await timeout.advance(3100);await timeout.advance(12001);const stalled=timeout.metrics().reads;await timeout.advance(10000);assert.equal(timeout.metrics().reads,stalled,'A timeout does not trigger a retry loop');timeout.hold(false);timeout.revision(1);find(timeout.render(),n=>typeof n.props?.onRegistrationChange==='function').props.onRegistrationChange();await timeout.settle();timeout.release();await timeout.settle();assert.equal(timeout.state(14).rows[0].present_mandates,25,'An aborted late response cannot overwrite a newer registration');timeout.close();
 const switched=realm('votes');await switched.settle();switched.hold();switched.local('institution_session_registrations');await switched.advance(3100);switched.render(switched.props('game-B','student-B'));await switched.settle();switched.release();await switched.settle();assert.equal(JSON.parse(switched.state(14).scope)[0],'game-B','A late read cannot restore a previous game');assert.equal(JSON.parse(switched.state(14).scope)[1],'student-B','A late read cannot restore a previous user');switched.close();
 const role=realm('votes');await role.settle();role.render(role.props('game-A','student-A','teacher'));await role.settle();assert.equal(JSON.parse(role.state(14).scope)[2],'teacher','Changing roles reloads the snapshot under current permissions');role.close();
 const registration=realm('registration');await registration.settle();
 const select=find(registration.render(),node=>node.props?.label==='Орган');assert(select,'Registration offers an institution selector');select.props.onChange('ksrf');await registration.settle();registration.revision(1);
 const beforeReturn=registration.count('institution_units');registration.local('institution_meeting_records');await registration.advance(1000);await registration.settle();assert.equal(registration.count('institution_units'),beforeReturn+1,'A late write to A refreshes the shared snapshot while B is open');
 find(registration.render(),node=>node.props?.label==='Орган').props.onChange('gd');await registration.settle();assert.equal(registration.state(12)[0].agenda_body,'agenda-1','Returning to A shows the updated agenda without waiting for background polling');
 for(const table of ['institution_meeting_records','institution_session_registrations','institution_units','formal_documents']){const before=registration.count('institution_units');registration.local(table);await registration.advance(1000);await registration.settle();assert.equal(registration.count('institution_units'),before+1,'The real panel hook reloads after '+table+' invalidation')}
 const unrelated=registration.count('institution_units');registration.local('institution_meeting_records','game-B');await registration.advance(1000);assert.equal(registration.count('institution_units'),unrelated,'Another game does not invalidate this panel');registration.close();
 await panelMutations();
 await staleMeetingActions();
 console.log(JSON.stringify({environment:'40 isolated component realms; 12 virtual seconds, 8 signals/s each; idle: 20 virtual minutes; synthetic responses without Auth, HTTP or database',before,after:reads,idleBefore,idleAfter,checks:['single-flight','latest own registration without Realtime','failure preserves result','12s timeout and late response','hidden recovery','game, user and role switch','callbacks on successful writes only']}));
}
main().catch(error=>{console.error(error);process.exitCode=1});
