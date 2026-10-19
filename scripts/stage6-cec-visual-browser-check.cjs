const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..');
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser','/opt/google/chrome/chrome'].find(x=>x&&fs.existsSync(x));
if(!chrome)throw Error('Chrome or Chromium required');
const css=fs.readFileSync(path.join(root,'app/stage6-election-workspace.css'),'utf8')+'\n'+fs.readFileSync(path.join(root,'app/stage6-cec-workspace-polish.css'),'utf8');
const h=[
'<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>',
':root{--navy:#102b54;--text:#173457;--muted:#657c9d;--body:#506589;--line:#dbe4f0}*{box-sizing:border-box}body{font-family:system-ui,Arial,sans-serif;font-size:14px;margin:0;padding:12px;background:#f4f7fc}button,input,select,textarea{font:inherit}button{cursor:pointer}',
css,'</style></head><body><main class="stageOperations" data-stage="6"><section id="stage6-cec" class="electionLab cecWorkspace">',
'<header class="electionLabHead cecHead"><div><small>ЦИК РФ · ЭТАП 6</small><h2>Выдвижение и регистрация кандидатов</h2><p>Кандидаты готовят программу, документы для ЦИК и подают регистрационные пакеты на шестом этапе.</p></div><div class="cecHeadSide">Центральная избирательная комиссия</div></header>',
'<nav class="cecTabs" aria-label="Разделы работы ЦИК"><button class="active" aria-pressed="true">Моё досье</button><button aria-pressed="false">Подача в ЦИК <b>0</b></button><button aria-pressed="false">Кандидаты <b>0</b></button><button aria-pressed="false">Решения ЦИК <b>0</b></button></nav>',
'<div class="cecSystemGate" role="status"><b>Избирательная система выбирается студентами.</b><span>Выдвижение и подача документов в ЦИК доступны независимо от итогов голосования.</span></div>',
'<details class="candidateNomination" open><summary><div><b>Выдвинуть кандидата</b><span>Партия может иметь одного активного кандидата.</span></div><i>+</i></summary><div class="candidateNominationBody">',
'<label>Партия<select><option>Самовыдвижение / сценарный кандидат</option></select></label>',
'<label>Участник<select><option>Не привязывать к участнику</option></select></label>',
'<label>Имя в бюллетене<input placeholder="Имя кандидата"></label>',
'<label class="candidateProgram">Программа кандидата<textarea rows="7" placeholder="1. Положение программы"></textarea></label>',
'<label class="candidateProgram">Публичный агитационный тезис<textarea rows="3" placeholder="Публичный тезис"></textarea></label>',
'<button class="primary">Создать черновик досье</button></div></details>',
'<div class="candidateGrid"><article class="candidateCard registered"><header><div class="candidateAvatar">ИИ</div><div><small>Самовыдвижение</small><h3>Иванов Иван Иванович</h3></div><div class="candidateHeaderActions"><span>Зарегистрирован</span></div></header><div class="candidateAudit"><span>Подач <b>1</b></span><span>Юр. ошибок <b>0</b></span></div>',
'<details class="candidateDossier" open><summary><div><b>Моё досье</b><span>Подготовьте документы</span></div><strong>2/10 · 3/7</strong></summary><div class="candidateDossierBody"><section class="candidateDocPack"><header><div><small>ДОКУМЕНТЫ</small><h4>Самовыдвижение</h4></div></header>',
'<div class="cecDocumentChecklist"><article class="cecDocumentItem missing"><label class="cecDocumentUploadTarget"><span class="cecDocumentState">1</span><span class="cecDocumentCopy"><b>Заявление о согласии баллотироваться</b><small>Файл ещё не загружен</small></span><strong>Загрузить</strong></label></article>',
'<article class="cecDocumentItem ok"><label class="cecDocumentUploadTarget"><span class="cecDocumentState">✓</span><span class="cecDocumentCopy"><b>Сведения о доходах</b><small>Предварительная проверка пройдена</small></span><strong>Заменить</strong></label></article></div></section></div></details></article></div>',
'<section class="cecDecisionRegistry"><header><div><small>ПУБЛИЧНЫЙ РЕЕСТР</small><h3>Решения ЦИК РФ</h3></div><span>1 решение</span></header><article class="cecDecision registered"><div><small>№ 001</small><h4>Иванов Иван Иванович</h4><p>Кандидат зарегистрирован.</p><button class="cecDocumentOpen">Открыть решение ЦИК</button></div><strong>Зарегистрирован</strong></article></section>',
'</section></main></body></html>'
].join('');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  for(const width of [320,360,390,430,490,600,700,768,900,1024,1440]){
   const page=await browser.newPage({viewport:{width,height:1000}});
   await page.setContent(h,{waitUntil:'load'});
   const s=await page.evaluate(()=>{
    const root=document.querySelector('#stage6-cec'),rect=e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,right:b.right,bottom:b.bottom}};
    return {screen:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,
     root:rect(root),tabs:[...root.querySelectorAll('.cecTabs button')].map(rect),
     fields:[...root.querySelectorAll('.candidateNominationBody>label')].slice(0,3).map(rect),
     uploads:[...root.querySelectorAll('.cecDocumentUploadTarget')].map(rect),
     action:rect(root.querySelector('.candidateNominationBody>.primary'))};
   });
   assert(s.scroll<=s.screen+2,'Horizontal overflow at '+width);
   for(const b of [...s.tabs,...s.fields,...s.uploads,s.action]){
    assert(b.x>=s.root.x-2&&b.right<=s.root.right+2,'Control overflow at '+width);
    assert(b.w>25,'Collapsed control at '+width);
   }
   if(width<=700)assert(s.tabs[2].y>s.tabs[0].y,'Tabs not stacked at '+width);
   if(width>=900)assert(Math.abs(s.tabs[3].y-s.tabs[0].y)<2,'Desktop tabs not in one row at '+width);
   if(width<=700)assert(s.fields[1].y>s.fields[0].y,'Fields do not stack at '+width);
   if(width>=1024)assert(Math.abs(s.fields[2].y-s.fields[0].y)<2,'Desktop inputs not aligned at '+width);
   await page.locator('.candidateNomination>summary').click();
   assert.equal(await page.locator('.candidateNomination').evaluate(x=>x.open),false,'Details did not close at '+width);
   await page.locator('.candidateNomination>summary').click();
   assert.equal(await page.locator('.candidateNomination').evaluate(x=>x.open),true,'Details did not reopen at '+width);
   await page.close();
  }
  console.log('PASS: 11 screen widths (320–1440), navigation tabs, nomination form, document uploads, CEC decisions and details toggle.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
