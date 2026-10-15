/* Responsive topbar collision regression: tablet widths, teacher/student, chat open/closed. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright-core');
const root=path.join(__dirname,'..');
const paths=[
 'app/design-tokens.css','app/globals.css','app/design-shell.css',
 'app/design-responsive.css','app/design-readability.css',
 'app/mobile-nav-polish.css','app/topbar-controls-alignment.css',
 'app/tablet-topbar-layout.css','app/turn-countdown.css'
];
const styles=paths.map(x=>fs.readFileSync(path.join(root,x),'utf8')).join('\n');
const layout=fs.readFileSync(path.join(root,'app/layout.tsx'),'utf8');
assert(layout.indexOf("import './tablet-topbar-layout.css'")>layout.indexOf("import './topbar-controls-alignment.css'"),'Tablet styles must follow the existing topbar baseline');
const browserPath=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(x=>x&&fs.existsSync(x));
if(!browserPath)throw Error('Chromium is required for tablet toolbar geometry');
const teacher=`<div class="viewAsSwitcher"><button type="button" class="viewAsTrigger"><span class="viewAsTriggerText"><small>РЕЖИМ ПРОСМОТРА</small><strong>Преподаватель</strong></span></button></div>`;
const markup=role=>`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style></head><body>
<div class="simShell"><aside class="simSidebar"><div class="sidebarBrand">ГОС.ID</div></aside>
<div class="simWorkspace"><header class="simTop">
<div class="mobileBrand"><span class="brandMark">ГОС</span><b>ГОС.ID</b></div>
<nav class="topScreenHistory" aria-label="История разделов">
<button type="button" class="screenHistoryButton" aria-label="Назад">‹</button>
<button type="button" class="screenHistoryButton" aria-label="Вперёд">›</button></nav>
<div class="simTopCenter">
<div class="topStageCopy"><small>ЭТАП 13</small><strong>Федеральный бюджет: обсуждение и принятие закона</strong></div>
<div class="topIndicators">
<span class="livePill on"><svg width="17" height="17"></svg><span class="livePillText">Ход открыт</span></span>
<button type="button" class="gameShareScreen"><svg width="17" height="17"></svg><span>Поделиться</span></button>
<span class="timerPill timerPillDuration" aria-label="До конца хода: 16 дней, 14 часов, 42 минуты">
<span class="timerPillUnit"><strong>16</strong><span class="timerPillUnitFull">ДНИ</span><span class="timerPillUnitCompact">д</span></span>
<span class="timerPillUnit"><strong>14</strong><span class="timerPillUnitFull">ЧАСЫ</span><span class="timerPillUnitCompact">ч</span></span>
<span class="timerPillUnit"><strong>42</strong><span class="timerPillUnitFull">МИНУТЫ</span><span class="timerPillUnitCompact">м</span></span>
</span></div></div>
${role==='teacher'?teacher:''}
<button type="button" class="topChatButton"><svg width="18" height="18"></svg><span>Чат</span></button>
</header><main id="game-main"></main></div></div></body></html>`;
function overlap(a,b) {return Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top))}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:browserPath,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  for(const role of ['teacher','student'])for(const chatOpen of [false,true])for(const width of [320,390,768,820,900,901,1024,1180,1280,1366,1499,1500,1600]){
   const page=await browser.newPage({viewport:{width,height:850},deviceScaleFactor:1});
   await page.setContent(markup(role),{waitUntil:'load'});
   if(chatOpen)await page.locator('.simWorkspace').evaluate(el=>el.classList.add('chatOpen'));
   const measures=await page.evaluate(()=>{
    const sel=x=>{const el=document.querySelector(x);if(!el)return null;const r=el.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,display:getComputedStyle(el).display,visibility:getComputedStyle(el).visibility}};
    const action=['.topScreenHistory','.topStageCopy','.topIndicators','.viewAsSwitcher','.topChatButton'];
    const clickability=['.screenHistoryButton','.gameShareScreen','.viewAsTrigger','.topChatButton'];
    const buttons=clickability.map(selector=>{
      const el=document.querySelector(selector);
      if(!el||getComputedStyle(el).display==='none'||!el.getClientRects().length)return {selector,hidden:true};
      const r=el.getBoundingClientRect();
      const centerX=(r.left+r.right)/2,centerY=(r.top+r.bottom)/2;
      const at=document.elementFromPoint(centerX,centerY);
      return {selector,rect:sel(selector),hit:at===el||el.contains(at)};
    });
    return {top:sel('.simTop'),history:sel(action[0]),title:sel(action[1]),indicators:sel(action[2]),preview:sel(action[3]),chat:sel(action[4]),buttons,
      overflow:document.documentElement.scrollWidth>innerWidth+2,
      statusWidth:document.querySelector('.topIndicators').scrollWidth,
      statusClient:document.querySelector('.topIndicators').clientWidth,
      token:getComputedStyle(document.querySelector('.simWorkspace')).getPropertyValue('--gs-top-h').trim()};
   });
   assert(!measures.overflow,`${width}px ${role}: horizontal document overflow ${JSON.stringify(measures)}`);
   for(const item of measures.buttons)if(!item.hidden)assert(item.hit,`${width}px ${role} button blocked ${JSON.stringify(item)}`);
   if(width>900&&width<1500){
     assert(measures.title.display!=='none'&&measures.title.width>=130,`${width}px stage text squeezed: ${JSON.stringify(measures)}`);
     assert(overlap(measures.title,measures.history)<1,`${width}px stage title overlaps history`);
     assert(overlap(measures.title,measures.chat)<1,`${width}px stage title overlaps chat button`);
     assert(overlap(measures.title,measures.indicators)<1,`${width}px stage title overlaps status controls`);
     if(role==='teacher')assert(overlap(measures.indicators,measures.preview)<1,`${width}px indicators overlap preview switcher`);
     assert(measures.token==='122px',`${width}px chat offset must follow resized header`);
     assert(measures.top.height>=122,`${width}px rows must fit header height`);
   }
   if(width<=900)assert(measures.title.display==='none',`${width}px compact phone/tablet topbar unexpectedly altered`);
   if(width>=1500)assert(measures.token!=='122px','Large desktop token must remain unchanged');
   await page.close();
   console.log('PASS '+width+'px '+role+' chat='+chatOpen);
  }
 }finally{await browser.close()}
 console.log('PASS tablet header: no title/action collision, touch controls hit-test, header offsets');
})().catch(e=>{console.error(e);process.exitCode=1});
