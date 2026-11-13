/* Password entry and role restoration: deterministic mock, no real users or game writes. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const source=ts.transpileModule(fs.readFileSync('app/page.tsx','utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}
}).outputText;
const nodes=(node,match)=>!node||typeof node!=='object'?[]:[
 ...(match(node)?[node]:[]),...[node.props?.children].flat(Infinity).flatMap(v=>nodes(v,match))];
const label=node=>node==null||typeof node==='boolean'?'':typeof node==='object'?[node.props?.children].flat(Infinity).map(label).join(''):String(node);
const successful={data:{session:{access_token:'fixture-access',refresh_token:'fixture-refresh',user:{id:'fixture-user'}},user:{id:'fixture-user'}},error:null};
function harness({teacher=false,teacherGames=[{id:'old-game',status:'open'},{id:'latest-game',status:'open'}],lastGame='latest-game',
 memberships=[{game_id:'first-game',kind:'student',joined_at:'2026-10-01'},{game_id:'second-game',kind:'student',joined_at:'2026-11-01'}],
 responses=[successful],online=true,adoptions=[{error:null}],teacherError=null,membershipError=null}={}){
 const slots=[],navigation=[],calls={auth:0,adopt:0,profiles:0,teacherList:0,access:0,membership:0,saved:0},storage=new Map();
 let cursor=0,tree;
 const react={
  useState(value){const i=cursor++;if(!slots[i])slots[i]={value};return[slots[i].value,updated=>slots[i].value=typeof updated==='function'?updated(slots[i].value):updated]},
  useEffect(){cursor++},useMemo(f){cursor++;return f()},useRef(value){const i=cursor++;if(!slots[i])slots[i]={value:{current:value}};return slots[i].value}
 };
 const jsx=(type,props)=>({type,props:props||{}});
 const from=table=>{
  if(table==='teacher_profiles'){
   return {select(){return this},eq(){return this},async maybeSingle(){calls.profiles++;return{data:teacher?{last_game_id:lastGame}:null,error:teacherError}},
    update(){return this},then(resolve){calls.saved++;resolve({error:null})}};
  }
  assert.equal(table,'game_members');
  return{select(fields){assert(fields.includes('game_id'));return this},eq(field,value){assert.equal(field,'user_id');assert.equal(value,'fixture-user');return this},
   in(field,list){assert.equal(field,'kind');assert.equal(list.join(','),'student,observer');return this},
   is(field,value){assert.equal(field,'roster_archived_at');assert.equal(value,null);return this},
   order(field,opts){assert.equal(field,'joined_at');assert.equal(opts.ascending,false);return this},
   async limit(number){assert.equal(number,20);calls.membership++;return{data:memberships,error:membershipError}}};
 };
 const api={from,auth:{getSession(){throw Error('Password login must not refresh stale session')},
  async setSession(v){assert.equal(v.access_token,'fixture-access');return adoptions[Math.min(calls.adopt++,adoptions.length-1)];}},
  async rpc(name){
   if(name==='list_my_teacher_games'){calls.teacherList++;return{data:{games:teacherGames},error:null}}
   if(name==='ensure_my_game_access'){calls.access++;return{data:true,error:null}}
   throw Error('Unexpected RPC '+name);
  }
 };
 const errors={};const loadError=fs.readFileSync('lib/userError.ts','utf8');
 new Function('exports',ts.transpileModule(loadError,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(errors);
 const transport={};
 new Function('exports',ts.transpileModule(fs.readFileSync('lib/authTransport.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(transport);
 const requireFor=name=>{
  if(name==='react')return react;
  if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};
  if(name==='next/navigation')return{useRouter:()=>({push:url=>navigation.push(url)})};
  if(name==='@/lib/supabase')return{supabase:api,createPasswordAuthClient:()=>({auth:{async signInWithPassword(opts){
   calls.auth++;assert.equal(opts.email,'probe@example.com');return responses[Math.min(calls.auth-1,responses.length-1)];
  }}})};
  if(name==='@/lib/userError')return errors;
  if(name==='@/lib/authTransport')return transport;
  if(name==='@/lib/rememberedGameCodes')return{readRememberedGameCodes:()=>[],rememberGameCode:()=>[],forgetRememberedGameCode:()=>[]};
  if(name==='lucide-react'||name.startsWith('@/components/'))return new Proxy({}, {get:()=> 'fixture'});
  throw Error('Unexpected import: '+name);
 };
 const browserStorage={
  getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)
 };
 const browser={location:{search:'',origin:'https://fixture.example',hostname:'fixture.example'},localStorage:browserStorage,sessionStorage:{getItem:()=>null,setItem(){}},history:{},setTimeout};
 const mod={exports:{}};
 vm.runInNewContext('(function(require,module,exports){'+source+'})',
  {console,navigator:{onLine:online},window:browser,URLSearchParams,setTimeout:fn=>{queueMicrotask(fn);return 1},clearTimeout(){}}
 )(requireFor,mod,mod.exports);
 function render(){cursor=0;tree=mod.exports.default();return tree}
 function change(match,value){const node=nodes(tree,match)[0];assert(node,'Field not found');
  node.props.onChange({target:{value,checked:value}});render();}
 render();
 return{calls,navigation,storage,render,
  fields:()=>nodes(tree,n=>n.type==='input').map(n=>({type:n.props.type,id:n.props.id,name:n.props.name})),
  toggleRemember(){change(n=>n.type==='input'&&n.props.type==='checkbox',true)},
  preferGame(id){storage.set('gos-id:last-member-game:fixture-user',id)},
  error:()=>label(nodes(tree,n=>n.props?.role==='alert')[0]),
  async submit(){const form=nodes(tree,n=>n.type==='form')[0];assert(form);await form.props.onSubmit({preventDefault(){}});render()}
 };
}
async function main(){
 const pass=async(name,fn)=>{try{await fn();console.log('PASS '+name)}catch(e){console.error('FAIL '+name+': '+e.stack);process.exitCode=1}};
 await pass('Personal password login is the default; no game code or role switch',async()=>{
  const h=harness();assert.equal(h.fields().filter(x=>x.type==='email').length,1);
  assert.equal(h.fields().filter(x=>x.type==='password').length,1);
  assert.equal(h.fields().filter(x=>x.type==='checkbox').length,1);
  assert(!h.fields().some(x=>x.id==='personal-game-code'));});
 await pass('Student goes straight to their most recently joined active game',async()=>{
  const h=harness();h.render();
  const email=nodes(h.render(),n=>n.type==='input'&&n.props.type==='email')[0];email.props.onChange({target:{value:' Probe@Example.com '}});h.render();
  nodes(h.render(),n=>n.type==='input'&&n.props.type==='password')[0].props.onChange({target:{value:'fixture-pass'}});h.render();
  await h.submit();assert.equal(h.calls.auth,1);assert.equal(h.calls.profiles,1);assert.equal(h.calls.membership,1);
  assert.deepEqual(h.navigation,['/game/first-game']); // server returns ordered memberships; fixture array is order of server result
 });
 await pass('Remembered account-specific membership takes precedence',async()=>{
  const h=harness();h.preferGame('second-game');
  nodes(h.render(),n=>n.type==='input'&&n.props.type==='email')[0].props.onChange({target:{value:'probe@example.com'}});h.render();
  nodes(h.render(),n=>n.type==='input'&&n.props.type==='password')[0].props.onChange({target:{value:'fixture-pass'}});h.render();
  await h.submit();assert.deepEqual(h.navigation,['/game/second-game']);});
 await pass('Teacher goes to the last authorized game rather than another user’s game',async()=>{
  const h=harness({teacher:true});
  nodes(h.render(),n=>n.type==='input'&&n.props.type==='email')[0].props.onChange({target:{value:'probe@example.com'}});h.render();
  nodes(h.render(),n=>n.type==='input'&&n.props.type==='password')[0].props.onChange({target:{value:'fixture-pass'}});h.render();
  await h.submit();assert.equal(h.calls.teacherList,1);assert.equal(h.calls.access,1);
  assert.equal(h.calls.membership,0);assert.deepEqual(h.navigation,['/game/latest-game']);});
 await pass('Teacher with no games enters protected permanent cabinet',async()=>{
  const h=harness({teacher:true,teacherGames:[]});
  nodes(h.render(),n=>n.type==='input'&&n.props.type==='email')[0].props.onChange({target:{value:'probe@example.com'}});h.render();
  nodes(h.render(),n=>n.type==='input'&&n.props.type==='password')[0].props.onChange({target:{value:'fixture-pass'}});h.render();
  await h.submit();assert.deepEqual(h.navigation,['/teacher']);assert.equal(h.calls.membership,0);});
 await pass('Only the email is remembered, never the plaintext password',async()=>{
  const h=harness();h.toggleRemember();
  nodes(h.render(),n=>n.type==='input'&&n.props.type==='email')[0].props.onChange({target:{value:'probe@example.com'}});h.render();
  nodes(h.render(),n=>n.type==='input'&&n.props.type==='password')[0].props.onChange({target:{value:'very-secret-password'}});h.render();
  await h.submit();assert.equal(h.storage.get('gos-id:remembered-login-email'),'probe@example.com');
  assert(![...h.storage.values()].some(v=>v==='very-secret-password'));});
 await pass('Denied teacher profile read is fail-closed',async()=>{
  const h=harness({teacherError:{message:'Denied',code:'42501'}});
  nodes(h.render(),n=>n.type==='input'&&n.props.type==='email')[0].props.onChange({target:{value:'probe@example.com'}});h.render();
  nodes(h.render(),n=>n.type==='input'&&n.props.type==='password')[0].props.onChange({target:{value:'fixture-pass'}});h.render();
  await h.submit();assert.equal(h.calls.membership,0);assert.deepEqual(h.navigation,[]);});
 await pass('Missing student membership cannot open any game',async()=>{
  const h=harness({memberships:[]});
  nodes(h.render(),n=>n.type==='input'&&n.props.type==='email')[0].props.onChange({target:{value:'probe@example.com'}});h.render();
  nodes(h.render(),n=>n.type==='input'&&n.props.type==='password')[0].props.onChange({target:{value:'fixture-pass'}});h.render();
  await h.submit();assert.deepEqual(h.navigation,[]);assert.match(h.error(),/активная игра/);});
 await pass('Invalid credentials are not retried',async()=>{
  const h=harness({responses:[{data:{session:null},error:{message:'Invalid login credentials',code:'invalid_credentials',status:400}}]});
  nodes(h.render(),n=>n.type==='input'&&n.props.type==='email')[0].props.onChange({target:{value:'probe@example.com'}});h.render();
  nodes(h.render(),n=>n.type==='input'&&n.props.type==='password')[0].props.onChange({target:{value:'incorrect'}});h.render();
  await h.submit();assert.equal(h.calls.auth,1);assert.deepEqual(h.navigation,[]);});
 await pass('HTTP 402 never causes repeated auth requests',async()=>{
  const h=harness({responses:[{data:{session:null},error:{message:'Payment Required',code:'exceed_egress_quota',status:402}}]});
  nodes(h.render(),n=>n.type==='input'&&n.props.type==='email')[0].props.onChange({target:{value:'probe@example.com'}});h.render();
  nodes(h.render(),n=>n.type==='input'&&n.props.type==='password')[0].props.onChange({target:{value:'incorrect'}});h.render();
  await h.submit();assert.equal(h.calls.auth,1);assert.deepEqual(h.navigation,[]);});
 await pass('Offline mode does not contact Auth',async()=>{
  const h=harness({online:false});await h.submit();assert.equal(h.calls.auth,0);assert.deepEqual(h.navigation,[]);});
 await pass('40 concurrent simulated students do not duplicate logins',async()=>{
  const hs=Array.from({length:40},()=>harness());
  for(const h of hs){
   nodes(h.render(),n=>n.type==='input'&&n.props.type==='email')[0].props.onChange({target:{value:'probe@example.com'}});h.render();
   nodes(h.render(),n=>n.type==='input'&&n.props.type==='password')[0].props.onChange({target:{value:'fixture-pass'}});h.render();
  }
  await Promise.all(hs.map(h=>h.submit()));
  assert(hs.every(h=>h.calls.auth===1&&h.calls.membership===1&&h.navigation.length===1));});
}
main().catch(e=>{console.error(e);process.exitCode=1});
