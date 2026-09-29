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
  for(const width of [1180,900,820,768,650,430,390,360,320]){
   await page.locator('#preview').evaluate((el,w)=>{el.style.width=w+'px'},width);
   await page.locator('#screen').selectOption('teacher');
   await frame.locator('.teacherSimple .teacherFocus').waitFor();
   const result=await frame.locator('html').evaluate(html=>{
    const root=html.querySelector('.teacherSimple');
    const dock=html.querySelector('.mobileDock');
    const bounds=(selector)=>Array.from(root.querySelectorAll(selector)).map(el=>{
     const r=el.getBoundingClientRect();
     return {selector,className:String(el.className||''),x:r.x,right:r.right,width:r.width,top:r.top,bottom:r.bottom};
    });
    return {viewport:html.clientWidth,scroll:html.scrollWidth,
     sections:bounds(':scope > section,:scope > details'),
     cards:bounds('.teacherAction,.pulseCard,.studentLiveRow,.teacherAnalyticsCards>div,.teacherPlayerStatsRow,.teacherPartyMatrix>article,.gameReadinessGrid article'),
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
    assert(result.dock.scroll>result.dock.width+100,
     'Dock must scroll horizontally at '+width+'px: '+JSON.stringify(result.dock));
    const moved=await frame.locator('.mobileDock').evaluate(el=>{
     el.scrollLeft=0;
     el.scrollLeft=el.scrollWidth-el.clientWidth;
     return {left:el.scrollLeft,max:el.scrollWidth-el.clientWidth};
    });
    assert(moved.left>100&&Math.abs(moved.left-moved.max)<=3,
     'Rightmost navigation item must be reachable by horizontal scroll');
   }
   await page.locator('#preview').screenshot({path:path.join(shotDir,'teacher-mobile-'+width+'.png')});
   console.log('PASS teacher '+width+'px: no global overflow; dock scroll '+result.dock.scroll+'/'+result.dock.width);
  }
 }finally{await browser.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1});
