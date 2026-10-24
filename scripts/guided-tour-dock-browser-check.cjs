const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright-core');
const {startTestServer,stopTestServer,closeTestBrowser,cleanTestRoute}=require('./browser-test-runtime.cjs');
const root=path.resolve(__dirname,'..'),route=path.join(root,'app','tour-mobile-test-route');
const address='http://127.0.0.1:3995/tour-mobile-test-route';
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium'].find(s=>s&&fs.existsSync(s));
if(!chrome)throw Error('Chromium is required for this UI regression');
const source=[
"'use client';",
"import {useState,useEffect} from 'react';",
"import {LayoutDashboard,BookOpenText,Radio,Landmark,Vote,FileText,Wallet,GraduationCap,MessageCircle,UserRound,Activity} from 'lucide-react';",
"import MobileDock from '../../components/game/MobileDock';",
"import GuidedTour,{getTourSteps} from '../../components/game/GuidedTour';",
"import type {View} from '../../components/game/types';",
"const icons={dashboard:LayoutDashboard,stages:BookOpenText,actions:Radio,parties:Landmark,votes:Vote,documents:FileText,budget:Wallet,events:Activity,grades:GraduationCap,profile:UserRound};",
"const labels={dashboard:'Обзор',stages:'Этапы',actions:'Процесс',parties:'Партии',votes:'Голосования',documents:'НПА',budget:'Бюджет',events:'События',grades:'Оценки',profile:'Профиль'};",
"const items=(Object.keys(icons) as View[]).map(key=>({key,label:labels[key as keyof typeof labels],icon:(()=>{const Icon=icons[key as keyof typeof icons];return <Icon/>})()}));",
"const steps=getTourSteps(false);",
"export default function TestTour(){",
"const [index,setIndex]=useState(0),[editing,setEditing]=useState(false),[active,setActive]=useState<View>('dashboard');",
"useEffect(()=>{(window as any).__tourGo=(n:number)=>setIndex(n);document.body.dataset.tourReady='yes';return()=>{delete (window as any).__tourGo;delete document.body.dataset.tourReady}},[]);",
"const goto=(target:string)=>{if(target!=='chat')setActive(target as View);setIndex(i=>Math.min(i+1,steps.length-1))};",
"return <div className='simShell' style={{minHeight:'100dvh'}}><div className='simWorkspace'><div style={{height:500,padding:22}}><h1>Тест экскурсии</h1></div></div>",
"<MobileDock items={items} activeView={active} storageKey='tour-ci-dock' editing={editing} setEditing={setEditing} onNavigate={goto} onChat={()=>goto('chat')} onAll={()=>{}}/>",
"<GuidedTour step={steps[index]} index={index} total={steps.length} onSkip={()=>{}} onFallback={goto}/></div>}",
].join('\n');
async function ready(server){for(let i=0;i<35;i++){if(server.exitCode!==null)throw Error('Next server exited');try{const r=await fetch(address,{signal:AbortSignal.timeout(2500)});if(r.ok)return}catch{}await new Promise(r=>setTimeout(r,900))}throw Error('Fixture failed to start')}
async function main(){
fs.mkdirSync(route,{recursive:true});fs.writeFileSync(path.join(route,'page.tsx'),source);
let server,browser;
try{
 server=startTestServer(root,3995,{NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'build-placeholder-key'});
 await ready(server);browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
 for(const width of [360,390,768]){
  const ctx=await browser.newContext({viewport:{width,height:820},hasTouch:true,isMobile:true,reducedMotion:'reduce'});
  const page=await ctx.newPage();await page.goto(address);
  await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
  await page.waitForFunction(()=>document.body.dataset.tourReady==='yes');
  const card=page.locator('[aria-label="Обучение навигации"] [role="status"]');
  for(let i=0;i<11;i++){
   await page.evaluate(n=>window.__tourGo(n),i);
   const cta=card.getByRole('button',{name:/Перейти в раздел/});await cta.waitFor();
   const style=await cta.evaluate(el=>{
    const color=t=>(t.match(/[\d.]+/g)||[]).slice(0,3).map(Number);
    const lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
    const s=getComputedStyle(el),a=lum(color(s.color)),b=lum(color(s.backgroundColor)),r=el.getBoundingClientRect();
    return {ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),opacity:s.opacity,
     hit:document.elementFromPoint(r.left+Math.min(18,r.width/2),r.top+r.height/2)?.closest('button')===el};
   });
   assert(style.ratio>=4.5&&style.opacity==='1'&&style.hit,'Invisible CTA '+width+'px step '+(i+1)+' '+JSON.stringify(style));
   if(i===5||i===8){
    await page.waitForTimeout(150);
    const dock=page.locator('.mobileDockScroll');
    const initial=await dock.evaluate(el=>{el.scrollLeft=0;return {width:el.clientWidth,scroll:el.scrollWidth}});
    assert(initial.scroll>initial.width+30,'Dock must scroll at '+width);
    const b=await dock.boundingBox();assert(b);
    const px=b.x+Math.min(110,b.width/2),py=b.y+b.height/2;
    const hit=await page.evaluate(([x,y])=>!!document.elementFromPoint(x,y)?.closest('.mobileDockScroll'),[px,py]);
    assert(hit,'Overlay blocks adjacent icons at '+width+' step '+(i+1));
    await page.mouse.move(px,py);await page.mouse.down();await page.mouse.move(px-90,py,{steps:8});await page.mouse.up();
    const scrolled=await dock.evaluate(el=>el.scrollLeft);
    assert(scrolled>8,'Cannot swipe dock at '+width+' step '+(i+1)+': '+scrolled);
    await cta.click();await page.waitForFunction(n=>document.querySelector('[aria-label="Обучение навигации"] [role="status"]')?.textContent?.includes('Шаг '+(n+2)+' из 11'),i);
   }
  }
  await ctx.close();console.log('PASS real tour: '+width+'px, 11 visible CTAs, vote/grades swipe, direct navigation');
 }
}finally{await closeTestBrowser(browser);await stopTestServer(server);cleanTestRoute(root,route)}
}
main().catch(e=>{console.error(e);process.exitCode=1});
