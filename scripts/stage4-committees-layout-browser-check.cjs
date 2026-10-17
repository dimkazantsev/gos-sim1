/* Isolated stage-four composition regression. No database writes.
 * Keep mode="ministries" CSS and role/ballot procedures untouched. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright-core');
const root=require('node:path').resolve(__dirname,'..');
const read=name=>fs.readFileSync(require('node:path').join(root,name),'utf8');
const component=read('components/game/InstitutionStaffingLab.tsx');
const ballot=read('components/game/CommitteeChairElectionPanel.tsx');
const leadership=read('components/game/DumaLeadershipElection.tsx');
const styles=read('app/design-tokens.css')+'\n'+read('app/globals.css')+'\n'+read('app/stage-operations.css');
const scoped=read('app/stage-operations.css').split('/* Stage 4 — committees share')[1];
assert(scoped,'Scoped stage 4 styles must exist');
for(const rule of scoped.matchAll(/\.staffingLab\[data-staffing="([^"]+)"\]/g))
 assert.equal(rule[1],'committees','No style for stage 9 ministries');
for(const roleRpc of ["ensure_duma_committees","get_committee_matrix","assign_institution_member","remove_institution_member"])
 assert(component.includes("'"+roleRpc+"'"),'Committee RPC connection retained: '+roleRpc);
for(const electionRpc of ["create_committee_chair_election","nominate_office_candidate","open_office_election","cast_personal_office_ballot","close_office_election"])
 assert(ballot.includes("'"+electionRpc+"'"),'Election RPC retained: '+electionRpc);
assert(ballot.includes("election.vote_mode==='open'")&&ballot.includes("!['nomination','open'].includes(election.status)"),'Secrecy rule remains');
assert(ballot.includes('!registered.some(r=>r.user_id===me.user_id)')&&ballot.includes('myPresent<=0'),'Attendance registration and declared deputy count both guard voting');
assert(component.includes("mode==='committees'?"),'Committee/ministry branch retained');
assert(component.includes('Избирается депутатами Государственной Думы в блоке выше'),'Voting placement hint correct');
assert(!ballot.includes('с учётом GV'),'Russian wording for ghost voting');
assert(leadership.includes('226 <small>из 450</small>')&&ballot.includes('226 <small>из 450</small>'),'Aligned majority display');
const cards=Array.from({length:5},(_,i)=>'<article class="institutionUnit committeeUnit"><header><div><small>КОМИТЕТ</small><h4>Комитет по государственному управлению, законодательству и конституционным вопросам №'+(i+1)+'</h4><p>Полномочия комитета</p></div><span>12 депутатов</span></header>'+
 '<div class="committeeQuota"><div><i></i><b>Длинное официальное название парламентской партии</b><strong>42</strong><span>2 депутата</span></div></div>'+
 '<div class="unitHead"><small>ПРЕДСЕДАТЕЛЬ</small><b>Александра Михайловна Константинова</b><span>Избирается депутатами Государственной Думы в блоке выше</span></div>'+
 '<div class="unitMembers"><div><span>Александра Михайловна Константинова</span><small>Фракция</small><b>≈ 11,2 мандата</b><button aria-label="Исключить">×</button></div></div>'+
 '<div class="unitAssign"><select><option>Добавить депутата…</option></select><button>Добавить</button></div></article>').join('');
const votes=Array.from({length:2},(_,i)=>'<article class="committeeElectionCard"><header><div><small>КОМИТЕТ</small><b>Комитет по государственному управлению №'+(i+1)+'</b><span>Председатель: не избран</span></div><div class="committeeElectionCreate"><select><option>Открыто</option></select><button>Начать выборы</button></div></header><div class="committeeElectionState"><span>ПЕРВЫЙ ТУР</span><b>Выдвижение</b><em>Открытое</em></div><div class="committeeNominate"><select><option>Кандидат от фракции…</option></select><button>Выдвинуть</button><button class="primary">Открыть голосование</button></div>'+
 '<div class="committeeCandidateList"><div><span>АК</span><div><b>Александра Константинова</b><small>Фракция</small></div><strong>226</strong><div class="committeeBallot"><input placeholder="Голоса"><button>Записать</button></div></div></div></article>').join('');
const html='<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width, initial-scale=1"><style>'+
 '*{box-sizing:border-box}body{margin:0;font:14px Arial,sans-serif;background:#f4f7fb;color:#142644}main{min-width:0}'+styles+'</style>'+
 '<main class="stageOperations"><div class="stageOperationsModules"><section class="staffingLab" data-staffing="committees"><header class="staffingLabHead"><div class="staffingLabIntro"><div class="staffingLabEyebrow"><svg width="17" height="17"></svg><span>Государственная Дума</span><span class="staffingLabStage">Этап 4</span></div><h2>Формирование комитетов Государственной Думы</h2><p>Палата образует пять комитетов и избирает их председателей. После выборов депутаты распределяются по комитетам с учётом фракционных квот.</p></div><div class="staffingBalance"><span>Составы комитетов</span><strong>12</strong><em>депутатов распределено</em></div></header>'+
 '<div class="stageOperationsActionBar"><p>Создайте комитеты</p><button class="primary">Создать комитеты</button></div>'+
 '<section class="committeeElectionBoard"><div class="committeeElectionHead"><div class="committeeElectionIntro"><small>Государственная Дума · Этап 4</small><h3>Выборы председателей комитетов</h3><p>Фракции выдвигают кандидатов. Для избрания необходимо большинство голосов.</p></div><div class="committeeElectionThreshold"><span>Необходимое большинство</span><strong>226 <small>из 450</small></strong><em>голосов для избрания</em></div></div><div class="committeeElectionGrid">'+votes+'</div></section>'+
 '<section class="staffingSection"><div class="staffingSectionHead"><div><small>ГОСУДАРСТВЕННАЯ ДУМА</small><h3>5 комитетов · пропорциональное представительство фракций</h3><p>Один депутат состоит только в одном комитете. Составы отражают квоты партий.</p></div><span>1 депутат — 1 комитет</span></div><div class="committeeGrid">'+cards+'</div></section><footer class="staffingRule"><b>Порядок формирования</b><p>Квоты по мандатам.</p></footer></section>'+
 '<section class="staffingLab" data-staffing="ministries"><header class="staffingLabHead"><div><h2>Команды министерств</h2><p>Назначение сотрудников министерств</p></div><div class="staffingBalance"><strong>6</strong><span>в министерствах</span></div></header></section></div></main>';
(async()=>{
 const executable=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>p&&fs.existsSync(p));
 if(!executable)throw Error('Chrome is required');
 const browser=await chromium.launch({headless:true,executablePath:executable,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  for(const width of [320,390,768,1024,1440]){
   const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
   await page.setContent(html);
   const check=await page.evaluate(()=>{
    const selectors=['.staffingLab[data-staffing="committees"]','.staffingLabHead','.staffingBalance','.committeeElectionBoard','.committeeElectionHead','.committeeElectionThreshold','.committeeElectionGrid','.committeeElectionCard','.committeeNominate','.committeeCandidateList','.staffingSection','.committeeGrid','.committeeUnit','.committeeQuota','.unitMembers','.unitAssign'];
    const visible=e=>!!e&&getComputedStyle(e).display!=='none';
    const overflow=selectors.flatMap(sel=>{const e=document.querySelector(sel);if(!visible(e))return [{selector:sel,error:'missing/hidden'}];const r=e.getBoundingClientRect();return r.left<-1||r.right>innerWidth+2||e.scrollWidth>e.clientWidth+2?[{selector:sel,left:r.left,right:r.right,scroll:e.scrollWidth,client:e.clientWidth}]:[]});
    const ministry=document.querySelector('.staffingLab[data-staffing="ministries"] .staffingLabHead');
    return {width:innerWidth,docWidth:document.documentElement.scrollWidth,overflow,
      header:getComputedStyle(document.querySelector('.staffingLab[data-staffing="committees"] .staffingLabHead')).backgroundColor,
      ministryBackground:getComputedStyle(ministry).backgroundColor,
      numberCards:document.querySelectorAll('.committeeUnit').length,
      committeeColumns:getComputedStyle(document.querySelector('.committeeGrid')).gridTemplateColumns.split(' ').length};
   });
   assert(check.docWidth<=width+1,'Horizontal scroll '+width+': '+JSON.stringify(check));
   assert.deepEqual(check.overflow,[],'Component overflow at '+width+': '+JSON.stringify(check));
   assert.equal(check.header,'rgb(237, 242, 255)','Use same light brand header as Duma leadership');
   assert.equal(check.ministryBackground,'rgb(237, 242, 255)','Ministry header keeps the existing shared-stage styling');
   assert.equal(check.numberCards,5,'Committee list retains all five cards');
   if(width<=768)assert.equal(check.committeeColumns,1,'Compact container uses one column');
   // Before the committees are created, the action card sits directly above
   // the rules card. Guard against their borders touching again.
   const emptyState=await page.evaluate(()=>{
    document.querySelector('.staffingLab[data-staffing="committees"] .committeeElectionBoard').remove();
    document.querySelector('.staffingLab[data-staffing="committees"] .staffingSection').remove();
    const root=document.querySelector('.staffingLab[data-staffing="committees"]');
    const action=root.querySelector('.stageOperationsActionBar');
    const rules=root.querySelector('.staffingRule');
    const a=action.getBoundingClientRect(),b=rules.getBoundingClientRect();
    return {gap:b.top-a.bottom, marginTop:getComputedStyle(rules).marginTop,
     actionRight:a.right,rulesRight:b.right,documentWidth:document.documentElement.scrollWidth};
   });
   assert(emptyState.gap>=11.9,'Creation and rules panels need visible separation at '+width+': '+JSON.stringify(emptyState));
   assert(emptyState.actionRight<=width+1&&emptyState.rulesRight<=width+1&&emptyState.documentWidth<=width+1,'No mobile overflow in empty state at '+width);
   await page.close();
  }
  console.log('PASS committee composition: 320, 390, 768, 1024, 1440px; elections, quotas, staffing and ministry styles separated.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
