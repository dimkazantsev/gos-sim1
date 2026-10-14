/* Real browser grid checks: column baselines and modal fit at multiple widths. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright-core');
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>p&&fs.existsSync(p));
if(!chrome)throw Error('Chrome or Chromium is required');
const css=['app/design-views.css','app/design-responsive.css','app/2026-civic-portal.css','app/2026-stage-party-grades-repair.css']
 .map(name=>fs.readFileSync(name,'utf8')).join('\n');
const cells=n=>Array.from({length:n},(_,i)=>'<span class="align-check">'+(i+1)+'</span>').join('');
const scores=Array.from({length:16},(_,i)=>'<button class="draft" type="button"><b>'+i+'</b><small>авто</small></button>').join('');
const markup=`<!doctype html><html><meta name="viewport" content="width=device-width, initial-scale=1"><style>
*{box-sizing:border-box}body{margin:0;background:#eef3fb;font:14px Arial,sans-serif}.gradesPage{width:100%;padding:12px}.gradesMatrixWrap{width:100%;max-width:100%;padding:10px;background:#fff}.gradeModal{width:min(900px,100%);margin:20px auto;padding:10px;background:white}
${css}</style><body><div class="gradesPage"><section class="surface gradesMatrixWrap"><div class="gradesMatrix">
<div class="gradesMatrixHead"><b>СТУДЕНТ</b><span>Σ</span><span>СР.</span>${cells(16)}</div>
<div class="gradesMatrixRow"><div><b>Тестов Тест Тестович</b><small>МИР · участник</small></div><span class="gradeTotal">12</span><span class="gradeTotal">1.50</span>${scores}</div>
</div></section></div>
<div class="gradeModal"><section class="blitzVsnScore"><header><b>Знания и правоприменение</b><strong>0.50 / 1</strong></header><div class="blitzVsnBreakdown">${['Кейсы','Действия','Блиц','Полнота'].map(n=>'<span><small>'+n+'</small><b>0.25</b></span>').join('')}</div>
<p>Решения кейсов: 2 из 3</p></section><section class="gradeRationale"><small>ИНТЕРПРЕТАЦИЯ ДЕЙСТВИЙ</small><p>${'Содержательный текст оценки. '.repeat(25)}</p></section></div>
<section class="gosPartyElection" style="margin:16px;max-width:900px"><header class="gosPartyElectionHead"><span class="gosPartyElectionIcon">⌁</span><div><small>ПАРТИЙНОЕ САМОУПРАВЛЕНИЕ</small><h3>Выборы председателя</h3></div><span class="gosPartyElectionStatus">Набор участников</span></header><div class="gosPartyElectionSteps"><div class="gosPartyElectionStep"><span>Члены партии</span><b>2</b></div><div class="gosPartyElectionStep"><span>Приглашены</span><b>0</b></div><div class="gosPartyElectionStep"><span>Голоса</span><b>0/2</b></div></div></section></body></html>`;
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  for(const width of [390,768,1440]){
   const page=await browser.newPage({viewport:{width,height:900}});
   await page.setContent(markup);
   const info=await page.evaluate(()=>{
    const head=[...document.querySelectorAll('.gradesMatrixHead > *')].map(x=>x.getBoundingClientRect());
    const row=[...document.querySelectorAll('.gradesMatrixRow > *')].map(x=>x.getBoundingClientRect());
    const root=document.querySelector('.gradesMatrix').getBoundingClientRect();
    const grade=document.querySelector('.gradeModal').getBoundingClientRect();
    const criteria=[...document.querySelectorAll('.blitzVsnBreakdown>span')].map(x=>x.getBoundingClientRect());
    const rationale=document.querySelector('.gradeRationale').getBoundingClientRect();
    const election=document.querySelector('.gosPartyElection').getBoundingClientRect();
    return {head:head.map(x=>x.left),row:row.map(x=>x.left),count:head.length,root:{left:root.left,right:root.right},bodyWidth:document.body.scrollWidth,viewport:document.documentElement.clientWidth,grade:{left:grade.left,right:grade.right},criteria:criteria.map(x=>({left:x.left,right:x.right,top:x.top})),rationale:{left:rationale.left,right:rationale.right},election:{left:election.left,right:election.right}};
   });
   assert.equal(info.count,19,'Head is student + total + average + 16 stages');
   assert.equal(info.row.length,19);
   for(let i=0;i<19;i++)assert(Math.abs(info.head[i]-info.row[i])<1.5,'Alignment column '+i+' at '+width);
   assert(info.bodyWidth<=info.viewport+2,'No page horizontal overflow at '+width);
   assert(info.grade.left>=-1&&info.grade.right<=width+2,'Modal fits viewport');
   assert(info.rationale.left>=info.grade.left-1&&info.rationale.right<=info.grade.right+1,'Rationale fits');
   assert(info.election.left>=-1&&info.election.right<=width+2,'Election card fits viewport');
   assert(info.criteria.length===4&&info.criteria.every(x=>x.right<=info.grade.right+1),'Breakdown values fit inside modal');
   await page.close();
   console.log('PASS '+width+'px: 19 aligned tracks, contained modal, election and knowledge grid');
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
