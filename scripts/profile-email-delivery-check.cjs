/* Executes the real component handlers with simulated Auth responses.
 * No real accounts, email delivery, or network requests are used. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function compile(file){return ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;}
const errors={};new Function('exports',compile('lib/userError.ts'))(errors);
const emailDelivery={};new Function('exports',compile('components/game/profileEmailDelivery.ts'))(emailDelivery);
const text=node=>node==null||typeof node==='boolean'?'':typeof node==='object'?[node.props?.children].flat(Infinity).map(text).join(''):String(node);
const nodes=(node,match)=>!node||typeof node!=='object'?[]:[...(match(node)?[node]:[]),...[node.props?.children].flat(Infinity).flatMap(child=>nodes(child,match))];
function harness({actor={id:'current-user',is_anonymous:true},hostname='dimkazantsev.github.io',teacher=false,storage=new Map()}={}){
 const slots=[],effects=[],timers=new Map(),requests=[],writes=[];
 let cursor=0,dirty=false,tree,nextTimer=0,result={data:{},error:null},failure=null,hold=null,clock=Date.parse('2026-10-15T03:00:00Z');
 const react={
  useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:initial};return[slots[i].value,next=>{slots[i].value=typeof next==='function'?next(slots[i].value):next;dirty=true;}];},
  useRef(initial){const i=cursor++;return(slots[i]??={value:{current:initial}}).value;},
  useEffect(effect,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=effect();});}}
 };
 async function request(method,...args){requests.push({method,args});if(hold)await hold;if(failure)throw failure;return result;}
 const supabase={
  auth:{getUser:async()=>({data:{user:actor},error:null}),updateUser:(...args)=>request('updateUser',...args),resend:(...args)=>request('resend',...args),resetPasswordForEmail:(...args)=>request('resetPasswordForEmail',...args)},
  from(table){return{select(){return this;},eq(){return Promise.resolve({data:[],error:null});},async upsert(value){writes.push({table,value});return{error:null};}};}
 };
 const jsx=(type,props)=>({type,props:props||{}});
 const module={exports:{}};
 const context={console,Promise,URL,Date:class extends Date{static now(){return clock;}},process:{env:{}},window:{location:{hostname,origin:'https://'+hostname},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},setInterval(fn){const id=++nextTimer;timers.set(id,fn);return id;},clearInterval(id){timers.delete(id);}}};
 const requireFor=name=>{
  if(name==='react')return react;
  if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};
  if(name==='@/lib/supabase')return{supabase};
  if(name==='@/lib/userError')return errors;
  if(name==='./profileEmailDelivery')return emailDelivery;
  if(name==='lucide-react')return new Proxy({},{get:()=> 'svg'});
  throw new Error('Unexpected import '+name);
 };
 vm.runInNewContext('(function(require,module,exports){'+compile('components/game/ProfileSecurityPanel.tsx')+'\n})',context)(requireFor,module,module.exports);
 const props={g:{game:{id:'game-id'},me:{user_id:'current-user'},teacher,members:[{user_id:'student',kind:'student',full_name:'Участник'}]}};
 function render(){cursor=0;dirty=false;tree=module.exports.default(props);while(effects.length)effects.shift()();return tree;}
 async function settle(){for(let i=0;i<12;i++){render();await tick();if(!dirty)break;}return render();}
 const button=name=>nodes(tree,n=>n.type==='button'&&text(n).includes(name))[0];
 const email=()=>nodes(tree,n=>n.type==='input'&&n.props.type==='email')[0];
 return{render,settle,button,requests,writes,text:()=>text(tree),tree:()=>tree,
  async enter(value){email().props.onChange({target:{value}});await settle();},
  async click(name){const node=button(name);assert(node,'Missing button '+name);assert(!node.props.disabled,'Disabled button '+name);node.props.onClick();await settle();},
  result(value){result=value;},failure(value){failure=value;},hold(value){hold=value;},
  async advance(seconds){clock+=seconds*1000;[...timers.values()].forEach(fn=>fn());await settle();},
  dispose(){slots.forEach(slot=>slot?.cleanup?.());}
 };
}
async function main(){
 let passed=0;
 async function check(name,run){await run();passed++;console.log('PASS '+name);}
 await check('Existing address exposes recovery without claiming mail was sent',async()=>{
  const h=harness();await h.settle();await h.enter(' Person@Mail.ru ');h.result({error:{code:'email_exists',message:'Не удалось выполнить действие.'}});await h.click('Отправить письмо для подтверждения');
  assert.match(h.text(),/Этот адрес уже зарегистрирован/);assert.doesNotMatch(h.text(),/Письмо отправлено на/);assert(h.button('Отправить письмо для восстановления доступа'));assert.equal(h.writes.length,0);
  assert.equal(h.requests[0].args[0].email,'person@mail.ru');h.dispose();
 });
 await check('Recovery uses the entered existing address and the application recovery URL',async()=>{
  const h=harness();await h.settle();await h.enter('person@mail.ru');h.result({error:{code:'email_exists',message:'conflict'}});await h.click('Отправить письмо для подтверждения');h.result({error:null});await h.click('Отправить письмо для восстановления доступа');
  const r=h.requests.at(-1);assert.equal(r.method,'resetPasswordForEmail');assert.equal(r.args[0],'person@mail.ru');assert.equal(r.args[1].redirectTo,'https://gos-sim1.vercel.app/auth/update-password');assert.match(h.text(),/Если адрес зарегистрирован/);assert.equal(h.writes.length,0);assert.equal(h.button('Сохранить пароль'),undefined);h.dispose();
 });
 await check('Changing the address removes the previous recovery target',async()=>{
  const h=harness();await h.settle();await h.enter('first@mail.ru');h.result({error:{code:'email_exists',message:'conflict'}});await h.click('Отправить письмо для подтверждения');await h.enter('second@mail.ru');assert.equal(h.button('Отправить письмо для восстановления доступа'),undefined);h.result({error:null});await h.click('Отправить письмо для подтверждения');assert.equal(h.requests.at(-1).args[0].email,'second@mail.ru');h.dispose();
 });
 await check('First request updates the same account; repeat uses email_change resend',async()=>{
  const h=harness();await h.settle();await h.enter('new@mail.ru');await h.click('Отправить письмо для подтверждения');assert.equal(h.requests[0].method,'updateUser');assert.match(h.text(),/Письмо отправлено на new@mail.ru/);assert.equal(h.button('Сохранить пароль'),undefined);assert(h.button('Проверить подтверждение')&&!h.button('Проверить подтверждение').props.disabled);assert.equal(h.requests[0].args[1].emailRedirectTo,'https://gos-sim1.vercel.app/game/game-id?section=profile');assert(h.button('Повтор через 1 мин.').props.disabled);
  await h.advance(60);await h.click('Отправить письмо повторно');assert.equal(h.requests[1].method,'resend');assert.equal(h.requests[1].args[0].type,'email_change');assert.equal(h.requests[1].args[0].email,'new@mail.ru');h.dispose();
 });
 await check('Pending email after a reload uses the resend endpoint',async()=>{
  const h=harness({actor:{id:'current-user',is_anonymous:true,new_email:'pending@mail.ru'}});await h.settle();await h.click('Отправить письмо для подтверждения');assert.equal(h.requests[0].method,'resend');assert.equal(h.requests[0].args[0].email,'pending@mail.ru');h.dispose();
 });
 await check('Rate limit explains the cause and prevents immediate repeats',async()=>{
  const h=harness();await h.settle();await h.enter('person@mail.ru');h.result({error:{code:'over_email_send_rate_limit',message:'redacted'}});await h.click('Отправить письмо для подтверждения');assert.match(h.text(),/Сервис авторизации временно ограничил отправку писем/);assert(h.button('Повтор через 60 мин.').props.disabled);assert.doesNotMatch(h.text(),/Письмо отправлено на/);assert.equal(h.button('Отправить письмо для восстановления доступа'),undefined);await h.advance(3600);assert(!h.button('Отправить письмо для подтверждения').props.disabled);h.dispose();
 });
 await check('The existing rate-limit pause survives a profile reload',async()=>{
  const storage=new Map(),first=harness({storage});await first.settle();await first.enter('person@mail.ru');first.result({error:{status:429,code:'over_email_send_rate_limit',message:'redacted'}});await first.click('Отправить письмо для подтверждения');first.dispose();
  const next=harness({storage});await next.settle();await next.enter('person@mail.ru');assert(next.button('Повтор через 60 мин.').props.disabled);assert.equal(next.requests.length,0);assert(!next.button('Проверить подтверждение').props.disabled);await next.advance(3600);assert(!next.button('Отправить письмо для подтверждения').props.disabled);next.dispose();
 });
 await check('SMTP restriction is distinct from an account conflict',async()=>{
  const h=harness();await h.settle();await h.enter('person@mail.ru');h.result({error:{code:'email_address_not_authorized',message:'redacted'}});await h.click('Отправить письмо для подтверждения');assert.match(h.text(),/SMTP/);assert.equal(h.button('Отправить письмо для восстановления доступа'),undefined);h.dispose();
 });
 await check('Incomplete addresses never trigger Auth',async()=>{
  const h=harness();await h.settle();for(const address of ['@mail.ru','user@','user @mail.ru']){await h.enter(address);await h.click('Отправить письмо для подтверждения');assert.match(h.text(),/Укажите полный адрес/);}assert.equal(h.requests.length,0);h.dispose();
 });
 await check('Thrown transport errors release both sending actions',async()=>{
  const h=harness();await h.settle();await h.enter('person@mail.ru');h.failure(new Error('Failed to fetch'));await h.click('Отправить письмо для подтверждения');assert.match(h.text(),/Нет ответа от сервера/);assert(!h.button('Отправить письмо для подтверждения').props.disabled);h.failure(null);h.result({error:{code:'email_exists',message:'conflict'}});await h.click('Отправить письмо для подтверждения');h.failure(new Error('Failed to fetch'));await h.click('Отправить письмо для восстановления доступа');assert.match(h.text(),/Нет ответа от сервера/);assert(!h.button('Отправить письмо для восстановления доступа').props.disabled);h.dispose();
 });
 await check('Double clicks cannot create duplicate email requests',async()=>{
  const h=harness();await h.settle();await h.enter('person@mail.ru');let release;h.hold(new Promise(resolve=>release=resolve));const handler=h.button('Отправить письмо для подтверждения').props.onClick;handler();handler();await tick();assert.equal(h.requests.length,1);release();await h.settle();h.dispose();
 });
 await check('Verified accounts retain the password fields and cannot relink',async()=>{
  const h=harness({actor:{id:'current-user',email:'verified@mail.ru',is_anonymous:false,email_confirmed_at:'2026-10-15T03:00:00Z'}});await h.settle();assert(h.button('Почта подтверждена').props.disabled);assert(h.button('Сохранить пароль'));assert.equal(h.writes[0].value.user_id,'current-user');h.dispose();
 });
 await check('Auth transport preserves status, code, and Russian error context',async()=>{
  let options;
  const module={exports:{}};
  const requireFor=name=>name==='./userError'?errors:{createClient:(url,key,input)=>{options=input;return{};}};
  const context={process:{env:{}},Response,Headers,AbortController,DOMException,setTimeout,clearTimeout,fetch:async()=>new Response(JSON.stringify({code:'email_exists',msg:'A user with this email address has already been registered'}),{status:422,headers:{'content-type':'application/json','content-length':'1000'}})};
  vm.runInNewContext('(function(require,module,exports){'+compile('lib/supabase.ts')+'\n})',context)(requireFor,module,module.exports);
  const response=await options.global.fetch('https://auth.example.invalid/user');const body=await response.json();assert.equal(response.status,422);assert.equal(body.code,'email_exists');assert.match(body.msg,/Этот адрес уже зарегистрирован/);assert.equal(response.headers.get('content-length'),null);
 });
 console.log('PASS '+passed+' simulated email-flow checks; real inbox delivery is not tested.');
}
module.exports={harness,text};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
