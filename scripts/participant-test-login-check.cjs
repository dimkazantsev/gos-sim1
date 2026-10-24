/* Current component, deterministic Auth/RPC; no production accounts are created. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const source=ts.transpileModule(fs.readFileSync('app/page.tsx','utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}
}).outputText;
const nodes=(v,p)=>!v||typeof v!=='object'?[]:[
 ...(p(v)?[v]:[]),...[v.props?.children].flat(Infinity).flatMap(x=>nodes(x,p))
];
const label=n=>!n||typeof n!=='object'?String(n||''):[n.props?.children].flat(Infinity).map(label).join('');
function harness(initialSession,changeIdentity=false,signupError=null,teacherAccount=true){
 const values=[],calls=[];let cursor=0,tree;
 const jsx=(type,props)=>({type,props:props||{}});
 const react={
  useState(initial){const index=cursor++;if(!values[index])values[index]={value:initial};
   return [values[index].value,v=>values[index].value=typeof v==='function'?v(values[index].value):v];},
  useEffect(){cursor++;},useMemo(fn){cursor++;return fn()}
 };
 const api={from(table){assert.equal(table,'teacher_profiles');return{select:()=>({eq:()=>({maybeSingle:async()=>({data:teacherAccount?{user_id:initialSession?.user?.id}:null,error:null})})})}},auth:{
  async getSession(){calls.push('getSession');return{data:{session:initialSession},error:null}},
  async signOut({scope}){assert.equal(scope,'local');calls.push('signOut:local');return{error:null}},
  async signInAnonymously(){calls.push('signInAnonymously');return{error:signupError}}
 },async rpc(name,args){
  calls.push('rpc:'+name);
  assert.equal(name,'join_game_as_role');assert.equal(args.p_expected_kind,'student');
  assert.equal(args.p_game_code,'CODE');assert.equal(args.p_full_name,'Новый Участник Тестовый');
  return{data:'test-game-uuid',error:null};
 }};
 const imports=name=>{
  if(name==='react')return react;
  if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};
  if(name==='next/navigation')return{useRouter:()=>({push:x=>calls.push('navigate:'+x),replace:()=>{throw Error('Unexpected redirect')}})};
  if(name==='@/lib/supabase')return{supabase:api,createPasswordAuthClient:()=>{}};
  if(name==='@/lib/userError')return{userError:e=>e?.message||String(e)};
  if(name==='@/lib/authTransport')return{isTransientAuthError:()=>false};
  if(name==='@/lib/rememberedGameCodes')return{readRememberedGameCodes:()=>[],rememberGameCode:code=>[code],forgetRememberedGameCode:()=>[]};
  if(name==='lucide-react'||name.startsWith('@/components/'))return new Proxy({}, {get:()=> 'fixture'});
  throw Error('Unexpected import: '+name);
 };
 const module={exports:{}};
 vm.runInNewContext('(function(require,module,exports){'+source+'})',
  {window:{location:{search:'',origin:'https://fixture.example'},sessionStorage:{getItem:()=>null,setItem:()=>{}}},URLSearchParams,console,setTimeout})(imports,module,module.exports);
 function render(){cursor=0;tree=module.exports.default();return tree}
 function apply(predicate,value){const entry=nodes(tree,predicate)[0];assert(entry,'Input missing');
  entry.props.onChange({target:{value,checked:value}});render();}
 render();
 apply(n=>n.type==='input'&&n.props.name==='fullName','Новый Участник Тестовый');
 apply(n=>n.type==='input'&&n.props.name==='gameCode','CODE');
 apply(n=>n.type==='input'&&n.props.id==='invite-code','STUDENT');
 apply(n=>n.type==='input'&&n.props.name==='group','Учебная группа');

 return{calls,async submit(){const form=nodes(tree,n=>n.type==='form')[0];await form.props.onSubmit({preventDefault(){}});render()},
  error(){const e=nodes(tree,n=>n.props?.role==='alert'||n.props?.className==='errorBox');return e.map(label).join(' ')}};
}
(async()=>{
 const teacher={user:{id:'account-teacher',is_anonymous:false}};
 const teacherSwitch=harness(teacher,false);await teacherSwitch.submit();
 assert.deepEqual(teacherSwitch.calls.filter(x=>x!=='getSession'),
   ['signOut:local','signInAnonymously','rpc:join_game_as_role','navigate:/game/test-game-uuid'],
   'Entering participant mode automatically leaves the teacher identity');
 const student=harness({user:{id:'student-confirmed',is_anonymous:false}},false,null,false);
 await student.submit();
 assert(student.calls.includes('rpc:join_game_as_role')&&!student.calls.includes('signOut:local'),
   'A registered student can rejoin as student');
 const first=harness(null,false);await first.submit();
 assert(first.calls.includes('signInAnonymously')&&!first.calls.includes('signOut:local'));
 const anonymous=harness({user:{id:'old-anonymous',is_anonymous:true,user_metadata:{full_name:'Предыдущее Имя'}}},false);
 await anonymous.submit();assert(anonymous.calls.includes('signOut:local'),'Another FIO must create a fresh identity');
 const blocked=harness(teacher,false,{message:'Anonymous sign-ins are disabled'});
 await blocked.submit();assert(!blocked.calls.some(x=>x.startsWith('rpc:')),'Failed identity creation cannot enter a game');
 console.log('PASS role entry: automatic teacher separation, correct student resume, new anonymous accounts and fail-closed auth');
})().catch(e=>{console.error(e);process.exitCode=1});
