const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright-core');
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>p&&fs.existsSync(p));
if(!chrome)throw Error('Chromium required for desktop/tablet/phone visual regression');
const css=['app/2026-stage-system.css','app/stage-operations.css'].map(p=>fs.readFileSync(p,'utf8')).join('\n');
const html=`<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:#f2f5fa}
${css}
</style></head><body><div class="stageOperations" style="padding:12px">
<article class="gov8AgendaRow is-vote_open">
 <span class="gov8AgendaIndex">01</span>
 <div class="gov8AgendaMain"><small>Председатель Правительства Российской Федерации</small>
  <div class="gov8AgendaNameRow"><b>Тестов Тест Тестович</b></div>
  <span>Попытка 1/3 · Голосование открыто</span>
 </div>
 <div class="gov8AgendaActions">
  <div class="gov8AgendaLinks">
   <button class="gov8LinkButton">Документ</button><button class="gov8LinkButton">Реестр НПА</button>
   <button class="gov8LinkButton">Голосование</button><button class="gov8LinkButton">Политический процесс</button>
  </div>
  <div class="gov8AgendaControls">
   <button class="primary gov8AgendaCta">Перейти к голосованию</button>
   <button class="gov8RemoveNomination" aria-label="Снять кандидатуру Тестов Тест Тестович"><svg width="17" height="17"></svg><span>Снять</span></button>
  </div>
 </div>
</article></div></body></html>`;
function overlaps(a,b){
 return a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1;
}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  for(const width of [320,375,430,540,768,1024,1440]){
   const page=await browser.newPage({viewport:{width,height:800}});
   await page.setContent(html);
   const metrics=await page.evaluate(()=>{
    const sel=k=>document.querySelector(k), box=k=>{const r=sel(k).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
    return {card:box('.gov8AgendaRow'),name:box('.gov8AgendaNameRow b'),
     links:box('.gov8AgendaLinks'),controls:box('.gov8AgendaControls'),
     vote:box('.gov8AgendaCta'),remove:box('.gov8RemoveNomination'),
     scroll:document.documentElement.scrollWidth,viewport:window.innerWidth,
     removalLabel:sel('.gov8RemoveNomination').getAttribute('aria-label')};
   });
   for(const key of ['name','links','controls','vote','remove']){
    assert(metrics[key].left>=metrics.card.left-1, key+' exits left of card at '+width);
    assert(metrics[key].right<=metrics.card.right+2,key+' exits right of card at '+width);
   }
   assert(!overlaps(metrics.remove,metrics.name),'Destructive button overlaps candidate name at '+width);
   assert(!overlaps(metrics.remove,metrics.vote),'Destructive button overlaps voting action at '+width);
   assert(!overlaps(metrics.remove,metrics.links),'Destructive button overlaps links at '+width);
   assert(metrics.remove.height>=42,'Touch target must be usable at '+width);
   assert(metrics.scroll<=metrics.viewport+2,'No horizontal page overflow at '+width);
   assert(metrics.removalLabel.startsWith('Снять кандидатуру'),'Button has clear accessible name');
   await page.close();
   console.log('PASS Stage8/9 agenda controls at '+width+'px');
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
