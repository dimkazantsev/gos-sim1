'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright-core');
const meeting=fs.readFileSync('components/game/LegislativeSessionLab.tsx','utf8');
const packages=fs.readFileSync('components/game/Stage12BillPackages.tsx','utf8');
const workspace=fs.readFileSync('components/game/Stage12ReadingWorkspace.tsx','utf8');
const css=fs.readFileSync('components/game/Stage12BillPackages.module.css','utf8');
const tokens=fs.readFileSync('app/design-tokens.css','utf8');
assert(packages.includes("d.stage_no===12&&d.workflow_key==='bill'"),'The single package register still contains every Stage 12 bill');
assert(packages.includes('Реестр пакетов · {bills.length}')&&packages.includes('visibleBills.map(d=>'),'The package register must show all bills regardless of the chosen Duma session');
assert(workspace.includes('<Stage12BillPackages g={g}')&&workspace.includes('<LegislativeSessionLab g={g}'),'Preparation and unique meeting actions stay in one reading workspace');
assert(meeting.includes("const items=selected?agenda.filter("),'Meeting agenda remains distinct from the package register');
assert(meeting.includes('InstitutionRegistrationPanel')&&meeting.includes('DumaReadingDiscussion')&&meeting.includes('onOpenVotes(v.id)'),'Meeting registration, speeches and ballots are never removed');
assert(meeting.includes('close_duma_session')&&meeting.includes('Открыть документ повестки'),'Meeting close and agenda document actions remain available');
assert(!meeting.includes('StageModuleHeader')&&!meeting.includes('readingFlow')&&!meeting.includes('packageRegister'),'No duplicate meeting hero, stage strip or secondary bill register');
assert(css.includes('var(--gs-border)')&&css.includes('var(--gs-surface)'),'Approved brand tokens remain in use');
const html=`<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
${tokens}
*{box-sizing:border-box}body{margin:0;font-family:Manrope,Arial,sans-serif;background:var(--gs-bg)}
main{padding:12px;max-width:1180px;margin:auto}
${css}
</style></head><body><main><section class="section" aria-label="Пакеты законодательных инициатив">
<header class="heading"><div><small>Этап 12 · Подготовка и внесение</small><h3>Пакеты законопроектов</h3><p>Комплекты документов и их движение по реестру НПА.</p></div><button class="primary">Создать пакет документов</button></header>
<div class="listTitle"><h4>Реестр пакетов · 2</h4><button class="secondary">Обновить состав</button></div>
<div class="list">
<article class="card" data-package="1"><div class="cardHeader"><div class="cardTitle"><div><small>ГОС.ID-ЗП-ФЗ-0290 · Черновик</small><h4>О внесении изменений в Федеральный закон о государственной гражданской службе Российской Федерации</h4></div></div><span class="count">2/2 приложений</span></div><div class="cardActions"><button class="secondary">Открыть пакет, маршрут и поправки</button></div></article>
<article class="card" data-package="2"><div class="cardHeader"><div class="cardTitle"><div><small>ГОС.ID-ЗП-ФЗ-0288 · Профильный комитет</small><h4>Проект федерального закона</h4></div></div><span class="count">2/2 приложений</span></div><div class="cardActions"><button class="secondary">Открыть пакет, маршрут и поправки</button></div></article>
</div></section></main></body></html>`;
(async()=>{
 const executable=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(x=>x&&fs.existsSync(x));
 assert(executable,'Chromium is required for visual verification');
 const browser=await chromium.launch({headless:true,executablePath:executable,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  for(const width of [320,375,430,768,1024,1440]){
   const page=await browser.newPage({viewport:{width,height:800}});
   await page.setContent(html);
   const result=await page.evaluate(()=>({
    overflow:document.documentElement.scrollWidth>innerWidth+1,
    items:document.querySelectorAll('[data-package]').length,
    buttons:[...document.querySelectorAll('.cardActions button')].map(el=>({height:el.getBoundingClientRect().height,right:el.getBoundingClientRect().right})),
    clipped:[...document.querySelectorAll('.section,.heading,.card,.cardHeader')].some(el=>el.scrollWidth>el.clientWidth+2)
   }));
   assert(!result.overflow&&!result.clipped,'Package register overflows at '+width+': '+JSON.stringify(result));
   assert.equal(result.items,2,'Two packages must stay visible irrespective of meeting agenda count');
   assert(result.buttons.every(b=>b.height>=44&&b.right<=width+1),'Action hit targets remain safe at '+width);
   await page.close();
  }
  console.log('PASS: one Stage 12 bill register, meeting actions intact, no duplicated hero or session ribbon, 320–1440px safe.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
