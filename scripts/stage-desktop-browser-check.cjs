/* Desktop stage-map regression using real rendered React markup and the final
   concatenated production styles. No Supabase credentials or live game needed.
   Run: npm run design:preview && npm run design:stages */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright-core');

const root=path.resolve(__dirname,'..');
const preview=path.join(root,'.design-review','gos-sim-preview.html');
const shotDir=path.join(root,'.design-review','screenshots');
const chrome=[
 process.env.CHROME_BIN,
 '/usr/bin/google-chrome',
 '/usr/bin/chromium',
 '/usr/bin/chromium-browser',
 '/opt/google/chrome/chrome',
].find(item=>item&&fs.existsSync(item));

if(!chrome)throw Error('Chrome/Chromium executable missing; set CHROME_BIN');
if(!fs.existsSync(preview))throw Error('Run npm run design:preview first');
fs.mkdirSync(shotDir,{recursive:true});

async function main(){
 const browser=await chromium.launch({
  headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']
 });
 try{
  const page=await browser.newPage({viewport:{width:1640,height:1000},deviceScaleFactor:1});
  await page.goto('file://'+preview,{waitUntil:'load'});
  const frame=page.frameLocator('#preview');
  await page.locator('#screen').selectOption('stages');
  await frame.locator('.stagesAtlas .stageAtlasCard').first().waitFor();
  const widths=[1600,1440,1280,1160,1024,960,900,768,430,390,360];
  for(const width of widths){
   await page.locator('#preview').evaluate((el,w)=>{el.style.width=w+'px'},width);
   await frame.locator('.stageAtlasCard').first().evaluate(el=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const result=await frame.locator('.stagesPage').evaluate(root=>{
    const box=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,centerY:r.y+r.height/2}};
    const cards=[...root.querySelectorAll('.stageAtlasGrid>.stageAtlasCard')];
    const timeline=box(root.querySelector('.stageAtlasGrid'));
    return {
     viewport:document.documentElement.clientWidth,
     scrollWidth:document.documentElement.scrollWidth,
     timeline,
     cards:cards.map(el=>{
      const status=el.querySelector('.stageAtlasCardStatus'),details=el.querySelector('.stageAtlasDetailAction');
      const vote=el.querySelector('.stageAtlasVoteAction');
      return {card:box(el),status:box(status),details:box(details),vote:vote?box(vote):null,
       footer:box(el.querySelector('.stageAtlasCardFooter')),
       header:box(el.querySelector('.stageAtlasCardMain')),
       detailsLabel:details.getAttribute('aria-label'),
       voteLabel:vote?.getAttribute('aria-label')||null};
     })
    };
   });
   const resets=await frame.locator('.stageAtlasResetStage').count();
   const bulk=await frame.locator('.stageAtlasResetAll').count();
   assert.equal(resets,16,'Teacher must have exactly one reset icon per stage');
   assert.equal(bulk,1,'Teacher must have a single all-stages reset control');
   assert.equal(result.cards.length,16,'Exactly sixteen cards should render');
   assert(result.scrollWidth<=result.viewport+2,
    'Stage layout overflows iframe viewport at '+width+'px: '+JSON.stringify(result));
   for(const [index,card] of result.cards.entries()){
    assert(card.card.x>=result.timeline.x-2&&card.card.right<=result.timeline.right+2,
     'Card '+(index+1)+' exceeds the stage grid at '+width+'px');
    assert(card.footer.y>=card.header.bottom-3,
     'Footer overlaps stage content on card '+(index+1)+' at '+width+'px');
    assert(card.status.y>=card.card.y-2&&card.status.bottom<=card.footer.y+2,
     'Status pill should stay in header on card '+(index+1)+' at '+width+'px');
    assert(card.details.x>=card.footer.x-2&&card.details.right<=card.footer.right+2,
     'Details button extends beyond footer on card '+(index+1)+' at '+width+'px');
    assert(card.detailsLabel?.includes('Подробнее об этапе'),
     'Missing accessible details label on card '+(index+1));
    if(card.vote){
     assert(Math.abs(card.vote.centerY-card.details.centerY)<=3,
      'Voting button is not centered alongside the details action on card '+(index+1)+' at '+width+'px');
     assert(card.vote.right+2<=card.details.x,
      'Voting button overlaps other controls on card '+(index+1)+' at '+width+'px');
     assert(card.voteLabel?.includes('голосования'),
      'Voting action lacks an accessible label');
    }
   }
   const rows=new Map();
   for(const item of result.cards){
    const top=Math.round(item.card.y/4)*4;
    if(!rows.has(top))rows.set(top,[]);
    rows.get(top).push(item.card.bottom);
   }
   for(const bottoms of rows.values())
    assert(Math.max(...bottoms)-Math.min(...bottoms)<=3,
     'Card bottoms in the same grid row are not aligned at '+width+'px');
   if([1440,1024,390].includes(width)){
    await frame.locator('.stageAtlasGrid').screenshot({
     path:path.join(shotDir,'stages-'+width+'.png'),animations:'disabled'
    });
   }
   console.log('PASS '+width+'px: 16 cards, no clipping, aligned buttons'+
    ', vote button and accessibility checks');
  }
 }finally{await browser.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1});
