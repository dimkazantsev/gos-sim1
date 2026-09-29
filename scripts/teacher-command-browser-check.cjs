/* Browser regression: teacher command centre, fixed-size stage actions and no overflow. 
   Uses the real static React preview. Run design:preview first. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..');
const preview=path.join(root,'.design-review','gos-sim-preview.html');
const screenshots=path.join(root,'.design-review','screenshots');
const executable=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser']
 .find(p=>p&&fs.existsSync(p));
if(!executable)throw Error('Chrome/Chromium is required; set CHROME_BIN');
if(!fs.existsSync(preview))throw Error('Run npm run design:preview first');
fs.mkdirSync(screenshots,{recursive:true});

async function check(){
 const browser=await chromium.launch({headless:true,executablePath:executable,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const page=await browser.newPage({viewport:{width:1650,height:900},deviceScaleFactor:1});
  await page.goto('file://'+preview,{waitUntil:'load'});
  const frame=page.frameLocator('#preview');
  await page.locator('#screen').selectOption('teacher-stages');
  await frame.locator('.teacherStageManager').waitFor();
  for(const width of [1600,1440,1280,1100,900,768,430,390,360,320]){
   await page.locator('#preview').evaluate((el,n)=>{el.style.width=n+'px'},width);
   await frame.locator('.teacherStageManager').evaluate(el=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const data=await frame.locator('.teacherCommand').evaluate(root=>{
    const rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,y:r.y+r.height/2}};
    const grid=root.querySelector('.teacherStageGrid');
    const board=root.querySelector('.teacherStageManager');
    const cards=[...grid.querySelectorAll('.teacherStageCard')];
    return {
     width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,
     page:rect(root),grid:rect(grid),board:rect(board),
     cardRects:cards.map(card=>({
      card:rect(card),open:rect(card.querySelector('.teacherStageOpen')),
      reset:rect(card.querySelector('.teacherStageReset')),
      resetLabel:card.querySelector('.teacherStageReset').getAttribute('aria-label')
     })),
     allReset:rect(root.querySelector('.teacherResetAll')),
     allResetCount:root.querySelectorAll('.teacherResetAll').length,
     workspaceCount:root.querySelectorAll('.teacherWorkspaceNav [role=tab]').length,
     sections:[...root.children].filter(el=>getComputedStyle(el).display!=='none').map(rect)
    };
   });
   assert.equal(data.cardRects.length,16,'Exactly 16 stage cards required at '+width+'px');
   assert.equal(data.allResetCount,1,'Exactly one all-stage reset control required');
   assert.equal(data.workspaceCount,9,'All nine teacher workspaces must be present');
   assert(data.scroll<=data.width+3,'Horizontal document overflow at '+width+'px: '+JSON.stringify(data));
   for(let i=0;i<data.cardRects.length;i++){
    const card=data.cardRects[i];
    assert(card.card.left>=data.grid.left-2&&card.card.right<=data.grid.right+2,
     'Stage '+(i+1)+' outside grid at '+width+'px');
    assert(card.reset.left>=card.card.left-2&&card.reset.right<=card.card.right+2,
     'Reset icon outside card '+(i+1)+' at '+width+'px');
    assert(card.open.right<=card.reset.left+2,'Reset icon overlaps main stage action '+(i+1)+' at '+width+'px');
    assert(Math.abs(card.open.y-card.reset.y)<=26,'Reset not aligned with stage '+(i+1)+' at '+width+'px');
    assert(card.reset.width>=30&&card.reset.height>=34,'Reset icon too small on stage '+(i+1));
    assert(card.resetLabel.includes('Сбросить этап '+(i+1)),'Reset icon missing accessible label');
   }
   if([1440,900,390].includes(width)){
    await frame.locator('.teacherStageManager').screenshot({
     path:path.join(screenshots,'teacher-stages-'+width+'.png'),animations:'disabled'
    });
   }
   console.log('PASS '+width+'px: 16 independent reset icons, bulk reset, nine workspaces, no overflow');
  }
  for(const [screen,selector] of [
   ['teacher-journal','.classroomJournal'],
   ['teacher-analytics','.participantsAnalytics'],
   ['teacher-grades','.gradesToolbar'],
   ['teacher-event','.eventWorkspace'],
   ['teacher-parties','.teacherPartyDossiers'],
   ['teacher-tools','.teacherGhostPanel']
  ]){
   await page.locator('#screen').selectOption(screen);
   await frame.locator(selector).first().waitFor();
   assert.equal(await frame.locator('.teacherWorkspaceNav [role=tab]').count(),9,'Nine workspaces required');
   if(screen==='teacher-journal'){
    assert((await frame.locator('.journalToolbar select').count())>=2,'Participant and section journal filters missing');
    assert.equal(await frame.locator('.journalCounters button').count(),1,'Journal CSV export missing');
   }
   if(screen==='teacher-analytics'){
    assert.equal(await frame.locator('.participantsTable').count(),1,'Participant table missing');
    assert((await frame.locator('.participantsTable thead th').count())>=9,'Participant metrics missing');
   }
   if(screen==='teacher-grades'){
    assert((await frame.locator('.gradesToolbar select').count())>=2,'Grade sorting/filter controls missing');
    assert.equal(await frame.locator('.gradeTotalHead').count(),2,'Grade totals missing');
   }
   if(screen==='teacher-event'){
    assert.equal(await frame.locator('.eventCatalogTargets>div').count(),4,'Event case budget must contain four targets');
    assert.equal(await frame.locator('.eventEditorGrid select').count(),4,'Event must have category, seriousness, role and audience controls');
   }
   if(screen==='teacher-parties'){
    assert.equal(await frame.locator('.teacherPartyDossierHead').count(),1,'Expanded party dossier heading missing');
   }
   if(screen==='teacher-tools'){
    assert.equal(await frame.locator('.ghostBulk select').count(),2,'Ghost Voting must provide scope and party selection');
   }
   for(const width of [1440,390]){
    await page.locator('#preview').evaluate((el,w)=>{el.style.width=w+'px'},width);
    await frame.locator(selector).first().evaluate(el=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const ok=await frame.locator(selector).first().evaluate(el=>({
     width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,
     right:el.getBoundingClientRect().right
    }));
    assert(ok.scroll<=ok.width+3,screen+' overflows at '+width+'px: '+JSON.stringify(ok));
    if(width===1440)await frame.locator(selector).first().screenshot({
     path:path.join(screenshots,screen+'.png'),animations:'disabled'
    });
   }
   console.log('PASS '+screen+': responsive static controls');
  }
  await page.locator('#screen').selectOption('profile');
  assert.equal(await frame.locator('.profileJournalAccess button').count(),1,
   'Profile needs a private journal toggle');
 }finally{await browser.close()}
}
check().catch(error=>{console.error(error);process.exitCode=1});
