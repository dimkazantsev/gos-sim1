const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..');
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser','/opt/google/chrome/chrome'].find(x=>x&&fs.existsSync(x));
if(!chrome)throw Error('Chrome/Chromium executable is required');
const styles=fs.readFileSync(path.join(root,'app/stage7-election.css'),'utf8')+'\n'+fs.readFileSync(path.join(root,'app/stage6-election-workspace.css'),'utf8');
const card=(num,title,content)=>'<section class="stage7Panel stage6VoteCard"><div class="stage7PanelHead stage6CardHead"><div><small>'+num+' · ПОДГОТОВКА</small><h3>'+title+'</h3><p>Студенты выбирают правила президентских выборов.</p></div><span class="stage6CardIcon">✓</span></div>'+content+'</section>';
const date=card('01','Назначение трёх дней выборов','<div class="pollCreate"><label>Первый день выборов<input type="date"></label><button class="primary">Назначить три дня выборов</button></div>');
const vote=card('02','Избирательная система','<div class="pollCreate"><label>Система<select><option>Квалифицированное большинство</option></select></label><button class="primary">Проголосовать лично</button></div>');
const poll=card('03','Нужен ли социологический опрос?','<div class="pollDecision"><p>За: 18; Против: 22</p><div class="pollChoice"><button>За</button><button>Против</button></div></div>');
const confirm=card('04','Применить результаты личного голосования','<button class="primary">Зафиксировать решение студентов</button>');
const html='<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>'+
':root{--text:#142544;--navy:#0b234a;--body:#33486d;--muted:#687995;--line:#d8e1ee;--shadow:0 10px 30px rgba(22,43,82,.08)}'+
'*{box-sizing:border-box}body{margin:0;padding:12px;font:14px system-ui,Arial;color:var(--text);background:#f4f7fd}button,input,select{font:inherit}button{background:#315efb;color:#fff;border:0}'+styles+'</style></head><body>'+
'<main class="stageOperations" data-stage="6" style="min-width:0"><section class="presSystemDecision presStage6">'+
'<header class="stage6Intro"><small>ЭТАП 6 · ПОДГОТОВКА ВЫБОРОВ</small><h3>Порядок выборов Президента Российской Федерации</h3>'+
'<p>Совет Федерации назначает даты выборов. Студенты определяют систему и необходимость опроса.</p></header>'+
'<div class="stage7Grid stage6ElectionGrid">'+date+vote+poll+confirm+'</div></section></main></body></html>';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  for(const width of [1440,1024,900,780,750,680,520,420,390,360,320]){
   const page=await browser.newPage({viewport:{width,height:1000},deviceScaleFactor:1});
   await page.setContent(html,{waitUntil:'load'});
   const r=await page.evaluate(()=>{
    const root=document.querySelector('.presStage6'),cards=[...root.querySelectorAll('.stage6VoteCard')];
    const boxes=cards.map(c=>{const b=c.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width}});
    const actions=[...root.querySelectorAll('.pollCreate button,.stage6VoteCard>button')].map(x=>x.getBoundingClientRect().toJSON());
    const input=root.querySelector('input[type="date"]').getBoundingClientRect().toJSON();
    return {scroll:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth,rootWidth:root.clientWidth,rootScroll:root.scrollWidth,boxes,actions,input};
   });
   assert(r.scroll<=r.viewport+2,'Page horizontal overflow at '+width);
   assert(r.rootScroll<=r.rootWidth+2,'Workspace horizontal overflow at '+width);
   assert.equal(r.boxes.length,4);
   for(const b of r.boxes)assert(b.width>=225,'Card too narrow at '+width+': '+b.width);
   for(const a of r.actions){
    assert(r.boxes.some(b=>a.x>=b.left-1&&a.x+a.width<=b.right+1),'Action exceeds card at '+width);
    assert(a.width>=130,'Button too narrow at '+width);
   }
   if(width<750)assert(r.boxes[1].top>=r.boxes[0].bottom-2,'Single column expected at '+width);
   if(width>=900)assert(Math.abs(r.boxes[1].top-r.boxes[0].top)<=2,'Two columns expected at '+width);
   assert(r.actions[0].y>=r.input.y+r.input.height-1,'Date input/action overlap at '+width);
   await page.close();
  }
  console.log('PASS 11 viewport widths 320–1440: no overflow, date overlap or collapsed action controls.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
