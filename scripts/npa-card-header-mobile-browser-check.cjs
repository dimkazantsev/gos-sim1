const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright-core');
const preview=path.join(__dirname,'../.design-review/gos-sim-preview.html');
const executable=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(x=>x&&fs.existsSync(x));
if(!executable||!fs.existsSync(preview))throw Error('Chromium and design preview required for real mobile/tablet layout checks');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:executable,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:900}});
  await page.goto('file://'+preview,{waitUntil:'load'});
  await page.locator('#screen').selectOption('documents');
  const frame=page.frameLocator('#preview');
  for(const width of [320,375,430,768,820,1024,1440]){
   await page.locator('#preview').evaluate((el,w)=>{el.style.width=w+'px'},width);
   const card=frame.locator('.registryCard').first();
   await card.waitFor();
   const geo=await card.evaluate(el=>{
    const box=x=>{const b=x.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width}};
    const header=el.querySelector('.registryCardHead'),id=el.querySelector('.registryCardIdentity'),badge=el.querySelector('.formalStatus');
    return {card:box(el),header:box(header),id:box(id),badge:box(badge),headOverflow:header.scrollWidth-header.clientWidth,idOverflow:id.scrollWidth-id.clientWidth,badgeOverflow:badge.scrollWidth-badge.clientWidth,badgeText:badge.textContent.trim(),columns:getComputedStyle(header).gridTemplateColumns};
   });
   const context=width+'px '+JSON.stringify(geo);
   assert(geo.badgeText.length>10,'long workflow badge fixture required '+context);
   assert(geo.headOverflow<=2&&geo.idOverflow<=2&&geo.badgeOverflow<=2,'No horizontal overflow '+context);
   assert(geo.id.left>=geo.header.left-2&&geo.id.right<=geo.header.right+2,'Identity fits '+context);
   assert(geo.badge.left>=geo.header.left-2&&geo.badge.right<=geo.header.right+2,'Status fits '+context);
   if(width<=820)assert(geo.badge.top>=geo.id.bottom-1,'Status stacks under document number on phone/tablet '+context);
   console.log('PASS: NPA badge and number fit at '+width+'px');
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
