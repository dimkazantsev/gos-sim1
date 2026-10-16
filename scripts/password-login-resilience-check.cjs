/* Exercise the real entry form with deterministic Auth/RPC responses.
 * Accounts, game data, passwords and email delivery are never changed. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
function compile(file){return ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;}
const errors={};new Function('exports',compile('lib/userError.ts'))(errors);
const entryCode=compile('app/page.tsx');
let transport;
function loadTransport(){if(transport)return transport;const exports={};vm.runInNewContext('(function(exports){'+compile('lib/authTransport.ts')+'})',{URL,AbortController,fetch,setTimeout,clearTimeout})(exports);return transport=exports;}
const nodes=(node,match)=>!node||typeof node!=='object'?[]:[...(match(node)?[node]:[]),...[node.props?.children].flat(Infinity).flatMap(child=>nodes(child,match))];
const text=node=>node==null||typeof node==='boolean'?'':typeof node==='object'?[node.props?.children].flat(Infinity).map(text).join(''):String(node);
const ok={data:{session:{access_token:'fixture-access',refresh_token:'fixture-refresh'}},error:null};
function harness({responses=[ok],adoption=[{error:null}],rpc=[{data:'fixture-game',error:null}],online=true}={}){
 const slots=[],calls={password:0,adopt:0,resume:0,navigation:[],saved:[]};let cursor=0,tree;
 const react={
  useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:initial};return[slots[i].value,value=>{slots[i].value=typeof value==='function'?value(slots[i].value):value;}];},
  useEffect(){cursor++;},useMemo(fn){cursor++;return fn();}
 };
 const jsx=(type,props)=>({type,props:props||{}});
 const supabase={auth:{getSession(){throw Error('Explicit password login must not refresh the stored session');},async setSession(session){assert.equal(session.access_token,'fixture-access');return adoption[Math.min(calls.adopt++,adoption.length-1)];}},async rpc(name,args){assert.equal(name,'resume_member_game');assert.equal(args.p_game_code,'FIXTURE');return rpc[Math.min(calls.resume++,rpc.length-1)];}};
 const requireFor=name=>{
  if(name==='react')return react;
  if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};
  if(name==='next/navigation')return{useRouter:()=>({push:url=>calls.navigation.push(url)})};
  if(name==='@/lib/supabase')return{supabase,createPasswordAuthClient:()=>({auth:{async signInWithPassword(credentials){assert.equal(credentials.email,'probe@example.com');return responses[Math.min(calls.password++,responses.length-1)];}}})};
  if(name==='@/lib/userError')return errors;
  if(name==='@/lib/authTransport')return loadTransport();
  if(name==='@/lib/rememberedGameCodes')return{readRememberedGameCodes:()=>[],rememberGameCode:code=>{calls.saved.push(code);return[code];}};
  if(name==='lucide-react'||name.startsWith('@/components/'))return new Proxy({},{get:()=> 'fixture-component'});
  throw Error('Unexpected import '+name);
 };
 const mod={exports:{}};
 vm.runInNewContext('(function(require,module,exports){'+entryCode+'})',{console,navigator:{onLine:online},window:{location:{origin:'https://fixture.example'}},setTimeout:fn=>{queueMicrotask(fn);return 1;},clearTimeout(){}})(requireFor,mod,mod.exports);
 function render(){cursor=0;tree=mod.exports.default();return tree;}
 render();nodes(tree,n=>n.type==='button'&&text(n)==='Войти с личным паролем')[0].props.onClick();render();
 for(const [match,value] of [[n=>n.props?.id==='personal-game-code','FIXTURE'],[n=>n.type==='input'&&n.props.type==='email',' Probe@Example.com '],[n=>n.type==='input'&&n.props.type==='password','fixture-password']]){nodes(tree,match)[0].props.onChange({target:{value}});render();}
 return{calls,async submit(){await nodes(tree,n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});render();},error:()=>text(nodes(tree,n=>n.props?.role==='alert')[0])};
}
async function main(){
 const failures=[];let passed=0;
 async function check(name,run){try{await run();console.log('PASS '+name);passed++;}catch(e){console.error('FAIL '+name+': '+e.message);failures.push(name);}}
 await check('Translated transport failure retries and opens the existing game once',async()=>{
  const h=harness({responses:[{data:{session:null},error:{message:'Нет ответа от сервера. Проверьте соединение и повторите попытку.',status:0}},ok]});await h.submit();assert.equal(h.calls.password,2);assert.equal(h.calls.adopt,1);assert.equal(h.calls.resume,1);assert.deepEqual(h.calls.navigation,['/game/fixture-game']);assert.equal(h.error(),'');
 });
 await check('Auth 504 retries using its status even when the text was translated',async()=>{
  const h=harness({responses:[{data:{session:null},error:{message:'Сервер временно не отвечает. Повторите попытку.',status:504}},ok]});await h.submit();assert.equal(h.calls.password,2);assert.equal(h.calls.navigation.length,1);
 });
 await check('Wrong password is not retried and never opens or alters membership',async()=>{
  const h=harness({responses:[{data:{session:null},error:{message:'Invalid login credentials',code:'invalid_credentials',status:400}}]});await h.submit();assert.equal(h.calls.password,1);assert.equal(h.calls.adopt,0);assert.equal(h.calls.resume,0);assert.match(h.error(),/Неверный адрес почты или пароль/);
 });
 await check('Transient session verification retries without authenticating twice',async()=>{
  const h=harness({adoption:[{error:{message:'Нет ответа от сервера.',status:0}},{error:null}]});await h.submit();assert.equal(h.calls.password,1);assert.equal(h.calls.adopt,2);assert.equal(h.calls.resume,1);
 });
 await check('Membership denial never retries credentials or remembers the game',async()=>{
  const h=harness({rpc:[{error:{message:'Для этого действия недостаточно прав.',code:'42501'}}]});await h.submit();assert.equal(h.calls.password,1);assert.equal(h.calls.resume,1);assert.equal(h.calls.saved.length,0);assert.equal(h.calls.navigation.length,0);
 });
 await check('Offline device makes no authentication request',async()=>{
  const h=harness({online:false});await h.submit();assert.equal(h.calls.password,0);assert.equal(h.calls.resume,0);assert.match(h.error(),/не подключено к интернету/);
 });
 await check('40 simultaneous simulated entrants each open the game exactly once',async()=>{
  const entrants=Array.from({length:40},()=>harness({responses:[{data:{session:null},error:{message:'Нет ответа от сервера.',status:0}},ok]}));await Promise.all(entrants.map(h=>h.submit()));for(const h of entrants){assert.equal(h.calls.password,2);assert.equal(h.calls.adopt,1);assert.equal(h.calls.resume,1);assert.equal(h.calls.navigation.length,1);}
 });
 await check('Fresh-session verification and password requests abort; game data keeps its own signal',async()=>{
  const timers=new Map();let nextTimer=0,receivedSignal;
  let network=async(_input,init)=>{receivedSignal=init.signal;return new Response('{}',{status:200,headers:{'Content-Type':'application/json'}});};
  const context={URL,AbortController,Response,Headers,process:{env:{}},fetch:(...args)=>network(...args),setTimeout(fn,ms){const id=++nextTimer;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);}};
  const auth={};vm.runInNewContext('(function(exports){'+compile('lib/authTransport.ts')+'})',context)(auth);
  const refresh={};vm.runInNewContext('(function(exports){'+compile('lib/boundedSessionRefresh.ts')+'})',context)(refresh);
  const mod={exports:{}};const requireFor=name=>name==='./userError'?errors:name==='./boundedSessionRefresh'?refresh:name==='./authTransport'?auth:name==='@supabase/supabase-js'?{createClient:(_url,_key,options)=>({options})}:(()=>{throw Error('Unexpected import '+name);})();
  vm.runInNewContext('(function(require,module,exports){'+compile('lib/supabase.ts')+'})',context)(requireFor,mod,mod.exports);
  const api=mod.exports.supabase.options.global.fetch;
  const controller=new AbortController();await api('https://fixture.supabase.co/rest/v1/games',{signal:controller.signal});assert.equal(receivedSignal,controller.signal);assert.equal(timers.size,0);
  network=(_input,init)=>{receivedSignal=init.signal;return new Promise((_resolve,reject)=>{if(init.signal.aborted)reject(Error('caller aborted'));else init.signal.addEventListener('abort',()=>reject(Error('transport aborted')),{once:true});});};
  for(const request of [()=>api('https://fixture.supabase.co/auth/v1/user',{method:'GET'}),()=>mod.exports.createPasswordAuthClient().options.global.fetch('https://fixture.supabase.co/auth/v1/token?grant_type=password',{method:'POST'})]){
   const pending=request();assert.equal([...timers.values()][0].ms,12000);[...timers.values()][0].fn();await assert.rejects(pending,/Сервер авторизации не ответил/);assert(receivedSignal.aborted);assert.equal(timers.size,0);
  }
  const caller=new AbortController();const pending=auth.fetchWithAuthTimeout('https://fixture.supabase.co/auth/v1/user',{signal:caller.signal});caller.abort();await assert.rejects(pending,/transport aborted/);assert.equal(timers.size,0);
 });
 console.log(`${passed} passed; ${failures.length} failed. Simulated Auth only.`);if(failures.length)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
