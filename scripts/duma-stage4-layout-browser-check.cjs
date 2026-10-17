/* Visual contract for the stage-four State Duma panel.
   Browser uses isolated markup: no Supabase calls or production data changes. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const {chromium}=require('playwright-core');
const path=require('node:path');
const read=name=>fs.readFileSync(path.resolve(__dirname,'..',name),'utf8');
const jsx=read('components/game/DumaLeadershipElection.tsx');
const css=read('app/design-tokens.css')+'\n'+read('app/globals.css')+'\n'+read('app/stage-operations.css');
const transpiled=ts.transpileModule(jsx,{
 fileName:'DumaLeadershipElection.tsx',
 compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022},
 reportDiagnostics:true,
});
assert(!transpiled.diagnostics?.some(d=>d.category===ts.DiagnosticCategory.Error),'State Duma JSX parses');
for(const name of ['dumaElectionIntro','dumaElectionProcedureIcon','dumaElectionCreator','dumaElectionEmpty']){
 assert(jsx.includes(name)&&css.includes('.'+name),'Component/style pairing missing: '+name);
}
assert(!jsx.includes('с учётом GV'),'Use established Russian ГОС.ID terminology');
assert(jsx.includes("open_duma_leadership_procedure_vote")&&jsx.includes("create_office_election")&&jsx.includes("cast_personal_office_ballot"),'Voting RPC wiring retained');
assert(jsx.includes("procedureApproved?'approved'"),'Procedure state retains semantic status');
const html='<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+
 '*{box-sizing:border-box}body{margin:0;background:#f4f7fb;font-family:Arial,sans-serif}'+css+'</style></head><body><main class="stageOperations"><div class="stageOperationsModules"><section class="dumaElection">'+
 '<header class="dumaElectionHead"><div class="dumaElectionIntro"><div class="dumaElectionEyebrow"><svg width="17" height="17"></svg><span>Государственная Дума</span><span class="dumaElectionStage">Этап 4</span></div><h2>Избрание руководства Государственной Думы</h2><p>После регистрации депутаты утверждают порядок выборов. Фракции выдвигают кандидатов, затем проводится голосование. Депутат распоряжается действующими мандатами с учётом гоствойтинга.</p></div><div class="dumaThreshold"><span>Необходимое большинство</span><strong>226 <small>из 450</small></strong><em>голосов для избрания</em></div></header>'+
 '<div class="dumaElectionProcedure" data-procedure-status="pending"><span class="dumaElectionProcedureIcon"><svg width="22" height="22"></svg></span><div class="dumaElectionProcedureText"><b>Утверждение порядка выборов</b><p>Сначала зарегистрированные депутаты должны проголосовать по порядку избрания руководства.</p></div><button class="primary">Открыть голосование</button></div>'+
 '<div class="dumaElectionCreator"><label>Должность<select><option>Председатель Государственной Думы</option></select></label><label>Форма голосования<select><option>Открытое</option></select></label><button class="primary" disabled>Создать процедуру</button></div>'+
 '<div class="dumaElectionList"><div class="dumaElectionEmpty"><svg width="23" height="23"></svg><div><strong>Выборы руководства ещё не начались</strong><p>После утверждения порядка выборов здесь появятся процедуры избрания руководства Государственной Думы.</p></div></div>'+
 '<article class="dumaElectionCard"><header><div><small>ПЕРВЫЙ ТУР · ОТКРЫТОЕ</small><h3>Председатель Государственной Думы</h3></div><span>Выдвижение</span></header><div class="dumaNomination"><select><option>Выберите кандидата</option></select><button>Выдвинуть</button><button class="primary">Открыть голосование</button></div>'+
 '<div class="dumaCandidates"><div class="dumaCandidate"><div class="dumaCandidateIdentity"><span>АИ</span><div><b>Александра Ивановна Константинова</b><small>Парламентская фракция</small></div></div><div class="dumaCandidateScore"><strong>226</strong><span>голосов</span></div></div></div></article></div></section></div></main></body></html>';
(async()=>{
 const executable=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>p&&fs.existsSync(p));
 if(!executable)throw Error('Browser unavailable: Chromium required');
 const browser=await chromium.launch({headless:true,executablePath:executable,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  for(const width of [320,390,768,1024,1440]){
   const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
   await page.setContent(html);
   const result=await page.evaluate(()=>{
    const card=document.querySelector('.dumaElection');
    const root=document.querySelector('.stageOperations');
    const selectors=['.dumaElection','.dumaElectionHead','.dumaThreshold','.dumaElectionProcedure','.dumaElectionCreator','.dumaElectionList','.dumaElectionEmpty','.dumaElectionCard','.dumaCandidates','.dumaCandidate'];
    return {width:innerWidth,bodyScroll:document.documentElement.scrollWidth,cardWidth:card.getBoundingClientRect().width,
     rootWidth:root.getBoundingClientRect().width,
     titleSize:parseFloat(getComputedStyle(document.querySelector('.dumaElectionHead h2')).fontSize),
     headerBg:getComputedStyle(document.querySelector('.dumaElectionHead')).backgroundColor,
     creatorCols:getComputedStyle(document.querySelector('.dumaElectionCreator')).gridTemplateColumns.split(' ').length,
     fail:selectors.filter(sel=>{const e=document.querySelector(sel),r=e.getBoundingClientRect();return !e||r.left < -1||r.right>innerWidth+1||e.scrollWidth>e.clientWidth+2;})};
   });
   assert(result.cardWidth>0&&result.cardWidth<=width+1,'Card fits at '+width);
   assert(result.bodyScroll<=width+1,'No horizontal page scrolling at '+width+': '+JSON.stringify(result));
   assert.deepEqual(result.fail,[],'All nested panels fit '+width+': '+JSON.stringify(result));
   assert(result.titleSize>=20&&result.titleSize<=26,'Heading scale consistent');
   assert.equal(result.headerBg,'rgb(237, 242, 255)','Canonical soft-blue brand header');
   if(width<=390)assert.equal(result.creatorCols,1,'Single-column mobile controls');
   await page.close();
  }
  console.log('PASS Duma leadership: unified brand layout, Russian text and responsive geometry 320–1440px');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
