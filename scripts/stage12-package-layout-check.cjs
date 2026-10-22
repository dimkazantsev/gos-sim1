'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright-core');
const tokens=fs.readFileSync('app/design-tokens.css','utf8');
const css=fs.readFileSync('components/game/Stage12BillPackages.module.css','utf8');
const fixture=`<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>${tokens} ${css}</style></head><body style="margin:0;background:#f3f5fb">
<main style="padding:12px;max-width:1200px;margin:auto"><section class="section">
<header class="heading"><div><small>Материалы Этапа 12</small><h3>Пакеты законопроектов</h3><p>Создайте проект федерального закона и загрузите связанные материалы единой законодательной инициативы.</p></div><button class="primary">Создать пакет</button></header>
<div class="form"><h4>Новая законодательная инициатива</h4><div class="fields"><label>Вид закона<select><option>Федеральный закон</option></select></label><label>Субъект инициативы<select><option>Депутат Государственной Думы</option></select></label><label class="full">Название<input value="О внесении изменений в Федеральный закон о порядке рассмотрения законодательной инициативы"/></label><label class="full">Текст проекта<textarea>Проект закона</textarea></label></div><div class="attachGrid"><label class="attachment"><span>Пояснительная записка</span><input type="file"/></label><label class="attachment"><span>Перечень затрагиваемых актов</span><input type="file"/></label></div><button class="primary">Создать и загрузить пакет</button></div>
<div class="listTitle"><h4>Реестр пакетов · 2</h4><button class="secondary">Обновить состав</button></div>
<div class="list"><article class="card">
<div class="cardHeader"><div class="cardTitle"><svg height="20" width="20"></svg><div><small>ГОС.ID-ЗП-ФЗ-00288 · Черновик</small><h4>О внесении изменений в Федеральный закон «Об общих принципах организации публичной власти в Российской Федерации»</h4></div></div><span class="count">2/2 основных приложения</span></div>
<div class="fileList"><button class="file"><svg height="16" width="16"></svg><span><b>Пояснительная записка</b><small>очень-длинное-название-пояснительной-записки.docx · На рассмотрении</small></span><svg height="16" width="16"></svg></button><button class="file"><svg height="16" width="16"></svg><span><b>Перечень затрагиваемых актов</b><small>acts.pdf · На рассмотрении</small></span></button></div>
<div class="cardActions"><button class="secondary">Открыть пакет, маршрут и поправки</button><button class="secondary">Дополнить пакет</button></div>
<div class="inlineUpload"><label>Вид приложения<select><option>Финансово-экономическое обоснование</option></select></label><label>Файл<input type="file"/></label><button class="primary">Прикрепить</button></div>
</article></div>
</section></main></body></html>`;
(async()=>{
 const exe=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>p&&fs.existsSync(p));
 assert(exe,'Chrome needed for Stage 12 package layout check');
 const browser=await chromium.launch({headless:true,executablePath:exe,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
 for(const width of [320,375,430,768,1024,1440]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
  await page.setContent(fixture);
  const result=await page.evaluate(()=>{
   const els=[...document.querySelectorAll('.heading,.form,.card,.cardHeader,.file,.cardActions,.inlineUpload,.count,.listTitle')];
   const safe=els.every(e=>{const r=e.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1&&e.scrollWidth<=e.clientWidth+2});
   return {scroll:document.documentElement.scrollWidth,safe,buttons:[...document.querySelectorAll('.cardActions button,.form>button,.inlineUpload>button')].map(e=>({h:e.getBoundingClientRect().height,right:e.getBoundingClientRect().right})),fileCols:getComputedStyle(document.querySelector('.fileList')).gridTemplateColumns};
  });
  assert(result.scroll<=width+1&&result.safe,'Package content clipped at '+width+': '+JSON.stringify(result));
  assert(result.buttons.every(b=>b.h>=44&&b.right<=width+1),'Broken touch target at '+width+': '+JSON.stringify(result));
  await page.close();
 }
 console.log('PASS: Stage 12 packages display and upload controls at 320, 375, 430, 768, 1024, 1440 px.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
