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
 }finally{await browser.close()}
})().catch(err=>{console.error(err);process.exitCode=1});
