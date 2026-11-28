'use strict';
// Local rendered components and the actual project stylesheet; no hosted API,
// no browser sign-in, no production data. Tests markup and CSS, not live RPC clicks.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..'),out=path.join(root,'.design-review'),shots=path.join(out,'screenshots');
const originalResolve=Module._resolveFilename,originalLoad=Module._load;
Module._resolveFilename=function(request,...args){return originalResolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,...args)};
Module._load=function(request,...args){if(request==='@/lib/supabase')return {supabase:new Proxy({}, {get(){throw Error('Network access forbidden in static fixture')}})};return originalLoad.call(this,request,...args)};
require.extensions['.css']=m=>{m.exports={}};
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,f);
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),h=React.createElement;
const EventCollaboration=require('../components/game/EventCollaboration').default,EventChoicePanel=require('../components/game/EventChoicePanel').default,EventCaseModal=require('../components/game/EventCaseModal').default;
const dir=path.join(root,'content/events-v2-editorial'),cases=fs.readdirSync(dir).filter(n=>/^(collective-|individual-).*\.json$/.test(n)).flatMap(n=>JSON.parse(fs.readFileSync(path.join(dir,n),'utf8')).cases);
assert.equal(cases.length,330);
const longest=kind=>cases.filter(x=>kind==='single'?x.audience==='single':x.audience!=='single').sort((a,b)=>Math.max(...b.decision_options.map(s=>s.length))-Math.max(...a.decision_options.map(s=>s.length)))[0];
const single=longest('single'),collective=longest('all');
const members=[{user_id:'a',full_name:'Участник учебной игры с длинным именем',role_title:'Председатель комитета Государственной Думы по экономической политике',kind:'student'},{user_id:'b',full_name:'Второй участник учебной игры',role_title:'Заместитель Председателя Правительства Российской Федерации — Министерство по социальной политике',kind:'student'},{user_id:'t',full_name:'Преподаватель',kind:'teacher'},{user_id:'v',full_name:'Гость',kind:'observer'}];
const game={id:'fixture'},names=Object.fromEntries(members.map(m=>[m.user_id,m.full_name]));
const props=(who)=>({game,me:members.find(m=>m.user_id===who),teacher:who==='t',members,names,profiles:[]});
let css=fs.readFileSync(path.join(root,'app/globals.css'),'utf8').replace(/@import '\.\/([^']+)' layer\(legacy\);/g,(_,file)=>'@layer legacy {'+fs.readFileSync(path.join(root,'app',file),'utf8')+'}');
for(const match of fs.readFileSync(path.join(root,'app/layout.tsx'),'utf8').matchAll(/import ['"]\.\/([^'"]+\.css)['"]/g)){if(match[1]!=='globals.css')css+='\n'+fs.readFileSync(path.join(root,'app',match[1]),'utf8')}
const scenarios=[
 {name:'student-transfer',who:'a',c:single,assigned:['a'],invites:[],transfer:true,can:true},
 {name:'student-invited',who:'b',c:single,assigned:['a'],invites:[{id:'i',case_id:'fixture',recipient_id:'b',inviter_id:'a',status:'pending'}],transfer:true,can:false},
 {name:'student-transferred',who:'a',c:single,assigned:['b'],invites:[{id:'i',case_id:'fixture',recipient_id:'b',inviter_id:'a',status:'accepted',transfer_stage_no:7}],transfer:true,can:false},
 {name:'teacher',who:'t',c:single,assigned:['a'],invites:[],transfer:true,can:false},
 {name:'guest',who:'v',c:single,assigned:['a'],invites:[],transfer:true,can:false,readonly:true},
 {name:'collective-round2',who:'a',c:collective,assigned:['a','b'],invites:[],transfer:false,can:true,round2:true}
];
fs.mkdirSync(shots,{recursive:true});
const files=new Map();
for(const x of scenarios){
 const content=h(React.Fragment,null,h('h4',null,x.c.title),h('p',null,x.c.original_situation),x.round2?h('p',null,x.c.mandatory_boundary):null,
 h(EventCollaboration,{g:props(x.who),caseId:'fixture',audience:x.c.audience,invitations:x.invites,assignedIds:x.assigned,closed:false,votingStarted:false,onChanged:async()=>{},readOnly:!!x.readonly,transferMode:x.transfer,collectiveMode:!!x.round2}),
 h(EventChoicePanel,{labels:x.c.decision_options,decisions:[],members,profiles:[],canAnswer:x.can,onAnswer:()=>{},revealResults:x.who==='t',shuffleSeed:'fixture',allowedKeys:x.round2?['option_1','option_2']:undefined}));
 const markup=renderToStaticMarkup(h(EventCaseModal,{title:x.c.title,onClose:()=>{}},content));
 const file=path.join(out,'events-v2-'+x.name+'.html');files.set(x.name,file);
 fs.writeFileSync(file,'<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style><body>'+markup+'</body></html>');
}
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser','/opt/google/chrome/chrome'].find(p=>p&&fs.existsSync(p));assert.ok(chrome,'Chromium executable required');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});try{
 const page=await browser.newPage();await page.route(/^https?:\/\//,route=>route.abort());
 for(const x of scenarios)for(const width of [320,390,768,1024,1440]){
  await page.setViewportSize({width,height:900});await page.goto(pathToFileURL(files.get(x.name)).href);
  const dialog=page.getByRole('dialog');assert.equal(await dialog.count(),1);
  const g=await dialog.evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,doc:document.documentElement.scrollWidth,viewport:innerWidth,bodyScroll:el.querySelector('.eventModalBody').scrollWidth,bodyWidth:el.querySelector('.eventModalBody').clientWidth}));
  assert.ok(g.left>=-1&&g.right<=width+1&&g.doc<=width+1,JSON.stringify({scenario:x.name,width,g}));
  assert.ok(g.scroll<=g.width+1&&g.bodyScroll<=g.bodyWidth+1,JSON.stringify({scenario:x.name,width,g}));
  assert.equal(await page.locator('.eventAnswerChoice:enabled').count(),x.can?(x.round2?2:x.c.decision_options.length):0);
  assert.equal(await page.locator('[data-best-option]').count(),0,'No answer key in open fixture');
  if(x.name==='student-invited')assert.equal(await page.getByRole('button',{name:'Принять ситуацию',exact:true}).count(),1);
  if(x.name==='student-transfer')assert.equal(await page.getByRole('button',{name:'Передать ситуацию',exact:true}).count(),1);
  if(x.name==='student-transferred')assert.ok((await dialog.innerText()).includes('0,5 балла'));
  if(x.name==='guest')assert.equal(await page.locator('.eventCollaboration button').count(),0);
  if(x.round2)assert.equal(await page.locator('.eventAnswerChoice').count(),2);
  if(width===390||width===1440)await page.screenshot({path:path.join(shots,'events-v2-'+x.name+'-'+width+'.png')});
 }
 console.log('PASS actual components and project CSS: 6 role/state variants × 5 widths, no horizontal overflow, expected controls, no open key; local static fixture only');
 }finally{await browser.close()}})().catch(e=>{console.error(e.message);process.exitCode=1});
