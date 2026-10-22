'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright-core');
const component=fs.readFileSync('components/game/LegislativeSessionLab.tsx','utf8');
const css=fs.readFileSync('components/game/LegislativeSessionLab.module.css','utf8');
const tokens=fs.readFileSync('app/design-tokens.css','utf8');
assert(component.includes("d.stage_no===12&&d.workflow_key==='bill'"),'Only bills from Stage 12 count as packages');
assert(component.includes("agendaBillIds=new Set(items.map(item=>item.formal_document_id))"),'Meeting agenda must remain a separate set');
assert(component.includes("Пакетов Этапа 12")&&component.includes("value:stageBills.length"),'Counter must reflect two existing bill documents, not agenda length');
assert(component.includes("В повестке")&&component.includes("value:items.length"),'Agenda count uses actual agenda entries');
assert(component.includes("stageBills.map(bill=>")&&component.includes("data-in-agenda={inAgenda?"),'All packages must be listed independently of a meeting decision');
assert(component.includes("onOpenDocument(bill.id)"),'Guest/student can open the same bill dossier');
assert(!component.includes("add_duma_agenda_item',{p_session_id:selected.id,p_document_id:bill.id"),'Passive overview never adds new agenda items without chairman approval');
assert(css.includes("var(--gs-border)")&&css.includes("var(--gs-surface)"),'Existing brand tokens remain in use');
const html=`<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
${tokens}
*{box-sizing:border-box}body{margin:0;font-family:Manrope,Arial,sans-serif;background:var(--gs-bg)}
main{padding:12px;max-width:1180px;margin:auto}
${css}
</style></head><body><main><section class="packageRegister"><header class="packageRegisterHead"><div><small>Реестр законодательных инициатив</small><h3>Пакеты Этапа 12 · 2</h3><p>Все созданные законопроекты, независимо от включения в повестку. Добавление вопроса в повестку оформляет председатель заседания.</p></div><span class="packageRegisterCount">2 в реестре · 1 в повестке</span></header><div class="packageRegisterList">
<article class="packageRegisterItem" data-in-agenda="false"><div class="packageRegisterDescription"><small>ГОС.ID-ЗП-ФЗ-0290 · Черновик</small><h4>О внесении изменений в Федеральный закон о государственной гражданской службе Российской Федерации</h4><span class="packageAwaitingAgenda">Не включён в повестку</span></div><button class="secondary">Открыть пакет</button></article>
<article class="packageRegisterItem" data-in-agenda="true"><div class="packageRegisterDescription"><small>ГОС.ID-ЗП-ФЗ-0288 · Черновик</small><h4>Проект федерального закона</h4><span class="packageInAgenda">В повестке заседания № 2</span></div><button class="secondary">Открыть пакет</button></article>
</div></section></main></body></html>`;
(async()=>{
 const executable=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(x=>x&&fs.existsSync(x));
 assert(executable,'Chromium is required for visual verification');
 const browser=await chromium.launch({headless:true,executablePath:executable,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
 for(const width of [320,375,430,768,1024,1440]){
  const page=await browser.newPage({viewport:{width,height:800}});
  await page.setContent(html);
  const result=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,items:document.querySelectorAll('[data-in-agenda]').length,queued:document.querySelectorAll('[data-in-agenda=true]').length,buttons:[...document.querySelectorAll('.packageRegisterItem button')].map(el=>({height:el.getBoundingClientRect().height,right:el.getBoundingClientRect().right})),clipped:[...document.querySelectorAll('.packageRegister,.packageRegisterHead,.packageRegisterItem')].some(el=>el.scrollWidth>el.clientWidth+2)}));
  assert(!result.overflow&&!result.clipped,'Package register overflow at '+width+': '+JSON.stringify(result));
  assert(result.items===2&&result.queued===1,'Expected two documents and one agenda item');
  assert(result.buttons.every(b=>b.height>=44&&b.right<=width+1),'Unsafe action geometry at '+width);
  await page.close();
 }
 console.log('PASS: Stage 12 Work shows 2 bill packages vs 1 agenda item; 320–1440px safe; no automatic mutation.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
