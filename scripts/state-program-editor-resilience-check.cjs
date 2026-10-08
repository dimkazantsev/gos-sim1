/* Actual program loader/editor and money model with deterministic transport.
 * No browser, database, storage or network API is contacted. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),tick=()=>new Promise(resolve=>setImmediate(resolve));
const clone=value=>JSON.parse(JSON.stringify(value));
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};}
function text(node){if(node==null||typeof node==='boolean')return'';if(typeof node!=='object')return String(node);return[node.props?.children].flat(Infinity).map(text).join('');}
function nodes(node,match){if(!node||typeof node!=='object')return[];return[...(match(node)?[node]:[]),...[node.props?.children].flat(Infinity).flatMap(child=>nodes(child,match))];}
function fixture(game='game-a'){
 const program={id:game+'-program',game_id:game,title:'Программа развития '+game,responsible_ministry:'Министерство развития',responsible_minister_id:'minister-a',curator_id:'curator-a',national_goal:'Технологическое лидерство',presidential_priority_id:'priority-a',participants:'Министерство и исполнители',start_date:'2026-01-01',end_date:'2026-12-31',total_budget:'1000000000000000.00',expected_results:'Достигнут измеримый результат',status:'draft',government_vote_id:null,created_by:'teacher-a',created_at:'2026-01-01',updated_at:'2026-01-01',form_version:2,signed_at:null};
 const components=[1,2,3].map((n,i)=>({id:game+'-component-'+n,program_id:program.id,game_id:game,direction_no:n,direction_title:'Направление '+n,component_kind:'project',title:'Мероприятие '+n,goal_text:'Цель мероприятия '+n,start_date:'2026-01-01',end_date:'2026-12-31',budget:['999999999999999.99','0.01','0.00'][i]}));
 return{state_programs:[program],state_program_goals:[{id:game+'-goal',program_id:program.id,game_id:game,goal_text:'Цель программы',indicator_name:'Число результатов',unit:'ед.',baseline_value:1,target_value:2,target_year:2026}],state_program_components:components,state_program_expenses:[{id:game+'-expense-1',game_id:game,program_id:program.id,component_id:components[0].id,indicator_name:'Результат 1',justification:'Подробное обоснование первого расхода',budget_year:2026,amount:'999999999999999.99',position:1},{id:game+'-expense-2',game_id:game,program_id:program.id,component_id:components[1].id,indicator_name:'Результат 2',justification:'Подробное обоснование второго расхода',budget_year:2026,amount:'0.01',position:2}],presidential_addresses:[{id:'address-a',game_id:game,title:'Опубликованное послание',body_text:'Содержание опубликованного послания Президента',video_url:null,status:'published',updated_at:'2026-01-01'}],presidential_priorities:[{id:'priority-a',address_id:'address-a',game_id:game,priority_no:1,title:'Приоритет развития',description:null,national_goal:'Технологическое лидерство'}],state_program_budget_years:[{id:game+'-year',program_id:program.id,game_id:game,budget_year:2026,amount:'1000000000000000.00'}]};
}
function harness(component='StateProgramEditor',initialProps={}){
 const slots=[],effects=[],counts=new Map(),holds=new Map(),failures=new Map(),tables=new Map(),calls=[],errors=[],saved=[],refreshes=[],cache=new Map();
 let cursor=0,dirty=false,tree,latestLoad,disposed=false,uuid=0,revision=0;
 for(const game of ['game-a','game-b'])for(const [name,rows] of Object.entries(fixture(game)))tables.set(game+':'+name,rows);
 const g={game:{id:'game-a'},me:{user_id:'teacher-a',kind:'teacher',role_title:'Преподаватель',roster_archived_at:null},teacher:true,members:[{user_id:'minister-a',full_name:'Министр',kind:'student',roster_archived_at:null},{user_id:'curator-a',full_name:'Куратор',kind:'student',roster_archived_at:null},{user_id:'archived-a',full_name:'Выбывший',kind:'student',roster_archived_at:'2026-01-01'}],officeAssignments:[],votes:[],setError:error=>errors.push(String(error?.message||error)),refresh:async()=>{refreshes.push('refresh');}};
 function data(game){return{program:clone(tables.get(game+':state_programs')[0]),goals:clone(tables.get(game+':state_program_goals')),components:clone(tables.get(game+':state_program_components')),expenses:clone(tables.get(game+':state_program_expenses')),priorities:clone(tables.get(game+':presidential_priorities'))};}
 let props=component==='StateProgramLab'?{g}:{g,...data('game-a'),editable:true,...initialProps};
 if(component==='StateProgramEditor')props.onSaved=async id=>{saved.push(id);hydrate();};
 const react={
  useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return[slots[i].value,next=>{const value=typeof next==='function'?next(slots[i].value):next;if(!Object.is(value,slots[i].value)){slots[i].value=value;dirty=true;}}];},
  useRef(initial){const i=cursor++;return(slots[i]??={value:{current:initial}}).value;},
  useEffect(effect,deps){const i=cursor++,old=slots[i];if(!old||!deps||deps.some((value,j)=>!Object.is(value,old.deps?.[j]))){slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=effect();});}}
 };
 const moneyColumn={state_programs:'total_budget',state_program_components:'budget',state_program_expenses:'amount',state_program_budget_years:'amount'};
 async function transport(name,args,value,mutate){calls.push({name,args:clone(args)});const count=(counts.get(name)||0)+1;counts.set(name,count);await holds.get(name+':'+count)?.promise;if(failures.has(name))return{data:null,error:{message:failures.get(name)}};if(mutate)mutate();return{data:value,error:null};}
 function updateSaved(args){
  const game=args.p_game_id,payload=clone(args.p_payload),existing=tables.get(game+':state_programs')[0],id=args.p_program_id||game+'-created-program',serial=++revision;
  const rows=payload.components.map((row,index)=>({...row,id:game+'-saved-component-'+serial+'-'+index,game_id:game,program_id:id,budget:'0.00'}));
  const model=loadModule('stateProgramModel');
  const expenses=payload.expenses.map((row,index)=>{const item={...row,id:game+'-saved-expense-'+serial+'-'+index,game_id:game,program_id:id,component_id:rows[row.component_no-1].id,position:index+1};delete item.component_no;return item;});
  const amountText=cents=>(cents/100n).toString()+'.'+(cents%100n).toString().padStart(2,'0');
  for(const row of rows)row.budget=amountText(expenses.filter(x=>x.component_id===row.id).reduce((sum,x)=>sum+model.expenseKopecks(x.amount),0n));
  const total=amountText(expenses.reduce((sum,x)=>sum+model.expenseKopecks(x.amount),0n));
  tables.set(game+':state_programs',[{...existing,...payload,id,total_budget:total,status:args.p_confirm?'minister_review':'draft',form_version:2,updated_at:'revision-'+serial}]);
  tables.set(game+':state_program_goals',payload.goals.map((row,index)=>({...row,id:game+'-saved-goal-'+serial+'-'+index,game_id:game,program_id:id})));
  tables.set(game+':state_program_components',rows);tables.set(game+':state_program_expenses',expenses);
 }
 const supabase={
  from(table){const filters={},orders=[];let projection='';return{select(value){projection=value;return this;},eq(key,value){filters[key]=value;return this;},order(key){orders.push(key);return this;},async then(resolve,reject){try{const game=filters.game_id||props.g.game.id;let rows=clone(tables.get(game+':'+table)||[]);const column=moneyColumn[table];if(column)rows=rows.map(row=>{const value=row[column];return{...row,[column]:Number(value),...(projection.includes(column+'_text:'+column+'::text')?{[column+'_text']:String(value)}:{})};});resolve(await transport(table,{...filters,projection,orders},rows));}catch(error){reject(error);}}};},
  async rpc(name,args){if(name==='get_state_program_readiness')return transport(name,args,{ready:true,issues:[],goals:1,directions:3,components:3,budget_years:1,expected_budget_years:1});return transport(name,args,args.p_program_id||args.p_game_id+'-created-program',()=>{if(name==='save_state_program_draft')updateSaved(args);if(name==='save_presidential_address'){const rows=tables.get(args.p_game_id+':presidential_addresses');rows[0]={...rows[0],title:args.p_title,body_text:args.p_body,video_url:args.p_video_url};}});}
 };
 const jsx=(type,props,key)=>({type,props:props||{},key}),tag=name=>Object.assign(()=>{},{displayName:name});
 function requireFor(name){
  if(name==='react')return react;if(name==='react/jsx-runtime')return{jsx,jsxs:jsx,Fragment:'fragment'};if(name==='@/lib/supabase')return{supabase};
  if(name==='./useGameTableSync')return{useGameTableSync(game,tables,load,scope){const latest=react.useRef(load);latest.current=load;latestLoad=()=>latest.current();react.useEffect(()=>{if(game)void latest.current();},[game,scope,tables.join('|')]);}};
  if(name==='./stateProgramModel'||name==='./stageRoles')return loadModule(name.slice(2));
  if(name.endsWith('.module.css'))return{__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};
  if(name==='../ui/StyledSelect'||name==='../ui/StageModuleHeader'||name==='./StateProgramEditor')return{__esModule:true,default:tag(path.basename(name))};
  if(name==='../ui/IconAction')return{IconAction:tag('IconAction')};throw new Error('Unexpected program import '+name);
 }
 function loadModule(name){
  if(cache.has(name))return cache.get(name);const relative='components/game/'+name+(name==='stateProgramModel'||name==='stageRoles'?'.ts':'.tsx'),ref=process.env[name==='StateProgramEditor'?'STATE_PROGRAM_EDITOR_SOURCE_REF':'STATE_PROGRAM_LAB_SOURCE_REF'];
  const source=ref&&(name==='StateProgramEditor'||name==='StateProgramLab')?cp.execFileSync('git',['show',ref+':'+relative],{cwd:root,encoding:'utf8'}):fs.readFileSync(path.join(root,relative),'utf8');
  const parsed=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},reportDiagnostics:true,fileName:relative});assert.equal((parsed.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0,name+' must parse');
  const module={exports:{}};vm.runInNewContext('(function(require,module,exports){'+parsed.outputText+'\n})',{console,Date,Promise,Map,Set,Object,Array,String,Number,BigInt,Math,Error,crypto:{randomUUID:()=> 'draft-row-'+(++uuid)}})(requireFor,module,module.exports);cache.set(name,module.exports);return module.exports;
 }
 const actual=loadModule(component).default;
 function render(){assert.equal(disposed,false,'Cannot render an unmounted fixture');cursor=0;dirty=false;tree=actual(props);while(effects.length)effects.shift()();return tree;}
 async function settle(){for(let i=0;i<15;i++){render();await tick();if(!dirty)break;}return render();}
 const all=(type,from=tree)=>nodes(from,node=>node.type===type);
 function field(label,index=0){let controls=nodes(tree,node=>(node.type==='input'||node.type==='textarea')&&node.props['aria-label']===label);if(!controls.length){const labels=all('label').filter(node=>text(node).startsWith(label));controls=labels.flatMap(owner=>nodes(owner,node=>node.type==='input'||node.type==='textarea'));}assert.ok(controls[index],'Missing field: '+label);return controls[index];}
 function button(label){const found=all('button').find(node=>text(node)===label);assert.ok(found,'Missing button: '+label);return found;}
 function select(label,index=0){const found=nodes(tree,node=>node.type?.displayName==='StyledSelect'&&node.props.label===label)[index];assert.ok(found,'Missing select: '+label);return found;}
 function change(label,value,index){field(label,index).props.onChange({target:{value}});render();}
 function hydrate(){if(component==='StateProgramEditor'){const next=data(props.g.game.id);props={...props,...next,editable:['draft','revision'].includes(next.program.status)&&!next.program.signed_at};}}
 return{calls,errors,saved,refreshes,render,settle,all,field,button,select,change,model:loadModule('stateProgramModel'),text:()=>text(tree),refresh:()=>latestLoad(),hydrate,
  get props(){return props;},editor:()=>nodes(tree,node=>node.type?.displayName==='StateProgramEditor')[0],
  setProps(value){props={...props,...value};},
  scope(game,user='teacher-b',teacher=true){const nextG={...props.g,game:{id:game},me:{...props.g.me,user_id:user,kind:teacher?'teacher':'student'},teacher};props=component==='StateProgramEditor'?{...props,g:nextG,...data(game),editable:teacher}:{g:nextG};},
  patch(table,patch,index=0,game=props.g.game.id){const rows=tables.get(game+':'+table);rows[index]={...rows[index],...patch};},
  hold(name){const hold=deferred();holds.set(name+':'+((counts.get(name)||0)+1),hold);return hold;},fail(name,message='Simulated program rejection'){failures.set(name,message);},recover:name=>failures.delete(name),
  dispose(){disposed=true;for(const slot of slots)slot?.cleanup?.();}
 };
}
async function runChecks(check){
 await check('Actual Lab transport preserves large cents through editor reload and confirmation',async()=>{
  assert.equal(Number('999999999999999.99'),1000000000000000,'Fixture must expose ordinary JSON precision loss');const lab=harness('StateProgramLab');await lab.settle();const loaded=lab.editor();assert.ok(loaded,'Loaded editor props');assert.equal(loaded.props.expenses[0].amount,'999999999999999.99');assert.equal(loaded.props.program.total_budget,'1000000000000000.00');assert.equal(loaded.props.components[0].budget,'999999999999999.99');
  const editor=harness('StateProgramEditor',loaded.props);await editor.settle();assert.equal(editor.field('Сумма расхода 1, рубли').props.value,'999999999999999.99');assert.match(editor.text(),/1[\s\u00a0]000[\s\u00a0]000[\s\u00a0]000[\s\u00a0]000[\s\u00a0]000,00 ₽/);editor.button('Сохранить всю форму').props.onClick();await editor.settle();assert.equal(editor.field('Сумма расхода 1, рубли').props.value,'999999999999999.99');editor.button('Подтвердить программу и направить министру').props.onClick();await editor.settle();const calls=editor.calls.filter(x=>x.name==='save_state_program_draft');assert.equal(calls.length,2);assert.equal(calls[1].args.p_confirm,true);assert.equal(calls[1].args.p_payload.expenses[0].amount,'999999999999999.99');assert.equal(calls[1].args.p_payload.expenses[1].amount,'0.01');assert.equal('total_budget'in calls[1].args.p_payload,false);editor.dispose();lab.dispose();
 });
 await check('Actual Lab annual and legacy passport funding retains exact text formatting',async()=>{
  const lab=harness('StateProgramLab');lab.patch('state_programs',{form_version:1,total_budget:'987654321012345.67'});lab.patch('state_program_budget_years',{amount:'987654321012345.67'});await lab.settle();assert.equal(lab.editor().props.program.total_budget,'987654321012345.67');assert.match(lab.text(),/987[\s\u00a0]654[\s\u00a0]321[\s\u00a0]012[\s\u00a0]345,67 ₽/);for(const [table,column] of [['state_programs','total_budget'],['state_program_components','budget'],['state_program_expenses','amount'],['state_program_budget_years','amount']])assert.ok(lab.calls.find(x=>x.name===table).args.projection.includes(column+'_text:'+column+'::text'));lab.dispose();
 });
 await check('Actual editor save sends the full linked form and exact canonical decimal strings',async()=>{
  const h=harness();await h.settle();h.change('Сумма расхода 2, рубли',' 123,45 ');h.select('Ответственный министр').props.onChange('curator-a');h.render();h.button('Сохранить всю форму').props.onClick();await h.settle();const payload=h.calls.find(x=>x.name==='save_state_program_draft').args;assert.equal(payload.p_game_id,'game-a');assert.equal(payload.p_program_id,'game-a-program');assert.equal(payload.p_confirm,false);assert.equal(payload.p_payload.responsible_minister_id,'curator-a');assert.equal(payload.p_payload.goals[0].target_year,'2026');assert.equal(payload.p_payload.components.length,3);assert.equal(payload.p_payload.expenses[1].component_no,2);assert.equal(payload.p_payload.expenses[1].amount,'123.45');assert.equal('key'in payload.p_payload.expenses[0],false);assert.equal(h.saved.length,1);h.dispose();
 });
 await check('Actual editor dirty passport, goal, component and expense rows survive server refresh',async()=>{
  const h=harness();await h.settle();h.change('Название программы','Мой черновик программы');h.change('Целевое значение','8');h.change('Название элемента','Мой черновик мероприятия');h.change('Сумма расхода 1, рубли','17.31');h.patch('state_programs',{title:'Внешняя новая версия'});h.hydrate();await h.settle();assert.equal(h.field('Название программы').props.value,'Мой черновик программы');assert.equal(h.field('Целевое значение').props.value,'8');assert.equal(h.field('Название элемента').props.value,'Мой черновик мероприятия');assert.equal(h.field('Сумма расхода 1, рубли').props.value,'17.31');h.dispose();
 });
 await check('Actual editor clean saved forms follow later authoritative values',async()=>{
  const h=harness();await h.settle();h.change('Название программы','Сохранённая программа');h.button('Сохранить всю форму').props.onClick();await h.settle();h.patch('state_programs',{title:'Поздняя сохранённая версия'});h.patch('state_program_expenses',{amount:'121.07'});h.hydrate();await h.settle();assert.equal(h.field('Название программы').props.value,'Поздняя сохранённая версия');assert.equal(h.field('Сумма расхода 1, рубли').props.value,'121.07');h.dispose();
 });
 await check('Actual editor newer edits during a pending save remain drafts after its reload',async()=>{
  const h=harness();await h.settle();h.change('Название программы','Сохраняемая версия');const pending=h.hold('save_state_program_draft');h.button('Сохранить всю форму').props.onClick();await tick();h.change('Название программы','Новый несохранённый текст');h.change('Сумма расхода 1, рубли','29.13');h.button('Добавить показатель').props.onClick();h.render();pending.resolve();await h.settle();assert.equal(h.field('Название программы').props.value,'Новый несохранённый текст');assert.equal(h.field('Сумма расхода 1, рубли').props.value,'29.13');assert.equal(h.all('textarea').filter(x=>x.props.value==='').length,1,'New blank goal must remain');h.patch('state_programs',{title:'Внешняя версия'});h.hydrate();await h.settle();assert.equal(h.field('Название программы').props.value,'Новый несохранённый текст');h.dispose();
 });
 await check('Actual editor duplicate retained clicks issue one pending RPC',async()=>{
  const h=harness();await h.settle();const pending=h.hold('save_state_program_draft'),action=h.button('Сохранить всю форму').props.onClick;action();action();await tick();assert.equal(h.calls.filter(x=>x.name==='save_state_program_draft').length,1);pending.resolve();await h.settle();assert.equal(h.button('Сохранить всю форму').props.disabled,false);h.dispose();
 });
 await check('Actual editor old identity save and input handlers cannot mutate the current form',async()=>{
  const h=harness();await h.settle();h.change('Название программы','Старый личный черновик');const action=h.button('Сохранить всю форму').props.onClick,input=h.field('Название программы').props.onChange;h.scope('game-b');await h.settle();assert.equal(h.field('Название программы').props.value,'Программа развития game-b');input({target:{value:'Старый обработчик'}});action();await h.settle();assert.equal(h.calls.filter(x=>x.name==='save_state_program_draft').length,0);assert.equal(h.field('Название программы').props.value,'Программа развития game-b');h.dispose();
 });
 await check('Actual editor signed or read-only phase invalidates retained save handlers',async()=>{
  const h=harness();await h.settle();const action=h.button('Сохранить всю форму').props.onClick;h.setProps({program:{...h.props.program,status:'ready',signed_at:'2026-10-08T00:00:00Z'},editable:false});await h.settle();action();await h.settle();assert.equal(h.calls.filter(x=>x.name==='save_state_program_draft').length,0);assert.equal(h.all('button').length,0);assert.equal(h.all('fieldset')[0].props.disabled,true);h.dispose();
 });
 await check('Actual editor late old-scope success cannot clear current busy controls or refresh it',async()=>{
  const h=harness();await h.settle();const old=h.hold('save_state_program_draft');h.button('Сохранить всю форму').props.onClick();await tick();h.scope('game-b');await h.settle();assert.equal(h.button('Сохранить всю форму').props.disabled,false);h.change('Название программы','Текущий черновик другой игры');const current=h.hold('save_state_program_draft');h.button('Сохранить всю форму').props.onClick();await tick();h.render();old.resolve();await h.settle();assert.equal(h.button('Сохранить всю форму').props.disabled,true);assert.equal(h.saved.length,0);current.resolve();await h.settle();assert.equal(h.saved.length,1);assert.equal(h.field('Название программы').props.value,'Текущий черновик другой игры');h.dispose();
 });
 await check('Actual editor RPC errors retain all draft values and release busy state',async()=>{
  const h=harness();await h.settle();h.change('Название программы','Несохранённая программа');h.change('Сумма расхода 1, рубли','48.17');h.fail('save_state_program_draft','Simulated program permission rejection');h.button('Подтвердить программу и направить министру').props.onClick();await h.settle();assert.equal(h.field('Название программы').props.value,'Несохранённая программа');assert.equal(h.field('Сумма расхода 1, рубли').props.value,'48.17');assert.equal(h.button('Сохранить всю форму').props.disabled,false);assert.equal(h.saved.length,0);assert.match(h.errors.at(-1),/permission rejection/);h.dispose();
 });
 await check('Actual editor unmount rejects pending success, errors and retained mutation handlers',async()=>{
  for(const fail of [false,true]){const h=harness();await h.settle();const action=h.button('Сохранить всю форму').props.onClick,pending=h.hold('save_state_program_draft');action();await tick();if(fail)h.fail('save_state_program_draft','Unmounted save rejection');h.dispose();pending.resolve();await tick();await tick();action();await tick();assert.equal(h.saved.length,0);assert.equal(h.errors.length,0);assert.equal(h.calls.filter(x=>x.name==='save_state_program_draft').length,1);}
 });
 await check('Actual editor rejects invalid decimals and expenses detached from a filled component',async()=>{
  for(const amount of ['NaN','Infinity','1.001','-1','1e3']){const h=harness();await h.settle();h.change('Сумма расхода 1, рубли',amount);h.button('Сохранить всю форму').props.onClick();await h.settle();assert.equal(h.calls.length,0,amount);assert.match(h.errors.at(-1),/двух знаков/);h.dispose();}const h=harness();await h.settle();h.select('Мероприятие расхода 1').props.onChange('');h.render();h.button('Сохранить всю форму').props.onClick();await h.settle();assert.equal(h.calls.length,0);assert.match(h.errors.at(-1),/Свяжите каждый расход/);h.dispose();
 });
 await check('Actual editor legacy read-only budgets stay visible without structured expense rows',async()=>{
  const h=harness();h.setProps({program:{...h.props.program,form_version:1,status:'adopted',total_budget:'987654321012345.67'},components:h.props.components.map((x,i)=>({...x,budget:i===0?'123456789012345.67':'0.00'})),expenses:[],editable:false});await h.settle();assert.match(h.text(),/123[\s\u00a0]456[\s\u00a0]789[\s\u00a0]012[\s\u00a0]345,67 ₽/);assert.match(h.text(),/987[\s\u00a0]654[\s\u00a0]321[\s\u00a0]012[\s\u00a0]345,67 ₽/);assert.equal(h.all('button').length,0);assert.equal(h.all('fieldset')[0].props.disabled,true);assert.ok(!h.select('Ответственный министр').props.options.some(x=>x.value==='archived-a'));h.dispose();
 });
 await check('Actual Lab ignores out-of-order or foreign-scope reads and retains accepted data on failure',async()=>{
  const h=harness('StateProgramLab');await h.settle();const old=h.hold('state_program_expenses'),reading=h.refresh();await tick();h.patch('state_program_expenses',{amount:'333.07'});await h.refresh();await h.settle();assert.equal(h.editor().props.expenses[0].amount,'333.07');old.resolve();await reading;await h.settle();assert.equal(h.editor().props.expenses[0].amount,'333.07');const other=h.hold('state_program_expenses'),foreign=h.refresh();await tick();h.scope('game-b');await h.settle();other.resolve();await foreign;await h.settle();assert.equal(h.editor().props.program.game_id,'game-b');h.fail('state_program_goals','Simulated program read rejection');h.patch('state_program_expenses',{amount:'444.09'});await h.refresh();await h.settle();assert.equal(h.editor().props.expenses[0].amount,'999999999999999.99');assert.match(h.errors.at(-1),/read rejection/);h.dispose();
 });
 await check('Actual Lab approval duplicate clicks issue one pending RPC',async()=>{
  const h=harness('StateProgramLab');h.patch('state_programs',{status:'pm_review'});await h.settle();const pending=h.hold('advance_state_program'),action=h.button('Подписать и опубликовать программу').props.onClick;action();action();await tick();const count=h.calls.filter(x=>x.name==='advance_state_program').length;pending.resolve();await h.settle();assert.equal(count,1);h.dispose();
 });
 await check('Actual Lab old identity approval handlers cannot start mutations',async()=>{
  const h=harness('StateProgramLab');h.patch('state_programs',{status:'pm_review'});await h.settle();const action=h.button('Подписать и опубликовать программу').props.onClick;h.scope('game-b');await h.settle();action();await h.settle();assert.equal(h.calls.filter(x=>x.name==='advance_state_program').length,0);h.dispose();
 });
 await check('Actual Lab address saves retain newer text entered before the pending save settles',async()=>{
  const h=harness('StateProgramLab');h.patch('presidential_addresses',{status:'draft',title:'Черновик послания'});await h.settle();h.change('Текст послания','Сохраняемая версия текста послания');const pending=h.hold('save_presidential_address');h.button('Сохранить послание').props.onClick();await tick();h.change('Текст послания','Более новый несохранённый текст послания');pending.resolve();await h.settle();assert.equal(h.field('Текст послания').props.value,'Более новый несохранённый текст послания');h.dispose();
 });
 await check('Actual Lab scope changes during post-save load cannot refresh the old Republic context',async()=>{
  const h=harness('StateProgramLab');h.patch('state_programs',{status:'pm_review'});await h.settle();const pending=h.hold('state_program_expenses');h.button('Подписать и опубликовать программу').props.onClick();await tick();h.scope('game-b');await h.settle();pending.resolve();await h.settle();assert.equal(h.refreshes.length,0);h.dispose();
 });
}
module.exports={runChecks};
if(require.main===module){const failed=[];let passed=0;runChecks(async(name,fn)=>{try{await fn();passed++;console.log('PASS '+name);}catch(error){failed.push(name);console.error('FAIL '+name+': '+error.stack);}}).then(()=>{console.log('Program resilience checks: '+passed+' passed, '+failed.length+' failed');if(failed.length)process.exitCode=1;}).catch(error=>{console.error(error);process.exitCode=1;});}
