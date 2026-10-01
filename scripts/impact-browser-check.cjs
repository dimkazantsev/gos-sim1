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
   for(const variant of ['impact-expanded','impact-ledger']){
    await page.locator('#screen').selectOption(variant);
    const test=await page.frameLocator('#preview').locator('html').evaluate(html=>{
     const root=html.querySelector('.impactWorkbench'),b=root.getBoundingClientRect();
     const visible=(selector)=>[...root.querySelectorAll(selector)].filter(el=>getComputedStyle(el).display!=='none'&&!el.closest('[hidden]'));
     const nodes=variantUnused(root); // placeholder replaced below
     return {viewport:html.clientWidth,scroll:html.scrollWidth,root:{left:b.left,right:b.right},
      visibleInputs:visible('.impactRuleEditor input').length,history:visible('.impactHistoryRow').length,
      offending:nodes.map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,element:el.tagName}}).filter(x=>x.left<b.left-3||x.right>b.right+3)};
     function variantUnused(root){return [...root.querySelectorAll('.impactRuleEditor:not([hidden]) .impactRuleControls,.impactRuleEditor:not([hidden]) .impactRuleEffects label,.impactRuleEditor:not([hidden]) .impactNumeric,.impactHistoryRow,.impactHistoryBottom,.impactUndo')].filter(el=>!el.closest('[hidden]'))}
    });
    assert(test.scroll<=test.viewport+3,variant+' overflows document at '+width+'px: '+JSON.stringify(test));
    assert(!test.offending.length,variant+' children escape at '+width+'px: '+JSON.stringify(test.offending));
    if(variant==='impact-expanded')assert(test.visibleInputs>=12,'Expanded rule editor lost inputs at '+width+'px');
    if(variant==='impact-ledger'){
     assert.equal(test.history,2,'History must contain applied and reverted records');
     const identities=await page.frameLocator('#preview').locator('.impactHistoryIdentity').evaluateAll(els=>els.map(el=>({width:el.getBoundingClientRect().width,date:el.querySelector('time').getBoundingClientRect().toJSON(),row:el.closest('.impactHistoryTop').getBoundingClientRect().toJSON()})));
     assert(identities.every(x=>x.width>=140),'Ledger text has readable width at '+width+': '+JSON.stringify(identities));
     assert(identities.every(x=>x.date.height<25),'Dates must not break into vertical letters');
     const alignments=await page.frameLocator('#preview').locator('.impactJournalEntry').evaluateAll(rows=>rows.map(row=>({text:row.querySelector('.impactHistoryHeading>b').getBoundingClientRect().left,indicator:row.querySelector('.impactDelta')?.getBoundingClientRect().left})));
     assert(alignments.every(x=>x.indicator===undefined||Math.abs(x.text-x.indicator)<=1),'Journal indicators share the text left edge at '+width+': '+JSON.stringify(alignments));
    }
    await page.locator('#preview').screenshot({path:path.join(screenshots,variant+'-'+width+'.png')});
    console.log('PASS '+variant+' '+width+'px');
   }
   console.log('PASS consequences '+width+'px: no horizontal overflow, three readable rules');
  }
 }finally{await browser.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1});
