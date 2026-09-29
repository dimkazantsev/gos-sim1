/* Consequence model visual regression. Uses generated fictional offline preview. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..');
const preview=path.join(root,'.design-review','gos-sim-preview.html');
const screenshots=path.join(root,'.design-review','screenshots');
fs.mkdirSync(screenshots,{recursive:true});
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser','/opt/google/chrome/chrome'].find(p=>p&&fs.existsSync(p));
if(!chrome)throw Error('Chrome/Chromium required');
async function main(){
 const browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const page=await browser.newPage({viewport:{width:1480,height:1000}});
  await page.goto('file://'+preview,{waitUntil:'load'});
  for(const width of [1440,1180,820,650,430,390,360,320]){
   await page.locator('#preview').evaluate((el,w)=>{el.style.width=w+'px'},width);
   await page.locator('#screen').selectOption('impact');
   const frame=page.frameLocator('#preview');
   await frame.locator('.impactWorkbench').waitFor();
   const result=await frame.locator('html').evaluate(html=>{
    const root=html.querySelector('.impactWorkbench'),dock=html.querySelector('.mobileDock');
    const box=root.getBoundingClientRect(),viewport=html.clientWidth;
    const nodes=[...root.querySelectorAll('.impactWorkbenchHeader,.impactWorkbenchStats>span,.impactWorkbenchTabs button,.impactProcess>span,.impactSearch,.impactRuleCard,.impactExpandButton,.impactDelta,.impactNumeric,.impactRuleEffects label')];
    return {viewport,scroll:html.scrollWidth,root:{left:box.left,right:box.right},
     cards:root.querySelectorAll('.impactRuleCard').length,labels:root.querySelectorAll('.impactRuleCard h3').length,
     offenders:nodes.map(node=>{const r=node.getBoundingClientRect();return {name:node.className||node.tagName,left:r.left,right:r.right}}).filter(r=>r.left<box.left-3||r.right>box.right+3)};
   });
   assert.equal(result.cards,3,'Three consequence rules must be rendered');
   assert(result.scroll<=result.viewport+3,'Consequence page overflows at '+width+': '+JSON.stringify(result));
   assert.equal(result.offenders.length,0,'Consequences layout has escaped children at '+width+': '+JSON.stringify(result.offenders));
   await page.locator('#preview').screenshot({path:path.join(screenshots,'impact-'+width+'.png')});
   console.log('PASS consequences '+width+'px: no horizontal overflow, three readable rules');
  }
 }finally{await browser.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1});
