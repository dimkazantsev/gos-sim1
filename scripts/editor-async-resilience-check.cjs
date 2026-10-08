/* Real component handlers and effects, deterministic simulated reads/HTTP.
 * This suite does not start a browser or contact a database or document API. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};}
function text(node){if(node==null||typeof node==='boolean')return'';if(typeof node!=='object')return String(node);return[node.props?.children].flat(Infinity).map(text).join('');}
function nodes(node,match){if(!node||typeof node!=='object')return[];return[...(match(node)?[node]:[]),...[node.props?.children].flat(Infinity).flatMap(child=>nodes(child,match))];}
function formalDocument(id,workflow='bill'){
 const status=workflow==='budget'?'budget_registered':'draft';
 return{id,game_id:'game-a',author_id:'teacher-a',title:'Document '+id,registry_no:id,body_text:'The saved document contains enough text',doc_type:'fz_bill',subject_key:'gd_deputy',subject_label:'Депутат',workflow_key:workflow,status_code:status,status_label:'Draft',current_owner_key:'author',current_step:0,workflow_steps:[{code:status,label:'Draft',owner:'author',action:null}],created_at:'2026-10-08T00:00:00Z',updated_at:'2026-10-08T00:00:00Z',metadata:{},stage_no:12};
}
function harness(component){
 const file=path.join(root,'components/game',component+'.tsx');
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const slots=[],pendingEffects=[],channels=[],counts=new Map(),holds=new Map(),errors=[],fetches=[],failures=new Set(),profileNotes=new Map(),committeeLegal=new Map(),budgetConclusions=new Map();
 let cursor=0,dirty=false,tree,latestTableLoad,revision=1,serverVenue='Saved venue',clock=0,sessionUser='teacher-a',props;
 const g={game:{id:'game-a'},me:{game_id:'game-a',user_id:'teacher-a',kind:'teacher',full_name:'Teacher A'},teacher:true,currentStage:{stage_no:7},formalDocuments:[],formalHistory:[],votes:[],members:[],parties:[],setError:error=>errors.push(String(error?.message||error))};
 for(const name of ['createFormalDocument','deleteFormalDocument','advanceFormalDocument','updateFormalDraft','vetoFormalDocument','resolveBudgetConciliation','startBudgetRejectionBranch','createVote'])g[name]=async()=>null;
 g.refresh=async()=>{};
 props={g,onOpenVotes:()=>{}};
 const react={
  useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return[slots[i].value,next=>{const value=typeof next==='function'?next(slots[i].value):next;if(!Object.is(value,slots[i].value)){slots[i].value=value;dirty=true;}}];},
  useRef(initial){const i=cursor++;return(slots[i]??={value:{current:initial}}).value;},
  useMemo(fn){cursor++;return fn();},
  useEffect(effect,deps){const i=cursor++,old=slots[i];if(!old||!deps||deps.some((value,j)=>!Object.is(value,old.deps?.[j]))){slots[i]={deps,cleanup:old?.cleanup};pendingEffects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=effect();});}}
 };
 const supabase={
  auth:{getSession:async()=>({data:{session:sessionUser?{user:{id:sessionUser},access_token:'simulation-only'}:null},error:null})},
  from(table){const number=(counts.get(table)||0)+1;counts.set(table,number);const snapshot={revision,serverVenue,user:g.me.user_id,game:g.game.id},filters={};const query={select(){return this;},eq(key,value){filters[key]=value;return this;},is(){return this;},order(){return this;},maybeSingle(){return this;},async then(resolve,reject){try{
   await holds.get(table+':'+number)?.promise;
   let data=[];
   if(table==='presidential_candidates')data=['a','b'].map(letter=>({id:'candidate-'+letter,user_id:snapshot.user,created_by:snapshot.user,registration_status:'registered',display_name:'Candidate '+letter+' revision '+snapshot.revision,photo_path:null,party_id:null,rating_penalty:0}));
   if(table==='presidential_election_settings')data={game_id:snapshot.game,system_type:'relative',status:'round1',poll_enabled:true,result:{}};
   if(table==='presidential_scorecards')data=['a','b'].map(letter=>({candidate_id:'candidate-'+letter,round_no:1,poll_pct:20,computed_pct:snapshot.revision}));
   if(table==='presidential_inauguration')data={game_id:snapshot.game,scheduled_at:'2026-10-08T12:00:00Z',venue:snapshot.serverVenue,notes:'Saved notes',hymn_path:null,ceremonial_music_path:null};
   if(table==='bill_submission_profiles')data={document_id:filters.document_id,committee_key:'committee-1',requires_financial_justification:false,requires_government_opinion:false,note:profileNotes.get(filters.document_id)||'Saved profile '+filters.document_id+' revision '+snapshot.revision};
   if(table==='bill_committee_conclusions')data={document_id:filters.document_id,legal_compliance:committeeLegal.get(filters.document_id)||'Saved legal '+filters.document_id+' revision '+snapshot.revision,internal_logic:'Saved logic',affected_acts_completeness:'Saved acts',recommendation:'draft',finalized:false};
   if(table==='budget_preliminary_reviews')data={document_id:filters.document_id,documents_compliant:true,sent_to_all_committees:false,accounts_chamber_reviewed:false,committee_conclusion:budgetConclusions.get(filters.document_id)||'Saved budget '+filters.document_id+' revision '+snapshot.revision,decision:'draft',note:'Saved budget note'};
   resolve(failures.has(table)?{data:null,error:{message:'simulated table failure'}}:{data,error:null});
  }catch(error){reject(error);}}};return query;},
  rpc:async(name,args)=>{
   if(name==='save_presidential_inauguration')serverVenue=args.p_venue;
   if(name==='save_bill_submission_profile')profileNotes.set(args.p_document_id,args.p_note);
   if(name==='save_bill_committee_conclusion')committeeLegal.set(args.p_document_id,args.p_legal_compliance);
   if(name==='save_budget_preliminary_review')budgetConclusions.set(args.p_document_id,args.p_committee_conclusion);
   return{data:name==='get_formal_subjects'?['gd_deputy']:name==='get_bill_dossier_readiness'?{issues:[],review_issues:[],required_files:[],submission_ready:false,committee_ready:false}:null,error:null};
  },
  storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'https://example.invalid/media'},error:null})})},
  channel(){const handlers=[];const channel={on(kind,filter,callback){handlers.push({filter,callback});return this;},subscribe(){return this;},handlers};channels.push(channel);return channel;},removeChannel:async()=>{}
 };
 const jsx=(type,props)=>({type,props:props||{}}),tag=name=>Object.assign(()=>{},{displayName:name});
 const subject={key:'gd_deputy',label:'Депутат',short:'Депутат',roleHints:['депутат'],defaultType:'fz_bill'};
 const types=[{key:'fz_bill',label:'Законопроект',workflow:'bill'},{key:'other',label:'Иной документ',workflow:'generic'}];
 function requireFor(name){
  if(name==='react')return react;
  if(name==='react/jsx-runtime')return{jsx,jsxs:jsx,Fragment:'fragment'};
  if(name==='@/lib/supabase')return{supabase};
  if(name==='@/lib/userError')return{userError:error=>String(error?.message||error)};
  if(name==='./useGameTableSync')return{useGameTableSync(id,tables,load,scope){const latest=react.useRef(load);latest.current=load;latestTableLoad=()=>latest.current();react.useEffect(()=>{if(id)void latest.current();},[id,scope,tables.join('|')]);}};
  if(name==='./useSavedGameState')return{useSavedGameState:(id,user,section,initial)=>react.useState(initial),savedChoice:()=>()=>true,savedString:()=>true,savedBoolean:()=>true};
  if(name==='./formalInstitutions')return{FORMAL_SUBJECTS:[subject],FORMAL_TYPES:types,inferFormal:()=>({subject,type:types[0]}),formalSignature:()=>null,ownerLabel:x=>x};
  if(name==='./proceduralVoting')return{votePresetForDocument:()=>null};
  if(name==='./documentTemplates')return{DOCUMENT_TEMPLATES:[{key:'fz_bill',title:'Template title',body:'Template body with enough text',docType:'fz_bill',subject:'gd_deputy'}]};
  if(name==='./institutionEmblems')return{institutionEmblem:()=>''};
  return new Proxy({__esModule:true,default:tag(path.basename(name))},{get:(object,key)=>key in object?object[key]:tag(String(key))});
 }
 const module={exports:{}};
 const context={console,Date,Promise,Map,Set,Object,Array,String,Number,Math,FormData,File,Blob,AbortController,process:{env:{}},window:{location:{origin:'https://example.invalid'}},
  fetch:async(url,init)=>{const response=deferred();fetches.push({url,init,response});return response.promise;},
  setInterval:()=>++clock,clearInterval:()=>{},requestAnimationFrame:fn=>{fn();return++clock;},cancelAnimationFrame:()=>{}
 };
 vm.runInNewContext('(function(require,module,exports){'+code+'\n})',context)(requireFor,module,module.exports);
 function render(){cursor=0;dirty=false;tree=module.exports.default(props);while(pendingEffects.length)pendingEffects.shift()();return tree;}
 async function settle(){for(let i=0;i<8;i++){render();await tick();if(!dirty)break;}return render();}
 const byClass=(name,from=tree)=>nodes(from,node=>node.props?.className?.split(' ').includes(name))[0];
 const all=(type,from=tree)=>nodes(from,node=>node.type===type);
 const byLabel=name=>nodes(tree,node=>node.props?.['aria-label']===name)[0];
 const clickResults=()=>all('button',byClass('stage7Tabs'))[2].props.onClick();
 return{
  g,render,settle,errors,fetches,byClass,all,byLabel,clickResults,setProps:value=>Object.assign(props,value),
  venueInput:()=>all('input',byClass('inaugurationForm'))[1],
  selectCandidate:()=>all('select',byClass('campaignForm'))[0],
  createEditor(){all('button',byClass('formalTabs'))[0].props.onClick();render();},
  openDossier(){all('button',byClass('billReadinessFooter'))[0].props.onClick();render();},
  refreshDocument(){return nodes(tree,node=>node.type?.displayName==='DocumentTools')[0].props.onRefresh();},
  remoteProfile(value,id='doc-a'){profileNotes.set(id,value);},remoteLegal(value,id='doc-a'){committeeLegal.set(id,value);},remoteBudget(value,id='doc-a'){budgetConclusions.set(id,value);},
  resolveFetch(index,data,ok=true){fetches[index].response.resolve({ok,json:async()=>data});},
  setRevision:value=>{revision=value;},setVenue:value=>{serverVenue=value;},setSessionUser:value=>{sessionUser=value;},
  fail:table=>failures.add(table),
  hold(table){const pending=deferred();holds.set(table+':'+((counts.get(table)||0)+1),pending);return pending;},
  refresh(){if(latestTableLoad)return latestTableLoad();for(const channel of channels)for(const {filter,callback} of channel.handlers)if(filter.table==='presidential_scorecards')callback();},
  dispose(){for(const slot of slots)slot?.cleanup?.();}
 };
}

async function main(){
 const failures=[];
 async function check(name,fn){try{await fn();console.log('PASS '+name);}catch(error){failures.push(name);console.error('FAIL '+name+': '+error.message);}}
 await check('Stage7 refresh preserves inauguration edits and delegates calculator controls',async()=>{
  const h=harness('PresidentialElectionStage7');await h.settle();h.clickResults();h.render();h.venueInput().props.onChange({target:{value:'Unsaved venue'}});h.render();h.setVenue('Other saved venue');await h.refresh();await h.settle();assert.equal(h.venueInput().props.value,'Unsaved venue');const calculator=nodes(h.render(),node=>node.type?.displayName==='PresidentialRulesCalculator')[0];assert.ok(calculator,'The actual calculator is mounted as a separate component');assert.equal(calculator.props.g,h.g);assert.equal(calculator.props.settings.status,'round1');assert.equal(calculator.props.candidates.length,2);assert.equal(h.byClass('scoreMetricsRow'),undefined);h.dispose();
 });
 await check('Stage7 background callbacks keep a manually selected candidate',async()=>{
  const h=harness('PresidentialElectionStage7');await h.settle();h.selectCandidate().props.onChange({target:{value:'candidate-b'}});h.render();await h.refresh();await h.settle();assert.equal(h.selectCandidate().props.value,'candidate-b');h.dispose();
 });
 await check('Stage7 official standings ignore older refreshes and another game',async()=>{
  const h=harness('PresidentialElectionStage7');await h.settle();h.clickResults();h.render();const old=h.hold('presidential_scorecards');h.setRevision(2);const first=h.refresh();await tick();h.setRevision(3);await h.refresh();await h.settle();assert.match(text(h.byClass('resultBars')),/3\.00%/);old.resolve();await first;await h.settle();assert.match(text(h.byClass('resultBars')),/revision 3/);
  const other=h.hold('presidential_scorecards');const pending=h.refresh();await tick();h.g.game.id='game-b';h.g.me.game_id='game-b';h.setRevision(4);h.setVenue('Other game venue');await h.settle();other.resolve();await pending;await h.settle();assert.match(text(h.byClass('resultBars')),/revision 4/);assert.equal(h.venueInput().props.value,'Other game venue');h.dispose();
 });
 await check('Stage7 students retain public standings and ceremony without teacher inputs',async()=>{
  const h=harness('PresidentialElectionStage7');await h.settle();h.clickResults();h.render();h.g.teacher=false;h.g.me.kind='student';await h.settle();assert.match(text(h.byClass('resultBars')),/1\.00%/);assert.equal(h.byClass('inaugurationForm'),undefined);assert.match(text(h.byClass('ceremonyPublic')),/Saved venue/);const calculator=nodes(h.render(),node=>node.type?.displayName==='PresidentialRulesCalculator')[0];assert.equal(calculator.props.g.teacher,false);h.dispose();
 });
 await check('Saved ceremony drafts accept later server refreshes',async()=>{
  const h=harness('PresidentialElectionStage7');await h.settle();h.clickResults();h.render();h.venueInput().props.onChange({target:{value:'New venue'}});h.render();h.all('button',h.byClass('inaugurationForm'))[0].props.onClick();await h.settle();h.setVenue('Remote venue');await h.refresh();await h.settle();assert.equal(h.venueInput().props.value,'Remote venue');h.dispose();
 });
 await check('Stage7 failed reads expose an error and retain accepted values',async()=>{
  const h=harness('PresidentialElectionStage7');await h.settle();h.clickResults();h.render();h.fail('presidential_scorecards');h.setRevision(2);h.setVenue('Unavailable venue');await h.refresh();await h.settle();assert.match(text(h.byClass('resultBars')),/revision 1/);assert.equal(h.venueInput().props.value,'Saved venue');assert.match(h.errors.at(-1),/simulated table failure/);h.dispose();
 });
 await require('./presidential-calculator-resilience-check.cjs').runChecks(check);
 await check('The latest selected file wins even if older extraction finishes last',async()=>{
  const h=harness('DocumentsView');await h.settle();h.createEditor();const upload=h.byLabel('Загрузить документ для распознавания');upload.props.onChange({target:{files:[new File(['a'],'source-a.txt')]}});await h.settle();h.byLabel('Загрузить документ для распознавания').props.onChange({target:{files:[new File(['b'],'source-b.txt')]}});await h.settle();h.resolveFetch(1,{text:'Latest extracted document text'});await h.settle();h.resolveFetch(0,{text:'Stale extracted text'});await h.settle();assert.equal(h.byLabel('Текст документа').props.value,'Latest extracted document text');assert.equal(h.byLabel('Название документа').props.value,'source b');h.dispose();
 });
 await check('Old extraction completion cannot stop the current loading indicator',async()=>{
  const h=harness('DocumentsView');await h.settle();h.createEditor();h.byLabel('Загрузить документ для распознавания').props.onChange({target:{files:[new File(['a'],'a.txt')]}});await h.settle();h.byLabel('Загрузить документ для распознавания').props.onChange({target:{files:[new File(['b'],'b.txt')]}});await h.settle();h.resolveFetch(0,{text:'Older text'});await h.settle();assert.match(text(h.byClass('formalFileDrop')),/Извлекаю текст/);h.resolveFetch(1,{text:'Current text'});await h.settle();assert.doesNotMatch(text(h.byClass('formalFileDrop')),/Извлекаю текст/);h.dispose();
 });
 await check('Text and title typed during extraction are preserved',async()=>{
  const h=harness('DocumentsView');await h.settle();h.createEditor();h.byLabel('Загрузить документ для распознавания').props.onChange({target:{files:[new File(['a'],'source.txt')]}});await h.settle();h.byLabel('Текст документа').props.onChange({target:{value:'My manually typed document text'}});h.byLabel('Название документа').props.onChange({target:{value:'My typed title'}});h.render();h.resolveFetch(0,{text:'Extracted old document text'});await h.settle();assert.equal(h.byLabel('Текст документа').props.value,'My manually typed document text');assert.equal(h.byLabel('Название документа').props.value,'My typed title');h.dispose();
 });
 await check('Manually selected document requisites survive extraction',async()=>{
  const h=harness('DocumentsView');await h.settle();h.createEditor();h.byLabel('Загрузить документ для распознавания').props.onChange({target:{files:[new File(['a'],'source.txt')]}});await h.settle();const type=nodes(h.render(),node=>node.props?.label==='Вид документа')[0];type.props.onChange('other');h.render();h.resolveFetch(0,{text:'Extracted draft bill text'});await h.settle();assert.equal(nodes(h.render(),node=>node.props?.label==='Вид документа')[0].props.value,'other');h.dispose();
 });
 await check('Replacing the source with a template cancels pending extraction',async()=>{
  const h=harness('DocumentsView');await h.settle();h.createEditor();h.byLabel('Загрузить документ для распознавания').props.onChange({target:{files:[new File(['a'],'source.txt')]}});await h.settle();h.all('button').find(node=>text(node).includes('Использовать образец')).props.onClick();h.render();h.resolveFetch(0,{text:'Stale source text'});await h.settle();assert.equal(h.byLabel('Текст документа').props.value,'Template body with enough text');h.dispose();
 });
 await check('Identity change and unmount reject pending document extraction',async()=>{
  const h=harness('DocumentsView');await h.settle();h.createEditor();h.byLabel('Загрузить документ для распознавания').props.onChange({target:{files:[new File(['a'],'source.txt')]}});await h.settle();h.g.me.user_id='teacher-b';h.setSessionUser('teacher-b');await h.settle();h.resolveFetch(0,{text:'Old account document text'});await h.settle();assert.equal(h.byLabel('Текст документа').props.value,'');h.dispose();
  const unmounted=harness('DocumentsView');await unmounted.settle();unmounted.createEditor();unmounted.byLabel('Загрузить документ для распознавания').props.onChange({target:{files:[new File(['a'],'source.txt')]}});await unmounted.settle();unmounted.dispose();unmounted.resolveFetch(0,{text:'Unmounted document text'});await tick();assert.equal(nodes(unmounted.render(),node=>node.props?.['aria-label']==='Текст документа')[0].props.value,'');
 });
 await check('A late bill dossier response cannot replace the newly selected document',async()=>{
  const h=harness('DocumentsView');h.g.formalDocuments=[formalDocument('doc-a'),formalDocument('doc-b')];h.setProps({focusId:'doc-a'});const old=h.hold('bill_submission_profiles');await h.settle();h.setProps({focusId:'doc-b'});await h.settle();h.openDossier();h.render();assert.equal(h.all('textarea',h.byClass('billProfileForm'))[0].props.value,'Saved profile doc-b revision 1');old.resolve();await h.settle();assert.equal(h.all('textarea',h.byClass('billProfileForm'))[0].props.value,'Saved profile doc-b revision 1');h.dispose();
 });
 await check('Bill profile and committee edits survive background refresh and hydrate after save',async()=>{
  const h=harness('DocumentsView');h.g.formalDocuments=[formalDocument('doc-a')];h.setProps({focusId:'doc-a'});await h.settle();h.openDossier();h.render();
  const note=()=>h.all('textarea',h.byClass('billProfileForm'))[0],legal=()=>h.all('textarea',h.byClass('billCommitteeConclusion'))[0];
  note().props.onChange({target:{value:'Unsaved profile note'}});legal().props.onChange({target:{value:'Unsaved legal opinion'}});h.render();h.setRevision(2);await h.refreshDocument();await h.settle();assert.equal(note().props.value,'Unsaved profile note');assert.equal(legal().props.value,'Unsaved legal opinion');
  h.all('button',h.byClass('billProfileForm'))[0].props.onClick();await h.settle();h.all('button',h.byClass('committeeConclusionActions'))[0].props.onClick();await h.settle();h.remoteProfile('Later saved note');h.remoteLegal('Later saved legal opinion');await h.refreshDocument();await h.settle();assert.equal(note().props.value,'Later saved note');assert.equal(legal().props.value,'Later saved legal opinion');h.dispose();
 });
 await check('Budget preliminary edits survive background refresh and hydrate after save',async()=>{
  const h=harness('DocumentsView');h.g.formalDocuments=[formalDocument('doc-a','budget')];h.setProps({focusId:'doc-a'});await h.settle();const conclusion=()=>h.all('textarea',h.byClass('budgetPreliminary'))[0];conclusion().props.onChange({target:{value:'Unsaved budget conclusion'}});h.render();h.setRevision(2);await h.refreshDocument();await h.settle();assert.equal(conclusion().props.value,'Unsaved budget conclusion');h.all('button',h.byClass('budgetPreliminaryDecision'))[0].props.onClick();await h.settle();h.remoteBudget('Later saved budget conclusion');await h.refreshDocument();await h.settle();assert.equal(conclusion().props.value,'Later saved budget conclusion');h.dispose();
 });
 await check('Failed dossier reads retain accepted fields and report the error',async()=>{
  const h=harness('DocumentsView');h.g.formalDocuments=[formalDocument('doc-a')];h.setProps({focusId:'doc-a'});await h.settle();h.openDossier();h.render();h.fail('bill_package_files');h.setRevision(2);await h.refreshDocument();await h.settle();assert.equal(h.all('textarea',h.byClass('billProfileForm'))[0].props.value,'Saved profile doc-a revision 1');assert.match(h.errors.at(-1),/simulated table failure/);h.dispose();
 });
 if(failures.length)process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
