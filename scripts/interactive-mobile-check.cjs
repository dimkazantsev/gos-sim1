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
 const [rules,setRules]=useState(impactRules);
 useEffect(()=>{document.body.dataset.uiReady='yes';return()=>{delete document.body.dataset.uiReady}},[]);
 const g={metrics,impactRules:rules,impactLedger:[],names:{},
   updateImpactRule:async(id:string,enabled:boolean,auto_apply:boolean,effects:unknown,description:string)=>{
    setRules(prev=>prev.map(rule=>rule.id===id?{...rule,enabled,auto_apply,effects:effects as typeof rule.effects,description,updated_at:new Date().toISOString()}:rule));
    return true;
   },revertImpactEntry:async()=>true} as unknown as ReturnTypeRepublic;
 return <div style={{width:'100%',maxWidth:'100vw',padding:'12px 12px 120px'}}>
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
const address='http://127.0.0.1:3998/ui-interaction-test-route';
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
 await desktop.goto(address);
 await desktop.waitForFunction(()=>document.body.dataset.uiReady==='yes');
 await desktop.locator('.mobileDockItem').first().waitFor();
 for(const width of [320,360,390,430,768])await checkUnits(desktop,width);
 await desktop.setViewportSize({width:390,height:850});
 await desktop.getByRole('button',{name:'Все разделы'}).click();
 const modal=desktop.getByRole('dialog',{name:'Все разделы'});
 await modal.waitFor({state:'visible'});
 await modal.locator('.mobileAllGrid button').first().waitFor();
 assert.equal(await modal.locator('.mobileAllGrid button').count(),9,'All nine real routes are in a single menu');
 const menuBounds=await modal.evaluate(el=>{const a=el.getBoundingClientRect();return {top:a.top,bottom:a.bottom,height:innerHeight}});
 assert(menuBounds.top>=-2&&menuBounds.bottom<=menuBounds.height+2);
 await desktop.screenshot({path:path.join(screens,'real-all-sections.png')});
 await modal.getByRole('button',{name:'Закрыть'}).click();
 let keys=await order(desktop);
 assert.equal(keys[0],'teacher');
 // Mouse long press must activate the mode; pointer capture must not block drop targeting.
 const from=await desktop.locator('[data-dock-item="teacher"]').boundingBox();
 const to=await desktop.locator('[data-dock-item="stages"]').boundingBox();
 await desktop.mouse.move(from.x+from.width/2,from.y+from.height/2);
 await desktop.mouse.down();
 await sleep(510);
 assert(await desktop.locator('.mobileDockV2').evaluate(el=>el.classList.contains('isEditing')),'Mouse long-press did not activate editing');
 await desktop.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:8});
 await desktop.mouse.up();
 keys=await order(desktop);
 assert.deepEqual(keys.slice(0,3),['dashboard','stages','teacher'],'Mouse drag did not reorder: '+keys.join(','));
 await desktop.getByRole('button',{name:'Готово'}).click();
 await desktop.reload();
 await desktop.waitForFunction(()=>document.body.dataset.uiReady==='yes');
 assert.deepEqual((await order(desktop)).slice(0,3),['dashboard','stages','teacher'],'Reorder did not survive reload');
 console.log('PASS mouse long press, drag and durable saved order');
 // Use a fresh touch browser profile, with native touch events rather than mouse emulation.
 const touchContext=await browser.newContext({viewport:{width:390,height:850},isMobile:true,hasTouch:true,deviceScaleFactor:1});
 const touch=await touchContext.newPage();
 await touch.goto(address);
 await touch.waitForFunction(()=>document.body.dataset.uiReady==='yes');
 await touch.locator('.mobileDockItem').first().waitFor();
 await touch.evaluate(()=>localStorage.removeItem('dock-interaction-ci'));
 await touch.reload();
 await touch.waitForFunction(()=>document.body.dataset.uiReady==='yes');
 const touchFrom=await touch.locator('[data-dock-item="teacher"]').boundingBox();
 const touchTo=await touch.locator('[data-dock-item="stages"]').boundingBox();
 const cdp=await touchContext.newCDPSession(touch);
 const tx=touchFrom.x+touchFrom.width/2,ty=touchFrom.y+touchFrom.height/2;
 const toX=touchTo.x+touchTo.width/2,toY=touchTo.y+touchTo.height/2;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:tx,y:ty}]});
 await sleep(540);
 assert(await touch.locator('.mobileDockV2').evaluate(el=>el.classList.contains('isEditing')),'Touch long-press did not activate editing');
 for(let i=1;i<=8;i++){
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:tx+(toX-tx)*i/8,y:ty+(toY-ty)*i/8}]});
  await sleep(35);
 }
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 assert.deepEqual((await order(touch)).slice(0,3),['dashboard','stages','teacher'],'Native touch drag did not reorder');
 await touch.getByRole('button',{name:'Готово'}).click();
 await touch.reload();
 await touch.waitForFunction(()=>document.body.dataset.uiReady==='yes');
 assert.deepEqual((await order(touch)).slice(0,3),['dashboard','stages','teacher'],'Touch drag order not saved');
 console.log('PASS native touch hold + drag and persistence');
 await touch.screenshot({path:path.join(screens,'real-dragged-mobile.png')});
 await touchContext.close();
}finally{
 if(browser)await browser.close();
 if(server?.exitCode!==null)console.log('Next dev server output:',lines.join('').slice(-5000));
 if(server){server.kill('SIGTERM');await sleep(1500)}
 fs.rmSync(route,{recursive:true,force:true});
}
}
main().catch(error=>{console.error(error);process.exitCode=1});
