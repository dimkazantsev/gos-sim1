/* Actual calculator handlers and effects with deterministic deferred transport.
 * No browser, database, storage, or document API is contacted. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),tick=()=>new Promise(resolve=>setImmediate(resolve));
const clone=value=>JSON.parse(JSON.stringify(value));
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};}
function text(node){if(node==null||typeof node==='boolean')return'';if(typeof node!=='object')return String(node);return[node.props?.children].flat(Infinity).map(text).join('');}
function nodes(node,match){if(!node||typeof node!=='object')return[];return[...(match(node)?[node]:[]),...[node.props?.children].flat(Infinity).flatMap(child=>nodes(child,match))];}
function calculation(game='game-a',round=1){
 return{ready:true,issues:[],round,jury_size:2,total_points:100,poll_enabled:true,rows:['a','b'].map((letter,index)=>({candidate_id:game+'-candidate-'+letter,name:game+' candidate '+letter,points:game==='game-a'?50:80,program_pct:50,campaign_pct:50,game_pct:50,poll_pct:20,penalty:0,modifier:0,first_pct:round===2?30+index*10:null,teacher_runoff_pct:50,result_pct:round===2?40+index*5:35}))};
}
function harness(){
 const relative='components/game/PresidentialRulesCalculator.tsx';
 const source=process.env.PRESIDENTIAL_CALCULATOR_SOURCE_REF?cp.execFileSync('git',['show',process.env.PRESIDENTIAL_CALCULATOR_SOURCE_REF+':'+relative],{cwd:root,encoding:'utf8'}):fs.readFileSync(path.join(root,relative),'utf8');
 const parsed=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},reportDiagnostics:true,fileName:relative});
 assert.equal((parsed.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0,'Calculator must parse');
 const slots=[],effects=[],counts=new Map(),holds=new Map(),failures=new Map(),servers=new Map(),ballots=new Map(),calls=[],errors=[],saved=[];
 let cursor=0,dirty=false,tree,latestLoad,disposed=false;
 for(const game of ['game-a','game-b'])for(const round of [1,2])servers.set(game+':'+round,calculation(game,round));
 for(const game of ['game-a','game-b'])ballots.set(game,[{round_no:1,criterion:'program',slot_no:1,candidate_id:game+'-candidate-a'}]);
 const candidateRows=game=>['a','b'].map(letter=>({id:game+'-candidate-'+letter,user_id:game+'-student-'+letter,display_name:game+' candidate '+letter}));
 const g={game:{id:'game-a'},me:{user_id:'teacher-a',kind:'teacher',roster_archived_at:null},teacher:true,setError:error=>errors.push(String(error?.message||error))};
 let props={g,candidates:candidateRows('game-a'),settings:{system_type:'relative',threshold_pct:50,poll_enabled:true,status:'round1',result:{}},onSaved:async()=>{saved.push(props.g.game?.id);}};
 const react={
  useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return[slots[i].value,next=>{const value=typeof next==='function'?next(slots[i].value):next;if(!Object.is(value,slots[i].value)){slots[i].value=value;dirty=true;}}];},
  useRef(initial){const i=cursor++;return(slots[i]??={value:{current:initial}}).value;},
  useMemo(fn){cursor++;return fn();},useCallback(fn){cursor++;return fn;},
  useEffect(effect,deps){const i=cursor++,old=slots[i];if(!old||!deps||deps.some((value,j)=>!Object.is(value,old.deps?.[j]))){slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=effect();});}}
 };
 async function transport(name,args,data,mutate){
  calls.push({name,args:clone(args)});const number=(counts.get(name)||0)+1;counts.set(name,number);
  await holds.get(name+':'+number)?.promise;
  if(failures.has(name))return{data:null,error:{message:failures.get(name)}};
  if(mutate)mutate();return{data,error:null};
 }
 const supabase={
  async rpc(name,args){
   if(name==='get_presidential_rules_calculation')return transport(name,args,clone(servers.get(args.p_game_id+':'+args.p_round_no)));
   return transport(name,args,null,()=>{
    if(name==='set_presidential_rules_input')for(const [key,value] of servers){if(!key.endsWith(':1'))continue;const row=value.rows.find(x=>x.candidate_id===args.p_candidate_id);if(row){row.points=args.p_game_points;row.poll_pct=args.p_poll_pct;}}
    if(name==='set_presidential_jury_size'){const value=servers.get(args.p_game_id+':1');if(value)value.jury_size=args.p_size;}
    if(name==='set_presidential_teacher_ballot'){const list=ballots.get(args.p_game_id)||[],remaining=list.filter(b=>!(b.round_no===args.p_round_no&&b.criterion===args.p_criterion&&b.slot_no===args.p_slot_no));if(args.p_candidate_id)remaining.push({round_no:args.p_round_no,criterion:args.p_criterion,slot_no:args.p_slot_no,candidate_id:args.p_candidate_id});ballots.set(args.p_game_id,remaining);}
   });
  },
  from(table){const filters={};return{select(){return this;},eq(key,value){filters[key]=value;return this;},async then(resolve,reject){try{const data=clone(ballots.get(filters.game_id)||[]);resolve(await transport(table,{...filters},data));}catch(error){reject(error);}}};}
 };
 const jsx=(type,props,key)=>({type,props:props||{},key}),tag=name=>Object.assign(()=>{},{displayName:name});
 function requireFor(name){
  if(name==='react')return react;
  if(name==='react/jsx-runtime')return{jsx,jsxs:jsx,Fragment:'fragment'};
  if(name==='@/lib/supabase')return{supabase};
  if(name==='./useGameTableSync')return{useGameTableSync(game,tables,load,scope){const latest=react.useRef(load);latest.current=load;latestLoad=()=>latest.current();react.useEffect(()=>{if(game)void latest.current();},[game,scope,tables.join('|')]);}};
  if(name.endsWith('.module.css'))return{__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};
  if(name==='../ui/StyledSelect')return{__esModule:true,default:tag('StyledSelect')};
  throw new Error('Unexpected calculator import '+name);
 }
 const module={exports:{}};
 vm.runInNewContext('(function(require,module,exports){'+parsed.outputText+'\n})',{console,Date,Promise,Map,Set,Object,Array,String,Number,Math,Error})(requireFor,module,module.exports);
 function render(){assert.equal(disposed,false,'Cannot render an unmounted fixture');cursor=0;dirty=false;tree=module.exports.default(props);while(effects.length)effects.shift()();return tree;}
 async function settle(){for(let i=0;i<12;i++){render();await tick();if(!dirty)break;}return render();}
 const all=(type,from=tree)=>nodes(from,node=>node.type===type);
 const row=id=>all('article').find(node=>node.key===(id||props.candidates[0].id));
 function field(label,id){const owner=all('label',id?row(id):tree).find(node=>text(node).startsWith(label));assert.ok(owner,'Missing field: '+label);const control=nodes(owner,node=>node.type==='input')[0];assert.ok(control,'Missing input: '+label);return control;}
 function button(label,id){const found=all('button',id?row(id):tree).find(node=>text(node)===label);assert.ok(found,'Missing button: '+label);return found;}
 function select(label,index=0){const found=nodes(tree,node=>node.type?.displayName==='StyledSelect'&&node.props.label===label)[index];assert.ok(found,'Missing select: '+label);return found;}
 function change(label,value,id){field(label,id).props.onChange({target:{value}});render();}
 return{
  get g(){return props.g;},get firstId(){return props.candidates[0].id;},calls,errors,saved,render,settle,all,row,field,button,select,change,text:()=>text(tree),refresh:()=>latestLoad(),
  hold(name){const hold=deferred();holds.set(name+':'+((counts.get(name)||0)+1),hold);return hold;},
  fail(name,message='Simulated calculator rejection'){failures.set(name,message);},recover:name=>failures.delete(name),
  server(patch,game=props.g.game?.id,round=1){const value=servers.get(game+':'+round);Object.assign(value,clone(patch));},
  points(value,game=props.g.game?.id){servers.get(game+':1').rows[0].points=value;},
  setProps(value){props={...props,...value};},
  scope(game,user,teacher=true){props={...props,g:{...props.g,game:{id:game},me:{...props.g.me,user_id:user,kind:teacher?'teacher':'student'},teacher},candidates:candidateRows(game)};},
  round(round){props={...props,settings:{...props.settings,status:round===2?'runoff':'round1',result:round===2?{round:2,candidate_ids:props.candidates.map(x=>x.id)}:{}}};},
  dispose(){disposed=true;for(const slot of slots)slot?.cleanup?.();}
 };
}

async function runChecks(check){
 await check('Actual calculator preserves dirty point, poll and jury-size drafts during refresh',async()=>{
  const h=harness();await h.settle();h.change('Баллы в игре','95',h.firstId);h.change('Доля соцопроса, %','44',h.firstId);h.change('Число голосующих преподавателей','5');h.points(60);h.server({jury_size:3});await h.refresh();await h.settle();assert.equal(h.field('Баллы в игре',h.firstId).props.value,'95');assert.equal(h.field('Доля соцопроса, %',h.firstId).props.value,'44');assert.equal(h.field('Число голосующих преподавателей').props.value,'5');assert.equal(h.button('Зафиксировать итог первого тура').props.disabled,true);h.dispose();
 });
 await check('Actual calculator saves exact candidate inputs and follows later clean server values',async()=>{
  const h=harness();await h.settle();h.change('Баллы в игре','90',h.firstId);h.change('Доля соцопроса, %','35',h.firstId);h.button('Сохранить значения',h.firstId).props.onClick();await h.settle();const call=h.calls.find(x=>x.name==='set_presidential_rules_input');assert.equal(call.args.p_candidate_id,h.firstId);assert.equal(call.args.p_game_points,90);assert.equal(call.args.p_poll_pct,35);assert.equal(h.saved.length,1);h.points(45);await h.refresh();await h.settle();assert.equal(h.field('Баллы в игре',h.firstId).props.value,'45');assert.equal(h.button('Зафиксировать итог первого тура').props.disabled,false);h.dispose();
 });
 await check('Actual calculator keeps newer edits made while a candidate save is pending',async()=>{
  const h=harness();await h.settle();h.change('Баллы в игре','90',h.firstId);const pending=h.hold('set_presidential_rules_input');h.button('Сохранить значения',h.firstId).props.onClick();await tick();h.change('Баллы в игре','99',h.firstId);pending.resolve();await h.settle();h.points(12);await h.refresh();await h.settle();assert.equal(h.field('Баллы в игре',h.firstId).props.value,'99');assert.equal(h.button('Зафиксировать итог первого тура').props.disabled,true);h.dispose();
 });
 await check('Actual calculator ignores late reads from an older refresh and another game',async()=>{
  const h=harness();await h.settle();h.points(60);const old=h.hold('get_presidential_rules_calculation'),first=h.refresh();await tick();h.points(70);await h.refresh();await h.settle();assert.equal(h.field('Баллы в игре',h.firstId).props.value,'70');old.resolve();await first;await h.settle();assert.equal(h.field('Баллы в игре',h.firstId).props.value,'70');
  const other=h.hold('get_presidential_rules_calculation'),pending=h.refresh();await tick();h.scope('game-b','teacher-b');await h.settle();other.resolve();await pending;await h.settle();assert.equal(h.field('Баллы в игре',h.firstId).props.value,'80');assert.doesNotMatch(h.text(),/game-a candidate/);h.dispose();
 });
 await check('Actual calculator ballot selects save the checked round, criterion, slot and candidate',async()=>{
  const h=harness();await h.settle();h.select('Программа и документы').props.onChange(h.firstId.replace(/a$/,'b'));await h.settle();const call=h.calls.find(x=>x.name==='set_presidential_teacher_ballot');assert.equal(call.args.p_game_id,'game-a');assert.equal(call.args.p_round_no,1);assert.equal(call.args.p_criterion,'program');assert.equal(call.args.p_slot_no,1);assert.equal(call.args.p_candidate_id,'game-a-candidate-b');assert.equal(h.select('Программа и документы').props.value,'game-a-candidate-b');h.change('Число голосующих преподавателей','4');h.button('Сохранить состав ППС').props.onClick();await h.settle();h.server({jury_size:3});await h.refresh();await h.settle();assert.equal(h.field('Число голосующих преподавателей').props.value,'3');assert.equal(nodes(h.render(),node=>node.type?.displayName==='StyledSelect').length,6);h.dispose();
 });
 await check('Actual calculator failed reads and writes retain drafts and release busy controls',async()=>{
  const h=harness();await h.settle();h.change('Баллы в игре','91',h.firstId);h.fail('presidential_teacher_ballots','Simulated ballot read failure');h.points(10);await h.refresh();await h.settle();assert.equal(h.field('Баллы в игре',h.firstId).props.value,'91');assert.match(h.errors.at(-1),/ballot read failure/);h.recover('presidential_teacher_ballots');h.fail('set_presidential_rules_input');h.button('Сохранить значения',h.firstId).props.onClick();await h.settle();assert.equal(h.field('Баллы в игре',h.firstId).props.value,'91');assert.equal(h.button('Сохранить значения',h.firstId).props.disabled,false);assert.equal(h.button('Зафиксировать итог первого тура').props.disabled,true);assert.match(h.errors.at(-1),/calculator rejection/);h.dispose();
 });
 await check('Actual calculator double-clicks issue one pending mutation',async()=>{
  const h=harness();await h.settle();h.change('Баллы в игре','92',h.firstId);const hold=h.hold('set_presidential_rules_input'),action=h.button('Сохранить значения',h.firstId).props.onClick;action();action();await tick();assert.equal(h.calls.filter(x=>x.name==='set_presidential_rules_input').length,1);hold.resolve();await h.settle();assert.equal(h.button('Сохранить значения',h.firstId).props.disabled,false);h.dispose();
 });
 await check('Actual calculator old identity handlers cannot start mutations in a changed scope',async()=>{
  const h=harness();await h.settle();h.change('Баллы в игре','93',h.firstId);const action=h.button('Сохранить значения',h.firstId).props.onClick;h.scope('game-a','teacher-b');await h.settle();action();await h.settle();assert.equal(h.calls.filter(x=>x.name==='set_presidential_rules_input').length,0);h.dispose();
 });
 await check('Actual calculator late old-scope completion cannot clear a new scope busy state',async()=>{
  const h=harness();await h.settle();h.change('Баллы в игре','94',h.firstId);const old=h.hold('set_presidential_rules_input');h.button('Сохранить значения',h.firstId).props.onClick();await tick();h.scope('game-b','teacher-b');await h.settle();h.change('Баллы в игре','81',h.firstId);const current=h.hold('set_presidential_rules_input');h.button('Сохранить значения',h.firstId).props.onClick();await tick();h.render();old.resolve();await h.settle();assert.equal(h.button('Сохранить значения',h.firstId).props.disabled,true);assert.equal(h.saved.length,0);current.resolve();await h.settle();assert.equal(h.button('Сохранить значения',h.firstId).props.disabled,false);assert.equal(h.saved.length,1);h.dispose();
 });
 await check('Actual calculator round changes reject a pending first-round refresh after runoff hydration',async()=>{
  const h=harness();await h.settle();h.change('Баллы в игре','96',h.firstId);const old=h.hold('set_presidential_rules_input');h.button('Сохранить значения',h.firstId).props.onClick();await tick();h.round(2);await h.settle();assert.match(h.text(),/Первый тур, без пересчёта30%/);old.resolve();await h.settle();assert.match(h.text(),/Первый тур, без пересчёта30%/);assert.equal(h.saved.length,0,'Old round callback must not refresh the current round');assert.equal(h.button('Зафиксировать итог второго тура').props.disabled,false);h.dispose();
 });
 await check('Actual calculator unmount ignores pending read failures and mutation callbacks',async()=>{
  const reading=harness();await reading.settle();const read=reading.hold('get_presidential_rules_calculation'),pending=reading.refresh();await tick();reading.fail('get_presidential_rules_calculation','Unmounted read failure');reading.dispose();read.resolve();await pending;await tick();assert.equal(reading.errors.length,0);
  const saving=harness();await saving.settle();saving.change('Баллы в игре','97',saving.firstId);const save=saving.hold('set_presidential_rules_input');saving.button('Сохранить значения',saving.firstId).props.onClick();await tick();saving.dispose();save.resolve();await tick();await tick();assert.equal(saving.saved.length,0);assert.equal(saving.errors.length,0);
 });
 await check('Actual calculator students have no controls and historic finished protocols stay read-only',async()=>{
  const h=harness();await h.settle();h.change('Баллы в игре','98',h.firstId);h.scope('game-a','student-a',false);await h.settle();assert.equal(h.render(),null);h.scope('game-a','teacher-b');await h.settle();assert.equal(h.field('Баллы в игре',h.firstId).props.value,'50');h.setProps({settings:{system_type:'relative',threshold_pct:50,poll_enabled:true,status:'finished',result:{winner_id:h.firstId}}});await h.settle();assert.match(h.text(),/исторический результат/);assert.equal(h.all('input').length,0);assert.equal(h.all('button').length,0);h.dispose();
 });
}

module.exports={runChecks};
if(require.main===module){const failed=[];runChecks(async(name,fn)=>{try{await fn();console.log('PASS '+name);}catch(error){failed.push(name);console.error('FAIL '+name+': '+error.stack);}}).then(()=>{if(failed.length)process.exitCode=1;}).catch(error=>{console.error(error);process.exitCode=1;});}
