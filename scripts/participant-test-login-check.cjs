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
function harness(initialSession,changeIdentity=false,signupError=null){
 const values=[],calls=[];let cursor=0,tree;
 const jsx=(type,props)=>({type,props:props||{}});
 const react={
  useState(initial){const index=cursor++;if(!values[index])values[index]={value:initial};
   return [values[index].value,v=>values[index].value=typeof v==='function'?v(values[index].value):v];},
  useEffect(){cursor++;},useMemo(fn){cursor++;return fn()}
 };
 const api={auth:{
  async getSession(){calls.push('getSession');return{data:{session:initialSession},error:null}},
  async signOut({scope}){assert.equal(scope,'local');calls.push('signOut:local');return{error:null}},
  async signInAnonymously(){calls.push('signInAnonymously');return{error:signupError}}
 },async rpc(name,args){
  calls.push('rpc:'+name);
  assert.equal(name,'join_game_with_code');
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
  {window:{location:{search:'',origin:'https://fixture.example'}},URLSearchParams,console,setTimeout})(imports,module,module.exports);
 function render(){cursor=0;tree=module.exports.default();return tree}
 function apply(predicate,value){const entry=nodes(tree,predicate)[0];assert(entry,'Input missing');
  entry.props.onChange({target:{value,checked:value}});render();}
 render();
 apply(n=>n.type==='input'&&n.props.name==='fullName','Новый Участник Тестовый');
 apply(n=>n.type==='input'&&n.props.name==='gameCode','CODE');
 apply(n=>n.type==='input'&&n.props.id==='invite-code','STUDENT');
 apply(n=>n.type==='input'&&n.props.name==='group','Учебная группа');
 if(changeIdentity)apply(n=>n.type==='input'&&n.props.type==='checkbox',true);
 return{calls,async submit(){const form=nodes(tree,n=>n.type==='form')[0];await form.props.onSubmit({preventDefault(){}});render()},
  error(){const e=nodes(tree,n=>n.props?.role==='alert'||n.props?.className==='errorBox');return e.map(label).join(' ')}};
}
(async()=>{
 const teacher={user:{id:'account-teacher',is_anonymous:false}};
 const existing=harness(teacher,false);await existing.submit();
 assert(existing.error().includes('личной учётной записью'),'Explain account collision');
 assert(!existing.calls.includes('signOut:local')&&!existing.calls.some(x=>x.startsWith('rpc:')),'No silent teacher role overwrite');
 const switched=harness(teacher,true);await switched.submit();
 assert.deepEqual(switched.calls.filter(x=>x!=='getSession'),['signOut:local','signInAnonymously','rpc:join_game_with_code','navigate:/game/test-game-uuid']);
 const anonymous=harness({user:{id:'previous-test',is_anonymous:true}},true);await anonymous.submit();
 assert(anonymous.calls.includes('signOut:local')&&anonymous.calls.includes('signInAnonymously'),'New anonymous user needs a different auth uid');
 const first=harness(null,false);await first.submit();
 assert(first.calls.includes('signInAnonymously')&&!first.calls.includes('signOut:local'));
 const denied=harness(teacher,true,{message:'Anonymous sign-ins are disabled'});
 await denied.submit();assert(!denied.calls.some(x=>x.startsWith('rpc:')),'Auth errors must not join a game');
 console.log('PASS student test identity: teacher protection, deliberate local switch, distinct anonymous user, first access and denied signup.');
})().catch(e=>{console.error(e);process.exitCode=1});
