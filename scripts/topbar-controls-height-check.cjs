/* Regression for the real top-bar CSS cascade: Pause and Share must have
   exactly the same height and baseline on desktop/mobile. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..');
const files=['app/globals.css','app/design-shell.css','app/design-responsive.css','app/mobile-nav-polish.css','app/topbar-controls-alignment.css','app/tablet-topbar-layout.css','app/turn-countdown.css'];
const styles=files.map(file=>fs.readFileSync(path.join(root,file),'utf8')).join('\n');
const layout=fs.readFileSync(path.join(root,'app/layout.tsx'),'utf8');
const client=fs.readFileSync(path.join(root,'components/GameClient.tsx'),'utf8');
assert(layout.indexOf("import './topbar-controls-alignment.css'")>layout.indexOf("import './brand-identity.css'"),'Alignment styles must be loaded after existing responsive styles');
const pause=client.indexOf('className={`livePill ');
const share=client.indexOf('className="gameShareScreen"');
const timer=client.indexOf('className="timerPill timerPillDuration"');
assert(pause>0&&share>pause&&timer>share,'Pause, Share, timer must retain their original header order');
const browserPath=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser','/opt/google/chrome/chrome'].find(p=>p&&fs.existsSync(p));
if(!browserPath)throw Error('Chromium required for top-bar geometry check');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:browserPath,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const page=await browser.newPage();
  const html=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>${styles}</style></head><body><div class="simShell"><div class="simWorkspace">
  <header class="simTop"><div class="mobileBrand">ГОС.ID</div>
  <nav class="topScreenHistory"><button class="screenHistoryButton">◀</button><button class="screenHistoryButton">▶</button></nav>
  <div class="simTopCenter"><div class="topStageCopy"><small>ЭТАП 01</small><strong>Бюджет</strong></div>
  <div class="topIndicators"><span class="livePill off"><span class="livePillText">Пауза</span></span>
  <button class="gameShareScreen"><svg width="17" height="17"></svg><span>Поделиться</span></button>
  <span class="timerPill timerPillDuration" aria-label="До конца хода: 16 дней, 14 часов, 42 минуты">
   <span class="timerPillUnit"><strong>16</strong><span class="timerPillUnitFull">ДНИ</span><span class="timerPillUnitCompact">д</span></span>
   <span class="timerPillUnit"><strong>14</strong><span class="timerPillUnitFull">ЧАСЫ</span><span class="timerPillUnitCompact">ч</span></span>
   <span class="timerPillUnit"><strong>42</strong><span class="timerPillUnitFull">МИНУТЫ</span><span class="timerPillUnitCompact">м</span></span></span></div></div>
  <div class="viewAsSwitcher"><button class="viewAsTrigger">Режим просмотра</button></div></header>
  </div></div></body></html>`;
  for(const width of [320,390,650,820,900,901,1024,1440]){
   await page.setViewportSize({width,height:800});
   await page.setContent(html,{waitUntil:'load'});
   const bounds=await page.evaluate(()=>{
    const get=selector=>{const e=document.querySelector(selector);const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height,display:getComputedStyle(e).display}};
    return {pause:get('.simTop .livePill'),share:get('.simTop .gameShareScreen'),timer:get('.simTop .timerPill'),preview:get('.simTop .viewAsTrigger')};
   });
   const expected=width<=900?36:48;
   for(const key of ['pause','share','timer','preview'])assert(Math.abs(bounds[key].height-expected)<1,`${width}px ${key} height mismatch: ${JSON.stringify(bounds)}`);
   for(const key of ['share','timer'])assert(Math.abs(bounds[key].top-bounds.pause.top)<2,`${width}px ${key} baseline mismatch: ${JSON.stringify(bounds)}`);
   const timerText=await page.locator('.timerPillDuration').evaluate(el=>({
    units:[...el.querySelectorAll('.timerPillUnit strong')].map(n=>n.textContent),
    title:el.getAttribute('aria-label'),
    width:el.getBoundingClientRect().width,
    minuteLabelLeft:el.querySelector('.timerPillUnit:last-child .timerPillUnitFull').getBoundingClientRect().left,
    minuteSeparatorLeft:el.querySelector('.timerPillUnit:last-child').getBoundingClientRect().left,
    minuteLabelRight:el.querySelector('.timerPillUnit:last-child .timerPillUnitFull').getBoundingClientRect().right,
    timerRight:el.getBoundingClientRect().right,
    labels:[...el.querySelectorAll('.timerPillUnitFull')].map(n=>getComputedStyle(n).display),
    size:el.scrollWidth-el.clientWidth
   }));
   assert.deepEqual(timerText.units,['16','14','42'],'Days, hours, minutes appear in correct order');
   assert(timerText.title.includes('16 дней, 14 часов, 42 минуты'),'Full Russian accessible reading');
   assert.equal(timerText.width,width<=650?58:width<1500?80:176,'Compact footprint must fit at '+width);
   if(width>=1500){
    assert(timerText.minuteLabelLeft-timerText.minuteSeparatorLeft>=7,
      'First letter of МИНУТЫ overlaps divider at '+width+'px: '+JSON.stringify(timerText));
    assert(timerText.minuteLabelRight<=timerText.timerRight-3,
      'Minutes label must remain inside timer at '+width+'px');
   }
   assert(timerText.size<=2,'Timer internal text overflow at '+width+'px: '+JSON.stringify(timerText));
   assert.equal(timerText.labels.every(label=>label===(width<1500?'none':'block')),true,'Desktop/mobile unit labels differ at '+width);
   console.log('PASS top-bar equal-height three-unit timer '+width+'px');
  }
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
