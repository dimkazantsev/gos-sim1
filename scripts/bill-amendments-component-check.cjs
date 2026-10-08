const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const root=path.resolve(__dirname,'..'),file=path.join(root,'components/game/BillAmendmentsPanel.tsx');
const transpile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const amendment=(id='qa-amendment',status='submitted')=>({id,author_id:'qa-author',subject_key:'gd_deputy',old_text:'десять дней',new_text:'двадцать дней',rationale:'Срок достаточен для исполнения.',competence_note:'',status,vote_id:null,review_note:null,can_withdraw:true,stale:false});
const state=(overrides={})=>({document_id:'qa-document',body_text:'Статья 1. Срок составляет десять дней. Статья 2. Отчёт ежеквартально.',status_code:'reading2',can_manage:false,can_submit:true,subjects:['gd_deputy'],pending_count:0,open_vote_id:null,amendments:[],packs:[],...overrides});
function harness(initial=state(),readOnly=false){
 const slots=[],effects=[],calls=[],errors=[],gates=[],responses=[];let cursor=0,tree,server=initial,mutationError=null,refreshes=0,notifications=0;
 const g={game:{id:'qa-game'},me:{user_id:'qa-author',kind:'student'},members:[{user_id:'qa-author',full_name:'QA author'}],setError:e=>errors.push(e),refresh:async()=>{refreshes++;}};
 const doc={id:'qa-document',game_id:'qa-game',workflow_key:'bill',status_code:'reading2',updated_at:'2026-10-08T00:00:00Z'};
 const react={useState(initial){const i=cursor++;slots[i]??={value:typeof initial==='function'?initial():initial};return[slots[i].value,next=>{slots[i].value=typeof next==='function'?next(slots[i].value):next;}];},useRef(initial){const i=cursor++;return(slots[i]??={value:{current:initial}}).value;},useEffect(effect,deps){const i=cursor++,old=slots[i];if(!old||!deps||deps.some((v,j)=>!Object.is(v,old.deps?.[j]))){slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=effect();});}}};
 const supabase={rpc:async(name,args)=>{calls.push({name,args});if(name==='get_bill_amendments'){const queued=responses.shift();return typeof queued==='function'?queued():queued||{data:JSON.parse(JSON.stringify(server)),error:null};}return mutationError?{data:null,error:{message:mutationError}}:{data:name==='open_bill_amendment_vote'?'qa-pack-vote':null,error:null};}};
 const opened=[];function StyledSelect({label,value,onChange,options,disabled}){return React.createElement('select',{'aria-label':label,value,disabled,onChange:e=>onChange(e.target.value)},options.map(o=>React.createElement('option',{key:o.value,value:o.value},o.label)));}
 let context;
 function requireFor(request){
  if(request==='react')return react;if(request==='react/jsx-runtime')return require(request);if(request==='@/lib/supabase')return{supabase};
  if(request==='../ui/StyledSelect')return{__esModule:true,default:StyledSelect};
  if(request==='./useGameTableSync')return{useGameTableSync:()=>{},notifyGameDataRefresh:()=>{notifications++;}};
  if(request==='./StageForms.module.css')return{__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};
  if(request==='./formalInstitutions'){const module={exports:{}};vm.runInContext('(function(require,module,exports){'+transpile(fs.readFileSync(path.join(root,'components/game/formalInstitutions.ts'),'utf8'))+'\n})',context)(requireFor,module,module.exports);return module.exports;}
  throw Error('Unexpected amendment fixture import '+request);
 }
 context=vm.createContext({console,Promise,Error,Object,Number,Array,JSON});const module={exports:{}};vm.runInContext('(function(require,module,exports){'+transpile(fs.readFileSync(file,'utf8'))+'\n})',context)(requireFor,module,module.exports);
 function render(){cursor=0;tree=module.exports.default({g,document:doc,readOnly,onOpenVotes:id=>opened.push(id),onPendingChange:gate=>gates.push(gate)});while(effects.length)effects.shift()();return tree;}
 async function flush(){for(let i=0;i<24;i++){render();await Promise.resolve();await Promise.resolve();await Promise.resolve();}return tree;}
 function nodes(type,node=tree,out=[]){if(!node||typeof node!=='object')return out;if(node.type===type)out.push(node);const children=typeof node.type==='function'?node.type(node.props):node.props?.children;for(const child of [children].flat(Infinity))if(child!==undefined)nodes(type,child,out);return out;}
 function button(label){return nodes('button').find(x=>x.props.children===label);}
 const change=(index,value)=>nodes('textarea')[index].props.onChange({target:{value}});
 return{g,doc,calls,errors,gates,responses,opened,flush,nodes,button,change,html:()=>renderToStaticMarkup(tree),server(value){server=value;},mutationError(value){mutationError=value;},refresh:()=>nodes('button').find(x=>x.props['aria-label']==='Повторить загрузку поправок').props.onClick(),stats:()=>({refreshes,notifications}),dispose(){slots.forEach(x=>x?.cleanup?.());}};
}
async function main(){
 const failures=[];async function check(name,fn){try{await fn();console.log('PASS '+name);}catch(error){failures.push(name);console.error('FAIL '+name+': '+error.stack);}}
 await check('Literal unique quote and rationale gate submission; RPC preserves exact old/new text',async()=>{
  const h=harness();await h.flush();assert.equal(h.button('Внести поправку').props.disabled,true);h.change(0,'Статья');h.change(1,'Глава');h.change(2,'Обоснование уточнения текста.');await h.flush();assert.equal(h.button('Внести поправку').props.disabled,true);
  h.change(0,'десять дней');h.change(1,'двадцать дней');await h.flush();assert.equal(h.button('Внести поправку').props.disabled,false);assert.equal(h.nodes('del')[0].props.children,'десять дней');assert.equal(h.nodes('ins')[0].props.children,'двадцать дней');h.nodes('form')[0].props.onSubmit({preventDefault(){}});await h.flush();const call=h.calls.find(x=>x.name==='submit_bill_amendment');assert.equal(call.args.p_document_id,'qa-document');assert.equal(call.args.p_old_text,'десять дней');assert.equal(call.args.p_new_text,'двадцать дней');assert.equal(h.nodes('textarea')[0].props.value,'');assert.ok(h.stats().refreshes>0&&h.stats().notifications>0);h.dispose();
 });
 await check('Court requires competence explanation, and a failed save preserves the draft',async()=>{
  const h=harness(state({subjects:['ks']}));await h.flush();h.change(0,'десять дней');h.change(1,'двадцать дней');h.change(2,'Содержательное обоснование поправки.');await h.flush();assert.equal(h.button('Внести поправку').props.disabled,true);h.change(3,'Изменение связано с порядком судопроизводства.');await h.flush();assert.equal(h.button('Внести поправку').props.disabled,false);h.mutationError('QA save failed');h.nodes('form')[0].props.onSubmit({preventDefault(){}});await h.flush();assert.equal(h.calls.find(x=>x.name==='submit_bill_amendment').args.p_competence_note,'Изменение связано с порядком судопроизводства.');assert.equal(h.nodes('textarea')[0].props.value,'десять дней');assert.equal(h.errors.at(-1),'QA save failed');h.dispose();
 });
 await check('Manager opens only selected current submitted amendments and read-only mode has no writes',async()=>{
  const rows=[amendment(),{...amendment('qa-stale'),stale:true},amendment('qa-accepted','accepted')];const h=harness(state({can_manage:true,amendments:rows,pending_count:2}));await h.flush();const choices=h.nodes('input').filter(x=>x.props.type==='checkbox');assert.equal(choices.length,2);assert.equal(choices[1].props.disabled,true);choices[0].props.onChange({target:{checked:true}});await h.flush();h.button('Открыть голосование по выбранным поправкам').props.onClick();await h.flush();const ids=h.calls.find(x=>x.name==='open_bill_amendment_vote').args.p_amendment_ids;assert.equal(JSON.stringify(ids),JSON.stringify(['qa-amendment']));assert.equal(h.opened.at(-1),'qa-pack-vote');h.dispose();
  const readonly=harness(state({can_manage:true,amendments:rows}),true);await readonly.flush();assert.equal(readonly.nodes('form').length,0);assert.equal(readonly.nodes('input').length,0);assert.equal(readonly.button('Отозвать поправку'),undefined);assert.equal(readonly.button('Открыть голосование по выбранным поправкам'),undefined);assert.equal(readonly.calls.filter(x=>x.name!=='get_bill_amendments').length,0);readonly.dispose();
 });
 await check('Amendment close controls use the isolated RPC; shared close preserves legacy vote routing',async()=>{
  const h=harness(state({can_manage:true,open_vote_id:'qa-pack-vote',pending_count:1,amendments:[amendment('qa-voting','voting')]}));await h.flush();
  h.button('Завершить голосование по пакету').props.onClick();await h.flush();assert.equal(h.calls.find(x=>x.name==='close_bill_amendment_vote').args.p_vote_id,'qa-pack-vote');assert.equal(h.calls.some(x=>x.name==='close_procedural_vote'),false);h.dispose();
  const source=fs.readFileSync(path.join(root,'components/game/useRepublicGame.ts'),'utf8'),ast=ts.createSourceFile('useRepublicGame.ts',source,ts.ScriptTarget.Latest,true);let close;
  function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='closeVote')close=node;ts.forEachChild(node,visit);}visit(ast);assert.ok(close,'actual shared closeVote function');
  const calls=[],errors=[];let refreshes=0,reject=false;const context=vm.createContext({exports:{},votes:[{id:'qa-pack',procedure_key:'bill_amendments'},{id:'qa-reading',procedure_key:'bill_reading2'},{id:'qa-session',procedure_key:'registered_session'}],supabase:{rpc:async(name,args)=>{calls.push({name,args});return reject?{error:{message:'QA rejected close'}}:{data:{result:'passed'},error:null};}},setError:e=>errors.push(e),refresh:async()=>{refreshes++;}});
  vm.runInContext(transpile(close.getText(ast)+'\nexports.closeVote=closeVote;'),context);
  await context.exports.closeVote('qa-pack','QA amendment');await context.exports.closeVote('qa-reading');await context.exports.closeVote('qa-session');
  assert.deepEqual(calls.map(c=>c.name),['close_bill_amendment_vote','close_procedural_vote','close_procedural_vote']);assert.equal(calls[0].args.p_note,'QA amendment');assert.equal(calls[1].args.p_note,null);assert.equal(refreshes,3);
  reject=true;assert.equal(await context.exports.closeVote('qa-pack'),null);assert.equal(errors.at(-1),'QA rejected close');assert.equal(refreshes,3);
  const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261008150928_bill_second_reading_and_municipal_links.sql'),'utf8');
  assert.doesNotMatch(migration,/create\s+or\s+replace\s+function\s+public\.(?:create_procedural_vote|close_procedural_vote)\s*\(/i);assert.doesNotMatch(migration,/(?:grant|revoke)[^;]*public\.(?:create_procedural_vote|close_procedural_vote)\s*\(/i);
  assert.doesNotMatch(migration,/vote\s*:=\s*public\.create_civic_vote/i);assert.match(migration,/if new\.procedure_key is distinct from 'bill_amendments' then return new;end if;/);
 });
 await check('Load failure removes old actionable rows and reports unchecked gate; older game response is ignored',async()=>{
  const h=harness(state({can_manage:true,amendments:[amendment()],pending_count:1}));await h.flush();assert.equal(h.gates.at(-1).pending,true);h.responses.push({data:null,error:{message:'QA unavailable'}});h.refresh();await h.flush();assert.match(h.html(),/role="alert"/);assert.equal(h.button('Открыть голосование по выбранным поправкам'),undefined);assert.equal(h.gates.at(-1).checked,false);
  let resolveOld;h.responses.push(()=>new Promise(resolve=>{resolveOld=resolve;}));h.refresh();await h.flush();h.doc.id='qa-new-document';h.server(state({document_id:'qa-new-document',amendments:[],pending_count:0}));await h.flush();resolveOld({data:state({amendments:[amendment('qa-obsolete')]}),error:null});await h.flush();assert.equal(h.gates.at(-1).documentId,'qa-new-document');assert.equal(h.gates.at(-1).checked,true);assert.doesNotMatch(h.html(),/qa-obsolete/);h.dispose();
  const mismatched=harness();mismatched.g.game={id:'qa-other-game'};await mismatched.flush();assert.match(mismatched.html(),/текущей игры/);assert.equal(mismatched.calls.length,0);assert.equal(mismatched.gates.at(-1).checked,false);mismatched.dispose();
 });
 await check('Accepted, rejected and no-quorum history are distinct; accepted changes have green styling',async()=>{
  const h=harness(state({amendments:[amendment('qa-accepted','accepted'),amendment('qa-rejected','rejected')],packs:[{id:'qa-pack',vote_id:'qa-vote',status:'no_quorum',result_label:'Нет кворума'}]}));await h.flush();assert.match(h.html(),/data-status="accepted"/);assert.match(h.html(),/Принята и включена в текст/);assert.match(h.html(),/Пакет отклонён|Отклонена/);assert.match(h.html(),/Нет кворума; поправки вновь доступны/);const css=fs.readFileSync(path.join(root,'components/game/StageForms.module.css'),'utf8');assert.match(css,/data-status=accepted[^}]*var\(--gs-green/);h.dispose();
  const docs=fs.readFileSync(path.join(root,'components/game/DocumentsView.tsx'),'utf8');assert.match(docs,/!billAmendmentGate.checked\|\|billAmendmentGate.pending/);assert.match(docs,/disabled=\{busy\|\|readOnly\|\|billSecondReadingBlocked\}/);assert.match(docs,/onOpenVotes=\{onOpenVotes\} readOnly=\{readOnly\} onPendingChange/);
 });
 if(failures.length)process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
