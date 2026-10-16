/* The real React header and teacher tabs share one sticky container.
   Uses the application's complete CSS import order, including chat overrides. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {chromium}=require('playwright-core');
const {startTestServer,closeTestBrowser,stopTestServer,cleanTestRoute}=require('./browser-test-runtime.cjs');
const root=path.resolve(__dirname,'..'),route=path.join(root,'app','teacher-header-test-route');
const shots=path.join(root,'.design-review','screenshots');
const exe=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser',chromium.executablePath()].find(p=>p&&fs.existsSync(p));
if(!exe)throw Error('Chromium required for unified teacher header regression');
const source=String.raw`'use client';
import {useEffect,useState} from 'react';
import {Eye,ChevronLeft,ChevronRight,Share2,Radio,MessageCircle} from 'lucide-react';
import GameHeader,{TeacherNavigationProvider} from '../../components/game/GameHeader';
import TeacherView from '../../components/game/TeacherView';
import fixture from '../../.design-review/fixture.json';
import type {ReturnTypeRepublic} from '../../components/game/viewTypes';
const noop=()=>{};
export default function HeaderTest(){
 const [chat,setChat]=useState(false),[teacher,setTeacher]=useState(true);
 useEffect(()=>{setChat(new URLSearchParams(location.search).has('chat'));document.body.dataset.headerReady='yes';return()=>{delete document.body.dataset.headerReady}},[]);
 const g=new Proxy({...fixture,teacher:true,setChatOpen:setChat},{get:(target,key)=>key in target?target[key as keyof typeof target]:noop}) as unknown as ReturnTypeRepublic;
 return <div className="simShell"><aside className="simSidebar">ГОС.ID</aside>
  <TeacherNavigationProvider><div className={'simWorkspace '+(chat?'chatOpen':'')}>
   <GameHeader teacherNavigation={teacher}><header className="simTop">
    <div className="mobileBrand"><b>ГОС.ID</b></div>
    <nav className="topScreenHistory"><button className="screenHistoryButton" aria-label="Назад"><ChevronLeft/></button><button className="screenHistoryButton" aria-label="Вперёд"><ChevronRight/></button></nav>
    <div className="simTopCenter"><div className="topStageCopy"><small>ЭТАП 01</small><strong>Управление</strong></div>
     <div className="topIndicators"><span className="livePill on"><Radio/><span className="livePillText">Ход открыт</span></span>
      <button className="gameShareScreen" aria-label="Поделиться"><Share2/><span>Поделиться</span></button>
      <span className="timerPill timerPillDuration"><span className="timerPillUnit"><strong>14</strong><span className="timerPillUnitFull">ДНИ</span><span className="timerPillUnitCompact">д</span></span><span className="timerPillUnit"><strong>22</strong><span className="timerPillUnitFull">ЧАСЫ</span><span className="timerPillUnitCompact">ч</span></span><span className="timerPillUnit"><strong>12</strong><span className="timerPillUnitFull">МИНУТЫ</span><span className="timerPillUnitCompact">м</span></span></span>
     </div></div>
    <div className="viewAsSwitcher"><button className="viewAsTrigger" aria-label="Сменить режим просмотра" onClick={()=>setTeacher(v=>!v)}><Eye className="viewAsMobileIcon"/><span className="viewAsTriggerText"><small>РЕЖИМ ПРОСМОТРА</small><strong>Преподаватель</strong></span></button></div>
    <button className="topChatButton" onClick={()=>setChat(v=>!v)}><MessageCircle/><span>Чат</span></button>
   </header></GameHeader>
   <div className="simContentFlow">
    <section className="crisisNotice">Тестовое уведомление между шапкой и рабочей областью</section>
    <main id="game-main" className={'simMain '+(chat?'chatOpen':'')} style={{minHeight:1800}}>
     {teacher?<TeacherView g={g} initialWorkspace="analytics" onOpenProcesses={noop} onOpenStages={noop}/>:<section>Другой раздел</section>}
    </main>
   </div>
  </div></TeacherNavigationProvider>
 </div>;
}`;
let browser,server;
const logs=[],address='http://127.0.0.1:4006/teacher-header-test-route';
async function ready(){
 for(let n=0;n<60;n++){
  if(server.exitCode!==null)throw Error('Next server exited: '+logs.join(''));
  try{const r=await fetch(address);if(r.ok)return}catch{}
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 throw Error('Header test route did not start: '+logs.join(''));
}
async function measure(page){
 return page.evaluate(()=>{
  const box=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
  const header=document.querySelector('.unifiedTeacherHeader'),top=document.querySelector('.simTop'),nav=document.querySelector('.teacherWorkspaceNav'),main=document.querySelector('.simMain');
  const h=box(header),n=box(nav),t=box(top);
  const gutter=document.elementFromPoint(h.left+2,n.top+3);
  return {header:h,top:t,nav:n,main:box(main),headerPosition:getComputedStyle(header).position,
   topBorder:getComputedStyle(top).borderBottomWidth,navBorder:getComputedStyle(nav).borderTopWidth,
   background:getComputedStyle(header).backgroundColor,gutterBelongsToHeader:header.contains(gutter),
   portal:header.contains(nav),duplicates:document.querySelectorAll('.simMain .teacherWorkspaceNav').length,
   width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth};
 });
}
function assertJoin(m,label){
 assert(m.portal&&m.duplicates===0,label+': tabs must live in the actual header exactly once');
 assert.equal(m.headerPosition,'sticky',label+': one sticky container');
 assert(Math.abs(m.nav.top-m.top.bottom)<=1,label+': visible seam or gap '+JSON.stringify(m));
 assert(Math.abs(m.header.bottom-m.nav.bottom-1)<=1,label+': only one outer lower border '+JSON.stringify(m));
 assert.equal(m.topBorder,'0px',label+': obsolete separator between header rows');
 assert.equal(m.navBorder,'0px',label+': obsolete nested border');
 assert.equal(m.background,'rgb(255, 255, 255)',label+': opaque common surface');
 assert(m.gutterBelongsToHeader,label+': side gutter exposes scrolling content');
 assert(Math.abs(m.nav.left-m.main.left)<=2&&Math.abs(m.nav.right-m.main.right)<=2,label+': original content width and gutters '+JSON.stringify(m));
 assert(m.scroll<=m.width+2,label+': horizontal page overflow '+JSON.stringify(m));
}
(async()=>{
 try{
  if(!fs.existsSync(path.join(root,'.design-review','fixture.json')))execFileSync(process.execPath,['scripts/design-preview.cjs'],{cwd:root,stdio:'pipe'});
  fs.mkdirSync(route,{recursive:true});fs.mkdirSync(shots,{recursive:true});fs.writeFileSync(path.join(route,'page.tsx'),source);
  server=startTestServer(root,4006,{NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'placeholder'});
  for(const pipe of [server.stdout,server.stderr])pipe.on('data',chunk=>{logs.push(String(chunk));if(logs.length>40)logs.shift()});
  await ready();
  browser=await chromium.launch({headless:true,executablePath:exe,args:['--no-sandbox','--disable-dev-shm-usage']});
  for(const width of [320,390,760,761,900,1280,1600])for(const chat of width>=1100?[false,true]:[false]){
   const page=await browser.newPage({viewport:{width,height:850},deviceScaleFactor:1});
   const errors=[];page.on('pageerror',error=>errors.push(error.message));
   await page.route('https://*.supabase.co/**',route=>route.fulfill({json:[]}));
   await page.goto(address+(chat?'?chat=1':''));
   await page.waitForFunction(()=>document.body.dataset.headerReady==='yes'&&document.querySelectorAll('.unifiedTeacherHeader [role=tab]').length===12);
   await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
   await page.locator('#teacher-tab-analytics').waitFor();
   const label=width+'px chat='+chat;
   assertJoin(await measure(page),label);
   assert.equal(await page.getByRole('tab').count(),12,label+': all teacher sections');
   // Real portal handlers must keep selection, keyboard controls and persistence.
   await page.locator('#teacher-tab-journal').click();
   assert.equal(await page.locator('[role=tabpanel]').getAttribute('aria-labelledby'),'teacher-tab-journal');
   await page.keyboard.press('ArrowRight');
   assert.equal(await page.locator('#teacher-tab-analytics').getAttribute('aria-selected'),'true');
   await page.locator('#teacher-tab-journal').click();
   await page.reload();
   await page.waitForFunction(()=>document.querySelector('#teacher-tab-journal[aria-selected=true]'));
   const nav=page.locator('.teacherWorkspaceNav');
   const overflow=await nav.evaluate(el=>{el.scrollLeft=0;return el.scrollWidth>el.clientWidth+2});
   if(overflow){
    await nav.hover();await page.mouse.wheel(0,240);
    await page.waitForFunction(()=>document.querySelector('.teacherWorkspaceNav').scrollLeft>0);
    await page.locator('#teacher-tab-blitz').scrollIntoViewIfNeeded();
    assert(await page.locator('#teacher-tab-blitz').evaluate(el=>{const a=el.getBoundingClientRect(),b=el.parentElement.getBoundingClientRect();return a.left>=b.left-2&&a.right<=b.right+2}),label+': final tab must remain reachable');
   }
   await page.evaluate(()=>window.scrollTo(0,450));
   assertJoin(await measure(page),label+' scrolled');
   if([390,900,1600].includes(width))await page.screenshot({path:path.join(shots,'teacher-header-'+width+(chat?'-chat':'')+'.png')});
   await page.getByRole('button',{name:'Сменить режим просмотра'}).click();
   assert.equal(await page.getByRole('tab').count(),0,label+': navigation is removed with the teacher view');
   await page.getByRole('button',{name:'Сменить режим просмотра'}).click();
   await page.waitForFunction(()=>document.querySelectorAll('.unifiedTeacherHeader [role=tab]').length===12);
   assertJoin(await measure(page),label+' remounted');
   assert.deepEqual(errors,[],label+': React errors');
   await page.close();
   console.log('PASS '+label+': one header, actual React portal, chat width, scroll, keyboard and saved section');
  }
 }catch(error){console.error(logs.join(''));throw error}
 finally{await closeTestBrowser(browser);await stopTestServer(server);cleanTestRoute(root,route)}
})().catch(error=>{console.error(error);process.exitCode=1});
