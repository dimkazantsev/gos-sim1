/* Offline CSS geometry test for the lightweight game-entry screen. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright-core');
const src=fs.readFileSync('components/GameClient.tsx','utf8');
const views=fs.readFileSync('app/design-views.css','utf8');
const responsive=fs.readFileSync('app/design-responsive.css','utf8');
const shell=fs.readFileSync('app/design-shell.css','utf8');
const tokens=fs.readFileSync('app/design-tokens.css','utf8');
assert(src.includes('className="overviewPage quickEntryOverview" aria-label="Быстрый вход в игру"'),'Only lightweight entry is changed');
assert(src.includes('Выберите, что хотите открыть')&&src.includes('Полный обзор игры')&&src.includes('Мой профиль'));
assert(views.includes('@media(min-width:901px)')&&views.includes('.quickEntryOverview .missionButton'),'Desktop-only positioning');
assert(src.includes("onClick={()=>navigate('stages')}"),'Stage navigation is unchanged');
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(x=>x&&fs.existsSync(x));
if(!chrome)throw Error('Chromium is required for entry geometry checks');
const markup=[
 '<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width,initial-scale=1"><style>',
 tokens,shell,views,responsive,
 'html,body{margin:0}.previewWrap{max-width:1100px;margin:0 auto;padding:20px}.previewWrap *{box-sizing:border-box}',
 '</style><body><div class="previewWrap"><div class="overviewPage quickEntryOverview" aria-label="Быстрый вход в игру">',
 '<header class="overviewHeading"><div><span class="overline">Тестовая игра</span><h1>Вы вошли в игру.</h1></div></header>',
 '<section class="missionCard" aria-labelledby="fast-entry-title"><div class="missionTop"><span class="overline">ЭТАП / 03</span><span class="missionState open">Ход открыт</span></div>',
 '<h2 id="fast-entry-title">Выберите, что хотите открыть</h2><p>Данные разделов загружаются только при переходе в них.</p>',
 '<div class="missionBottom"><button type="button" class="missionButton">Этапы и задачи <span>↗</span></button><span class="missionNumber">03</span></div></section>',
 '<section class="agendaCard"><div class="sectionTop"><span class="overline">РАЗДЕЛЫ ИГРЫ</span></div>',
 '<button type="button" class="agendaAction"><span><b>Полный обзор игры</b><small>Этапы, голосования и показатели</small></span><svg width="17" height="17"></svg></button>',
 '<button type="button" class="agendaAction"><span><b>Мой профиль</b><small>Личные данные и документы</small></span><svg width="17" height="17"></svg></button>',
 '</section></div></div></body></html>'
].join('');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.setContent(markup);
  for(const width of [1440,1280,1024,901,900,768,390,320]){
   await page.setViewportSize({width,height:900});
   const result=await page.evaluate(()=>{
    const center=el=>{const r=el.getBoundingClientRect();return (r.left+r.right)/2};
    const bottom=document.querySelector('.missionBottom');
    const stage=document.querySelector('.missionButton');
    const card=document.querySelector('.agendaCard');
    const buttons=[...document.querySelectorAll('.quickEntryOverview button')];
    return {stageDiff:Math.abs(center(bottom)-center(stage)),
     actionDiffs:[...document.querySelectorAll('.agendaAction')].map(el=>Math.abs(center(card)-center(el))),
     buttons:buttons.map(el=>{const r=el.getBoundingClientRect();return {height:r.height,left:r.left,right:r.right,width:r.width}}),
     overflow:document.documentElement.scrollWidth>innerWidth+1};
   });
   assert.equal(result.overflow,false,'No horizontal overflow at '+width+'px');
   assert.equal(result.buttons.length,3,'All three shortcuts remain present');
   assert(result.buttons.every(b=>b.width>0&&b.height>=40&&b.left>=-1&&b.right<=width+1),'Usable shortcuts at '+width+'px');
   if(width>=901){
    assert(result.stageDiff<=1.5,'Stage button centered at '+width+'px: '+result.stageDiff);
    assert(result.actionDiffs.every(d=>d<=1.5),'Action buttons centered at '+width+'px: '+result.actionDiffs.join(','));
   }
  }
  console.log('PASS: centered desktop shortcuts, mobile retained, no horizontal overflow at 8 viewport widths');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
