'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright-core');
const stage12=fs.readFileSync('components/game/LegislativeSessionLab.tsx','utf8');
const css=fs.readFileSync('components/game/LegislativeSessionLab.module.css','utf8');
const tokens=fs.readFileSync('app/design-tokens.css','utf8');
assert(!stage12.includes("className={'legislativeAgendaItem '+i.status}"),'Old status-coded mint cards must be removed');
assert(stage12.includes("d?.status_code==='rejected'")&&stage12.includes("layout.rejectedCard"),'Rejected bill must be styled separately from completed agenda item');
assert(stage12.includes('d.status_code!==\'rejected\''),'Rejected bill must not show a false progressing reading timeline');
assert(css.includes('var(--gs-surface)')&&css.includes('var(--gs-border)'), 'Keep existing design tokens');
assert(css.includes('.card')&&css.includes('.progressCurrent'), 'Cards and current reading must follow standard style');
const template=`<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${tokens}
body{margin:0;background:#f3f5fb}main{padding:12px;max-width:1080px;margin:auto}.legislativeAgendaItem{display:grid;grid-template-columns:42px minmax(0,1fr) 330px;gap:10px;padding:12px;border:1px solid #e0e7ef;border-radius:14px;background:#fbfcfe}
.legislativeAgendaItem.completed{background:#f4fbf7;border-color:#b8dfca}
.agendaMeta span{background:#edf2f7;color:#64748b}
${css}</style></head><body><main>
<section class="agenda">
 <article class="legislativeAgendaItem card rejectedCard" data-agenda-status="completed">
  <div class="agendaNo number">01</div><div class="agendaDoc document">
   <small class="registry">ГОС.ID-НПА-0204 · Отклонён Государственной Думой</small>
   <h3 class="headline">О внесении изменения в Федеральный закон № 19-ФЗ «О выборах Президента Российской Федерации»</h3>
   <div class="agendaMeta meta"><span class="agendaStatus">Рассмотрено</span><span class="rejectedBadge">Отклонён</span></div>
   <p class="rejectedExplanation">Законопроект отклонён. Дальнейшее прохождение чтений прекращено.</p>
   <div class="documentActions"><button class="secondary">Открыть НПА</button></div>
   <p class="resultNote">Отклонить проект поправки к Федеральному закону № 19-ФЗ о введении системы абсолютного большинства</p>
  </div>
 </article>
 <article class="legislativeAgendaItem card" data-agenda-status="completed">
  <div class="agendaNo number">02</div><div class="agendaDoc document">
   <small class="registry">ГОС.ID-НПА-0206 · Одобрен Государственной Думой</small>
   <h3 class="headline">О внесении изменения в Федеральный закон № 19-ФЗ «О выборах Президента Российской Федерации»</h3>
   <div class="agendaMeta meta"><span class="agendaStatus">Рассмотрено</span><span class="documentStatus">Совет Федерации</span></div>
   <div class="progress"><span class="progressDone">I чтение</span><span class="progressDone">Поправки ко II чтению</span><span class="progressDone">II чтение</span><span class="progressDone">III чтение</span><span class="progressCurrent">Совет Федерации</span><span class="progressPending">Президент Российской Федерации</span><span class="progressPending">Опубликован</span></div>
   <div class="documentActions"><button class="secondary">Открыть НПА</button></div>
   <p class="resultNote">Принять проект поправки к Федеральному закону № 19-ФЗ</p>
  </div>
 </article>
</section>
<footer class="rule"><b>Логика переноса и голосований</b><p>Исторические решения не изменяются. На следующую сессию переносятся только незавершённые вопросы.</p></footer>
</main></body></html>`;
(async()=>{
const exe=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>p&&fs.existsSync(p));
assert(exe,'Chromium unavailable for Stage 12 responsive layout');
const browser=await chromium.launch({headless:true,executablePath:exe,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 for(const width of [320,390,768,1024,1440]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
  await page.setContent(template);
  const x=await page.evaluate(()=>{
   const card=[...document.querySelectorAll('.card')],buttons=[...document.querySelectorAll('.documentActions button')];
   const rejected=card[0],accepted=card[1];
   const bad=rejected.querySelector('.rejectedBadge'),title=rejected.querySelector('.headline');
   const right=el=>el.getBoundingClientRect().right;
   return {scroll:document.documentElement.scrollWidth,body:document.body.scrollWidth,
    cards:card.map(c=>({left:c.getBoundingClientRect().left,right:right(c),scroll:c.scrollWidth,client:c.clientWidth})),
    buttons:buttons.map(b=>({height:b.getBoundingClientRect().height,right:right(b)})),
    rejectedBackground:getComputedStyle(rejected).backgroundColor,
    normalBackground:getComputedStyle(accepted).backgroundColor,
    rejectedForeground:getComputedStyle(bad).color,
    titleFits:title.scrollWidth<=title.clientWidth+2,
    statusFits:bad.scrollWidth<=bad.clientWidth+2};
  });
  assert(x.scroll<=width+1&&x.body<=width+1,'Page exceeds viewport at '+width+': '+JSON.stringify(x));
  assert(x.cards.every(c=>c.left>=-1&&c.right<=width+1&&c.scroll<=c.client+2),'Agenda exceeds viewport at '+width+': '+JSON.stringify(x));
  assert(x.buttons.every(b=>b.height>=44&&b.right<=width+1),'Touch target unsafe at '+width);
  assert(x.titleFits&&x.statusFits,'Bill title or status is clipped at '+width);
  assert(x.rejectedBackground===x.normalBackground,'Rejected item must not retain a misleading green completed background');
  await page.close();
 }
 console.log('PASS: Stage 12 GOV.ID cards, semantic rejection and 320–1440 px tablet/desktop/mobile geometry.');
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
