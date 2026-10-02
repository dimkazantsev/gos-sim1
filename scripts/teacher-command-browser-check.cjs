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
    const rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
    const list=root.querySelector('.teacherStageList');
    const inspector=root.querySelector('.teacherStageInspector');
    const entries=[...list.querySelectorAll('.teacherStageListItem')];
    return {width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,
     list:rect(list),inspector:rect(inspector),rows:entries.map(rect),
     reset:root.querySelectorAll('.teacherStageInspectorReset').length,
     allReset:root.querySelectorAll('.teacherResetAll').length,
     workspaceCount:root.querySelectorAll('.teacherWorkspaceNav [role=tab]').length};
   });
   assert.equal(data.rows.length,16,'Stage list must contain all 16 stages at '+width+'px');
   assert.equal(data.reset,1,'Exactly one contextual stage reset button');
   assert.equal(data.allReset,1,'Exactly one global stage reset');
   assert.equal(data.workspaceCount,10,'Ten teacher workspaces');
   assert(data.scroll<=data.width+3,'Stage management overflows at '+width+'px: '+JSON.stringify(data));
   for(const row of data.rows)assert(row.left>=data.list.left-2&&row.right<=data.list.right+2,'Stage row leaves list at '+width+'px');
   assert(data.inspector.left>=-2&&data.inspector.right<=data.width+3,'Stage details leave viewport at '+width+'px');
   if([1440,900,390].includes(width)){
    await frame.locator('.teacherStageManager').screenshot({
     path:path.join(screenshots,'teacher-stages-'+width+'.png'),animations:'disabled'
    });
   }
   console.log('PASS '+width+'px: 16 stable list rows, contextual reset, ten workspaces, no overflow');
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
   assert.equal(await frame.locator('.teacherWorkspaceNav [role=tab]').count(),10,'Ten workspaces required');
   if(screen==='teacher-journal'){
    assert((await frame.locator('.journalToolbar .styledSelect').count())>=2,'Participant and section journal filters missing');
    assert.equal(await frame.locator('.journalCounters button[title="Экспорт показанных строк в CSV"]').count(),1,'Journal CSV export missing');
    assert.equal(await frame.getByRole('button',{name:'Очистить историю',exact:true}).count(),1,'Teacher journal clear control missing');
   }
   if(screen==='teacher-analytics'){
    assert.equal(await frame.locator('.participantsTable').count(),1,'Participant table missing');
    assert((await frame.locator('.participantsTable thead th').count())>=9,'Participant metrics missing');
   }
   if(screen==='teacher-grades'){
    assert((await frame.locator('.gradesToolbar .styledSelect').count())>=2,'Grade sorting/filter controls missing');
    assert.equal(await frame.locator('.gradeTotalHead').count(),2,'Grade totals missing');
   }
   if(screen==='teacher-event'){
    assert.equal(await frame.locator('.eventCatalogTargets>div').count(),4,'Event case budget must contain four targets');
    assert((await frame.locator('.eventEditorGrid .styledSelect').count())>=4,'Event must have category, seriousness, role and audience controls');
   }
   if(screen==='teacher-parties'){
    assert.equal(await frame.locator('.teacherPartyDossierHead').count(),1,'Expanded party dossier heading missing');
   }
   if(screen==='teacher-tools'){
    assert.equal(await frame.locator('.ghostBulk .styledSelect').count(),2,'Ghost Voting must provide scope and party selection');
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
  // Regression for all newly added public-profile, signature and events controls.
  assert.equal(await frame.locator('.profileCameraButton').count(),1,'Profile photo requires a round camera control');
  assert.equal(await frame.locator('.profileComicButton').count(),1,'Profile needs a working comic trigger');
  assert.equal(await frame.locator('.profileSignature').count(),1,'Profile must expose the signature uploader');
  assert.equal(await frame.locator('.profileSecurity').count(),1,'Profile must expose the password panel');
  for(const [screen,selector] of [['profile','.profilePage'],['teacher-event','.eventWorkspace'],['chat-video-preview','.chatVideoNote']]){
   await page.locator('#screen').selectOption(screen);
   await frame.locator(selector).first().waitFor();
   for(const width of [1440,1024,768,390,360,320]){
    await page.locator('#preview').evaluate((el,w)=>{el.style.width=w+'px'},width);
    await frame.locator(selector).first().evaluate(el=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const geometry=await frame.locator(selector).first().evaluate(el=>{
     const rect=el.getBoundingClientRect();return {
      viewport:document.documentElement.clientWidth,
      scroll:document.documentElement.scrollWidth,
      left:rect.left,right:rect.right,
      height:rect.height,
      offenders:Array.from(document.querySelectorAll('*')).filter(node=>{
       const r=node.getBoundingClientRect(),style=getComputedStyle(node);
       return style.position!=='fixed'&&r.width>1&&(r.right>document.documentElement.clientWidth+2||r.left<-2);
      }).slice(0,12).map(node=>({tag:node.tagName,cls:String(node.className||'').slice(0,90),text:node.textContent?.trim().slice(0,38),
       x:Math.round(node.getBoundingClientRect().x),right:Math.round(node.getBoundingClientRect().right)}))
     };
    });
    assert(geometry.scroll<=geometry.viewport+3,screen+' global overflow at '+width+'px: '+JSON.stringify(geometry));
    assert(geometry.left>=-3&&geometry.right<=geometry.viewport+3,screen+' escapes page at '+width+'px: '+JSON.stringify(geometry));
    if(screen==='chat-video-preview'){
     const video=await frame.locator('.chatVideoNote').first().evaluate(el=>{
      const r=el.getBoundingClientRect(),b=el.querySelector('.chatVideoPlay').getBoundingClientRect();
      return {width:r.width,height:r.height,centerX:r.x+r.width/2,centerY:r.y+r.height/2,
       playX:b.x+b.width/2,playY:b.y+b.height/2};
     });
     assert(video.width<=103&&video.height<=103,'Round video should not exceed 100px: '+JSON.stringify(video));
     assert(Math.abs(video.centerX-video.playX)<=2&&Math.abs(video.centerY-video.playY)<=2,'Video play must be centered: '+JSON.stringify(video));
    }
    if(screen==='teacher-event'){
     assert.equal(await frame.locator('.eventDecisionOverview article').count(),5,'Events overview must expose assigned/solved/yes/no/trust KPIs');
     assert.equal(await frame.locator('.autoEventPanel .autoEventButtons button').count(),3,'Event autopilot must have start, pause and check controls');
     assert.equal(await frame.locator('.autoEventSettings .styledSelect').count(),5,'Event autopilot needs all five adjustable parameters');
    }
    if(width===390&&screen!=='chat-video-preview')await frame.locator(selector).first().screenshot({
     path:path.join(screenshots,'new-'+screen+'-390.png'),animations:'disabled'
    });
    console.log('PASS '+screen+' '+width+'px: layout, controls'+(screen==='chat-video-preview'?', circular video and centered play':''));
   }
  }
 }finally{await browser.close()}
}
check().catch(error=>{console.error(error);process.exitCode=1});
