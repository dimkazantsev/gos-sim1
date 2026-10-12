/* Real-CSS geometry regression for NPA document toolbar. Uses local
 * design preview only: no Supabase credentials and no production writes. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright-core');
const root=path.join(__dirname,'..');
const preview=path.join(root,'.design-review/gos-sim-preview.html');
const screens=path.join(root,'.design-review/screenshots');
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser','/opt/google/chrome/chrome']
 .find(p=>p&&fs.existsSync(p));
if(!chrome)throw Error('Chromium required for NPA toolbar geometry test');
if(!fs.existsSync(preview))throw Error('Run npm run design:preview first');
fs.mkdirSync(screens,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const page=await browser.newPage({viewport:{width:1500,height:950}});
  await page.goto('file://'+preview,{waitUntil:'load'});
  const frame=page.frameLocator('#preview');
  for(const width of [320,360,390,430,560,650,820,1024,1440]){
   await page.locator('#preview').evaluate((el,w)=>{el.style.width=w+'px'},width);
   await page.locator('#screen').selectOption('document-detail');
   await frame.locator('.legalUnifiedToolbar .legalWorkspaceLabel').waitFor();
   const data=await frame.locator('.legalUnifiedToolbar').evaluate(el=>{
    const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
    const label=el.querySelector('.legalWorkspaceLabel'),button=el.querySelector('.legalBackToRegistry');
    return {toolbar:rect(el),label:rect(label),button:rect(button),
      labelAlign:getComputedStyle(label).textAlign,
      labelItems:getComputedStyle(label).justifyItems,
      overflow:el.scrollWidth-el.clientWidth,
      labelText:label.textContent.trim(),
      buttonText:button.textContent.trim()};
   });
   const context=width+'px '+JSON.stringify(data);
   assert(data.labelText.includes('Документ и процедура'),'Expected document title: '+context);
   assert(data.buttonText.includes('Реестр НПА'),'Expected return button: '+context);
   assert(data.overflow<=2,'Toolbar must not overflow: '+context);
   assert(data.label.left>=data.toolbar.left-2&&data.label.right<=data.toolbar.right+2,'Title stays inside toolbar: '+context);
   assert(data.button.left>=data.toolbar.left-2&&data.button.right<=data.toolbar.right+2,'Back button stays inside toolbar: '+context);
   assert(data.labelAlign==='left'||data.labelAlign==='start','Title is aligned left: '+context);
   assert(data.labelItems==='start','Text must be justified left: '+context);
   if(width>360){
    assert(data.label.left>=data.button.right+3,'Document title must be to the right of the back button: '+context);
    assert(Math.abs(data.label.top-data.button.top)<=22,'Title and back button must share the row: '+context);
   }else{
    assert(data.label.top>=data.button.bottom-2,'At 320-360px title must stack below button: '+context);
   }
   if([320,390,820,1440].includes(width)){
    await frame.locator('.legalUnifiedToolbar').screenshot({
     path:path.join(screens,'npa-toolbar-alignment-'+width+'.png'),animations:'disabled'
    });
   }
   console.log('PASS NPA toolbar title aligned after back button at '+width+'px');
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});