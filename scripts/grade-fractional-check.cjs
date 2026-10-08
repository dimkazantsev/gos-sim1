const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(process.argv[2]||path.join(root,'components/game/GradesView.tsx'),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
function harness(score){
 const slots=[],effects=[],channels=[],calls=[],errors=[];let cursor=0,tree,nextScore=score;
 const teacher={user_id:'qa-teacher',kind:'teacher',full_name:'QA teacher'},student={user_id:'qa-student',kind:'student',full_name:'QA student'};
 const g={game:{id:'qa-game'},me:teacher,teacher:true,members:[teacher,student],stages:[{stage_no:2,title:'QA stage',status:'open'}],setError:error=>errors.push(error)};
 const row={id:'qa-assessment',game_id:'qa-game',stage_no:2,user_id:student.user_id,auto_score:score,final_score:null,status:'draft',criterion_law:true,criterion_strategy:true,criterion_debrief:false,public_rationale:'QA penalty',last_run_type:'automatic',last_auto_at:'2026-10-08T00:00:00Z',revision_count:1,teacher_note:null,finalized_at:null};
 const react={useState(initial){const i=cursor++;slots[i]??={value:typeof initial==='function'?initial():initial};return[slots[i].value,next=>{slots[i].value=typeof next==='function'?next(slots[i].value):next;}];},useRef(initial){const i=cursor++;return(slots[i]??={value:{current:initial}}).value;},useMemo(fn){cursor++;return fn();},useEffect(effect,deps){const i=cursor++,old=slots[i];if(!old||!deps||deps.some((v,j)=>!Object.is(v,old.deps?.[j]))){slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=effect();});}}};
 const supabase={auth:{getUser:async()=>({data:{user:{id:teacher.user_id}}})},from(table){return{filters:[],select(){return this;},eq(key,value){this.filters.push([key,value]);return this;},order(){return this;},limit(){return this;},single(){this.one=true;return this;},then(resolve){let data=table==='stage_assessments'?[{...row}]:table==='stage_assessment_runs'?[{id:1,assessment_id:row.id,auto_score:row.auto_score,run_type:'automatic',criterion_law:true,criterion_strategy:true,criterion_debrief:false,created_at:'2026-10-08T00:00:00Z'}]:[];data=data.filter(value=>this.filters.every(([key,v])=>value[key]===v));return Promise.resolve({data:this.one?data[0]??null:data,error:null}).then(resolve);}};},rpc:async(name,args)=>{calls.push({name,args});if(name==='get_stage_assessment_evidence')return{data:{},error:null};if(name==='recalculate_stage_assessment'||name==='recalculate_student_stage'){row.auto_score=nextScore;row.revision_count++;return{data:row.id,error:null};}if(name==='finalize_stage_assessment'){row.final_score=args.p_score;row.status='final';return{data:row.id,error:null};}return{data:null,error:null};},channel(){const ch={handlers:[],on(event,filter,callback){this.handlers.push(callback);return this;},subscribe(){return this;}};channels.push(ch);return ch;},removeChannel:async()=>{}};
 function StyledSelect({label,value,onChange,options}){return React.createElement('select',{'aria-label':label,value,onChange:e=>onChange(e.target.value)},options.map(option=>React.createElement('option',{key:option.value,value:option.value},option.label)));}
 function requireFor(request){
  if(request==='react')return react;if(request==='react/jsx-runtime')return require(request);if(request==='@/lib/supabase')return{supabase};
  if(request==='../ui/StyledSelect')return{__esModule:true,default:StyledSelect};
  if(request==='../ui/useDialog')return{useDialog:()=>({current:null})};
  if(request==='../ui/IconAction')return{IconAction:({label,onClick})=>React.createElement('button',{'aria-label':label,onClick})};
  if(request==='./ScoreFormula')return{__esModule:true,default:()=>null};if(request==='lucide-react')return{ChevronDown:()=>null};
  throw Error('Unexpected grade fixture import '+request);
 }
 const module={exports:{}};vm.runInNewContext('(function(require,module,exports){'+code+'\nmodule.exports.fixtureModal=AssessmentModal;})',{console,Date,Promise,Map,Set,Object,Number,Math})(requireFor,module,module.exports);
 function render(){cursor=0;tree=module.exports.default({g});while(effects.length)effects.shift()();return tree;}
 async function flush(){for(let i=0;i<24;i++){render();await Promise.resolve();await Promise.resolve();await Promise.resolve();}return tree;}
 function nodes(type,node=tree,out=[]){if(!node||typeof node!=='object')return out;if(node.type===type)out.push(node);const children=typeof node.type==='function'?node.type(node.props):node.props?.children;for(const child of [children].flat(Infinity))if(child!==undefined)nodes(type,child,out);return out;}
 function modal(){return nodes(module.exports.fixtureModal)[0];}
 return{g,row,calls,errors,flush,nodes,modal,nextScore:value=>{nextScore=value;},html:()=>renderToStaticMarkup(tree),async open(){await flush();nodes('button').find(x=>x.props['aria-label']?.startsWith('QA student, этап 2,')).props.onClick();await flush();},selector:()=>nodes('select').find(x=>x.props['aria-label']==='Итоговый балл'),approval:()=>nodes('button').find(x=>x.props.children==='Утвердить как итоговую'),refresh(){channels.forEach(ch=>ch.handlers[0]?.());},dispose(){slots.forEach(x=>x?.cleanup?.());}};
}
async function main(){
 const failures=[];async function check(name,fn){try{await fn();console.log('PASS '+name);}catch(error){failures.push(name);console.error('FAIL '+name+': '+error.stack);}}
 await check('Half-point drafts preserve score and require an explicit integer final choice',async()=>{
  for(const score of [.5,1.5,2.5]){
   const h=harness(score);await h.open();assert.equal(h.modal().props.editScore,null);assert.equal(h.selector().props.value,'');assert.match(renderToStaticMarkup(h.selector()),/Выберите итоговый балл/);assert.equal(h.approval().props.disabled,true);
   const hero=h.nodes('div').find(x=>x.props.className?.startsWith('gradeScoreHero'));assert.match(renderToStaticMarkup(hero),/С учётом штрафа/);assert.doesNotMatch(renderToStaticMarkup(hero),/Нет участия/);
   const history=h.nodes('details').find(x=>x.props.className==='gradeRunHistory');assert.match(renderToStaticMarkup(history),/С учётом штрафа/);
   await h.modal().props.finalize();assert.equal(h.calls.filter(x=>x.name==='finalize_stage_assessment').length,0);assert.match(h.errors.at(-1),/итоговый целый балл/);
   h.selector().props.onChange({target:{value:''}});await h.flush();assert.equal(h.modal().props.editScore,null);
   h.selector().props.onChange({target:{value:'2'}});await h.flush();assert.equal(h.approval().props.disabled,false);await h.modal().props.finalize();await h.flush();assert.equal(h.calls.find(x=>x.name==='finalize_stage_assessment').args.p_score,2);assert.equal(h.row.auto_score,score);h.dispose();
  }
 });
 await check('Existing integer scores remain selected including zero',async()=>{
  for(const score of [0,1,2,3]){const h=harness(score);await h.open();assert.equal(h.modal().props.editScore,score);assert.equal(h.selector().props.value,String(score));assert.equal(h.approval().props.disabled,false);h.dispose();}
 });
 await check('Explicit recalculation from integer to fraction resets final choice',async()=>{
  const h=harness(2);await h.open();h.nextScore(2.5);await h.modal().props.recalc();await h.flush();assert.equal(h.modal().props.editScore,null);assert.equal(h.selector().props.value,'');assert.equal(h.approval().props.disabled,true);assert.equal(h.row.auto_score,2.5);h.dispose();
 });
 await check('Realtime fractional draft changes clear stale choices and allow a new integer choice',async()=>{
  const h=harness(2);await h.open();h.row.auto_score=2.5;h.refresh();await h.flush();assert.equal(h.modal().props.editScore,null);h.selector().props.onChange({target:{value:'2'}});await h.flush();assert.equal(h.modal().props.editScore,2);h.row.auto_score=1.5;h.refresh();await h.flush();assert.equal(h.modal().props.editScore,null);h.dispose();
 });
 if(failures.length)process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
