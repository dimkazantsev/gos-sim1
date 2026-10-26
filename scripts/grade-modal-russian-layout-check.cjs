const assert=require('node:assert/strict');
const fs=require('node:fs');
const Module=require('node:module');
const ts=require('typescript'),{chromium}=require('playwright-core');
const file='components/game/assessmentPresentation.ts',mod=new Module(file,module);
mod.filename=file;mod.paths=module.paths;
mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{
 module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022
}}).outputText,file);
const {assessmentRunLabel,assessmentRationaleParagraphs}=mod.exports;
for(const [code,expected] of [['hourly','Ежечасно'],['manual','Вручную'],['cron','По расписанию'],['unknown','Автоматический пересчёт']])
 assert.equal(assessmentRunLabel(code),expected);
const original='Критерий 1 · право и правила: не подтверждён. Критерий 2 · стратегия и интересы: не подтверждён. Критерий 3 · итоговый разбор: не подтверждён. Автооценка: 1/3 — низкий уровень. События: правомерных решений 0.';
const paragraphs=assessmentRationaleParagraphs(original);
assert(paragraphs.length>=4,'Readability: explanation should have separate sections');
assert.equal(paragraphs.join(' '),original,'Do not change original explanation');
const component=fs.readFileSync('components/game/GradesView.tsx','utf8');
assert(component.includes('assessmentRunLabel(a.last_run_type)'));
assert(component.includes('assessmentRunLabel(r.run_type)'));
assert(component.includes('assessmentRationaleParagraphs(a.public_rationale)'));
assert(!component.includes('{a.last_run_type}</span>')&&!component.includes('{r.run_type}</span>'));
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>p&&fs.existsSync(p));
if(!chrome)throw Error('Browser is needed for modal regression');
const css=['app/sim-panels.css','app/design-views.css','app/design-responsive.css','app/2026-stage-party-grades-repair.css'].map(p=>fs.readFileSync(p,'utf8')).join('\n');
const rows=['hourly','manual'].map((type,i)=>
 '<article><time class="gradeRunTime">14.10, 14:'+String(i+11)+'</time><b class="gradeRunScore">'+(i+1)+'/3 · Низкий</b><span class="gradeRunTrigger">'+assessmentRunLabel(type)+'</span><em class="gradeRunCriteria">Право ○ · Стратегия ○ · Анализ ○</em></article>').join('');
const markup=[
 '<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{font:14px Arial,sans-serif;margin:0;background:#eef3fb}',css,'</style><body>',
 '<div class="gradeModalBack"><article class="gradeModal" role="dialog" aria-modal="true"><header><div><small>ЭТАП 1</small><h2>Тестовый участник</h2><p>Регистрация партий</p></div></header>',
 '<div class="gradeScoreHero draft"><strong>1</strong><div><b>Низкий</b><span>Автоматический черновик</span></div></div>',
 '<section class="gradeRationale"><small>ИНТЕРПРЕТАЦИЯ ДЕЙСТВИЙ</small><div class="gradeRationaleText">',
 ...paragraphs.map(t=>'<p>'+t+'</p>'),
 '</div><footer><span>Пересчёт: 14.10, 14:11</span><span>Ежечасно</span><span>Версия 2</span></footer></section>',
 '<details class="gradeRunHistory" open><summary>История автоматических пересчётов <span>2</span></summary><div>',
 rows,'</div></details></article></div></body></html>'
].join('');

// The stage debrief is a separate two-column form; check its actual stylesheet.
assert(component.includes('Этот текст вы отправляете системе ИИ'), 'Explain that the debrief goes to the AI system');
assert(component.includes('В чате «Вне игры»'), 'Explain the out-of-game discussion');
assert(component.includes('Преподаватель может учесть содержательное обсуждение'), 'Keep teacher grading discretionary');
const debriefCss=fs.readFileSync('app/2026-profile-grade-layout.css','utf8');
assert(debriefCss.includes('grid-template-columns:minmax(0,1fr);grid-auto-rows:min-content'),'Teacher assessment must be single-column at ALL screen widths');
assert(!debriefCss.includes('grid-template-columns:minmax(180px,.8fr) minmax(0,1.6fr)'),'Legacy desktop two-column form must be removed');
const baseGradeCss=fs.readFileSync('app/sim-panels.css','utf8');
assert(!baseGradeCss.includes('.gradeApproval>div{grid-column:1/-1;display:flex;justify-content:flex-end;gap:6px}'),'Selector wrapper must not inherit action-button right alignment');
assert(baseGradeCss.includes('.gradeApproval>div:last-child:not(.styledSelect){'),'Action row must be the ONLY right-aligned direct div');
const debriefMarkup=[
 '<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{font:14px Arial,sans-serif;margin:0;background:#eef3fb}',css,debriefCss,'</style><body>',
 '<main class="gradesPage" style="width:100%;max-width:1350px;margin:auto;padding:12px"><section class="gradesDebrief gradesDebriefRefined"><header class="gradesDebriefHeading"><div><small>КРИТЕРИЙ 3 · ИТОГОВЫЙ РАЗБОР</small><h2>Анализ этапа</h2></div></header>',
 '<div class="gradesDebriefFields"><div class="gradesDebriefContext"><div class="styledSelect"><span class="styledSelectLabel">Этап для итогового разбора</span><button type="button" class="styledSelectTrigger">1. Создание партий</button></div>',
 '<div class="gradesDebriefPrompt"><b>Кому предназначен разбор</b><p>Этот текст вы отправляете системе ИИ для предварительного анализа этапа. Укажите причины и цели действий, интересы сторон, применённые правила, результаты и политические последствия.</p>',
 '<p>В чате «Вне игры» можно подробнее обсуждать закономерности, аргументы и альтернативные решения. Преподаватель может учесть содержательное обсуждение и повысить итоговую оценку.</p>',
 '<small>До утверждения итоговой оценки преподавателем разбор можно обновлять.</small></div></div>',
 '<label class="gradesDebriefEditor"><span>Ваш итоговый разбор</span><textarea placeholder="Изложите содержательный анализ выбранного этапа…"></textarea></label></div>',
 '</section></main></body></html>'
].join('');

// Synthetic teacher fixture: inspect CSS in Chromium without live student records.
assert(component.indexOf('className="gradeApproval"')<component.indexOf('className="gradeRationale gradeRationaleExplained"'),'Teacher decision precedes long explanation');
const teacherFixture=[
 '<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width,initial-scale=1"><style>',
 '*{box-sizing:border-box}body{font:14px Arial,sans-serif;margin:0;background:#eef3fb}',
 css,debriefCss,'</style><body>',
 '<div class="gradeModalBack"><article class="gradeModal gradeModalRefined" role="dialog" aria-modal="true">',
 '<header class="gradeModalHeading"><div><small>Этап 11 · Результат участника</small><h2>Тестов Тест Тестович</h2><p>Рассмотрение государственных программ и внесённых инициатив</p></div><button class="gsIconAction" aria-label="Закрыть оценку">×</button></header>',
 '<div class="gradeScoreHero draft"><strong>2</strong><div><span class="gradeScoreCaption">Оценка за этап · из 3 баллов</span><b>Средний уровень</b><span>Автоматический черновик</span></div></div>',
 '<div class="gradeCriteria"><span>Право и правила</span><span>Стратегия и интересы</span><span>Анализ этапа</span></div>',
 '<section class="gradeApproval"><div class="styledSelect"><span class="styledSelectLabel">Итоговый балл</span><button class="styledSelectTrigger"><span class="styledSelectValue">2 · Средний уровень</span></button></div><label>Комментарий<textarea rows="3" placeholder="Почему вы подтверждаете или меняете автооценку"></textarea></label><div><button type="button">Пересчитать сейчас</button><button type="button" class="primary">Утвердить как итоговую</button></div></section>',
 '<section class="gradeRationale gradeRationaleExplained"><header class="gradeRationaleHeading"><small>ПОЯСНЕНИЕ ОЦЕНКИ</small><h3>За что начисляются баллы</h3></header><div class="gradeExplanation"><article class="gradeExplanationCriterion"><h4>Законность решений и соблюдение процедур</h4><p>',
 'Оценка учитывает документы и решения. '.repeat(20),'</p></article></div></section>',
 '<details class="gradeRunHistory" open><summary>История автоматических пересчётов <span>2</span></summary><div>',rows,'</div></details>',
 '<section class="gradeEvidence"><h3>Доказательства</h3><div class="gradeEvidenceGroups"><details open><summary>Документы</summary><div><article><p>',
 'Описание игровых действий и обоснования. '.repeat(12),'</p></article></div></details></div></section>',
 '</article></div></body></html>'
].join('');

(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  for(const width of [390,768,1440]){
   const page=await browser.newPage({viewport:{width,height:900}});
   await page.setContent(markup);
   const d=await page.evaluate(()=>{
    const box=s=>document.querySelector(s).getBoundingClientRect(),
     modal=box('.gradeModal'),hero=box('.gradeScoreHero'),score=box('.gradeScoreHero>strong'),
     rationale=box('.gradeRationale'),history=box('.gradeRunHistory');
    const itemBoxes=[...document.querySelectorAll('.gradeRunHistory article')].map(row=>({
     row:row.getBoundingClientRect(),children:[...row.children].map(c=>c.getBoundingClientRect())
    }));
    return {bodyWidth:document.body.scrollWidth,viewport:document.documentElement.clientWidth,
     modal:{left:modal.left,right:modal.right,scroll:document.querySelector('.gradeModal').scrollWidth,client:document.querySelector('.gradeModal').clientWidth},
     hero:{top:hero.top,bottom:hero.bottom},score:{top:score.top,bottom:score.bottom,mid:(score.top+score.bottom)/2},
     rationale:{left:rationale.left,right:rationale.right},history:{left:history.left,right:history.right},
     rows:itemBoxes.map(x=>({left:x.row.left,right:x.row.right,items:x.children.map(c=>({left:c.left,right:c.right}))})),
     paragraphs:[...document.querySelectorAll('.gradeRationaleText>p')].map(p=>({right:p.getBoundingClientRect().right}))
    };
   });
   assert(d.modal.left>=-1&&d.modal.right<=width+1,'Modal horizontal bounds '+width);
   assert(d.bodyWidth<=d.viewport+2,'No page overflow '+width);
   assert(d.modal.scroll<=d.modal.client+2,'No modal overflow '+width);
   assert(d.score.top>=d.hero.top-1&&d.score.bottom<=d.hero.bottom+1,'Score box fits hero '+width);
   assert(Math.abs(d.score.mid-(d.hero.top+d.hero.bottom)/2)<=2,'Score centered '+width);
   assert(d.rationale.left>=d.modal.left&&d.rationale.right<=d.modal.right+1,'Rationale contained '+width);
   assert(d.history.left>=d.modal.left&&d.history.right<=d.modal.right+1,'History contained '+width);
   for(const row of d.rows)for(const item of row.items)
    assert(item.left>=row.left-1&&item.right<=row.right+1,'History grid aligned '+width);
   assert(d.paragraphs.every(p=>p.right<=d.rationale.right+1),'Explanation wraps '+width);
   await page.close();
   console.log('PASS Russian labels, explanation and assessment modal at '+width+'px');
  }

  for(const width of [320,390,768,1024,1440]){
   const page=await browser.newPage({viewport:{width,height:900}});
   await page.setContent(debriefMarkup);
   const form=await page.evaluate(()=>{
    const rect=sel=>{const e=document.querySelector(sel),r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height}};
    return {viewport:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,
     fields:rect('.gradesDebriefFields'),leftLabel:rect('.gradesDebriefContext .styledSelectLabel'),
     rightLabel:rect('.gradesDebriefEditor>span'),selector:rect('.gradesDebriefContext .styledSelectTrigger'),
     textarea:rect('.gradesDebriefEditor textarea'),prompt:rect('.gradesDebriefPrompt')};
   });
   assert(form.scroll<=form.viewport+2,'Debrief has horizontal overflow at '+width+': '+JSON.stringify(form));
   assert(form.textarea.left>=-1&&form.textarea.right<=width+2,'Debrief textarea outside viewport at '+width);
   assert(form.selector.left>=-1&&form.selector.right<=width+2,'Debrief stage selector outside viewport at '+width);
   assert(form.textarea.height>=195,'Debrief textarea too short at '+width);
   if(width>940){
    assert(Math.abs(form.leftLabel.top-form.rightLabel.top)<=2,'Debrief labels misaligned at '+width+': '+JSON.stringify(form));
    assert(Math.abs(form.selector.top-form.textarea.top)<=3,'Debrief input tops misaligned at '+width+': '+JSON.stringify(form));
    assert(Math.abs(form.prompt.bottom-form.textarea.bottom)<=3,'Debrief columns have unequal bottoms at '+width+': '+JSON.stringify(form));
   }else{
    assert(form.textarea.top>form.prompt.bottom,'Debrief fields must stack on mobile at '+width);
   }
   await page.close();
   console.log('PASS debrief form and AI/out-of-game guidance at '+width+'px');
  }
 
  for(const [width,height] of [[320,640],[360,740],[390,844],[600,740],[768,1024],[820,1180],[1024,768],[1440,900],[1680,1050]]){
   const page=await browser.newPage({viewport:{width,height},hasTouch:width<=820});
   await page.setContent(teacherFixture);
   const modal=page.locator('.gradeModalRefined'),note=modal.locator('.gradeApproval textarea');
   const result=await page.evaluate(()=>{
    const pick=s=>document.querySelector(s),rect=s=>pick(s).getBoundingClientRect(),d=pick('.gradeModalRefined');
    const sections=['.gradeModalHeading','.gradeScoreHero','.gradeCriteria','.gradeApproval','.gradeRationale','.gradeRunHistory','.gradeEvidence','.styledSelectTrigger','.gradeApproval textarea'].map(selector=>{const r=rect(selector);return {selector,left:r.left,right:r.right,top:r.top,bottom:r.bottom}});
    const buttons=[...document.querySelectorAll('.gradeApproval button')].map(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:r.height}});
    const m=d.getBoundingClientRect();
    const b=s=>{const r=rect(s);return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width}};
    return {pageScroll:document.documentElement.scrollWidth,modal:{left:m.left,right:m.right,height:m.height,scroll:d.scrollWidth,client:d.clientWidth},width:innerWidth,approval:rect('.gradeApproval').top,rationale:rect('.gradeRationale').top,sections,buttons,
     form:{panel:b('.gradeApproval'),selector:b('.gradeApproval>.styledSelect'),scoreLabel:b('.gradeApproval .styledSelectLabel'),scoreTrigger:b('.gradeApproval .styledSelectTrigger'),comment:b('.gradeApproval>label'),textarea:b('.gradeApproval textarea'),actions:b('.gradeApproval>div:last-child'),scoreAlignment:getComputedStyle(pick('.gradeApproval>.styledSelect')).justifyContent }};
   });
   assert(result.pageScroll<=width+2,'Global horizontal overflow '+width);
   assert(result.modal.left>=-1&&result.modal.right<=width+2,'Dialog outside viewport '+width);
   assert(result.modal.scroll<=result.modal.client+2,'Dialog horizontal clipping '+width);
   assert(result.approval<result.rationale,'Teacher note must precede long rationale '+width);
   const {panel,selector,scoreLabel,scoreTrigger,comment,textarea,actions,scoreAlignment}=result.form;
   assert(Math.abs(scoreLabel.left-comment.left)<=2,'Score heading incorrectly shifted right at '+width+': '+JSON.stringify(result.form));
   assert(Math.abs(scoreTrigger.left-textarea.left)<=2,'Score field not aligned with comment at '+width+': '+JSON.stringify(result.form));
   assert(Math.abs(scoreTrigger.right-textarea.right)<=2,'Score field and comment must share the right edge at '+width);
   assert(scoreAlignment==='stretch','The score selector must stretch to the comment width at '+width);
   assert(selector.top>=panel.top-1&&selector.bottom<=comment.top+1,'Grade selection must precede comment at '+width);
   assert(comment.top>=selector.bottom-1&&comment.bottom<=actions.top+1,'Comment must precede buttons at '+width);
   assert(textarea.left>=panel.left-1&&textarea.right<=panel.right+1,'Textarea outside grade panel at '+width);
   assert(textarea.width>=panel.width*.70,'Comment should fill grade panel, not a narrow desktop column at '+width);
   assert(actions.top>=textarea.bottom-1,'Grade approval actions must sit after comment at '+width);
   assert(selector.right<=panel.right+1&&actions.right<=panel.right+1,'Controls outside grade panel at '+width);
   for(const part of result.sections)assert(part.left>=result.modal.left-1&&part.right<=result.modal.right+2,'Section '+part.selector+' outside modal at '+width);
   assert(result.buttons.every(b=>b.height>=44),'Touch buttons too small at '+width);
   for(let i=0;i<result.buttons.length;i++)for(let j=i+1;j<result.buttons.length;j++){
    const a=result.buttons[i],b=result.buttons[j];
    assert(!(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1),'Overlapping actions at '+width);
   }
   await note.scrollIntoViewIfNeeded();await note.fill('Обоснование изменения оценки после анализа документов и участия в решениях');
   assert((await note.inputValue()).startsWith('Обоснование'));
   await modal.evaluate(el=>el.scrollTop=el.scrollHeight);
   const close=await page.locator('.gradeModalHeading .gsIconAction').boundingBox(),box=await modal.boundingBox();
   assert(close&&box&&close.y>=box.y-1&&close.y+close.height<=box.y+height+1,'Close action disappears on scroll '+width);
   if(width<=600)assert(Math.abs(box.height-height)<=2,'Mobile modal is not full-height '+width);
   await page.close();
   console.log('PASS teacher grading '+width+'x'+height+': focus, scroll, touch, no overlap/overflow');
  }
}finally{await browser.close()}
})().catch(err=>{console.error(err);process.exitCode=1});
