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
   const frame=page.frameLocator('#preview');await frame.locator('.formalPaper').waitFor();
   const geometry=await frame.locator('html').evaluate(html=>{
    const root=html.querySelector('.formalPage'),r=root.getBoundingClientRect(),actions=root.querySelector('.formalActions').getBoundingClientRect(),paper=root.querySelector('.formalPaper').getBoundingClientRect();
    const nodes=[...root.querySelectorAll('.formalRegistryRow,.formalDocHeader,.formalStatusLarge,.formalStep,.formalActions button,.formalPassport,.formalPaper,.formalLinkedVotes button')];
    return {viewport:html.clientWidth,scroll:html.scrollWidth,root:r.toJSON(),actions:actions.toJSON(),paper:paper.toJSON(),offenders:nodes.map(el=>({name:el.className,left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right})).filter(x=>x.left<r.left-2||x.right>r.right+2)};
   });
   assert(geometry.scroll<=geometry.viewport+2,'Registry overflow at '+width+': '+JSON.stringify(geometry));
   assert.equal(geometry.offenders.length,0,'Registry children stay inside at '+width+': '+JSON.stringify(geometry.offenders));
   const rows=await frame.locator('.formalRegistryRow').evaluateAll(rows=>rows.map(el=>{const r=el.getBoundingClientRect();return {height:r.height,bottom:r.bottom,top:r.top,children:[...el.children].map(c=>({top:c.getBoundingClientRect().top,bottom:c.getBoundingClientRect().bottom}))}}));
   assert(rows.length>=6,'Test a populated document list');
   for(const row of rows)assert(row.children.every(c=>c.top>=row.top-2&&c.bottom<=row.bottom+2),'Document content must fit its row at '+width+'px: '+JSON.stringify(row));
   for(let i=1;i<rows.length;i++)assert(rows[i].top>=rows[i-1].bottom-1,'Document rows may not overlap');
   assert(geometry.actions.bottom<=geometry.paper.top,'Primary procedure is placed before the document body');
   assert.equal(await frame.locator('.formalVoteLink.active').count(),1,'Linked open vote is visible');
   assert.equal(await frame.getByRole('button',{name:'Перейти к голосованию →'}).count(),1);
   await page.locator('#preview').screenshot({path:path.join(screens,'registry-'+width+'.png')});
   console.log('PASS Populated registry, procedure placement and linked vote at '+width+'px');
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
