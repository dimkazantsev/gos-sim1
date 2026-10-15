/* Guard the visual join between the existing top bar and teacher tabs. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..');
const sheets=[
 'app/design-tokens.css','app/design-shell.css','app/design-views.css',
 'app/design-responsive.css','app/teacher-mobile.css','app/mobile-nav-polish.css',
 'app/teacher-command.css','app/teacher-operations.css','app/teacher-ui-polish.css',
 'app/teacher-extended.css','app/teacher-final-interactions.css',
 'app/2026-october-refinement.css','app/tablet-topbar-layout.css',
 'app/teacher-unified-header.css'
];
const css=sheets.map(p=>fs.readFileSync(path.join(root,p),'utf8')).join('\n');
const exe=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser']
 .find(p=>p&&fs.existsSync(p));
if(!exe)throw Error('Chromium required for unified teacher header regression');
const tabs=['Обзор','Участники и доступ','Этапы','Журнал','Аналитика','Оценки',
 'Модель последствий','Фракции','Инструменты','События','Награды','Блиц-вопросы'];
const markup=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0;background:#f3f6fb}
*{animation:none!important;transition:none!important}${css}</style></head><body>
<div class="simShell"><aside class="simSidebar">ГОС.ID</aside><div class="simWorkspace">
<header class="simTop">
<div class="mobileBrand">ГОС.ID</div>
<nav class="topScreenHistory"><button aria-label="Назад">‹</button><button aria-label="Вперёд">›</button></nav>
<div class="simTopCenter"><div class="topStageCopy"><small>ЭТАП 01</small><strong>Управление</strong></div>
<div class="topIndicators"><span class="livePill on">Ход открыт</span></div></div>
</header><div class="simContentFlow"><main class="simMain"><div class="teacherSimple teacherCommand">
<section class="teacherWorkspace"><div class="teacherWorkspaceNav" role="tablist">
${tabs.map((name,i)=>`<button role="tab" aria-selected="${i===0}" class="${i===0?'active':''}"><span>${name}</span></button>`).join('')}
</div><section class="teacherCommandBar"><b>ПУЛЬТ ПРЕПОДАВАТЕЛЯ</b></section>
<div class="teacherWorkspacePanel" style="min-height:1700px"><p>Рабочий раздел</p></div>
</section></div></main></div></div></div></body></html>`;
const rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:exe,args:['--no-sandbox','--disable-dev-shm-usage']});
 try {
  for(const width of [320,390,760,761,900,1280,1600]){
   for(const chat of (width>=1100?[false,true]:[false])){
    const page=await browser.newPage({viewport:{width,height:850},deviceScaleFactor:1});
    await page.setContent(markup,{waitUntil:'load'});
    if(chat)await page.evaluate(()=>{
      document.querySelector('.simWorkspace').classList.add('chatOpen');
      document.querySelector('.simMain').classList.add('chatOpen');
    });
    const m=await page.evaluate(()=>{
     const box=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
     const top=document.querySelector('.simTop'),nav=document.querySelector('.teacherWorkspaceNav');
     const main=document.querySelector('.simMain'),card=document.querySelector('.teacherWorkspace');
     const bar=document.querySelector('.teacherCommandBar');
     return {top:box(top),nav:box(nav),main:box(main),bar:box(bar),
       navBackground:getComputedStyle(nav).backgroundColor,
       topBackground:getComputedStyle(top).backgroundColor,
       cardBorder:getComputedStyle(card).borderTopWidth,
       navBorder:getComputedStyle(nav).borderTopWidth,
       navRadius:getComputedStyle(nav).borderTopLeftRadius,
       contentBackground:getComputedStyle(document.querySelector('.simContentFlow')).backgroundImage,
       client:nav.clientWidth,scroll:nav.scrollWidth,
       viewport:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth};
    });
    assert(Math.abs(m.nav.top-m.top.bottom)<=2,
      `${width}px chat=${chat}: gap between top header and tabs: ${JSON.stringify(m)}`);
    assert(Math.abs(m.nav.left-m.main.left)<=2&&Math.abs(m.nav.right-m.main.right)<=2,
      `${width}px: altered content width or gutters: ${JSON.stringify(m)}`);
    assert(m.nav.width<m.viewport-8,
      `${width}px: teacher tabs incorrectly stretched across viewport: ${JSON.stringify(m)}`);
    assert(m.navBackground==='rgb(255, 255, 255)'&&m.topBackground==='rgb(255, 255, 255)',
      `${width}px: the two header tiers must have identical opaque backgrounds`);
    assert(m.cardBorder==='0px'&&m.navBorder==='0px'&&m.navRadius==='0px',
      `${width}px: legacy double card outline still shown: ${JSON.stringify(m)}`);
    assert(m.contentBackground.includes('linear-gradient'),
      `${width}px: header-to-tabs background bridge missing`);
    assert(m.bar.top>=m.nav.bottom+8&&m.bar.top<=m.nav.bottom+25,
      `${width}px: command card spacing not intentional: ${JSON.stringify(m)}`);
    assert(m.scrollWidth<=m.viewport+2,`${width}px: page horizontal overflow`);
    if(m.scroll>m.client+3){
     const scroll=await page.locator('.teacherWorkspaceNav').evaluate(el=>{
      el.scrollLeft=el.scrollWidth-el.clientWidth;
      return el.scrollLeft;
     });
     assert(scroll>3,`${width}px: last tab not reachable by horizontal scrolling`);
    }
    await page.evaluate(()=>window.scrollTo(0,450));
    const sticky=await page.evaluate(()=>{
     const t=document.querySelector('.simTop').getBoundingClientRect();
     const n=document.querySelector('.teacherWorkspaceNav').getBoundingClientRect();
     return {headerBottom:t.bottom,navTop:n.top};
    });
    assert(Math.abs(sticky.headerBottom-sticky.navTop)<=2,
      `${width}px: gap appears when scrolling: ${JSON.stringify(sticky)}`);
    await page.close();
   }
  }
  console.log('PASS: teacher tabs join opaque top bar, retain original inset width, scroll and stick at 320–1600px, chat on/off.');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
