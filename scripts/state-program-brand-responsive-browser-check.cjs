/* Isolated layout verification using the real ГОС.ID CSS and representative
 * markup from StateProgramLab/StateProgramEditor. No network, auth or game data. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright-core');
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>p&&fs.existsSync(p));
if(!chrome)throw Error('Chrome is required for program form layout checks');
const raw=fs.readFileSync('components/game/StageForms.module.css','utf8')
 .replace(/:global\(([^)]+)\)/g,'$1');
const css=fs.readFileSync('app/globals.css','utf8')+'\n'+
 fs.readFileSync('components/ui/StageModuleHeader.module.css','utf8')+'\n'+raw;
const html=`<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${css}</style></head><body><main style="max-width:1500px;margin:0 auto;padding:12px">
<section class="programLab programWorkspace">
<header class="header" data-stage-module-head>
 <div class="copy"><span class="eyebrow">Управление по целям · Этапы 10–11</span>
  <h2>Государственные программы</h2><p>Национальная цель, измеримые показатели, мероприятия и обоснованные расходы.</p></div>
 <dl class="stats"><div><dt>ПП РФ №786</dt><dd>Госпрограммы</dd><span>Актуальная система управления государственными программами</span></div>
 <div><dt>Указ №309</dt><dd>Национальные цели</dd><span>Национальные цели до 2030 и 2036 годов</span></div></dl>
</header>
<section class="panel addressPanel"><div class="sectionHead"><div><h3>Послание Президента и приоритеты</h3>
<p>Опубликованные приоритеты связываются с паспортом государственной программы.</p></div>
<span class="pill">Черновик</span></div>
<div class="grid addressForm">
<label class="field">Название послания<input aria-label="Название послания" value="Послание Президента Российской Федерации"></label>
<label class="field">Видео или ссылка<input aria-label="Видео или ссылка" value=""></label>
<label class="field wide">Текст послания<textarea aria-label="Текст послания" rows="4"></textarea></label>
<div class="addressActions wide"><span class="addressHint">Введите текст послания</span><button class="primary" type="button">Сохранить послание</button></div></div>
<section class="section"><div class="sectionHead"><div><h3>Национальные цели Послания Президента</h3><p>Президент самостоятельно формулирует пять или шесть целей.</p><span class="goalProgress">Заполнено: 6 из 6</span></div></div>
<div class="programGoalChoices">
${Array.from({length:5},(_,i)=>'<label class="programGoalChoice"><span class="goalOrdinal">'+(i+1)+'.</span><span class="goalInputGroup">Цель '+(i+1)+'<textarea rows="2" placeholder="Сформулируйте собственную цель Президента"></textarea></span></label>').join('')}
<div class="programGoalControls"><button type="button">Добавить шестую цель</button></div>
<div class="actions"><button type="button">Сохранить выбранные цели</button><button type="button" class="primary">Утвердить цели и опубликовать послание</button></div>
</div></section></section>
<div class="programPicker"><div class="programTabs"><button type="button" aria-pressed="true"><b>Государственная программа</b><span>Черновик</span></button></div><button class="programNew" type="button">Новая программа</button></div>
<section class="panel programEditorPanel"><div class="sectionHead programIntro"><div><h3>Новая государственная программа</h3><p>Паспорт, цели, мероприятия и расходы заполняются вместе. Суммы указаны в рублях.</p></div></div>
<section class="treeExpenses" aria-label="Расходы элемента">
 <div class="tableWrap"><table class="table treeExpenseTable">
 <thead><tr><th>Что финансируется</th><th>Обоснование</th><th>Год</th><th>Сумма, ₽</th><th>Удалить</th></tr></thead>
 <tbody><tr>
 <td data-label="Что финансируется"><input aria-label="Предмет расхода" placeholder="Например: строительство двух поликлиник"></td>
 <td data-label="Обоснование"><textarea rows="2" aria-label="Обоснование расхода" placeholder="Почему требуется эта сумма?"></textarea></td>
 <td data-label="Год"><input type="number" aria-label="Год расхода" value="2026"></td>
 <td data-label="Сумма, ₽"><input aria-label="Сумма расхода" placeholder="0,00"></td>
 <td data-label="Удалить" class="treeExpenseRemove"><button type="button" aria-label="Удалить расход">×</button></td>
 </tr></tbody></table></div>
 <button class="treeAddExpense" type="button">Добавить расход к элементу 1.1</button>
 </section>
<fieldset class="form"><legend>Паспорт программы</legend><div class="grid">
<label class="field">Название программы<input aria-label="Название программы"></label>
<label class="field">Ответственное министерство<input aria-label="Ответственное министерство"></label>
<div class="styledSelect"><span class="styledSelectLabel">Ответственный министр</span><button class="styledSelectTrigger">Выберите участника</button></div>
<div class="styledSelect"><span class="styledSelectLabel">Куратор</span><button class="styledSelectTrigger">Выберите участника</button></div>
<label class="field">Начало реализации<input type="date" aria-label="Начало реализации"></label>
<label class="field">Завершение реализации<input type="date" aria-label="Завершение реализации"></label>
<label class="field wide">Участники программы<textarea rows="2"></textarea></label>
</div></fieldset></section>
</section></main></body></html>`;
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  for(const width of [320,375,430,768,1024,1440]){
   const page=await browser.newPage({viewport:{width,height:900},deviceScaleFactor:1});
   await page.setContent(html,{waitUntil:'load'});
   const m=await page.evaluate(()=>{
    const box=sel=>{const node=document.querySelector(sel);if(!node)throw Error(sel+' missing');const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
    return {viewport:innerWidth,scroll:document.documentElement.scrollWidth,header:box('[data-stage-module-head]'),
      main:box('.programWorkspace'),title:box('.programWorkspace h2'),
      stats:box('[data-stage-module-head] dl'),address:box('.addressPanel'),
      body:box('.addressForm textarea'),save:box('.addressActions button'),
      progress:box('.goalProgress'),progressBorder:getComputedStyle(document.querySelector('.goalProgress')).borderTopWidth,
      picker:box('.programPicker'),newButton:box('.programNew'),
      editor:box('.programEditorPanel'),expense:box('.treeExpenses'),expenseYear:box('.treeExpenseTable input[type=number]'),expenseRemove:box('.treeExpenseRemove button'),expenseThead:getComputedStyle(document.querySelector('.treeExpenseTable thead')).display,minister:box('.styledSelectTrigger'),goal:box('.programGoalChoice textarea'),goalAction:box('.programGoalControls button'),
      bg:getComputedStyle(document.querySelector('[data-stage-module-head]')).backgroundImage};
   });
   assert(m.scroll<=width+2,'Horizontal page overflow at '+width+': '+m.scroll);
   for(const key of ['header','title','stats','address','body','save','progress','picker','newButton','editor','expense','expenseYear','expenseRemove','minister','goal','goalAction']){
    assert(m[key].left>=-1 && m[key].right<=width+1,key+' exits viewport '+width);
   }
   assert(m.progressBorder==='0px','Goal progress must not render as a badge/strip at '+width);
   assert(m.progress.top>=m.save.bottom-1,'Goal progress overlaps address actions at '+width);
   assert(m.expenseYear.height>=42&&m.expenseRemove.height>=32,'Expense inputs or remove control too small at '+width);
   if(width<=850)assert(m.expenseThead==='none','Compact expense rows must use accessible field labels at '+width);
   else assert(m.expenseThead!=='none','Wide screen retains semantic table header at '+width);
   assert(m.goal.top>=m.save.bottom-1,'Goal form overlaps address save action at '+width);
   assert(m.save.top>=m.body.bottom-1,'Save overlaps address content at '+width);
   assert(m.save.height>=42&&m.newButton.height>=42&&m.minister.height>=42&&m.goalAction.height>=42,'Touch target is too small at '+width);
   assert(m.bg==='none','Program header should reuse the light Work/Documents panel at '+width);
   if(width<=700)assert(m.save.width>=m.body.width-2,'Mobile save button should be full width at '+width);
   if(width>1000)assert(m.stats.left>=m.title.left,'Header information columns should remain aligned at '+width);
   await page.close();
   console.log('PASS program form geometry '+width+'px');
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
