/* Actual EventWorkspace handlers with a simulated Supabase transport.
 * No browser, database, or event API is contacted. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function text(node){if(node==null||typeof node==='boolean')return'';if(typeof node!=='object')return String(node);return[node.props?.children].flat(Infinity).map(text).join('');}
function nodes(node,match){if(!node||typeof node!=='object')return[];return[...(match(node)?[node]:[]),...[node.props?.children].flat(Infinity).flatMap(child=>nodes(child,match))];}
function harness(){
 const file=path.resolve(__dirname,'../components/game/EventWorkspace.tsx');
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const slots=[],effects=[],calls=[];let cursor=0,dirty=false,tree,rpcError=null;
 const g={game:{id:'fictional-game'},me:{user_id:'fictional-teacher',kind:'teacher'},teacher:true,members:[{user_id:'fictional-a',kind:'student',full_name:'Student A',role_title:'Министр финансов'},{user_id:'fictional-b',kind:'student',full_name:'Student B',role_title:'Председатель правительства'}],profiles:{},names:{},refresh:async()=>{}};
 const props={g,mode:'manage'};
 const react={
  useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return[slots[i].value,next=>{const value=typeof next==='function'?next(slots[i].value):next;if(!Object.is(value,slots[i].value)){slots[i].value=value;dirty=true;}}];},
  useEffect(effect,deps){const i=cursor++,old=slots[i];if(!old||deps.some((value,j)=>!Object.is(value,old.deps?.[j]))){slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=effect();});}}
 };
 const supabase={
  from(){return{select(){return this;},eq(){return this;},order(){return this;},limit(){return this;},then(resolve){return Promise.resolve({data:[],error:null}).then(resolve);}};},
  rpc:async(name,args)=>{calls.push({name,args});return{data:'fictional-event',error:rpcError};},
  channel(){return{on(){return this;},subscribe(){return this;}};},removeChannel:async()=>{}
 };
 const jsx=(type,props)=>({type,props:props||{}}),tag=name=>Object.assign(()=>{},{displayName:name});
 function requireFor(name){if(name==='react')return react;if(name==='react/jsx-runtime')return{jsx,jsxs:jsx,Fragment:'fragment'};if(name==='@/lib/supabase')return{supabase};return new Proxy({__esModule:true,default:tag(path.basename(name))},{get:(object,key)=>key in object?object[key]:tag(String(key))});}
 const module={exports:{}};
 vm.runInNewContext('(function(require,module,exports){'+code+'\n})',{console,Date,Promise,Set,Object,Array,String,Number,Math,setInterval:()=>1,clearInterval:()=>{}})(requireFor,module,module.exports);
 function render(){cursor=0;dirty=false;tree=module.exports.default(props);while(effects.length)effects.shift()();return tree;}
 async function settle(){for(let i=0;i<8;i++){render();await tick();if(!dirty)break;}return render();}
 const all=(type,from=tree)=>nodes(from,node=>node.type===type);
 const byClass=name=>nodes(tree,node=>node.props?.className?.split(' ').includes(name))[0];
 const choices=()=>all('article',byClass('eventChoiceEditor'));
 function field(label,from=tree){const owner=all('label',from).find(node=>text(node).startsWith(label));assert.ok(owner,'Missing field: '+label);const control=nodes(owner,node=>node.type==='input'||node.type==='textarea')[0];assert.ok(control,'Missing control: '+label);return control;}
 function select(label,from=tree){const node=nodes(from,node=>node.props?.label===label)[0];assert.ok(node,'Missing select: '+label);return node;}
 const button=label=>all('button').find(node=>text(node)===label);
 const send=()=>button('Назначить событие')||button('Отправка…');
 function change(control,value){control.props.onChange({target:{value,valueAsNumber:value===''?NaN:Number(value),checked:!!value}});render();}
 function basic(){change(field('Название'),'A meaningful event title');change(field('Описание ситуации'),'A situation that needs a deliberate government decision.');choices().forEach((_,i)=>{change(field('Вариант '+(i+1),choices()[i]),'Choice '+(i+1));change(field('Последствия решения',choices()[i]),'A meaningful consequence '+(i+1));});change(all('input',byClass('eventRecipients'))[0],true);}
 function classify(index,lawful='true',roles='Министр финансов',basis='Учебная конституция, статья 12'){
  select('Правомерность решения',choices()[index]).props.onChange(lawful);render();change(field('Полномочные должности',choices()[index]),roles);change(field('Правовое основание',choices()[index]),basis);
 }
 return{g,props,calls,render,settle,choices,field,select,button,send,change,basic,classify,setRpcError:error=>{rpcError=error;},dispose(){for(const slot of slots)slot?.cleanup?.();}};
}
async function main(){
 const failures=[];
 async function check(name,fn){try{await fn();console.log('PASS '+name);}catch(error){failures.push(name);console.error('FAIL '+name+': '+error.message);}}
 await check('Every option needs an explicit legal choice, roles, and a legal basis',async()=>{
  const h=harness();await h.settle();h.basic();assert.equal(h.send().props.disabled,true,'Previously valid manual events must await legal classification');h.send().props.onClick();await h.settle();assert.equal(h.calls.length,0);
  for(let i=0;i<h.choices().length;i++)assert.equal(h.select('Правомерность решения',h.choices()[i]).props.value,'');
  h.classify(0);h.classify(1,'false');assert.equal(h.send().props.disabled,true,'One incomplete option blocks sending');h.classify(2);assert.equal(h.send().props.disabled,false,'Explicitly unlawful options are valid classifications');
  h.change(h.field('Полномочные должности',h.choices()[1]),' , ; ');assert.equal(h.send().props.disabled,true);h.change(h.field('Полномочные должности',h.choices()[1]),'Министр финансов');h.change(h.field('Правовое основание',h.choices()[1]),'four');assert.equal(h.send().props.disabled,true);h.change(h.field('Правовое основание',h.choices()[1]),'Article 12');assert.equal(h.send().props.disabled,false);
  h.select('Правомерность решения',h.choices()[1]).props.onChange('');h.render();assert.equal(h.send().props.disabled,true);h.dispose();
 });
 await check('The actual create handler sends parsed authority metadata including false values',async()=>{
  const h=harness();await h.settle();h.basic();h.classify(0,'true',' Министр финансов, Председатель правительства ; Министр финансов ; ','  Учебная конституция, статья 12  ');h.classify(1,'false','Министр финансов');h.classify(2);h.change(h.field('Защищает интересы своей роли',h.choices()[0]),true);assert.equal(h.send().props.disabled,false);h.send().props.onClick();await h.settle();assert.equal(h.calls.length,1);const {name,args}=h.calls[0];assert.equal(name,'create_assigned_event');assert.equal(args.p_game_id,'fictional-game');assert.deepEqual(Array.from(args.p_recipients),['fictional-a']);
  const payload=JSON.parse(JSON.stringify(args.p_options));assert.deepEqual(payload[0],{label:'Choice 1',trust:2,description:'A meaningful consequence 1',authorized_roles:['Министр финансов','Председатель правительства'],lawful:true,legal_basis:'Учебная конституция, статья 12',protects_role_interest:true});assert.equal(payload[1].lawful,false);assert.equal(payload[1].protects_role_interest,false);assert.equal(payload[2].trust,-2);assert.deepEqual(Object.keys(payload[1]).sort(),['authorized_roles','description','label','lawful','legal_basis','protects_role_interest','trust']);
  assert.equal(h.send().props.disabled,true);for(const choice of h.choices()){assert.equal(h.select('Правомерность решения',choice).props.value,'');assert.equal(h.field('Полномочные должности',choice).props.value,'');assert.equal(h.field('Правовое основание',choice).props.value,'');assert.equal(h.field('Защищает интересы своей роли',choice).props.checked,false);}h.dispose();
 });
 await check('New options start unclassified and role bounds match the RPC',async()=>{
  const h=harness();await h.settle();h.basic();for(let i=0;i<h.choices().length;i++)h.classify(i);assert.equal(h.send().props.disabled,false);h.button('Добавить вариант').props.onClick();h.render();assert.equal(h.choices().length,4);assert.equal(h.select('Правомерность решения',h.choices()[3]).props.value,'');h.change(h.field('Вариант 4',h.choices()[3]),'Choice 4');h.change(h.field('Последствия решения',h.choices()[3]),'Meaningful fourth consequence');assert.equal(h.send().props.disabled,true);h.classify(3);assert.equal(h.send().props.disabled,false);
  for(const roles of ['x','x'.repeat(121),Array.from({length:21},(_,i)=>'Office '+i).join(';')]){h.change(h.field('Полномочные должности',h.choices()[3]),roles);assert.equal(h.send().props.disabled,true,'Invalid authority list must not reach the RPC');}h.change(h.field('Полномочные должности',h.choices()[3]),'Министр финансов');assert.equal(h.send().props.disabled,false);h.dispose();
 });
 await check('Existing duplicate label, finite trust, recipient, and read-only rules remain',async()=>{
  const h=harness();await h.settle();h.basic();for(let i=0;i<h.choices().length;i++)h.classify(i);h.change(h.field('Вариант 2',h.choices()[1]),' Choice 1 ');assert.equal(h.send().props.disabled,true);h.change(h.field('Вариант 2',h.choices()[1]),'Choice 2');h.change(h.field('Доверие, п.п.',h.choices()[1]),'');assert.equal(h.send().props.disabled,true);h.change(h.field('Доверие, п.п.',h.choices()[1]),0);h.change(h.field('Название'),'short');assert.equal(h.send().props.disabled,true);h.change(h.field('Название'),'A meaningful event title');h.change(h.field('Описание ситуации'),'Too short');assert.equal(h.send().props.disabled,true);h.change(h.field('Описание ситуации'),'A situation that needs a deliberate government decision.');h.select('Формат').props.onChange('group');h.render();assert.equal(h.send().props.disabled,true);const recipients=nodes(h.render(),node=>node.props?.className==='eventRecipients')[0];for(const input of nodes(recipients,node=>node.type==='input'))h.change(input,true);assert.equal(h.send().props.disabled,false);h.props.readOnly=true;h.render();assert.equal(h.send().props.disabled,true);h.send().props.onClick();await h.settle();assert.equal(h.calls.length,0);h.dispose();
 });
 await check('A rejected RPC preserves the teacher legal draft for correction',async()=>{
  const h=harness();await h.settle();h.basic();for(let i=0;i<h.choices().length;i++)h.classify(i,i===1?'false':'true');h.setRpcError({message:'Simulated validation failure'});h.send().props.onClick();await h.settle();assert.equal(h.calls.length,1);assert.equal(h.select('Правомерность решения',h.choices()[1]).props.value,'false');assert.equal(h.field('Правовое основание',h.choices()[1]).props.value,'Учебная конституция, статья 12');assert.equal(h.send().props.disabled,false);assert.match(text(h.render()),/Simulated validation failure/);h.dispose();
 });
 if(failures.length)process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
