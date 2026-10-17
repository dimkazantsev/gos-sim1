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
assert(ballot.includes("election.vote_mode==='secret'?'Тайное':'Открытое'"),'Both committee vote modes have initial capitals');
assert(ballot.includes('<option value="open">Открытое</option><option value="secret">Тайное</option>'),'Election creation options are correctly capitalized');
assert(ballot.includes("const canManage=teacher||(canCreate&&me.kind==='student'"),'GD leadership can see election controls when eligible');
assert(ballot.includes('registered.some(r=>r.user_id===me.user_id)')&&ballot.includes('gdMandateCapacity(me.user_id)>0'),'Chair authority still requires meeting registration and mandates');
assert(ballot.includes('teacher||ledParty||canManage')&&ballot.includes('cs.length===0')&&ballot.includes('canManage&&<button className="primary"'),'Authorized chair can open a nominated election');
assert(ballot.includes("election.status==='open'&&canManage"),'Authorized GD chair can also close open election');
assert(ballot.includes("election.status==='nomination'&&!canManage"),'Ordinary students see why voting has not started');
assert(ballot.includes("election.status==='open'&&election.ballot_mode==='personal'&&me.kind==='student'"),'Registered student ballot appears after opening');

assert(ballot.includes('!registered.some(r=>r.user_id===me.user_id)')&&ballot.includes('myPresent<=0'),'Attendance registration and declared deputy count both guard voting');
assert(component.includes("mode==='committees'?"),'Committee/ministry branch retained');
assert(component.includes('Избирается депутатами Государственной Думы в блоке выше'),'Voting placement hint correct');
assert(component.includes('<em>депутатов распределено</em>'),'Counter caption has no preceding decorative icon');
assert(!component.includes('UsersRound'),'Unused caption icon import removed');
assert(!ballot.includes('с учётом GV'),'Russian wording for ghost voting');
assert(leadership.includes('226 <small>из 450</small>')&&ballot.includes('226 <small>из 450</small>'),'Aligned majority display');
const cards=Array.from({length:5},(_,i)=>'<article class="institutionUnit committeeUnit"><header><div><small>КОМИТЕТ</small><h4>Комитет по государственному управлению, законодательству и конституционным вопросам №'+(i+1)+'</h4><p>Полномочия комитета</p></div><span>12 депутатов</span></header>'+
 '<div class="committeeQuota"><div><i></i><b>Длинное официальное название парламентской партии</b><strong>42</strong><span>2 депутата</span></div></div>'+
 '<div class="unitHead"><small>ПРЕДСЕДАТЕЛЬ</small><b>Александра Михайловна Константинова</b><span>Избирается депутатами Государственной Думы в блоке выше</span></div>'+
 '<div class="unitMembers"><div><span>Александра Михайловна Константинова</span><small>Фракция</small><b>≈ 11,2 мандата</b><button aria-label="Исключить">×</button></div></div>'+
 '<div class="unitAssign"><select><option>Добавить депутата…</option></select><button>Добавить</button></div></article>').join('');
const activeVotes=Array.from({length:2},(_,i)=>'<article class="committeeElectionCard nomination"><header><div><small>КОМИТЕТ</small><b>Комитет по государственному управлению №'+(i+1)+'</b><span>Председатель: не избран</span></div><div class="committeeElectionCreate"><select><option>Открыто</option></select><button>Начать выборы</button></div></header><div class="committeeElectionState"><span>ПЕРВЫЙ ТУР</span><b>Выдвижение</b><em>Открытое</em></div><div class="committeeNominate"><select><option>Кандидат от фракции…</option></select><button>Выдвинуть</button><button class="primary">Открыть голосование</button></div>'+
 '<div class="committeeCandidateList"><div><span>АК</span><div><b>Александра Константинова</b><small>Фракция</small></div><strong>226</strong><div class="committeeBallot"><input placeholder="Голоса"><button>Записать</button></div></div></div></article>').join('');
const idleTitles=[
 'Комитет по обороне и безопасности',
 'Комитет по экономической политике',
 'Комитет по внешней политике',
 'Комитет по внутренней политике и государственному устройству',
 'Комитет по социальной политике'
];
const idleVotes=idleTitles.map(title=>'<article class="committeeElectionCard idle"><header><div><small>КОМИТЕТ</small><b>'+title+'</b><span>Председатель: —</span></div><div class="committeeElectionCreate"><select aria-label="Форма выборов председателя: '+title+'"><option>Открыто</option></select><button>Начать выборы</button></div></header></article>').join('');
const votes=idleVotes+activeVotes;
const html='<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width, initial-scale=1"><style>'+
 '*{box-sizing:border-box}body{margin:0;font:14px Arial,sans-serif;background:#f4f7fb;color:#142644}main{min-width:0}'+styles+'</style>'+
 '<main class="stageOperations"><div class="stageOperationsModules"><section class="staffingLab" data-staffing="committees"><header class="staffingLabHead"><div class="staffingLabIntro"><div class="staffingLabEyebrow"><svg width="17" height="17"></svg><span>Государственная Дума</span><span class="staffingLabStage">Этап 4</span></div><h2>Формирование комитетов Государственной Думы</h2><p>Палата образует пять комитетов и избирает их председателей. После выборов депутаты распределяются по комитетам с учётом фракционных квот.</p></div><div class="staffingBalance"><span>Составы комитетов</span><strong>0</strong><em>депутатов распределено</em></div></header>'+
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
    const idleCards=[...document.querySelectorAll('.staffingLab[data-staffing="committees"] .committeeElectionCard.idle')];
    const cardLayout=idleCards.map(card=>{
     const info=card.querySelector('header>div:first-child');
     const form=card.querySelector('.committeeElectionCreate');
     const select=form.querySelector('select');
     const button=form.querySelector('button');
     const r=card.getBoundingClientRect(),t=info.getBoundingClientRect(),f=form.getBoundingClientRect(),sel=select.getBoundingClientRect(),b=button.getBoundingClientRect();
     return {cardLeft:r.left,cardRight:r.right,infoLeft:t.left,infoBottom:t.bottom,
      controlsLeft:f.left,controlsTop:f.top,selectBottom:sel.bottom,buttonTop:b.top,buttonRight:b.right,
      headerDisplay:getComputedStyle(card.querySelector('header')).display,
      selectFlex:getComputedStyle(select).flexGrow,
      headerBackground:getComputedStyle(card.querySelector('header')).backgroundColor,
      cardBackground:getComputedStyle(card).backgroundColor,
      borderBottom:getComputedStyle(card.querySelector('header')).borderBottomWidth};
    });
    const ministry=document.querySelector('.staffingLab[data-staffing="ministries"] .staffingLabHead');
    const badge=document.querySelector('.staffingLab[data-staffing="committees"] .staffingBalance');
    const rect=badge.getBoundingClientRect(), center=(rect.left+rect.right)/2;
    const children=[...badge.children];
    const distances=children.map(e=>{const r=e.getBoundingClientRect();return Math.abs((r.left+r.right)/2-center)});
    const counterIsGrid=getComputedStyle(badge).display==='grid';
    return {width:innerWidth,docWidth:document.documentElement.scrollWidth,overflow,
      header:getComputedStyle(document.querySelector('.staffingLab[data-staffing="committees"] .staffingLabHead')).backgroundColor,
      ministryBackground:getComputedStyle(ministry).backgroundColor,
      committeeCounterGridColumns:getComputedStyle(badge).gridTemplateColumns.split(' ').length,
      committeeCounterIsGrid:counterIsGrid,
      committeeCounterDistances:distances,
      committeeCounterText:badge.querySelector('strong').textContent,
      committeeCaptionCentered:getComputedStyle(badge.querySelector('em')).textAlign==='center',
      committeeCaptionHasIcon:!!badge.querySelector('em svg'),
      cardLayout,
      ministryCounterGridColumns:getComputedStyle(document.querySelector('.staffingLab[data-staffing="ministries"] .staffingBalance')).gridTemplateColumns.split(' ').length,
      numberCards:document.querySelectorAll('.committeeUnit').length,
      committeeColumns:getComputedStyle(document.querySelector('.committeeGrid')).gridTemplateColumns.split(' ').length};
   });
   assert(check.docWidth<=width+1,'Horizontal scroll '+width+': '+JSON.stringify(check));
   assert.deepEqual(check.overflow,[],'Component overflow at '+width+': '+JSON.stringify(check));
   assert.equal(check.header,'rgb(237, 242, 255)','Use same light brand header as Duma leadership');
   assert.equal(check.ministryBackground,'rgb(237, 242, 255)','Ministry header keeps the existing shared-stage styling');
   assert.equal(check.numberCards,5,'Committee list retains all five cards');
   assert.equal(check.cardLayout.length,5,'Five idle election panels rendered');
   for(const card of check.cardLayout){
    assert.equal(card.headerDisplay,'grid','Committee card has a fixed stacking layout at '+width);
    assert.equal(card.selectFlex,'0','Select does not stretch or shift its button at '+width);
    assert(card.controlsTop>=card.infoBottom-1,'Controls follow the committee name at '+width+': '+JSON.stringify(card));
    assert(Math.abs(card.infoLeft-card.controlsLeft)<2,'Title and form have the same left alignment at '+width);
    assert(card.buttonTop>=card.selectBottom+5,'Button appears below select at '+width);
    assert(card.buttonRight<=card.cardRight+1,'Controls do not overflow card at '+width);
    assert.equal(card.cardBackground,card.headerBackground,'Idle panels have no detached white blank region at '+width);
    assert.equal(card.borderBottom,'0px','Idle panels have no unnecessary divider at '+width);
   }
   if(width>=1024){
    assert(Math.abs(check.cardLayout[0].controlsTop-check.cardLayout[1].controlsTop)<2,'Two desktop committee cards align action row at '+width);
   }
   assert.equal(check.committeeCounterText,'0','Test empty committee count exactly as in reported screen');
   assert(check.committeeCaptionCentered,'Counter caption is centered at '+width);
   assert(!check.committeeCaptionHasIcon,'Counter caption has no decorative SVG at '+width);
   assert.equal(check.ministryCounterGridColumns,2,'Existing stage 9 ministry counter keeps its legacy layout');
   if(check.committeeCounterIsGrid){
     assert.equal(check.committeeCounterGridColumns,1,'Committee badge uses a single track, not inherited two-column staffing layout');
     assert(check.committeeCounterDistances.every(d=>d<2),'Committee counter label, number and subtitle align centrally at '+width+': '+JSON.stringify(check));
   }
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
