/* Actual component effects, isolated synthetic responses and virtual time. No network. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const compareRef=process.env.PERFORMANCE_BASELINE_REF;
const blitzCompareRef=process.env.BLITZ_BASELINE_REF;
const current=file=>fs.readFileSync(path.join(root,file),'utf8');
const baseline=(file,ref=compareRef)=>execFileSync('git',['show',ref+':'+file],{cwd:root,encoding:'utf8'});
const transpile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const compiled=new Map();
function compile(file,old=false){const key=String(old)+file;if(!compiled.has(key))compiled.set(key,transpile(old?baseline(file,typeof old==='string'?old:compareRef):current(file)));return compiled.get(key)}
const tick=async()=>{for(let i=0;i<10;i++)await Promise.resolve()};
function realm(file,old=false,{hidden=false,issueError=false,slowIssue=false,slowMutation=false}={}){
 let now=Date.parse('2026-10-25T12:00:00Z'),cursor=0,nextId=0,resolveIssue,resolveMutation;
 const hooks=[],effects=[],timers=new Map(),calls=[],listeners={window:new Map(),document:new Map()};
 const equal=(a,b)=>!!a&&!!b&&a.length===b.length&&a.every((x,i)=>Object.is(x,b[i]));
 const react={
  useState(value){const i=cursor++;if(!hooks[i])hooks[i]={value:typeof value==='function'?value():value};return[hooks[i].value,v=>{hooks[i].value=typeof v==='function'?v(hooks[i].value):v}]},
  useRef(value){const i=cursor++;if(!hooks[i])hooks[i]={current:value};return hooks[i]},
  useCallback(fn,deps){const i=cursor++;if(!hooks[i]||!equal(hooks[i].deps,deps))hooks[i]={deps,value:fn};return hooks[i].value},
  useEffect(fn,deps){const i=cursor++;if(!hooks[i]||!equal(hooks[i].deps,deps)){hooks[i]?.cleanup?.();hooks[i]={deps};effects.push(()=>{hooks[i].cleanup=fn()})}},
  useId(){return 'test-'+cursor++}
 };
 function target(kind){return{addEventListener(name,fn){if(!listeners[kind].has(name))listeners[kind].set(name,new Set());listeners[kind].get(name).add(fn)},removeEventListener(name,fn){listeners[kind].get(name)?.delete(fn)},dispatchEvent(event){for(const fn of [...listeners[kind].get(event.type)||[]])fn(event)}}}
 const document={...target('document'),visibilityState:hidden?'hidden':'visible'},window=target('window');
 const set=(fn,delay,interval)=>{const id=++nextId;timers.set(id,{fn,at:now+Math.max(0,delay),interval});return id};
 Object.assign(window,{setInterval:(fn,delay)=>set(fn,delay,delay),clearInterval:id=>timers.delete(id),setTimeout:(fn,delay)=>set(fn,delay,0),clearTimeout:id=>timers.delete(id)});
 const supabase={rpc:async(name,args)=>{
  calls.push({name,args,at:now});
  if(name==='blitz_issue_today'){if(slowIssue)await new Promise(resolve=>{resolveIssue=resolve});return{data:0,error:issueError?{code:'57014',message:'synthetic timeout'}:null}}
  if(slowMutation&&['comment_on_civic_content','react_to_civic_content','delete_civic_comment'].includes(name))await new Promise(resolve=>{resolveMutation=resolve});
  if(name==='get_civic_discussion')return{data:{likes:0,dislikes:0,mine:0,views:1,comment_count:0,comments:[]},error:null};
  return{data:null,error:null};
 },
  from(table){calls.push({name:table,at:now});const query=new Proxy({then:resolve=>Promise.resolve({data:[],error:null}).then(resolve)},{get(object,key){return key==='then'?object.then:()=>query}});return query},
  storage:{from:()=>({createSignedUrl:async(storedPath)=>{
   calls.push({name:'signedUrl',storedPath,at:now});
   return{data:{signedUrl:'https://example.invalid/'+storedPath+'?signed='+now},error:null};
  }})}};
 class ClockDate extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}}
 const math=Object.create(Math);math.random=()=>0.5;
 const jsx=(type,props)=>{if(props?.ref&&typeof props.ref==='object')props.ref.current={closest(){return this}};return{type,props}};
 const context={exports:{},console,Date:ClockDate,Math:math,document,window,IntersectionObserver:class{constructor(fn){this.fn=fn}observe(){this.fn([{isIntersecting:true}])}disconnect(){}},Event:class{constructor(type){this.type=type}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail}},setInterval:window.setInterval,clearInterval:window.clearInterval,setTimeout:window.setTimeout,clearTimeout:window.clearTimeout,fetch:()=>{throw Error('Network is forbidden in this test')}};
 let sync;
 context.require=name=>{
  if(name==='react')return react;
  if(name==='react/jsx-runtime')return{jsx,jsxs:jsx,Fragment:'fragment'};
  if(name==='react-dom')return{createPortal:value=>value};
  if(name==='@/lib/supabase')return{supabase};
  if(name==='@/lib/userError')return{userError:e=>e?.message||String(e)};
  if(name==='./useGameTableSync')return sync;
  if(name==='../ui/useDialog')return{useDialog:()=>({dialogRef:{current:null}})};
  if(name==='./chatHandles')return{chatHandles:()=>[]};
  return{};
 };
 vm.createContext(context);
 vm.runInContext('(function(exports,require){'+transpile(current('components/game/useGameTableSync.ts'))+'})(exports,require)',context);sync={...context.exports};sync.setGameRealtimeConnection('test-game',true);
 context.exports={};
 let code=compile(file,old);if(file.endsWith('NewsProposals.tsx'))code+='\nexports.ProposalFiles=ProposalFiles;';
 vm.runInContext('(function(exports,require){'+code+'})(exports,require)',context);
 return{calls,render(name,props){cursor=0;const tree=context.exports[name](props);while(effects.length)effects.shift()();return tree},
  async advance(ms){const until=now+ms;for(;;){const due=[...timers].filter(([,t])=>t.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;now=due[1].at;if(due[1].interval)due[1].at+=due[1].interval;else timers.delete(due[0]);due[1].fn();await tick()}now=until;await tick()},
  visible(value){document.visibilityState=value?'visible':'hidden';document.dispatchEvent({type:'visibilitychange'})},
  releaseIssue(){resolveIssue?.()},
  releaseMutation(){resolveMutation?.()},
  close(){for(const h of hooks)h?.cleanup?.();assert.equal(timers.size,0,'Unmount cancels intervals');for(const map of Object.values(listeners))for(const fns of map.values())assert.equal(fns.size,0,'Unmount removes listeners')}
 };
}
const count=(r,name)=>r.calls.filter(c=>c.name===name).length;
function find(tree,predicate){if(!tree)return;if(Array.isArray(tree)){for(const child of tree){const found=find(child,predicate);if(found)return found}}else if(typeof tree==='object'){if(predicate(tree))return tree;return find(tree.props?.children,predicate)}}
async function blitz(old=false){const sessions=Array.from({length:40},()=>realm('components/game/Blitz.tsx',old));for(let i=0;i<sessions.length;i++)sessions[i].render('BlitzOverlay',{gameId:'test-game',userId:'00000000-0000-4000-8000-'+String(i).padStart(12,'0'),enabled:true});await tick();for(const r of sessions)await r.advance(20*60000);const times=new Map();for(const r of sessions){const calls=r.calls.filter(c=>c.name==='blitz_open_recent');for(let i=1;i<calls.length;i++){assert(calls[i].at-calls[i-1].at<=45000,'Each delivery gap stays within 45 seconds');const bucket=Math.floor(calls[i].at/1000);times.set(bucket,(times.get(bucket)||0)+1)}}const counts={issue:sessions.reduce((n,r)=>n+count(r,'blitz_issue_today'),0),open:sessions.reduce((n,r)=>n+count(r,'blitz_open_recent'),0),peakPollingPerSecond:Math.max(...times.values())};for(const r of sessions)r.close();return counts}
async function inbox(old=false){const sessions=Array.from({length:40},()=>realm('components/game/DocumentTools.tsx',old));for(const r of sessions)r.render('DocumentInbox',{gameId:'test-game',userId:'student',members:[],documents:[],onOpen(){}});await tick();for(let iteration=0;iteration<60;iteration++)for(const r of sessions){await r.advance(20000);r.render('DocumentInbox',{gameId:'test-game',userId:'student',members:[],documents:[],onOpen(){}});await tick()}const reads=sessions.reduce((n,r)=>n+count(r,'formal_document_deliveries'),0);for(const r of sessions)r.close();return reads}
async function media(old=false){const sessions=Array.from({length:40},()=>realm('components/game/NewsProposals.tsx',old));const props=()=>({files:[{storage_path:'game/synthetic-file',file_name:'test.pdf',media_kind:'file'}]});for(const r of sessions)r.render('ProposalFiles',props());await tick();for(let iteration=0;iteration<60;iteration++)for(const r of sessions){await r.advance(20000);r.render('ProposalFiles',props());await tick()}const reads=sessions.reduce((n,r)=>n+count(r,'signedUrl'),0);for(const r of sessions)r.close();return reads}
async function main(){
 const before=compareRef?{reference:compareRef,blitz:await blitz(true),inbox:await inbox(true),media:await media(true)}:null;
 const blitzBefore=blitzCompareRef?{reference:blitzCompareRef,...await blitz(blitzCompareRef)}:null;
 const after={blitz:await blitz(),inbox:await inbox(),media:await media()};
 assert.equal(after.blitz.issue,40,'Daily preparation once per mounted student session/day');
 assert(after.blitz.open>=1080&&after.blitz.open<=1120,'Delivery retains its 45-second maximum gap with at most one extra check per client');assert(after.blitz.peakPollingPerSecond<=8,'Polling starts are distributed across the classroom');assert(after.inbox<=840,'Inbox retains a 60–75s fallback when its table is not in the live Realtime publication, without document-identity reloads');assert.equal(after.media,40,'Unchanged attachments reuse still-valid signed links');
 if(before){assert(after.blitz.issue<before.blitz.issue);assert.equal(after.blitz.open,before.blitz.open);assert(after.inbox<before.inbox/2);assert(before.media>after.media*20)}
 if(blitzBefore){assert.equal(after.blitz.issue,blitzBefore.issue);assert(after.blitz.open>=blitzBefore.open&&after.blitz.open<=blitzBefore.open+40);assert(after.blitz.peakPollingPerSecond<=blitzBefore.peakPollingPerSecond)}
 const hidden=realm('components/game/Blitz.tsx',false,{hidden:true});hidden.render('BlitzOverlay',{gameId:'test-game',enabled:true});await tick();await hidden.advance(20*60000);assert.equal(hidden.calls.length,0,'Hidden tabs cannot prepare or start timed questions');hidden.visible(true);await tick();assert.equal(count(hidden,'blitz_issue_today'),1);assert.equal(count(hidden,'blitz_open_recent'),1);hidden.close();
 const failed=realm('components/game/Blitz.tsx',false,{issueError:true});failed.render('BlitzOverlay',{gameId:'test-game',enabled:true});await tick();await failed.advance(20*60000);assert.equal(count(failed,'blitz_issue_today'),1,'An issuance failure must not repeat a heavy backfill every 45 seconds');assert(count(failed,'blitz_open_recent')>20,'Already assigned questions remain deliverable despite issuance failure');failed.close();
 const slow=realm('components/game/Blitz.tsx',false,{slowIssue:true});slow.render('BlitzOverlay',{gameId:'test-game',enabled:true});await tick();await slow.advance(135000);assert.equal(count(slow,'blitz_issue_today'),1,'Slow preparation stays single-flight');slow.visible(false);slow.releaseIssue();await tick();assert.equal(count(slow,'blitz_open_recent'),0,'Becoming hidden during preparation cannot start a 20-second question');slow.close();
 const boundary=realm('components/game/Blitz.tsx');boundary.render('BlitzOverlay',{gameId:'test-game',enabled:true});await tick();await boundary.advance(9*60*60000+45000);assert.equal(count(boundary,'blitz_issue_today'),2,'Moscow midnight starts the next assignment day');boundary.close();
 const identity=realm('components/game/Blitz.tsx');identity.render('BlitzOverlay',{gameId:'test-game',userId:'student-A',enabled:true});await tick();identity.render('BlitzOverlay',{gameId:'test-game',userId:'student-B',enabled:true});await tick();assert.equal(count(identity,'blitz_issue_today'),2,'A different authenticated student gets independent daily preparation');identity.close();
 const stage=realm('components/game/Blitz.tsx');stage.render('BlitzOverlay',{gameId:'test-game',userId:'student-A',stageKey:'1:locked:',enabled:true});await tick();stage.render('BlitzOverlay',{gameId:'test-game',userId:'student-A',stageKey:'1:open:2026-10-25T12:01:00Z',enabled:true});await tick();assert.equal(count(stage,'blitz_issue_today'),2,'Opening a stage prepares newly eligible assignments in the same session/day');await stage.advance(135000);assert.equal(count(stage,'blitz_issue_today'),2,'Stage preparation does not repeat on delivery polls');stage.close();
 const attachment=realm('components/game/NewsProposals.tsx');const files=[{storage_path:'private/synthetic',file_name:'test.pdf',media_kind:'file'}];attachment.render('ProposalFiles',{files});await tick();await attachment.advance(55*60000+1);assert.equal(count(attachment,'signedUrl'),2,'Visible expiring links renew even when the files object never changes');attachment.close();
 const hiddenAttachment=realm('components/game/NewsProposals.tsx');hiddenAttachment.render('ProposalFiles',{files});await tick();hiddenAttachment.visible(false);await hiddenAttachment.advance(70*60000);assert.equal(count(hiddenAttachment,'signedUrl'),1,'Hidden tabs do not renew media links');hiddenAttachment.visible(true);await tick();assert.equal(count(hiddenAttachment,'signedUrl'),2,'Returning to an expired link renews it once');hiddenAttachment.close();
 const civic=realm('components/game/CivicDiscussion.tsx',false,{slowMutation:true});
 const discussion=(target='post-A',user='student-A',readOnly=false)=>civic.render('default',{kind:'post',targetId:target,readOnly,g:{game:{id:'test-game'},me:{user_id:user},members:[],profiles:[],teacher:false,refresh:async()=>{}}});
 discussion();await tick();discussion();await tick();let tree=discussion();
 find(tree,n=>n.type==='button'&&n.props['aria-expanded']!==undefined).props.onClick();tree=discussion();await tick();tree=discussion();
 find(tree,n=>n.type==='textarea').props.onChange({target:{value:'Подтвердите основание решения.'}});tree=discussion();
 const submit=find(tree,n=>n.type==='form').props.onSubmit;submit({preventDefault(){}});submit({preventDefault(){}});await tick();
 assert.equal(count(civic,'comment_on_civic_content'),1,'Rapid repeat submission must issue one mutation');
 find(tree,n=>n.type==='textarea').props.onChange({target:{value:'Дополнение, написанное во время сохранения.'}});tree=discussion();
 civic.releaseMutation();await tick();tree=discussion();assert.equal(find(tree,n=>n.type==='textarea').props.value,'Дополнение, написанное во время сохранения.','A completed save preserves newer text typed in the same discussion');
 find(tree,n=>n.type==='form').props.onSubmit({preventDefault(){}});await tick();
 tree=discussion('post-B','student-B');await tick();tree=discussion('post-B','student-B');
 find(tree,n=>n.type==='button'&&n.props['aria-expanded']!==undefined).props.onClick();tree=discussion('post-B','student-B');await tick();tree=discussion('post-B','student-B');
 find(tree,n=>n.type==='textarea').props.onChange({target:{value:'Новый черновик другого участника.'}});tree=discussion('post-B','student-B');
 civic.releaseMutation();await tick();tree=discussion('post-B','student-B');
 assert.equal(find(tree,n=>n.type==='textarea').props.value,'Новый черновик другого участника.','A late old-target save cannot clear a new target/user draft');
 discussion('post-B','observer',true);await tick();const readonly=discussion('post-B','observer',true);find(readonly,n=>n.type==='button'&&n.props['aria-label']==='Нравится').props.onClick();await tick();
 assert.equal(count(civic,'react_to_civic_content'),0,'Read-only clients cannot invoke civic mutations through a stale handler');civic.close();
 for(const file of ['BudgetAmendments','DocumentTools','DocumentsView','NewsProposals','PoliticalWallView','EventCollaboration','ClassroomJournal','BlitzKnowledgeScore','CivicDiscussion']){
  const source=current('components/game/'+file+'.tsx');const sf=ts.createSourceFile(file+'.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);assert.equal(sf.parseDiagnostics.length,0,file+' syntax');assert(source.includes('useGameTableSync('),file+' uses shared invalidation');assert(!/setInterval\(/.test(source),file+' must not add an independent interval');
 }
 console.log(JSON.stringify({environment:'40 independent component-effect realms, 20 virtual minutes, synthetic replies; no production/Auth/HTTP load',before,blitzBefore,after,checks:['hidden timed questions','midnight rollover','stage opening prepares newly eligible assignments','slow request single-flight','failed backfill bounded','delivery cadence preserved','unchanged attachment signing','signed URL automatic expiry renewal','hidden signed links wait for visibility','unchanged document identities','civic submission single-flight','old civic save preserves new user/target draft','read-only civic mutations blocked']},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1});
