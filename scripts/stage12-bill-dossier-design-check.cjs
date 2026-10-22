'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright-core');
const css=fs.readFileSync('app/2026-bill-dossier-design.css','utf8');
const tokens=fs.readFileSync('app/design-tokens.css','utf8');
const original=fs.readFileSync('app/2026-npa-workspace-canonical.css','utf8');
const workflow=fs.readFileSync('app/2026-document-workflow-v2.css','utf8');
const markup=fs.readFileSync('components/game/DocumentsView.tsx','utf8');
const layout=fs.readFileSync('app/layout.tsx','utf8');
assert(layout.includes("import './2026-bill-dossier-design.css';"),'Late canonical style must be loaded');
for(const name of ['billReadinessPanel','billReadinessStepCopy','billDossierEditorHead','billDossierCard','billProfileForm','billPackageListCanonical','billPackageUpload']) assert(markup.includes(name)&&css.includes(name),name+' is scoped and unchanged');
assert(css.includes('var(--gs-accent)')&&css.includes('var(--gs-border)'), 'Only established GOС.ID tokens');
assert(markup.includes("saveBillProfile()")&&markup.includes("uploadBillFile()"),'Existing save and upload controls remain wired');
const fixture=`<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"/><style>
${tokens}
body{margin:0;background:var(--gs-bg);font-family:Manrope,Arial,sans-serif}
*{box-sizing:border-box}
button,input,textarea{font:inherit} button{cursor:pointer}
.legalPortal{max-width:1220px;margin:auto;padding:12px}
.billReadinessPanel{background:white}
.styledSelect{display:grid;gap:6px}
.styledSelectTrigger{display:flex;justify-content:space-between}
${workflow}
${original}
${css}
</style></head><body><main class="legalPortal"><section class="surface billDossierCompact billReadinessPanel">
<header class="billDossierCompactHead billReadinessHead"><div><small>Комплект законопроекта</small><h2>Комплект внесения</h2><p>Перед движением законопроекта проверьте обязательные блоки ниже. Здесь показано только то, что влияет на готовность документа.</p></div><span class="bad">Не готов к внесению</span></header>
<div class="billReadinessProgress"><div><span>Готовность комплекта</span><b>0 из 2 блоков</b></div><div class="billReadinessProgressTrack"><i style="width:0%"></i></div></div>
<div class="billReadinessSteps"><article class="needs-action"><span class="billReadinessStepNo">1</span><div class="billReadinessStepCopy"><small>Шаг 1</small><h3>Карточка внесения</h3><p>Заполните обязательные реквизиты законопроекта.</p><dl><div><dt>Профильный комитет</dt><dd>Не выбран</dd></div><div><dt>Представитель в ГД</dt><dd>Не требуется</dd></div></dl></div><span class="billReadinessStepState">Нужно заполнить</span></article>
<article class="needs-action"><span class="billReadinessStepNo">2</span><div class="billReadinessStepCopy"><small>Шаг 2</small><h3>Обязательные материалы</h3><p>Добавьте недостающие приложения к законопроекту.</p><div class="billMaterialSummary"><b>0 из 2</b><span>Не хватает: Пояснительная записка, Перечень затрагиваемых актов</span></div></div><span class="billReadinessStepState">0 / 2</span></article></div>
<footer class="billReadinessFooter"><div><b>Следующее действие</b><span>Заполните карточку внесения.</span></div><button class="primary">Закрыть панель</button></footer>
<div class="billDossierEditor"><div class="billDossierEditorHead"><div><small>ИСХОДНЫЙ КОМПЛЕКТ</small><h3>Карточка и материалы инициатора</h3></div><span>До внесения законопроекта</span></div>
<div class="billDossierLayout"><section class="billDossierCard"><div class="billDossierCardHead"><b>Карточка внесения</b><small>Комитет, представитель и параметры исходного комплекта</small></div>
<div class="billProfileForm"><label><input type="checkbox"> Требуется ФЭО</label><label><input type="checkbox"> Требуется заключение Правительства</label>
<div class="styledSelect"><span class="styledSelectLabel">Профильный комитет</span><button class="styledSelectTrigger"><span class="styledSelectValue">Комитет по социальной политике</span><span>⌄</span></button></div>
<div class="styledSelect"><span class="styledSelectLabel">Представитель в ГД</span><button class="styledSelectTrigger"><span class="styledSelectValue">Иванов Иван Иванович</span><span>⌄</span></button></div><textarea rows="2" placeholder="Комментарий к внесению">Рассмотрите, пожалуйста.</textarea><button class="secondary">Сохранить карточку</button></div></section>
<section class="billDossierCard"><div class="billDossierCardHead"><b>Материалы субъекта инициативы</b><small>Только документы, обязательные при первоначальном внесении</small></div>
<div class="billPackageList billPackageListCanonical"><div class="missing"><span class="billPackageStatusIcon">▤</span><div><b>Пояснительная записка</b></div></div><div class="missing"><span class="billPackageStatusIcon">▤</span><div><b>Перечень затрагиваемых актов</b></div></div></div>
<div class="billPackageUpload"><div class="styledSelect"><span class="styledSelectLabel">Добавить материал</span><button class="styledSelectTrigger"><span class="styledSelectValue">Пояснительная записка</span><span>⌄</span></button></div>
<label>Выберите файл<input type="file" accept=".pdf,.doc,.docx,.txt"/></label><button disabled>Загрузить</button></div></section></div></div></section></main></body></html>`;
(async()=>{
const executable=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(x=>x&&fs.existsSync(x));
assert(executable,'Chrome required for bill dossier design verification');
const browser=await chromium.launch({headless:true,executablePath:executable,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 for(const width of [320,375,430,768,1024,1440]){
  const page=await browser.newPage({viewport:{width,height:940},reducedMotion:'reduce'});
  await page.setContent(fixture);
  const data=await page.evaluate(()=>{
   const tags=['.billReadinessPanel','.billReadinessSteps','.billReadinessSteps article','.billDossierLayout','.billDossierCard','.billProfileForm','.billPackageUpload','.billPackageListCanonical'];
   const containers=tags.flatMap(sel=>[...document.querySelectorAll(sel)]).map(el=>{let r=el.getBoundingClientRect();return {l:r.left,r:r.right,scroll:el.scrollWidth,client:el.clientWidth};});
   const buttons=[...document.querySelectorAll('.billDossierCard button,.billReadinessFooter button')].map(el=>({h:el.getBoundingClientRect().height}));
   const check=document.querySelector('.billProfileForm input[type=checkbox]');
   const ck=getComputedStyle(check);
   const description=getComputedStyle(document.querySelector('.billReadinessStepCopy p'));
   const first=document.querySelector('.billProfileForm>label');
   const firstStyle=getComputedStyle(first);
   const uploadLabel=document.querySelector('.billPackageUpload>label');
   const file=document.querySelector('.billPackageUpload input[type=file]');
   return {pageScroll:document.documentElement.scrollWidth,containers,buttons,checkbox:{w:check.getBoundingClientRect().width,h:check.getBoundingClientRect().height},descriptionSize:parseFloat(description.fontSize),checkLayout:firstStyle.display,firstHeight:first.getBoundingClientRect().height,uploadHeight:uploadLabel.getBoundingClientRect().height,fileBounds:file.getBoundingClientRect().height};
  });
  assert(data.pageScroll<=width+1, 'Whole page overflows at '+width+': '+JSON.stringify(data));
  assert(data.containers.every(x=>x.l>=-1&&x.r<=width+1&&x.scroll<=x.client+2),'Child panel overflows at '+width+': '+JSON.stringify(data));
  assert(data.buttons.every(x=>x.h>=44),'Buttons smaller than 44 px at '+width+': '+JSON.stringify(data));
  assert(data.descriptionSize>=12,'Small text at '+width+': '+data.descriptionSize);
  assert(data.checkbox.w>=18&&data.checkbox.w<=24&&data.checkbox.h>=18&&data.checkbox.h<=24,'Checkbox wrong size at '+width);
  assert(data.checkLayout==='flex'&&data.firstHeight<=58,'Checkbox row over-expanded at '+width);
  assert(data.uploadHeight>=44&&data.fileBounds>=44,'File chooser needs tappable upload surface at '+width);
  await page.close();
 }
 console.log('PASS: bill dossier panels, checkboxes, fields, file control and buttons fit 320-1440 px with shared design tokens.');
} finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
