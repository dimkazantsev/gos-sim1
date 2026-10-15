/* Real browser grid checks: column baselines and modal fit at multiple widths. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright-core');
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>p&&fs.existsSync(p));
if(!chrome)throw Error('Chrome or Chromium is required');
const gradesViewSource=fs.readFileSync('components/game/GradesView.tsx','utf8');
assert(gradesViewSource.includes('onScroll={event=>{const scrollLeft=event.currentTarget.scrollLeft;'),'Grade matrix must watch real horizontal scrolling');
assert(gradesViewSource.includes('gradesMatrixScrolled'),'Grade matrix must toggle compact mode on scroll');
assert(gradesViewSource.includes('aria-label={s.full_name} title={s.full_name}'),'Full name must remain accessible in compact mode');

const css=['app/design-views.css','app/design-responsive.css','app/2026-civic-portal.css','app/2026-stage-party-grades-repair.css','app/party-registration-versions.css']
 .map(name=>fs.readFileSync(name,'utf8')).join('\n');
const cells=n=>Array.from({length:n},(_,i)=>'<span class="align-check">'+(i+1)+'</span>').join('');
const partySource=fs.readFileSync('components/game/PartiesView.tsx','utf8');
for(const name of ['partyRegistrationDocTop','partyRegistrationDocActions','partyRegistrationHiddenInput','partyRegistrationRevisionNote','partyRegistrationFooter'])
 assert(partySource.includes(name),'Single per-document registration interface preserves '+name);
assert(!partySource.includes('civicPartyUploadMain')&&!partySource.includes('partyRegistrationUpdates'),'Duplicated student upload and timeline must be gone');
assert(partySource.includes('uploadInputs.current[kind.kind]?.click()'),'Every document must have its own upload button');
assert(partySource.includes('onClick={()=>void g.submitPartyRegistration(selected.id)}'),'Registration workflow remains unchanged');

const scores=Array.from({length:16},(_,i)=>'<button class="draft" type="button"><b>'+i+'</b><small>авто</small></button>').join('');
const markup=`<!doctype html><html><meta name="viewport" content="width=device-width, initial-scale=1"><style>
*{box-sizing:border-box}body{margin:0;background:#eef3fb;font:14px Arial,sans-serif}.gradesPage{width:100%;padding:12px}.gradesMatrixWrap{width:100%;max-width:100%;padding:10px;background:#fff}.gradeModal{width:min(900px,100%);margin:20px auto;padding:10px;background:white}
${css}</style><body><div class="gradesPage"><section class="surface gradesMatrixWrap"><div class="gradesMatrix">
<div class="gradesMatrixHead"><b>СТУДЕНТ</b><span>Σ</span><span>СР.</span>${cells(16)}</div>
<div class="gradesMatrixRow"><div class="gradesStudentCell"><b class="gradesStudentName" title="Тестов Тест Тестович"><span class="gradesNameFull">Тестов Тест Тестович</span><span class="gradesNameShort" aria-hidden="true">Тестов</span></b><small>МИР · участник</small></div><span class="gradeTotal">12</span><span class="gradeTotal">1.50</span>${scores}</div>
</div></section></div>
<div class="gradeModal"><section class="blitzVsnScore"><header><b>Знания и правоприменение</b><strong>0.50 / 1</strong></header><div class="blitzVsnBreakdown">${['Кейсы','Действия','Блиц','Полнота'].map(n=>'<span><small>'+n+'</small><b>0.25</b></span>').join('')}</div>
<p>Решения кейсов: 2 из 3</p></section><section class="gradeRationale"><small>ИНТЕРПРЕТАЦИЯ ДЕЙСТВИЙ</small><p>${'Содержательный текст оценки. '.repeat(25)}</p></section></div>
<section class="gosPartyElection" style="margin:16px;max-width:900px"><header class="gosPartyElectionHead"><span class="gosPartyElectionIcon">⌁</span><div><small>ПАРТИЙНОЕ САМОУПРАВЛЕНИЕ</small><h3>Выборы председателя</h3></div><span class="gosPartyElectionStatus">Набор участников</span></header><div class="gosPartyElectionSteps"><div class="gosPartyElectionStep"><span>Члены партии</span><b>2</b></div><div class="gosPartyElectionStep"><span>Приглашены</span><b>0</b></div><div class="gosPartyElectionStep"><span>Голоса</span><b>0/2</b></div></div></section></body></html>`;
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  for(const width of [320,390,768,1024,1440]){
   const page=await browser.newPage({viewport:{width,height:900}});
   await page.setContent(markup);
   await page.evaluate(()=>{
    const wrapper=document.createElement('details');
    wrapper.className='civicPartyPackage hasRevision';wrapper.open=true;
    wrapper.style.cssText='margin:16px;width:min(1100px,calc(100% - 32px));max-width:100%';
    wrapper.innerHTML='<summary>Документы и регистрация партии</summary>'+
     '<div class="civicPartyFiles">'+
      '<article class="partyRegistrationDoc isRevision"><div class="partyRegistrationDocTop">'+
       '<div class="partyRegistrationDocIdentity"><b>Госпошлина</b><span class="partyRegistrationDocStatus">В1 · На доработке</span></div>'+
       '<div class="partyRegistrationDocActions"><a href="#">Открыть</a><button class="secondary">Загрузить В2</button></div></div>'+
       '<p class="partyRegistrationRevisionNote">Документ возвращён на доработку. Исправьте недостатки</p>'+
       '<details class="partyRegistrationDocHistory"><summary>История версий (2)</summary><p>В1 · На доработке</p></details></article>'+
      '<article class="partyRegistrationDoc"><div class="partyRegistrationDocTop">'+
       '<div class="partyRegistrationDocIdentity"><b>Устав</b><span class="partyRegistrationDocStatus">В2 · Принято</span></div>'+
       '<div class="partyRegistrationDocActions"><a href="#">Открыть</a><button class="secondary">Загрузить В3</button></div></div></article>'+
      '<div class="partyRegistrationFooter"><button class="primary">Направить пакет на регистрацию</button>'+
       '<details class="partyRegistrationLegal"><summary>Нормативные требования</summary>'+
        '<a href="#">Федеральный закон № 95-ФЗ</a><a href="#">Формы Минюста</a></details></div></div>';
    document.body.appendChild(wrapper);
   });
   const partyDoc=await page.evaluate(()=>{
    const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return{top:r.top,left:r.left,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
    const root=rect('.civicPartyPackage'),cards=[...document.querySelectorAll('.partyRegistrationDoc')].map(el=>{const r=el.getBoundingClientRect();return{left:r.left,right:r.right,width:r.width}});
    const actions=[...document.querySelectorAll('.partyRegistrationDocActions')].map(el=>{const r=el.getBoundingClientRect();return{left:r.left,right:r.right,width:r.width}});
    const buttons=[...document.querySelectorAll('.partyRegistrationDocActions button')].map(el=>{const r=el.getBoundingClientRect();return{left:r.left,right:r.right,height:r.height}});
    const status=rect('.partyRegistrationDocStatus'),remark=rect('.partyRegistrationRevisionNote'),footer=rect('.partyRegistrationFooter');
    return {root,cards,actions,buttons,status,remark,footer,bodyWidth:document.body.scrollWidth};
   });
   assert(partyDoc.cards.length===2&&partyDoc.cards.every(x=>x.width>190),'Each document row remains readable at '+width);
   assert(partyDoc.cards.every(x=>x.left>=partyDoc.root.left-1&&x.right<=partyDoc.root.right+1),'Document rows stay inside dossier at '+width);
   assert(partyDoc.actions.every((x,i)=>x.left>=partyDoc.cards[i].left-1&&x.right<=partyDoc.cards[i].right+1),'Document actions stay inside rows at '+width);
   assert(partyDoc.buttons.every(x=>x.height>=35),'Document upload controls remain tappable at '+width);
   assert(partyDoc.remark.left>=partyDoc.cards[0].left-1&&partyDoc.remark.right<=partyDoc.cards[0].right+1,'Red rejection notice stays inside its row at '+width);
   assert(partyDoc.footer.left>=partyDoc.root.left-1&&partyDoc.footer.right<=partyDoc.root.right+1,'Registration action stays inside dossier at '+width);
   assert(partyDoc.bodyWidth<=width+2,'Document list creates no horizontal overflow at '+width);
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
   const sticky=await page.evaluate(()=>{
    const table=document.querySelector('.gradesMatrix');
    const name=document.querySelector('.gradesStudentCell');
    const full=document.querySelector('.gradesNameFull'),short=document.querySelector('.gradesNameShort');
    const firstCell=document.querySelector('.gradesMatrixRow>.gradeTotal');
    const headName=document.querySelector('.gradesMatrixHead>b:first-child');
    const natural={width:Math.round(name.getBoundingClientRect().width),fullVisible:getComputedStyle(full).display!=='none'};
    table.scrollLeft=330;
    table.classList.add('gradesMatrixScrolled');
    const compact={
      width:Math.round(name.getBoundingClientRect().width),
      headWidth:Math.round(headName.getBoundingClientRect().width),
      shortVisible:getComputedStyle(short).display!=='none',
      fullHidden:getComputedStyle(full).display==='none',
      noteHidden:getComputedStyle(name.querySelector('small')).display==='none',
      visibleLabel:short.textContent,
      nameRight:name.getBoundingClientRect().right,
      firstCellRight:firstCell.getBoundingClientRect().right,
      viewportRight:table.getBoundingClientRect().right,
      scrollLeft:table.scrollLeft
    };
    table.scrollLeft=0;
    table.classList.remove('gradesMatrixScrolled');
    return {natural,compact,restored:Math.round(name.getBoundingClientRect().width)};
   });
   if(width<=1100){
    assert.equal(sticky.natural.width,204,'Full pinned student column initially at '+width);
    assert.equal(sticky.compact.width,124,'Surname column must shrink after horizontal scroll at '+width);
    assert.equal(sticky.compact.headWidth,124,'Header and row sticky tracks align at '+width);
    assert(sticky.compact.shortVisible&&sticky.compact.fullHidden&&sticky.compact.noteHidden,'Surname-only mode hides details at '+width);
    assert.equal(sticky.compact.visibleLabel,'Тестов','Surname is displayed after scrolling');
    assert(sticky.compact.nameRight<sticky.compact.viewportRight,'Sticky name must leave room for scores at '+width);
    assert.equal(sticky.restored,204,'Full column returns when scrolled back at '+width);
   }else{
    assert.equal(sticky.compact.width,sticky.natural.width,'Desktop layout must not change while scrolling');
    assert(!sticky.compact.shortVisible,'Desktop must retain full name');
   }
   await page.close();
   console.log('PASS '+width+'px: 19 aligned tracks and mobile surname-only pinned column');
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
