/* Exercise the REAL interactive React dock and impact inputs in Chromium/iOS-style touch mode.
   A temporary Next.js page is created only while this test runs and is deleted afterward. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..');
const route=path.join(root,'app','ui-interaction-test-route');
const screens=path.join(root,'.design-review','screenshots');
fs.mkdirSync(screens,{recursive:true});
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser','/opt/google/chrome/chrome'].find(p=>p&&fs.existsSync(p));
if(!chrome)throw Error('Chrome is required for real mobile interactions');
const pageSource=String.raw`'use client';
import {useState,useEffect} from 'react';
import {LayoutDashboard,Settings2,Landmark,Vote,BookOpenText,FileText,GraduationCap,Radio,UserRound} from 'lucide-react';
import MobileDock from '../../components/game/MobileDock';
import ImpactRulesPanel from '../../components/game/ImpactRulesPanel';
import EventCaseTile from '../../components/game/EventCaseTile';
import EventCaseModal from '../../components/game/EventCaseModal';
import EventComic from '../../components/game/EventComic';
import EventChoicePanel from '../../components/game/EventChoicePanel';
import VoteBallotControls from '../../components/game/VoteBallotControls';
import authoredCases from '../../content/events-v2.json';
import type {View} from '../../components/game/types';
import type {ReturnTypeRepublic} from '../../components/game/viewTypes';
const available:[View,string,typeof Settings2][]=[
 ['teacher','Управление',Settings2],['dashboard','Обзор игры',LayoutDashboard],
 ['stages','Этапы и задачи',BookOpenText],['votes','Голосования',Vote],
 ['actions','Политические процессы',Radio],['parties','Партии',Landmark],
 ['documents','Реестр НПА',FileText],['grades','Оценки и разбор',GraduationCap],
 ['profile','Мой профиль',UserRound]
];
const metrics=[{id:'m1',metric_key:'public_trust',label:'Общественное доверие',unit:'%'},{id:'m2',metric_key:'support',label:'Поддержка граждан',unit:'п.п.'},{id:'m3',metric_key:'budget',label:'Федеральный бюджет',unit:'млрд ₽'}];
const impactRules=[{id:'r1',rule_key:'decision',label:'Принятие решения',event_type:'decision_approved',description:'Проверка длинных единиц.',conditions:{},effects:{metrics:{public_trust:2,support:1,budget:-1},actor_party_support:3},enabled:true,auto_apply:true,priority:1,created_at:'2026-09-29T00:00:00Z',updated_at:'2026-09-29T00:00:00Z'}];
export default function UiTest(){
 const [editing,setEditing]=useState(false),[menu,setMenu]=useState(false),[active,setActive]=useState<View>('teacher');
 const [rules,setRules]=useState(impactRules),[opened,setOpened]=useState(''),[answer,setAnswer]=useState(''),[allocation,setAllocation]=useState('');
 const caseTiles=authoredCases.slice(0,8).map(c=>({...c,id:c.case_key})),activeCase=caseTiles.find(c=>c.id===opened);
 useEffect(()=>{document.body.dataset.uiReady='yes';return()=>{delete document.body.dataset.uiReady}},[]);
 const g={teacher:true,game:{id:'ui-test'},metrics:metrics.map(m=>({...m,value:68,min_value:0,max_value:100})),impactRules:rules,impactLedger:[],names:{},
   updateImpactRule:async(id:string,enabled:boolean,auto_apply:boolean,effects:unknown,description:string)=>{
    setRules(prev=>prev.map(rule=>rule.id===id?{...rule,enabled,auto_apply,effects:effects as typeof rule.effects,description,updated_at:new Date().toISOString()}:rule));
    return true;
   },revertImpactEntry:async()=>true} as unknown as ReturnTypeRepublic;
 return <div style={{width:'100%',maxWidth:'100vw',padding:'12px 12px 120px'}}>
  <section className="interfaceCaseTest"><div className="eventTileGrid">{caseTiles.map(c=><EventCaseTile key={c.id} item={c} meta={c.category} onClick={()=>{setOpened(c.id);setAnswer('')}}/>)}</div></section>
  {activeCase&&<EventCaseModal title={activeCase.title} onClose={()=>setOpened('')}><EventComic title={activeCase.title} caseKey={activeCase.case_key} category={activeCase.category} scene={activeCase.comic_scene}/><p>{activeCase.situation}</p><EventChoicePanel labels={activeCase.decision_options} decisions={[{actor_id:'a',choice:'option_1'},{actor_id:'b',choice:'option_2'},...(answer?[{actor_id:'c',choice:answer}]:[])]} members={[{user_id:'a',full_name:'Анна'},{user_id:'b',full_name:'Илья'},{user_id:'c',full_name:'Мария'}] as any} profiles={[]} currentChoice={answer} canAnswer={!answer} onAnswer={setAnswer}/></EventCaseModal>}
  <section className="civicVotes"><VoteBallotControls vote={{id:'test-vote',voting_mode:'mandate',status:'open',allow_abstain:true} as any} maxWeight={216} canCast={true} onSubmit={async(y,n,a)=>{setAllocation([y,n,a].join('/'));return true}}/><output id="ballot-result">{allocation}</output></section>
  <main className="teacherSimple"><ImpactRulesPanel g={g} initialExpandedRuleId="r1"/></main>
  {menu&&<div className="mobileMoreBackdrop" onClick={()=>setMenu(false)}>
   <section className="mobileMoreSheet" role="dialog" aria-label="Все разделы" onClick={e=>e.stopPropagation()}>
    <header><b>Все разделы игры</b><button onClick={()=>setMenu(false)}>Закрыть</button></header>
    <div className="mobileAllGrid">{available.map(([key,label,Icon])=><button key={key} onClick={()=>{setActive(key);setMenu(false)}}><Icon/><span>{label}</span></button>)}</div>
   </section>
  </div>}
  <MobileDock items={available.map(([key,label,Icon])=>({key,label,icon:<Icon/>}))}
   activeView={active} storageKey="dock-interaction-ci" editing={editing} setEditing={setEditing}
   onNavigate={setActive} onAll={()=>setMenu(true)}/>
 </div>;
}
`;
let server,browser;
const address='http://localhost:3998/ui-interaction-test-route';
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
async function ready(){
 for(let n=0;n<45;n++){
  if(server.exitCode!==null)throw Error('Next dev server exited prematurely: '+server.exitCode);
  try{const r=await fetch(address,{signal:AbortSignal.timeout(5000)});if(r.ok)return}catch{}
  await sleep(1000);
 }
 throw Error('Next dev page did not become available');
}
function order(page){return page.locator('.mobileDockItem').evaluateAll(els=>els.map(x=>x.dataset.dockItem))}
async function checkUnits(page,width){
 await page.setViewportSize({width,height:850});
 const measurements=await page.locator('.impactNumeric').evaluateAll(nodes=>nodes.map(el=>{
  const r=el.getBoundingClientRect(),input=el.querySelector('input').getBoundingClientRect(),unit=el.querySelector('em').getBoundingClientRect();
  return {bounds:[r.left,r.right],input:[input.left,input.right],unit:[unit.left,unit.right],
   label:el.closest('label').getBoundingClientRect().toJSON()};
 }));
 assert(measurements.length>=3);
 for(const m of measurements){
  assert(m.input[1]<=m.unit[0]+2,'Input collides with its unit at '+width+': '+JSON.stringify(m));
  assert(m.unit[1]<=m.bounds[1]+2,'Unit escapes field at '+width+': '+JSON.stringify(m));
  assert(m.bounds[0]>=m.label.left-2&&m.bounds[1]<=m.label.right+2,'Field escapes label at '+width+': '+JSON.stringify(m));
 }
 const doc=await page.locator('html').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));
 assert(doc.scroll<=doc.width+3,'Document overflow at '+width+': '+JSON.stringify(doc));
 console.log('PASS bounded units '+width+'px: '+measurements.length+' fields');
}
async function main(){
 fs.mkdirSync(route,{recursive:true});
 fs.writeFileSync(path.join(route,'page.tsx'),pageSource);
 server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'dev','-p','3998'],{
  cwd:root,stdio:['ignore','pipe','pipe'],
  env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'placeholder'}
 });
 const lines=[];
 server.stdout.on('data',chunk=>{lines.push(String(chunk));if(lines.length>50)lines.shift()});
 server.stderr.on('data',chunk=>{lines.push(String(chunk));if(lines.length>50)lines.shift()});
 try{
 await ready();
 browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
 const desktop=await browser.newPage({viewport:{width:390,height:850}});
 desktop.on('pageerror',err=>console.error('BROWSER PAGE ERROR:',String(err)));
 desktop.on('console',msg=>{if(msg.type()==='error')console.error('BROWSER CONSOLE ERROR:',msg.text())});
 await desktop.goto(address);
 // Next.js development overlay sits above the fixed dock; disable only in CI's browser page.
 await desktop.addStyleTag({content:'nextjs-portal{display:none!important;pointer-events:none!important}'});
 await desktop.waitForFunction(()=>document.body.dataset.uiReady==='yes',null,{timeout:30000});
 await desktop.locator('.mobileDockItem').first().waitFor();
 // Real case tiles open a separate accessible dialog; Escape restores focus.
 for(const width of [390,1440]){
  await desktop.setViewportSize({width,height:900});
  const tile=desktop.locator('.eventCaseTile').first();await tile.click();
  const modal=desktop.getByRole('dialog');await modal.waitFor();
  assert.equal(await modal.locator('svg[data-scene]').count(),1,'One case, one illustration');
  assert.equal(await modal.locator('.eventOptionButtons').count(),0,'No duplicate answer controls');
  const answers=modal.locator('.eventAnswerChoice');assert.equal(await answers.count(),require('../content/events-v2.json')[0].decision_options.length,'All authored options are rendered once');await answers.first().click();await desktop.waitForFunction(()=>document.querySelector('.eventAnswerChoice[aria-pressed=true]')?.textContent.includes('67%'));assert.equal(await answers.first().locator('.eventVoter').count(),2);assert.equal(await answers.first().isDisabled(),true,'Submitted answer is locked');
  const modalBounds=await modal.boundingBox();assert(modalBounds.width<=width-15,'Modal fits the viewport');
  await desktop.screenshot({path:path.join(screens,'event-modal-'+width+'.png')});
  await desktop.keyboard.press('Escape');await modal.waitFor({state:'detached'});
  assert.equal(await desktop.locator('.eventCaseTile').first().evaluate(el=>document.activeElement===el),true,'Closing returns focus to its tile');
 }
 await desktop.getByRole('checkbox',{name:'Указать количество голосов'}).check();
 await desktop.locator('.civicQuantity input').fill('100');await desktop.getByRole('button',{name:'За · 100',exact:true}).click();await desktop.waitForFunction(()=>document.querySelector('#ballot-result')?.textContent==='100/0/0');
 await desktop.getByRole('checkbox',{name:'Распределить голоса между вариантами'}).check();
 const splitInputs=desktop.locator('.civicSplitInputs input');await splitInputs.nth(0).fill('180');await splitInputs.nth(1).fill('20');await splitInputs.nth(2).fill('10');
 await desktop.getByRole('button',{name:'Подать голоса · 210',exact:true}).click();await desktop.waitForFunction(()=>document.querySelector('#ballot-result')?.textContent==='180/20/10');
 await splitInputs.nth(0).fill('200');assert.equal(await desktop.getByRole('button',{name:'Подать голоса · 230',exact:true}).isDisabled(),true,'An over-allocation cannot be submitted');await splitInputs.nth(0).fill('180');
 console.log('PASS Real case choices, percentages, avatars and partial/split mandate ballots');
 for(const width of [320,390,1440]){
  await desktop.setViewportSize({width,height:900});
  const values=await desktop.locator('.metricValueControl').evaluateAll(nodes=>nodes.map(el=>el.getBoundingClientRect().toJSON()));
  assert.equal(values.length,2);assert(Math.abs(values[0].top-values[1].top)<1,'Current/new controls share their baseline');assert.equal(values[0].height,values[1].height);
  assert(values.every(r=>r.left>=0&&r.right<=width),'Value fields stay in the viewport');
 }
 console.log('PASS Case modal, Escape, focus restoration and standardized metric fields');
 for(const width of [320,360,390,430,768])await checkUnits(desktop,width);
 await desktop.setViewportSize({width:390,height:850});
 const dockGeom=await desktop.locator('.mobileDockV2').evaluate(el=>{
  const scroll=el.querySelector('.mobileDockScroll'),item=el.querySelector('.mobileDockItem'),icon=el.querySelector('.mobileDockIcon svg');
  return {dock:el.getBoundingClientRect().height,item:item.getBoundingClientRect().width,icon:icon.getBoundingClientRect().width,scroll:scroll.scrollWidth,client:scroll.clientWidth};
 });
 assert(dockGeom.dock<=82,'Dock became too tall: '+JSON.stringify(dockGeom));
 assert(dockGeom.item>=60&&dockGeom.item<=78&&dockGeom.icon>=22&&dockGeom.icon<=24,'Dock touch targets or icons have the wrong size: '+JSON.stringify(dockGeom));
 const swipeResult=await desktop.locator('.mobileDockScroll').evaluate(async el=>{
  el.scrollLeft=0;
  const item=el.querySelector('.mobileDockItem'),r=item.getBoundingClientRect();
  const id=71,x=r.left+r.width/2,y=r.top+r.height/2;
  item.dispatchEvent(new PointerEvent('pointerdown',{pointerId:id,pointerType:'touch',isPrimary:true,clientX:x,clientY:y,bubbles:true}));
  item.dispatchEvent(new PointerEvent('pointermove',{pointerId:id,pointerType:'touch',isPrimary:true,clientX:x-70,clientY:y,bubbles:true,cancelable:true}));
  item.dispatchEvent(new PointerEvent('pointerup',{pointerId:id,pointerType:'touch',isPrimary:true,clientX:x-70,clientY:y,bubbles:true}));
  await new Promise(r=>setTimeout(r,80));
  return {left:el.scrollLeft,max:el.scrollWidth-el.clientWidth};
 });
 if(swipeResult.max>4)assert(swipeResult.left>0,'Pointer swipe must move the dock: '+JSON.stringify(swipeResult));
 await desktop.getByRole('button',{name:'Все разделы'}).click();
 const modal=desktop.getByRole('dialog',{name:'Все разделы'});
 await modal.waitFor({state:'visible'});
 await modal.locator('.mobileAllGrid button').first().waitFor();
 assert.equal(await modal.locator('.mobileAllGrid button').count(),9,'All nine real routes are in a single menu');
 const menuBounds=await modal.evaluate(el=>{const a=el.getBoundingClientRect();return {top:a.top,bottom:a.bottom,height:innerHeight}});
 assert(menuBounds.top>=-2&&menuBounds.bottom<=menuBounds.height+2);
 await desktop.screenshot({path:path.join(screens,'real-all-sections.png')});
 await modal.getByRole('button',{name:'Закрыть'}).click();
 await modal.waitFor({state:'hidden'});
 await desktop.locator('.mobileDockScroll').evaluate(el=>{el.style.scrollBehavior='auto';el.scrollLeft=0});
 await desktop.evaluate(()=>{window.__dockEvents=[];document.addEventListener('pointerdown',e=>{window.__dockEvents.push({type:'down',node:e.target.closest('button')?.dataset?.dockItem||'',html:e.target.outerHTML.slice(0,250),x:e.clientX,y:e.clientY})},true);document.addEventListener('pointercancel',e=>window.__dockEvents.push({type:'cancel'}),true);});
 let keys=await order(desktop);
 assert.equal(keys[0],'teacher');
 // Mouse long press must activate the mode; pointer capture must not block drop targeting.
 const from=await desktop.locator('[data-dock-item="teacher"]').boundingBox();
 const to=await desktop.locator('[data-dock-item="stages"]').boundingBox();
 console.log('DRAG FROM',from,'TO',to,'ELEMENT UNDER',await desktop.evaluate(({x,y})=>document.elementFromPoint(x,y)?.outerHTML.slice(0,400),{x:from.x+from.width/2,y:from.y+from.height/2}));
 await desktop.mouse.move(from.x+from.width/2,from.y+from.height/2);
 await desktop.mouse.down();
 try{await desktop.waitForFunction(()=>document.querySelector('.mobileDockV2')?.classList.contains('isEditing'),null,{timeout:4500});}catch(err){console.error('POINTER DIAGNOSTIC',await desktop.evaluate(()=>({events:window.__dockEvents,at:document.elementFromPoint(innerWidth/2,innerHeight-30)?.outerHTML.slice(0,300),nav:document.querySelector('.mobileDock')?.className})));throw err}
 await desktop.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:8});
 await desktop.mouse.up();
 keys=await order(desktop);
 assert.deepEqual(keys.slice(0,3),['dashboard','stages','teacher'],'Mouse drag did not reorder: '+keys.join(','));
 await desktop.getByRole('button',{name:'Готово'}).click();
 await desktop.reload();
 await desktop.waitForFunction(()=>document.body.dataset.uiReady==='yes');
 // Hydration marks the page ready before the dock's persisted-order effect has committed.
 await desktop.waitForFunction(()=>[...document.querySelectorAll('.mobileDockItem')].slice(0,3).map(x=>x.dataset.dockItem).join(',')==='dashboard,stages,teacher',null,{timeout:4500});
 assert.deepEqual((await order(desktop)).slice(0,3),['dashboard','stages','teacher'],'Reorder did not survive reload');
 console.log('PASS mouse long press, drag and durable saved order');
 // Use a fresh touch browser profile, with native touch events rather than mouse emulation.
 const touchContext=await browser.newContext({viewport:{width:390,height:850},isMobile:true,hasTouch:true,deviceScaleFactor:1});
 const touch=await touchContext.newPage();
 await touch.goto(address);
 await touch.addStyleTag({content:'nextjs-portal{display:none!important;pointer-events:none!important}'});
 await touch.waitForFunction(()=>document.body.dataset.uiReady==='yes',null,{timeout:12000});
 await touch.locator('.mobileDockItem').first().waitFor();
 await touch.evaluate(()=>{localStorage.removeItem('dock-interaction-ci');localStorage.removeItem('dock-interaction-ci:pinned')});
 await touch.reload();
 await touch.addStyleTag({content:'nextjs-portal{display:none!important;pointer-events:none!important}'});
 await touch.waitForFunction(()=>document.body.dataset.uiReady==='yes');
 // Real finger swipes must move the scroll container BOTH ways without activating editing.
 const cdp=await touchContext.newCDPSession(touch);
 const swipeArea=await touch.locator('.mobileDockScroll').boundingBox();
 const sy=swipeArea.y+swipeArea.height/2;
 const right=swipeArea.x+swipeArea.width-25,left=swipeArea.x+27;
 await touch.locator('.mobileDockScroll').evaluate(el=>el.scrollLeft=0);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:right,y:sy}]});
 for(let i=1;i<=9;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:right+(left-right)*i/9,y:sy}]});await sleep(18)}
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await sleep(380);
 const forward=await touch.locator('.mobileDockScroll').evaluate(el=>({left:el.scrollLeft,max:el.scrollWidth-el.clientWidth}));
 assert(forward.max>160&&forward.left>45,'Leftward finger swipe should scroll to the right: '+JSON.stringify(forward));
 const backRight=swipeArea.x+Math.min(swipeArea.width-20,190),backLeft=swipeArea.x+32;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:backLeft,y:sy}]});
 for(let i=1;i<=9;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:backLeft+(backRight-backLeft)*i/9,y:sy}]});await sleep(18)}
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await sleep(380);
 const backward=await touch.locator('.mobileDockScroll').evaluate(el=>el.scrollLeft);
 assert(backward<forward.left-35,'Rightward finger swipe should scroll back left: '+JSON.stringify({forward,backward}));
 await touch.locator('.mobileDockScroll').evaluate(el=>el.scrollLeft=0);
 console.log('PASS real native touch swipes left and right; remaining dock items are scrollable');
 const touchFrom=await touch.locator('[data-dock-item="teacher"]').boundingBox();
 const touchTo=await touch.locator('[data-dock-item="stages"]').boundingBox();
 const tx=touchFrom.x+touchFrom.width/2,ty=touchFrom.y+touchFrom.height/2;
 const toX=touchTo.x+touchTo.width/2,toY=touchTo.y+touchTo.height/2;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:tx,y:ty}]});
 await touch.waitForFunction(()=>document.querySelector('.mobileDockV2')?.classList.contains('isEditing'),null,{timeout:4500});
 for(let i=1;i<=8;i++){
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:tx+(toX-tx)*i/8,y:ty+(toY-ty)*i/8}]});
  await sleep(35);
 }
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 assert.deepEqual((await order(touch)).slice(0,3),['dashboard','stages','teacher'],'Native touch drag did not reorder');
 console.log('TOUCH SAVED IMMEDIATELY',await touch.evaluate(()=>localStorage.getItem('dock-interaction-ci')));
 await touch.getByRole('button',{name:'Готово'}).click();
 console.log('TOUCH SAVED AFTER DONE',await touch.evaluate(()=>localStorage.getItem('dock-interaction-ci')));
 await touch.reload();
 await touch.waitForFunction(()=>document.body.dataset.uiReady==='yes');
 console.log('TOUCH STORAGE AFTER RELOAD',await touch.evaluate(()=>localStorage.getItem('dock-interaction-ci')));
 // The parent page becomes ready before all client effects necessarily commit.
 await touch.waitForFunction(()=>[...document.querySelectorAll('.mobileDockItem')].slice(0,3).map(x=>x.dataset.dockItem).join(',')==='dashboard,stages,teacher',null,{timeout:4000});
 assert.deepEqual((await order(touch)).slice(0,3),['dashboard','stages','teacher'],'Touch drag order not saved');
 console.log('PASS native touch hold + drag and persistence');
 // Holding stationary beyond the drag delay should pin; the same long hold unpins.
 // Target an actually visible route: a prior swipe can leave the first item clipped.
 await sleep(450);
 const pinPoint=await touch.locator('.mobileDockScroll').evaluate(el=>{
  const r=el.getBoundingClientRect();
  for(const fraction of [.45,.62,.30,.78,.15]){
   const x=r.left+r.width*fraction,y=r.top+r.height/2;
   const item=document.elementFromPoint(x,y)?.closest('[data-dock-item]');
   if(item){const b=item.getBoundingClientRect();return {key:item.dataset.dockItem,label:item.textContent.trim(),x:b.left+b.width/2,y:b.top+b.height/2}}
  }
  return null;
 });
 assert(pinPoint,'At least one scroll-strip item must be visible and tappable');
 const {x:px,y:py}=pinPoint;
 console.log('PIN TARGET',pinPoint);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:px,y:py}]});
 await sleep(1700);
 console.log('PIN DEBUG',await touch.evaluate(()=>({events:window.__pinEvents,storage:localStorage.getItem('dock-interaction-ci:pinned'),pinned:[...document.querySelectorAll('.mobileDockPinnedItem')].map(e=>e.textContent),editing:document.querySelector('.mobileDockV2')?.className,at:document.elementFromPoint(innerWidth/3,innerHeight-30)?.outerHTML.slice(0,180)})));
 await touch.waitForFunction(label=>document.querySelector('.mobileDockPinnedItem')?.textContent?.includes(label),pinPoint.label,{timeout:1200});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 assert.deepEqual(await touch.evaluate(()=>JSON.parse(localStorage.getItem('dock-interaction-ci:pinned')||'[]')),[pinPoint.key]);
 assert.equal(await touch.locator('[data-dock-item="'+pinPoint.key+'"]').count(),0,'Pinned item must leave scroll strip');
 await touch.reload();
 await touch.waitForFunction(()=>document.body.dataset.uiReady==='yes');
 await sleep(650);
 console.log('PIN RELOAD DEBUG',await touch.evaluate(()=>({storage:localStorage.getItem('dock-interaction-ci:pinned'),order:localStorage.getItem('dock-interaction-ci'),pinned:[...document.querySelectorAll('.mobileDockPinnedItem')].map(e=>e.textContent),unPinned:[...document.querySelectorAll('[data-dock-item]')].map(e=>e.dataset.dockItem),dock:document.querySelector('.mobileDockV2')?.outerHTML.slice(0,1200)})));
 await touch.waitForFunction(label=>document.querySelector('.mobileDockPinnedItem')?.textContent?.includes(label),pinPoint.label,{timeout:4500});
 console.log('PASS extra-long touch pins icon next to All sections; pin survives reload');
 const pinButton=await touch.locator('.mobileDockPinnedItem').first().boundingBox();
 const ux=pinButton.x+pinButton.width/2,uy=pinButton.y+pinButton.height/2;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:ux,y:uy}]});
 await touch.waitForFunction(()=>document.querySelectorAll('.mobileDockPinnedItem').length===0,null,{timeout:4500});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 assert.deepEqual(await touch.evaluate(()=>JSON.parse(localStorage.getItem('dock-interaction-ci:pinned')||'[]')),[]);
 assert.equal(await touch.locator('[data-dock-item="'+pinPoint.key+'"]').count(),1,'Unpinned icon must return to scroll strip');
 console.log('PASS extra-long hold unpins icon and restores scroll order');
 await touch.screenshot({path:path.join(screens,'real-dragged-mobile.png')});
 await touchContext.close();
}finally{
 console.log('Next dev server output:',lines.join('').slice(-6000));
 if(browser)await browser.close();
 if(server){server.kill('SIGTERM');await sleep(1500)}
 fs.rmSync(route,{recursive:true,force:true});
 // Next dev generates route validators. The temporary route must leave no stale
 // validator behind or a later production build fails after the route is removed.
 fs.rmSync(path.join(root,'.next','dev','types'),{recursive:true,force:true});
}
}
main().catch(error=>{console.error(error);process.exitCode=1});
