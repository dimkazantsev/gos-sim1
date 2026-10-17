const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright-core');
const styles=[
 'app/design-tokens.css','app/globals.css','app/2026-stage-system.css',
 'app/stage-operations.css','app/meeting-agenda-canonical.css'
].map(file=>fs.readFileSync(file,'utf8')).join('\n');
const pageSource=fs.readFileSync('components/game/InstitutionRegistrationPanel.tsx','utf8');
assert(pageSource.includes("data-agenda-state={agendaReady?'approved':agendaDraft?'draft':'pending'}"),'Agenda statuses match CSS');
assert(pageSource.includes("present_mandates"),'Registered deputies report factual attendance');
const template=(state)=>'<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+
 '*{box-sizing:border-box}body{margin:0;background:#f3f6fc;font:14px Arial,sans-serif;color:#132c50}main{padding:12px}'+styles+'</style></head><body><main>'+
 '<section class="civicRegistration"><div class="civicDisclosureBody"><section class="civicMeetingDocuments" data-agenda-state="'+state+'"><header><div><b>Повестка заседания Государственной Думы</b><small>Утверждена · регистрация разрешена</small></div><span>В реестре НПА</span></header><div class="civicMeetingSteps"><span><b>1. Подготовка</b>Руководители партий, затем руководство Думы</span><span><b>2. Утверждение</b>Председатель партии</span><span><b>3. Регистрация</b>Депутаты</span></div><p class="civicMeetingHelp">Повестка сохранена. Регистрация разрешена.</p><label>Содержание повестки<textarea>Вопросы заседания, выступления и результаты</textarea></label><div class="civicAgendaComposer"><small>Повестка готова</small><button>Сохранить и утвердить</button></div><div class="civicMeetingDelegate"><label>Ответственный<select><option>Без поручения</option></select></label><button>Сохранить</button></div><div class="civicMeetingMinutes"><header><b>Протокол</b><span>Не составлен</span></header><label>Содержание<textarea>Протокол заседания</textarea></label></div></section>'+
 '<section class="civicAttendance"><div><h3>Государственная Дума</h3><p>450 депутатов. Кворум 226.</p></div><div class="civicAttendanceNumbers"><span>Присутствует <b>226 / 450</b></span><span>Для кворума <b>226</b></span><span>Кворум есть</span></div><ul class="civicAttendees"><li>Иванов Иван Иванович<b>180 из 225 депутатов</b></li><li>Тестов Тест Тестович<b>46 из 225 депутатов</b></li></ul><div class="civicGdPresenceForm"><div><strong>Фактическая явка депутатов</strong><p>Можно представлять 225 депутатов, укажите реальное число.</p></div><label>Присутствуют депутаты<input type="number" value="180"></label><button class="primary">Обновить явку</button></div></section></div></section></main></body></html>';
(async()=>{
 const executable=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>p&&fs.existsSync(p));
 assert(executable,'Chromium unavailable');
 const browser=await chromium.launch({headless:true,executablePath:executable,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  for(const width of [320,390,768,1024,1440]){
   const page=await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'});
   await page.setContent(template(width===390?'approved':'draft'));
   const result=await page.evaluate(()=>{
    const selectors=['.civicMeetingDocuments','.civicMeetingDocuments>header','.civicMeetingSteps','.civicMeetingMinutes','.civicAgendaComposer','.civicMeetingDelegate','.civicAttendance','.civicAttendanceNumbers','.civicGdPresenceForm','.civicGdPresenceForm input'];
    const errors=selectors.flatMap(x=>{const el=document.querySelector(x),r=el.getBoundingClientRect();return r.left<-1||r.right>innerWidth+1||el.scrollWidth>el.clientWidth+2?[x+' '+Math.round(r.right)]:[]});
    return {docWidth:document.documentElement.scrollWidth,errors,header:getComputedStyle(document.querySelector('.civicMeetingDocuments>header')).backgroundColor,columns:getComputedStyle(document.querySelector('.civicMeetingSteps')).gridTemplateColumns.split(' ').length};
   });
   assert(result.docWidth<=width+1,'Horizontal scrolling at '+width+': '+JSON.stringify(result));
   assert.deepEqual(result.errors,[],'Overflow at '+width);
   assert.equal(result.header,'rgb(237, 242, 255)','Unified ГОС.ID header at '+width);
   if(width<=390)assert.equal(result.columns,1,'Steps stack on mobile');
   await page.close();
  }
  console.log('PASS canonical meeting agenda and factual GD attendance: responsive 320–1440 px');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
