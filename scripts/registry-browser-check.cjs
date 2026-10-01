/* Populated registry regression using real components and fictional preview data. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..'),screens=path.join(root,'.design-review/screenshots');
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser','/opt/google/chrome/chrome'].find(p=>p&&fs.existsSync(p));
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const page=await browser.newPage({viewport:{width:1480,height:1000}});await page.goto('file://'+path.join(root,'.design-review/gos-sim-preview.html'));
  for(const width of [320,390,650,820,1100,1440]){
   await page.locator('#preview').evaluate((el,w)=>el.style.width=w+'px',width);await page.locator('#screen').selectOption('documents');
   const frame=page.frameLocator('#preview');await frame.locator('.formalRegistry').waitFor();
   async function inside(selector){const data=await frame.locator(selector).evaluate(root=>({viewport:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,offenders:[...root.querySelectorAll('input,button,.styledSelectTrigger,.formalPaper,.formalPassport')].filter(el=>el.getClientRects().length).map(el=>({class:el.className,left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right})).filter(r=>r.left<-2||r.right>document.documentElement.clientWidth+2)}));assert(data.scroll<=data.viewport+2,'Portal overflow '+width+': '+JSON.stringify(data));assert.equal(data.offenders.length,0,'Portal controls stay inside '+width+': '+JSON.stringify(data));}
   await inside('.formalPage');
   const rows=await frame.locator('.formalRegistryRow').evaluateAll(rows=>rows.map(el=>{const r=el.getBoundingClientRect();return {height:r.height,bottom:r.bottom,top:r.top,left:r.left,right:r.right,children:[...el.children].map(c=>({top:c.getBoundingClientRect().top,bottom:c.getBoundingClientRect().bottom}))}}));
   assert(rows.length>=6,'Test populated list');for(const row of rows)assert(row.children.every(c=>c.top>=row.top-2&&c.bottom<=row.bottom+2),'Row content fits '+width);for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++)assert(!(Math.min(rows[i].right,rows[j].right)>Math.max(rows[i].left,rows[j].left)+1&&Math.min(rows[i].bottom,rows[j].bottom)>Math.max(rows[i].top,rows[j].top)+1),'Rows do not overlap');
   await page.locator('#preview').screenshot({path:path.join(screens,'registry-'+width+'.png')});
   await page.locator('#screen').selectOption('document-procedure');await frame.locator('.formalActions').waitFor();await inside('.formalPage');assert.equal(await frame.locator('.formalVoteLink.active').count(),1,'Open vote visible');await frame.locator('.formalActions').scrollIntoViewIfNeeded();await page.locator('#preview').screenshot({path:path.join(screens,'registry-procedure-'+width+'.png')});
   await page.locator('#screen').selectOption('document-detail');await frame.locator('.formalPaper').waitFor();await inside('.formalPage');await frame.locator('.legalMasthead').scrollIntoViewIfNeeded();const emblem=frame.locator('.legalEmblem');await emblem.evaluate(img=>{if(!img.complete)return new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject})});assert(await emblem.evaluate(img=>img.naturalWidth>0),'Emblem loads');await page.locator('#preview').screenshot({path:path.join(screens,'registry-document-'+width+'.png')});
   console.log('PASS Populated registry, procedure placement and linked vote at '+width+'px');
  }
  for(const [screen,selector] of [['votes','.civicVotes'],['parties','.civicParties']])for(const width of [320,390,768,1440]){
   await page.locator('#preview').evaluate((el,w)=>el.style.width=w+'px',width);await page.locator('#screen').selectOption(screen);
   const frame=page.frameLocator('#preview');await frame.locator(selector).waitFor();
   if(screen==='votes')await frame.locator('.voteManual').evaluate(el=>el.open=true);
   const geometry=await frame.locator(selector).evaluate(root=>({viewport:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,right:root.getBoundingClientRect().right,offenders:[...root.querySelectorAll('input,button,.styledSelectTrigger,.civicPublicDocs a')].filter(el=>el.getClientRects().length).map(el=>({class:el.className,left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right})).filter(r=>r.left<-2||r.right>document.documentElement.clientWidth+2)}));
   assert(geometry.scroll<=geometry.viewport+2,screen+' overflow at '+width+': '+JSON.stringify(geometry));assert.equal(geometry.offenders.length,0,screen+' controls stay inside at '+width+': '+JSON.stringify(geometry));
   if(screen==='parties'){assert.equal(await frame.locator('.civicPublicDocs a').count(),2,'Public charter and programme; fee is private');assert.equal(await frame.locator('.ghostBulk,.ghostPanel,.partyAgreements').count(),0,'Public parties omit GV and agreements');}
   await page.locator('#preview').screenshot({path:path.join(screens,screen+'-'+width+'.png')});
   await frame.locator(screen==='parties'?'.civicPublicDocs':'.civicBallot').last().scrollIntoViewIfNeeded();
   await page.locator('#preview').screenshot({path:path.join(screens,screen+'-detail-'+width+'.png')});console.log('PASS '+screen+' '+width+'px: public documents and controls remain in the viewport');
  }
  for(const width of [320,390,768,1440]){
   await page.locator('#preview').evaluate((el,w)=>el.style.width=w+'px',width);await page.locator('#screen').selectOption('actions');
   const frame=page.frameLocator('#preview');await frame.locator('.processPortal').waitFor();
   assert.equal(await frame.locator('.wallPost').count(),3,'Populated process feed');
   assert.equal(await frame.locator('.impactEditor').count(),0,'Post records actual changes without a metric checklist');
   assert.equal(await frame.locator('.wallPostAvatar img[alt="GOS//SIMS"]').count(),1,'Teacher has neutral game logo');
   assert.equal(await frame.locator('.processRecordedChanges').count(),2,'Actual linked changes and media reporting');
   const measured=await frame.locator('.processPortal').evaluate(el=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,offenders:[...el.querySelectorAll('button,input,a,.processSourceVisual')].filter(x=>x.getClientRects().length).map(x=>({class:x.className,left:x.getBoundingClientRect().left,right:x.getBoundingClientRect().right})).filter(r=>r.left<-2||r.right>document.documentElement.clientWidth+2)}));
   assert(measured.scroll<=measured.width+2,'Process overflow '+width+': '+JSON.stringify(measured));assert.equal(measured.offenders.length,0,'Process bounds '+width+': '+JSON.stringify(measured));
   await page.locator('#preview').screenshot({path:path.join(screens,'political-process-'+width+'.png')});
   await frame.locator('.wallComposer').evaluate(el=>el.open=true);await frame.locator('.processAttachmentTools').scrollIntoViewIfNeeded();await page.locator('#preview').screenshot({path:path.join(screens,'political-composer-'+width+'.png')});
   console.log('PASS Political process, neutral publisher and recorded changes at '+width+'px');
  }
  await page.locator('#screen').selectOption('teacher-parties');
  for(const width of [390,1440]){
   await page.locator('#preview').evaluate((el,w)=>el.style.width=w+'px',width);
   const frame=page.frameLocator('#preview');await frame.locator('.teacherPartyDossiers').waitFor();
   await frame.locator('.teacherPartySection').nth(1).scrollIntoViewIfNeeded();
   await page.locator('#preview').screenshot({path:path.join(screens,'teacher-documents-'+width+'.png')});
   await frame.locator('.partyMandateEditor').first().evaluate(el=>el.open=true);
   await frame.locator('.partyMandateEditor').first().scrollIntoViewIfNeeded();
   await page.locator('#preview').screenshot({path:path.join(screens,'teacher-mandates-'+width+'.png')});
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
