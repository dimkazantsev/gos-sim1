'use strict';
/* Isolated responsive regression: real StageModuleHeader CSS and fictional data. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..');
const css=fs.readFileSync(path.join(root,'components/ui/StageModuleHeader.module.css'),'utf8');
const component=fs.readFileSync(path.join(root,'components/ui/StageModuleHeader.tsx'),'utf8');
assert(component.includes('styles.stats')&&component.includes('stats.map('),'Shared header renders KPI cards');
assert(css.includes('.header:not(.government) .stats>div{justify-content:flex-start}'),'KPI cards align to the top');
assert(css.includes('.header:not(.government) .stats dt{min-height:3em}'),'Label row reserves equal height');
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>p&&fs.existsSync(p));
if(!chrome)throw Error('Chrome/Chromium executable required');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  for(const width of [320,390,768,1024,1440]){
   const page=await browser.newPage({viewport:{width,height:900},deviceScaleFactor:1});
   try{
    await page.setContent('<!DOCTYPE html><html lang="ru"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#f6f8ff}'+css+'</style><header class="header"><div class="copy"><span class="eyebrow">Этап 16 · Рефлексия</span><h2>Разбор построенного государства</h2><p>Восстановите решения и последствия.</p></div><dl class="stats"><div><dt>Завершённые этапы</dt><dd data-numeric="true">3 / 16</dd></div><div><dt>Рефлексии участников</dt><dd data-numeric="true">0 / 2</dd><span>Сдали все шесть разделов</span></div></dl></header><header class="header government"><div class="copy">Правительственный модуль</div><dl class="stats"><div><dt>Регистрация</dt><dd data-numeric="true">2 / 3</dd></div></dl></header>');
    const result=await page.locator('header.header').first().evaluate(el=>{
     const box=x=>x.getBoundingClientRect();
     const cards=[...el.querySelectorAll('.stats>div')].map(card=>{
      const r=box(card),dt=box(card.querySelector('dt')),dd=box(card.querySelector('dd'));
      return {y:r.y,titleY:dt.y,valueY:dd.y,relativeTitleY:dt.y-r.y,relativeValueY:dd.y-r.y,justify:getComputedStyle(card).justifyContent};
     });
     return {cards,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1};
    });
    const cards=result.cards;
    assert(!result.overflow,width+'px: horizontal overflow');
    assert(cards.every(c=>c.justify==='flex-start'),width+'px: top alignment');
    assert(Math.abs(cards[0].relativeTitleY-cards[1].relativeTitleY)<1.1,width+'px: mismatched title padding');
    assert(Math.abs(cards[0].relativeValueY-cards[1].relativeValueY)<1.1,width+'px: mismatched counter line');
    if(Math.abs(cards[0].y-cards[1].y)<1.1){
     assert(Math.abs(cards[0].titleY-cards[1].titleY)<1.1,width+'px: labels not aligned');
     assert(Math.abs(cards[0].valueY-cards[1].valueY)<1.1,width+'px: values not aligned');
    }
    assert.equal(await page.locator('header.government .stats>div').evaluate(el=>getComputedStyle(el).display),'grid','Government variant preserved');
    console.log('PASS Stage 16 summary alignment at '+width+'px');
   }finally{await page.close();}
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});