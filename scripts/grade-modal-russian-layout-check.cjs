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
 }finally{await browser.close()}
})().catch(err=>{console.error(err);process.exitCode=1});
