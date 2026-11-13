/* Browser geometry regression for the first student/guest game screen.
   Offline fixture; no app account, Supabase connection, or real assets. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright-core');
const entry=fs.readFileSync('components/GameClient.tsx','utf8');
const views=fs.readFileSync('app/design-views.css','utf8');
const responsive=fs.readFileSync('app/design-responsive.css','utf8');
const shell=fs.readFileSync('app/design-shell.css','utf8');
const tokens=fs.readFileSync('app/design-tokens.css','utf8');
assert(entry.includes('className="overviewPage quickEntryOverview" aria-label="Быстрый вход в игру"'),
 'Only the deferred student/guest dashboard is modified');
assert(entry.includes("onClick={()=>navigate('stages')}")&&entry.includes("onClick={()=>g.openDetailedDashboard()}"),
 'Existing stage and full-overview actions remain unchanged');
assert(entry.includes("onClick={()=>navigate('profile')}")&&entry.includes("onClick={()=>navigate('actions')}"),
 'Links for profile and political process use the standard game navigator');
assert(entry.includes('quickEntryPrimaryActions')&&entry.includes('quickEntrySectionLinks'));
assert(views.includes('.quickEntrySections::before')&&views.includes('.quickEntrySections::after'),
 'The abstract curves belong only to the white card');
assert(views.includes('.quickEntryOverview .missionNumber')&&views.includes('.quickEntryOverview .missionButton'));
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser']
 .find(x=>x&&fs.existsSync(x));
if(!chrome)throw Error('Chrome required for desktop/tablet/mobile geometry checks');
const markup=[
 '<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width,initial-scale=1"><style>',
 tokens,shell,views,responsive,
 'html,body{margin:0}.previewWrap{max-width:1100px;margin:0 auto;padding:20px}.previewWrap *{box-sizing:border-box}',
 '</style><body><div class="previewWrap"><div class="overviewPage quickEntryOverview" aria-label="Быстрый вход в игру">',
 '<section class="missionCard" aria-labelledby="fast-entry-title">',
 '<div class="missionTop"><span class="overline">ЭТАП / 07</span><span class="missionState open"><span></span>Ход открыт</span></div>',
 '<h2 id="fast-entry-title">Выберите, что хотите открыть</h2>',
 '<p>Данные разделов загружаются только при переходе в них. Это снижает нагрузку при одновременном входе участников.</p>',
 '<div class="missionBottom"><div class="quickEntryPrimaryActions">',
 '<button type="button" class="missionButton">Этапы и задачи <svg width="16" height="16"></svg></button>',
 '<button type="button" class="missionButton">Полный обзор игры <svg width="16" height="16"></svg></button>',
 '</div><span class="missionNumber" aria-hidden="true">07</span></div></section>',
 '<section class="agendaCard quickEntrySections" aria-label="Разделы игры">',
 '<div class="sectionTop"><span class="overline">РАЗДЕЛЫ ИГРЫ</span></div>',
 '<div class="quickEntrySectionLinks">',
 '<button class="agendaAction" type="button"><span class="agendaIcon blue"><svg width="21" height="21"></svg></span>',
 '<span><b>Мой профиль</b><small>Личные данные и документы</small></span><svg width="16" height="16"></svg></button>',
 '<button class="agendaAction" type="button"><span class="agendaIcon blue"><svg width="21" height="21"></svg></span>',
 '<span><b>Политический процесс</b><small>Публикации, органы и государственные решения</small></span><svg width="16" height="16"></svg></button>',
 '</div></section></div></div></body></html>'
].join('');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  let requests=0;page.on('request',()=>{requests++});
  await page.setContent(markup);
  for(const width of [1440,1280,1024,901,900,768,650,430,390,320]){
   await page.setViewportSize({width,height:900});
   const data=await page.evaluate(()=>{
    const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
    const hero=document.querySelector('.missionCard'),section=document.querySelector('.quickEntrySections');
    const title=document.querySelector('.missionCard h2');
    const primary=[...document.querySelectorAll('.quickEntryPrimaryActions .missionButton')];
    const rows=[...document.querySelectorAll('.quickEntrySectionLinks .agendaAction')];
    const number=document.querySelector('.missionNumber');
    return {hero:rect(hero),title:rect(title),primary:primary.map(rect),section:rect(section),rows:rows.map(rect),
      number:rect(number),numberDisplay:getComputedStyle(number).display,
      arcs:[getComputedStyle(section,'::before').content,getComputedStyle(section,'::after').content],
      overflow:document.documentElement.scrollWidth>innerWidth+1};
   });
   assert.equal(data.overflow,false,'No page overflow at '+width+'px');
   assert.equal(data.primary.length,2,'Two hero actions at '+width+'px');
   assert.equal(data.rows.length,2,'Two section shortcuts at '+width+'px');
   assert(data.primary.every(r=>r.width>150&&r.height>=44&&r.left>=-1&&r.right<=width+1),'Usable hero actions at '+width+'px');
   assert(data.rows.every(r=>r.width>150&&r.height>=44&&r.left>=-1&&r.right<=width+1),'Usable section rows at '+width+'px');
   assert(Math.abs(data.primary[0].left-data.title.left)<2,'Hero buttons aligned with title at '+width+'px');
   assert(Math.abs(data.primary[0].left-data.primary[1].left)<1,'Stacked buttons share left edge at '+width+'px');
   assert(data.primary[1].top>=data.primary[0].bottom+5,'Hero buttons separated at '+width+'px');
   assert(data.rows[1].top>=data.rows[0].bottom-1,'Section rows never overlap at '+width+'px');
   assert(data.arcs.every(x=>x!=='none'),'White-card abstracts are present at '+width+'px');
   if(width>=901)assert(data.numberDisplay!=='none'&&data.number.right<=data.hero.right+1,'Large 07 visible inside hero at '+width+'px');
   if(width<=650)assert(data.numberDisplay==='none','Mobile keeps compact stage presentation at '+width+'px');
  }
  assert.equal(requests,0,'CSS-only ornament and static shortcuts add zero network requests');
  console.log('PASS lightweight entry: desktop/tablet/phone alignment, 07, white-only waves, intact links, 0 network requests');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
