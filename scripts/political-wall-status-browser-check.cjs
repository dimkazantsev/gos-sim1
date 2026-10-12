/* Browser regression for status badges in the real PoliticalWallView CSS/DOM.
   Uses offline design preview; does not connect to production or delete data. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..');
const preview=path.join(root,'.design-review','gos-sim-preview.html');
const screenshots=path.join(root,'.design-review','screenshots');
const executable=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser']
 .find(p=>p&&fs.existsSync(p));
if(!executable)throw Error('Chromium is required for political post header regression');
if(!fs.existsSync(preview))throw Error('Run npm run design:preview first');
fs.mkdirSync(screenshots,{recursive:true});

const rect=node=>{
 const r=node.getBoundingClientRect();
 return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};
};
async function run(){
 const browser=await chromium.launch({headless:true,executablePath:executable,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const page=await browser.newPage({viewport:{width:1550,height:980},deviceScaleFactor:1});
  await page.goto('file://'+preview,{waitUntil:'load'});
  const frame=page.frameLocator('#preview');
  const statuses=['Опубликовано','Принято','Отклонено'];
  for(const mode of ['standard','bulk']){
   for(const width of [1440,1024,768,651,650,430,390,360,320]){
    await page.locator('#screen').selectOption('actions');
    await page.locator('#preview').evaluate((el,value)=>{el.style.width=value+'px'},width);
    await frame.locator('.wallFeed > .wallPost').first().waitFor();
    await frame.locator('.wallFeed').evaluate((feed,args)=>{
     const {statuses,mode}=args;
     [...feed.querySelectorAll(':scope > .wallPost')].slice(0,3).forEach((post,i)=>{
      const who=post.querySelector('.wallPostWho');
      who.querySelector('b').textContent=i===0
       ?'Министерство экономического развития Российской Федерации — департамент межведомственной координации'
       :i===1?'ОченьДлинноеНазваниеФедеральногоОрганаИсполнительнойВластиРоссийскойФедерации'
       :'Совет Федерации Федерального Собрания Российской Федерации';
      who.querySelector('small').textContent='Официальная публикация государственного органа · 12.10.2026, 16:05';
      const badge=post.querySelector('.postStatus');
      badge.textContent=statuses[i];badge.className='postStatus '+['published','accepted','rejected'][i];
      if(mode==='bulk'){
       post.classList.add('bulkSelecting');
       const selector=document.createElement('label');
       selector.className='wallBulkPostSelect';
       const check=document.createElement('input');check.type='checkbox';
       selector.append(check);post.querySelector('header').prepend(selector);
      }
     });
    },{statuses,mode});
    await frame.locator('.wallFeed').evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const measurements=await frame.locator('.wallFeed').evaluate(feed=>{
     const size=node=>{
      const r=node.getBoundingClientRect();
      return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};
     };
     const posts=[...feed.querySelectorAll(':scope > .wallPost')].slice(0,3);
     return posts.map(post=>{
      const head=post.querySelector('header');
      const who=head.querySelector('.wallPostWho');
      const badge=head.querySelector('.postStatus');
      const avatar=head.querySelector('.wallPostAvatar');
      const checkbox=head.querySelector('.wallBulkPostSelect');
      const small=who.querySelector('small');
      return {head:size(head),post:size(post),who:size(who),badge:size(badge),avatar:size(avatar),
       small:size(small),check:checkbox?size(checkbox):null,
       grid:getComputedStyle(head).gridTemplateAreas,
       status:badge.textContent.trim(),
       overflowing:head.scrollWidth-head.clientWidth};
     });
    });
    assert.equal(measurements.length,3,'Preview should show all three status variations');
    for(const [i,r] of measurements.entries()){
     const context=mode+' '+width+'px '+r.status+' '+JSON.stringify(r);
     assert(r.overflowing<=2,'Header content overflow: '+context);
     assert(r.badge.width>20&&r.badge.height>14,'Badge is invisible: '+context);
     assert(r.badge.left>=r.head.left-2&&r.badge.right<=r.head.right+2,'Badge escapes header: '+context);
     assert(r.who.left>=r.head.left-2&&r.who.right<=r.head.right+2,'Author escapes header: '+context);
     assert(r.avatar.right<=r.who.left+1,'Avatar collides with author: '+context);
     assert(r.who.width>15,'Author has no useful width: '+context);
     if(width<=650){
      assert(r.badge.top>=r.who.bottom-2,'Mobile status must be beneath author: '+context);
      assert(Math.abs(r.badge.left-r.who.left)<=3,'Mobile status must align with author: '+context);
     }else{
      assert(r.badge.left>=r.who.right-2,'Desktop status overlaps author: '+context);
     }
     if(mode==='bulk'){
      assert(r.check,'Teacher selection checkbox missing: '+context);
      assert(r.check.right<=r.avatar.left+2,'Checkbox collides with avatar: '+context);
      assert(/select/.test(r.grid),'Explicit bulk grid slot missing: '+context);
     }else{
      assert(!r.check,'Unexpected checkbox in standard mode: '+context);
     }
    }
    if([1440,390].includes(width)){
     await frame.locator('.wallFeed > .wallPost').first().screenshot({
      path:path.join(screenshots,'process-post-header-'+mode+'-'+width+'.png'),animations:'disabled'
     });
    }
    console.log('PASS political post header '+mode+' '+width+'px: statuses, long labels, no overlap');
   }
  }
 }finally{await browser.close()}
}
run().catch(e=>{console.error(e);process.exitCode=1});
