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
'<details class="candidateNomination" open><summary><div><b>Выдвинуть кандидата</b><span>Партия может иметь одного активного кандидата.</span></div><span class="candidateNominationToggle" aria-hidden="true"></span></summary><div class="candidateNominationBody">',
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
'<section class="cecSubmissionPanel" aria-label="Пример подачи"><div class="cecAutoReview"><ol><li><span>✓</span><div><b>Сведения о расходах</b></div></li></ol></div><div class="cecSubmissionActions" id="cecStudentActions"><button class="primary cecSubmitPackage">Подать пакет в ЦИК</button></div><section class="cecSubmittedDocuments"><header><div><b>Документы для проверки ЦИК</b></div></header><div class="cecSubmittedDocumentList"><article class="cecSubmittedDocument"><div class="cecSubmittedDocumentTop"><div><b>Заявление о согласии баллотироваться</b><small>Очень длинное название загруженного документа.pdf</small></div><div class="cecSubmittedDocumentLinks"><a href="#">Посмотреть</a><button>Скачать</button></div></div><label class="cecDocumentReviewerNote">Замечания<textarea rows="2"></textarea></label><div class="cecDocumentReviewerActions"><button>Принять документ</button><button class="returnForRevision">Вернуть на доработку</button></div></article></div></section><div class="cecSubmissionActions" id="cecTeacherActions"><button class="secondary">Сформировать проект решения по проверке</button></div></section>',
'</section></main></body></html>'
].join('');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  for(const width of [320,360,390,430,490,600,700,768,900,1024,1440]){
   const page=await browser.newPage({viewport:{width,height:1000}});
   await page.emulateMedia({reducedMotion:'reduce'});
   await page.setContent(h,{waitUntil:'load'});
   const s=await page.evaluate(()=>{
    const root=document.querySelector('#stage6-cec'),rect=e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height,right:b.right,bottom:b.bottom}};
    return {screen:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,
     root:rect(root),
     safePadding:{left:parseFloat(getComputedStyle(root).paddingLeft),right:parseFloat(getComputedStyle(root).paddingRight)},
     panels:[...root.children].filter(e=>e.matches('header,nav,section,details,div')).map(rect),
     textarea:[...root.querySelectorAll('.candidateNominationBody textarea')].map(rect),
     tabs:[...root.querySelectorAll('.cecTabs button')].map(rect),
     fields:[...root.querySelectorAll('.candidateNominationBody>label')].slice(0,3).map(rect),
     uploads:[...root.querySelectorAll('.cecDocumentUploadTarget')].map(rect),
     action:rect(root.querySelector('.candidateNominationBody>.primary')),
     reviewElements:[...root.querySelectorAll('.cecSubmittedDocuments,.cecSubmittedDocument,.cecSubmittedDocumentLinks,.cecDocumentReviewerActions,.cecDocumentReviewerNote')].map(rect),
     reviewControls:[...root.querySelectorAll('.cecSubmittedDocumentLinks :is(a,button),.cecDocumentReviewerActions button,.cecDocumentReviewerNote textarea,.cecSubmissionActions button')].map(rect),
     studentAction:rect(root.querySelector('#cecStudentActions button')),
     teacherAction:rect(root.querySelector('#cecTeacherActions button')),
     audit:rect(root.querySelector('.cecSubmissionPanel .cecAutoReview')),
     submittedDocs:rect(root.querySelector('.cecSubmittedDocuments')),
     toggle:rect(root.querySelector('.candidateNominationToggle')),
     summary:rect(root.querySelector('.candidateNomination>summary')),
     symbolStyle:(()=>{
       const e=root.querySelector('.candidateNominationToggle');
       const before=getComputedStyle(e,'::before'),after=getComputedStyle(e,'::after');
       return {beforeLeft:before.left,beforeTop:before.top,afterLeft:after.left,afterTop:after.top,
         beforeWidth:before.width,afterWidth:after.width,beforeTransform:before.transform,afterTransform:after.transform};
     })()};
   });
   assert(s.scroll<=s.screen+2,'Horizontal overflow at '+width);
   assert(s.safePadding.left>=10&&s.safePadding.right>=10,'Safe side padding removed at '+width+': '+JSON.stringify(s.safePadding));
   for(const panel of s.panels){
    assert(panel.x>=s.root.x+s.safePadding.left-2,'Panel touches left border at '+width);
    assert(panel.right<=s.root.right-s.safePadding.right+2,'Panel touches right border at '+width);
   }
   for(const area of s.textarea){
    assert(area.x>=s.root.x+s.safePadding.left+7&&area.right<=s.root.right-s.safePadding.right-7,'Textarea touches outer border at '+width);
   }
   assert(s.studentAction.y>=s.audit.bottom+11,'Submit button overlaps audit at '+width);
   assert(s.teacherAction.y>=s.submittedDocs.bottom+11,'Teacher button overlaps documents at '+width);
   for(const b of [...s.reviewElements,...s.reviewControls]){
    assert(b.x>=s.root.x-2&&b.right<=s.root.right+2,'CEC document review overflows at '+width);
    assert(b.w>35,'CEC review action collapsed at '+width);
   }
   for(const b of [...s.tabs,...s.fields,...s.uploads,s.action]){
    assert(b.x>=s.root.x-2&&b.right<=s.root.right+2,'Control overflow at '+width);
    assert(b.w>25,'Collapsed control at '+width);
   }
   assert(Math.abs(s.toggle.y+s.toggle.h/2-(s.summary.y+s.summary.h/2))<=1,'Toggle vertically off-center at '+width);
   assert(s.toggle.x>=s.summary.x&&s.toggle.right<=s.summary.right,'Toggle escapes summary at '+width);
   const centerValue=(v,size)=>v==='50%'||Math.abs(parseFloat(v)-size/2)<=2;
   assert(centerValue(s.symbolStyle.beforeLeft,s.toggle.w)&&centerValue(s.symbolStyle.beforeTop,s.toggle.h),'Cross first stroke not centered at '+width);
   assert(centerValue(s.symbolStyle.afterLeft,s.toggle.w)&&centerValue(s.symbolStyle.afterTop,s.toggle.h),'Cross second stroke not centered at '+width);
   assert(s.symbolStyle.beforeWidth==='16px'&&s.symbolStyle.afterWidth==='16px','Cross strokes mismatch at '+width);
   const labels=s.fields;
   if(width>=1024)assert(labels.every(b=>Math.abs(b.w-labels[0].w)<2),'Unequal input column widths at '+width);
   if(width<=700)assert(s.tabs[2].y>s.tabs[0].y,'Tabs not stacked at '+width);
   if(width>=900)assert(Math.abs(s.tabs[3].y-s.tabs[0].y)<2,'Desktop tabs not in one row at '+width);
   if(width<=700)assert(s.fields[1].y>s.fields[0].y,'Fields do not stack at '+width);
   if(width>=1024)assert(Math.abs(s.fields[2].y-s.fields[0].y)<2,'Desktop inputs not aligned at '+width);
   await page.locator('.candidateNomination>summary').click();
   assert.equal(await page.locator('.candidateNomination').evaluate(x=>x.open),false,'Details did not close at '+width);
   const closedStrokes=await page.locator('.candidateNominationToggle').evaluate(e=>({before:getComputedStyle(e,'::before').transform,after:getComputedStyle(e,'::after').transform}));
   assert.notEqual(closedStrokes.before,closedStrokes.after,'Collapsed state must show a plus at '+width);
   assert.notEqual(s.symbolStyle.beforeTransform,closedStrokes.before,'Symbol failed to change between cross and plus at '+width);
   await page.locator('.candidateNomination>summary').click();
   assert.equal(await page.locator('.candidateNomination').evaluate(x=>x.open),true,'Details did not reopen at '+width);
   await page.close();
  }
  console.log('PASS: 11 widths (320–1440), 10px+ safe gutters around all cards, separated textarea, centered cross/plus, inputs, tabs and uploads.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
