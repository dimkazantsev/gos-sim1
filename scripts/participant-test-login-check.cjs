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
function harness(initialSession,changeIdentity=false,signupError=null,teacherAccount=true,returningMemberships=[]){
 const values=[],calls=[];let cursor=0,tree;
 const jsx=(type,props)=>({type,props:props||{}});
 const react={
  useState(initial){const index=cursor++;if(!values[index])values[index]={value:initial};
   return [values[index].value,v=>values[index].value=typeof v==='function'?v(values[index].value):v];},
  useEffect(){cursor++;},useMemo(fn){cursor++;return fn()},
  useRef(initial){const i=cursor++;if(!values[i])values[i]={value:{current:initial}};return values[i].value}
 };
 const api={from(table){calls.push(table);
  if(table==='teacher_profiles')return{select:()=>({eq:()=>({maybeSingle:async()=>({data:teacherAccount?{user_id:initialSession?.user?.id}:null,error:null})})})};
  assert.equal(table,'game_members');
  return{select(fields){assert(fields.includes('games!inner'));return this},
   eq(field,value){assert.equal(field,'user_id');assert.equal(value,initialSession?.user?.id);return this},
   in(field,roles){assert.equal(field,'kind');assert.deepEqual(roles,['student','observer']);return this},
   is(field,value){assert.equal(field,'roster_archived_at');assert.equal(value,null);return this},
   async limit(n){assert(n>=2&&n<=20);return{data:returningMemberships,error:null}}};
 },auth:{
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
  async resume(){const button=nodes(tree,n=>n.type==='button'&&String(n.props.className||'').includes('entryResumeButton'))[0];assert(button,'Resume must be discoverable without login details');await button.props.onClick();render()},
  choices(){return nodes(tree,n=>n.type==='button'&&String(n.props.className||'')==='entryPersonalSwitch').filter(n=>label(n).includes('·')).map(n=>({text:label(n),click:()=>{n.props.onClick();render()}}))},
  error(){const e=nodes(tree,n=>n.props?.role==='alert'||n.props?.className==='errorBox');return e.map(label).join(' ')}};
}
(async()=>{
 const teacher={user:{id:'account-teacher',is_anonymous:false}};
 const teacherSwitch=harness(teacher,false);await teacherSwitch.submit();
 assert.deepEqual(teacherSwitch.calls.filter(x=>x!=='getSession'),
   ['teacher_profiles','signOut:local','signInAnonymously','rpc:join_game_as_role','navigate:/game/test-game-uuid'],
   'Entering participant mode automatically leaves the teacher identity');
 const student=harness({user:{id:'student-confirmed',is_anonymous:false}},false,null,false);
 await student.submit();
 assert(student.calls.includes('rpc:join_game_as_role')&&!student.calls.includes('signOut:local'),
   'A registered student can rejoin as student');
 const twoTaps=harness(null,false);
 await Promise.all([twoTaps.submit(),twoTaps.submit()]);
 assert.equal(twoTaps.calls.filter(c=>c==='signInAnonymously').length,1,'Two fast clicks must not create two anonymous accounts');
 assert.equal(twoTaps.calls.filter(c=>c==='rpc:join_game_as_role').length,1,'Two fast clicks must not join the game twice');
 const first=harness(null,false);await first.submit();
 assert(first.calls.includes('signInAnonymously')&&!first.calls.includes('signOut:local'));
 const anonymous=harness({user:{id:'old-anonymous',is_anonymous:true,user_metadata:{full_name:'Предыдущее Имя'}}},false);
 await anonymous.submit();assert(anonymous.calls.includes('signOut:local'),'Another FIO must create a fresh identity');
 assert.equal(anonymous.calls.filter(c=>c==='teacher_profiles').length,0,'Returning anonymous students must not read protected teacher profiles');
 const sameName=harness({user:{id:'old-anonymous',is_anonymous:true,user_metadata:{full_name:'Новый Участник Тестовый'}}},false);
 await sameName.submit();
 assert.equal(sameName.calls.filter(c=>c==='teacher_profiles').length,0,'One reusable anonymous session eliminates the extra HTTP read');
 assert.equal(sameName.calls.filter(c=>c==='signInAnonymously').length,0,'Rejoining the same browser does not create another anonymous account');
 assert.equal(sameName.calls.filter(c=>c==='rpc:join_game_as_role').length,1);
 const prior={game_id:'prior-game-uuid',kind:'student',games:[{title:'Республика',game_code:'OLD'}]};
 const returningAnonymous=harness({user:{id:'return-anon',is_anonymous:true,user_metadata:{full_name:'Другое имя'}}},false,null,false,[prior]);
 await returningAnonymous.resume();
 assert.deepEqual(returningAnonymous.calls,['getSession','game_members','navigate:/game/prior-game-uuid'],
  'Returning anonymous user goes directly to their game with no signup, invite or password');
 const returningRegistered=harness({user:{id:'return-confirmed',is_anonymous:false}},false,null,false,[prior]);
 await returningRegistered.resume();
 assert.deepEqual(returningRegistered.calls,['getSession','teacher_profiles','game_members','navigate:/game/prior-game-uuid'],
  'Registered participant keeps their identity and skips password when current session is valid');
 const returningTeacher=harness(teacher,false,null,true,[prior]);
 await returningTeacher.resume();
 assert(!returningTeacher.calls.includes('game_members')&&!returningTeacher.calls.some(x=>x.startsWith('navigate:/game/')),
  'Protected teacher account cannot use the student resume shortcut');
 const noSession=harness(null,false,null,false,[prior]);
 await noSession.resume();
 assert(!noSession.calls.includes('game_members')&&!noSession.calls.includes('signInAnonymously'),
  'A missing local session cannot impersonate a known participant');
 const blockedMember=harness({user:{id:'blocked-student',is_anonymous:true}},false,null,false,[]);
 await blockedMember.resume();
 assert(!blockedMember.calls.some(x=>x.startsWith('navigate:')),
  'Revoked, archived and other-game identities must not open a game');
 const twoGames=harness({user:{id:'two-games',is_anonymous:true}},false,null,false,
  [prior,{game_id:'second-game-uuid',kind:'observer',games:[{title:'Другая игра',game_code:'SECOND'}]}]);
 await twoGames.resume();
 const choices=twoGames.choices();
 assert.equal(choices.length,2,'Two accessible games require explicit selection');
 choices[1].click();
 assert(twoGames.calls.includes('navigate:/game/second-game-uuid'),'Selected permitted game opens');
 const rapidResume=harness({user:{id:'rapid-student',is_anonymous:true}},false,null,false,[prior]);
 await Promise.all([rapidResume.resume(),rapidResume.resume()]);
 assert.equal(rapidResume.calls.filter(x=>x==='game_members').length,1,'Double-click must not duplicate membership reads');
 const blocked=harness(teacher,false,{message:'Anonymous sign-ins are disabled'});
 await blocked.submit();assert(!blocked.calls.some(x=>x.startsWith('rpc:')),'Failed identity creation cannot enter a game');
 console.log('PASS role entry: automatic teacher separation, correct student resume, new anonymous accounts and fail-closed auth');
})().catch(e=>{console.error(e);process.exitCode=1});
