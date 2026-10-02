/* Responsive regression for the offline teacher preview and swipeable mobile dock.
   Uses real application markup from design:preview, without Supabase credentials. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..');
const preview=path.join(root,'.design-review','gos-sim-preview.html');
const shotDir=path.join(root,'.design-review','screenshots');
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser','/opt/google/chrome/chrome'].find(p=>p&&fs.existsSync(p));
if(!chrome)throw Error('Chrome/Chromium missing for teacher mobile check');
if(!fs.existsSync(preview))throw Error('Run npm run design:preview first');
fs.mkdirSync(shotDir,{recursive:true});
async function main(){
 const browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:940},deviceScaleFactor:1});
  await page.goto('file://'+preview,{waitUntil:'load'});
  const frame=page.frameLocator('#preview');
  for(const width of [1440,1180,900,820,768,650,600,430,390,360,320]){
   await page.locator('#preview').evaluate((el,w)=>{el.style.width=w+'px'},width);
   if(width<=900){
    await page.locator('#screen').selectOption('dashboard');
    const header=await frame.locator('.simTop').evaluate(el=>{
     const r=el.getBoundingClientRect();
     const parts=[...el.querySelectorAll('.mobileBrand,.topScreenHistory,.simTopCenter,.viewAsSwitcher')].filter(x=>getComputedStyle(x).display!=='none').map(x=>{const a=x.getBoundingClientRect();return {name:x.className,left:a.left,right:a.right,top:a.top,bottom:a.bottom}});
     return {height:r.height,width:document.documentElement.clientWidth,parts,connection:getComputedStyle(el.querySelector('.connectionPill')).display};
    });
    assert(header.height<=60,'Mobile header must fit one row at '+width+'px: '+JSON.stringify(header));
    assert(header.connection!=='none','Sync indicator must be present and stable');
    for(const part of header.parts)assert(part.left>=-2&&part.right<=header.width+2,'Header overflows at '+width+': '+JSON.stringify(header));
    await page.locator('#screen').selectOption('chat');
    // The sheet deliberately slides up; assert final position after the animation.
    await frame.locator('.gsChatV2').evaluate(async el=>{
     await Promise.all(el.getAnimations().map(animation=>animation.finished.catch(()=>{})));
    });
    const chatGeometry=await frame.locator('.gsChatV2').evaluate(el=>{
     const a=el.getBoundingClientRect(),b=document.querySelector('.mobileDockV2').getBoundingClientRect();
     return {chat:{top:a.top,bottom:a.bottom},dock:{top:b.top,bottom:b.bottom},headerBottom:document.querySelector('.simTop').getBoundingClientRect().bottom};
    });
    assert(chatGeometry.chat.top>=chatGeometry.headerBottom-2&&chatGeometry.chat.top<=chatGeometry.headerBottom+30,'Chat must remain below the header without overlapping it: '+JSON.stringify(chatGeometry));
    assert(chatGeometry.chat.bottom<=chatGeometry.dock.top+2&&chatGeometry.chat.bottom>=chatGeometry.dock.top-34,'Chat must end above dock with a small intentional gap: '+JSON.stringify(chatGeometry));
   }
   await page.locator('#screen').selectOption('teacher-stages');
   await frame.locator('.teacherCommand .teacherStageManager').waitFor();
   const result=await frame.locator('html').evaluate(html=>{
    const root=html.querySelector('.teacherCommand');
    const dock=html.querySelector('.mobileDockScroll');
    const bounds=(selector)=>Array.from(root.querySelectorAll(selector)).map(el=>{
     const r=el.getBoundingClientRect();
     return {selector,className:String(el.className||''),x:r.x,right:r.right,width:r.width,top:r.top,bottom:r.bottom};
    });
    return {viewport:html.clientWidth,scroll:html.scrollWidth,
     sections:bounds(':scope > section,:scope > details'),
     cards:bounds('.teacherStageCard,.teacherStageReset,.teacherStageExpand,.teacherCommandBar,.teacherQuick'),
     dock:{visible:getComputedStyle(dock).display!=='none',width:dock.clientWidth,scroll:dock.scrollWidth,buttons:dock.querySelectorAll('button').length}};
   });
   assert(result.scroll<=result.viewport+3,'Teacher view overflows at '+width+'px: '+JSON.stringify(result));
   for(const item of [...result.sections,...result.cards]){
    assert(item.x>=-3&&item.right<=result.viewport+3,
     'Teacher element overflows viewport at '+width+'px: '+JSON.stringify(item));
   }
   if(width<=900){
    assert(result.dock.visible,'Mobile dock hidden at '+width+'px');
    assert(result.dock.buttons>=9,'All eight routes + More must be in the mobile dock');
    if(width<=650)assert(result.dock.scroll>result.dock.width,
     'Dock should scroll when icons exceed narrow viewport at '+width+'px: '+JSON.stringify(result.dock));
    if(result.dock.scroll>result.dock.width+2){
     const moved=await frame.locator('.mobileDockScroll').evaluate(el=>{
      el.scrollLeft=0;
      el.scrollLeft=el.scrollWidth-el.clientWidth;
      return {left:el.scrollLeft,max:el.scrollWidth-el.clientWidth};
     });
     assert(moved.left>2&&Math.abs(moved.left-moved.max)<=3,
      'Last navigation item must be reachable by horizontal scroll');
    }
   }
   await page.locator('#preview').screenshot({path:path.join(shotDir,'teacher-mobile-'+width+'.png')});
   // The user reported clipping and enlarged, detached formula text. Review
   // the opened guide in the actual teacher workspace, including its table.
   await page.locator('#screen').selectOption('teacher-grades');
   const guide=frame.locator('.vsnGuide');await guide.waitFor();
   await guide.locator(':scope > summary').click();
   assert.equal(await guide.getAttribute('open'),'','Scoring guide expands at '+width+'px');
   const scoring=await guide.evaluate(el=>{
    const box=el.getBoundingClientRect();
    const selectors=['.vsnGuideHeading','.vsnGuideRange','.vsnGuideChevron','.vsnCriteria>article','.vsnFormulaIntro','.vsnEquations>section','.vsnEquation','.vsnTerms>div','.scoreWeights table','.scoreWeights th','.scoreWeights td','.vsnFormulaNote'];
    const items=selectors.flatMap(selector=>[...el.querySelectorAll(selector)].map(node=>{
     const r=node.getBoundingClientRect(),style=getComputedStyle(node);
     return {selector,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,scroll:node.scrollWidth,client:node.clientWidth,font:parseFloat(style.fontSize)};
    }));
    const cards=[...el.querySelectorAll('.vsnCriteria>article')].map(node=>{const r=node.getBoundingClientRect();return {top:r.top,height:r.height,width:r.width}});
    return {left:box.left,right:box.right,viewport:document.documentElement.clientWidth,scroll:el.scrollWidth,client:el.clientWidth,items,cards,details:el.querySelectorAll('details').length};
   });
   assert.equal(scoring.details,0,'Criteria and calculation stay in one disclosure');
   assert.equal(scoring.cards.length,4,'All four criteria are visible');
   assert(scoring.left>=-2&&scoring.right<=scoring.viewport+2,'Scoring guide stays within viewport at '+width+'px: '+JSON.stringify(scoring));
   assert(scoring.scroll<=scoring.client+2,'Scoring guide must not crop its content at '+width+'px');
   for(const item of scoring.items){
    assert(item.left>=scoring.left-2&&item.right<=scoring.right+2,'Scoring content escapes its panel at '+width+'px: '+JSON.stringify(item));
    assert(item.scroll<=item.client+2,'Scoring text is clipped at '+width+'px: '+JSON.stringify(item));
    if(item.selector==='.vsnEquation')assert(item.font>=17&&item.font<=20,'Formula stays proportionate at '+width+'px');
   }
   for(const card of scoring.cards){for(const other of scoring.cards){if(Math.abs(card.top-other.top)<2)assert(Math.abs(card.height-other.height)<2,'Criteria in the same row have equal height')}}
   const header=await guide.locator(':scope > summary').evaluate(el=>[...el.children].map(node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}}));
   for(let i=1;i<header.length;i++)assert(header[i].left>=header[i-1].right+6,'Scoring header items do not overlap at '+width+'px');
   await guide.screenshot({path:path.join(shotDir,'score-guide-'+width+'.png')});
   await guide.locator(':scope > summary').click();assert.equal(await guide.getAttribute('open'),null,'Scoring guide collapses at '+width+'px');
   if(width<=900){
    await page.locator('#screen').selectOption('mobile-all');
    const all=await page.frameLocator('#preview').locator('html').evaluate(html=>{
     const sheet=html.querySelector('.mobileMoreSheet'),grid=sheet.querySelector('.mobileAllGrid');
     const panel=sheet.getBoundingClientRect(),items=[...grid.querySelectorAll('button')].map(el=>{
      const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};
     });
     return {viewport:html.clientWidth,scroll:html.scrollWidth,sheet:{left:panel.left,right:panel.right,top:panel.top,bottom:panel.bottom},
      sections:items.length,overflow:items.filter(r=>r.left<panel.left-3||r.right>panel.right+3)};
    });
    assert.equal(all.sections,12,'Eleven teacher routes including Budget and chat must be visible in the same menu');
    assert(all.scroll<=all.viewport+3,'All sections menu widens page at '+width+'px');
    assert.equal(all.overflow.length,0,'All-sections items escape modal bounds at '+width+'px');
    assert(all.sheet.top>=-2&&all.sheet.bottom<=940+2,'All-sections menu escapes viewport at '+width+'px');
    await page.locator('#preview').screenshot({path:path.join(shotDir,'all-sections-'+width+'.png')});
   }
   console.log('PASS teacher '+width+'px: no global overflow; dock scroll '+result.dock.scroll+'/'+result.dock.width);
  }
 }finally{await browser.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1});
