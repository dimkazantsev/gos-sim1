'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright-core');
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&fs.existsSync(p));
if(!chrome)throw Error('Chrome is required for government meeting layout verification');
const css=['app/design-tokens.css','app/globals.css','app/2026-october-refinement.css','components/ui/StageModuleHeader.module.css'].map(p=>fs.readFileSync(p,'utf8')).join('\n');
const html=`<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>
<main style="max-width:1480px;margin:auto;padding:12px">
<section class="govSessionLab"><header class="header government" data-stage-module-head>
<div class="copy"><span class="eyebrow">Этап 11 · Правительство Российской Федерации</span><h2>Рассмотрение государственных программ</h2><p>Проекты Этапа 10 автоматически включаются в повестку.</p></div>
<dl class="stats"><div><dt>Государственные программы</dt><dd data-numeric="true">1</dd></div><div><dt>Повестка</dt><dd>Не создана</dd></div></dl>
</header><div class="govMeetingFlow">
<div><span>01</span><strong>Подготовка повестки</strong><small>Из согласованных ГП</small></div>
<div><span>02</span><strong>Утверждение</strong><small>Председателем Правительства</small></div>
<div><span>03</span><strong>Доклад и вопросы</strong><small>На заседании</small></div>
<div><span>04</span><strong>Решение</strong><small>Голосование и публикация</small></div></div>
<section class="govMeetingAgendaCard"><div class="govMeetingAgendaHead"><div><span class="govEyebrow">Официальный документ · Заседание № 1</span><h3>Повестка заседания Правительства</h3>
<p>2 государственные программы · 60 минут. Утверждена Председателем Правительства.</p></div><div class="govMeetingAgendaHeadActions"><button class="secondary">Открыть документ</button><button class="secondary">Обновить</button></div></div>
<div class="govMeetingAgendaActions"><div><strong>Повестка ожидает утверждения</strong><small>Председательствующий</small></div><button class="govMeetingRefreshPrograms secondary" aria-label="Обновить список государственных программ"><svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M20 6v6h-6M4 18v-6h6" fill="none" stroke="currentColor" stroke-width="2"/></svg><span>Обновить список ГП</span></button><button class="primary">Утвердить повестку</button></div></section>
<section class="govMeetingProgrammeList"><div class="govMeetingListHeader"><h3>Государственные программы в повестке</h3><p>Доклад → вопросы → голосование</p></div>
<article class="govMeetingProgramme govMeetingProgramme-presenting"><header><span class="govMeetingProgrammeNo">01</span><div><span class="govEyebrow">Министерство по экономической политике</span><h4>Программа повышения доступности государственных услуг</h4><p>Докладчик: министр · 7 минут</p></div><strong class="govMeetingProgrammeStatus">Доклад и вопросы</strong></header>
<div class="govMeetingSpeakerQuestions"><div class="govMeetingSpeakerHead"><div><h5>Вопросы к докладчику</h5><p>Перед голосованием необходимо ответить на вопросы.</p></div><span>2 вопроса</span></div><div class="govMeetingSpeakerInput"><label>Задать вопрос выступающему<textarea rows="2"></textarea></label><button>Отправить вопрос</button></div>
<div class="govMeetingSpeakerFinish"><small>Ответы завершены.</small><button class="primary">Завершить вопросы и открыть голосование</button></div></div>
<div class="govMeetingProgrammeActions"><button class="primary">Участвовать в голосовании</button></div></article></section></section></main></body></html>`;
(async()=>{const browser=await chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});try{
for(const width of [320,375,430,768,1024,1440]){
 const page=await browser.newPage({viewport:{width,height:900},deviceScaleFactor:1});await page.setContent(html,{waitUntil:'load'});
 const m=await page.evaluate(()=>({
 scroll:document.documentElement.scrollWidth,viewport:innerWidth,
 box:[...document.querySelectorAll('.govMeetingFlow,.govMeetingAgendaCard,.govMeetingProgramme,.govMeetingSpeakerQuestions')].map(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right})),
 buttons:[...document.querySelectorAll('.govSessionLab button')].map(el=>({height:el.getBoundingClientRect().height,right:el.getBoundingClientRect().right,left:el.getBoundingClientRect().left})),
 metrics:[...document.querySelectorAll('[data-stage-module-head] .stats>div')].map(card=>{
   const label=card.querySelector('dt'),value=card.querySelector('dd'),detail=card.querySelector('span');
   const l=label.getBoundingClientRect(),v=value.getBoundingClientRect(),c=card.getBoundingClientRect(),d=detail?.getBoundingClientRect();
   const fits=el=>el.scrollWidth<=el.clientWidth+2&&el.scrollHeight<=el.clientHeight+2;
   return {labelRight:l.right,valueLeft:v.left,labelTop:l.top,labelBottom:l.bottom,valueTop:v.top,valueBottom:v.bottom,cardLeft:c.left,cardRight:c.right,cardHeight:c.height,detailTop:d?.top??null,detailFits:detail?fits(detail):true,labelFits:fits(label),valueFits:fits(value)};
 }),
 summary:(()=>{const el=document.querySelector('[data-stage-module-head] .stats');const r=el.getBoundingClientRect();return {height:r.height,left:r.left,right:r.right}})(),
 refresh:(()=>{const btn=document.querySelector('.govMeetingRefreshPrograms'),ico=btn.querySelector('svg'),label=btn.querySelector('span');const b=btn.getBoundingClientRect(),i=ico.getBoundingClientRect(),t=label.getBoundingClientRect();return {height:b.height,width:b.width,btnLeft:b.left,btnRight:b.right,iconCenter:(i.top+i.bottom)/2,labelCenter:(t.top+t.bottom)/2,iconRight:i.right,labelLeft:t.left,wraps:label.getClientRects().length>1,style:getComputedStyle(btn).display};})()
 }));
 assert(m.scroll<=m.viewport+2,'Horizontal overflow at '+width+': '+JSON.stringify(m));
 assert(m.box.every(b=>b.left>=-1&&b.right<=width+1),'Panels outside viewport at '+width);
 assert(m.buttons.every(b=>b.height>=42&&b.left>=-1&&b.right<=width+1),'Unsafe controls at '+width);
 assert(m.metrics.length===2,'Two Stage 11 summary rows expected at '+width);
 assert(m.metrics.every(v=>v.labelRight+6<=v.valueLeft),'Summary label overlaps value at '+width+': '+JSON.stringify(m.metrics));
 assert(m.metrics.every(v=>v.cardLeft>=-1&&v.cardRight<=width+1&&v.labelFits&&v.valueFits&&v.detailFits),'Summary row clipped at '+width+': '+JSON.stringify(m.metrics));
 assert(m.metrics.every(v=>v.detailTop===null||v.detailTop>=Math.max(v.labelBottom,v.valueBottom)),'Summary supporting text overlaps at '+width);
 assert(m.metrics.every(v=>v.cardHeight<=110),'Oversized empty summary row at '+width+': '+JSON.stringify(m.metrics));
 assert(m.summary.height<=185,'Stage 11 summary consumes too much space at '+width+': '+JSON.stringify(m.summary));
 assert(m.summary.left>=-1&&m.summary.right<=width+1,'Stage 11 summary outside viewport at '+width);
 assert(m.refresh.style==='inline-flex'&&m.refresh.height>=44&&m.refresh.height<=58,'Refresh control must remain a single compact row at '+width+': '+JSON.stringify(m.refresh));
 assert(Math.abs(m.refresh.iconCenter-m.refresh.labelCenter)<=4&&m.refresh.iconRight+4<=m.refresh.labelLeft,'Refresh icon must remain beside label at '+width+': '+JSON.stringify(m.refresh));
 assert(!m.refresh.wraps&&m.refresh.btnLeft>=-1&&m.refresh.btnRight<=width+1,'Refresh label must fit every viewport at '+width+': '+JSON.stringify(m.refresh));
 for(const status of ['На согласовании','Утверждена']){
   await page.locator('[data-stage-module-head] .stats>div:last-child dd').evaluate((el,text)=>{el.textContent=text},status);
   const layout=await page.evaluate(()=>{
     const parent=document.querySelector('[data-stage-module-head] .stats>div:last-child'),l=parent.querySelector('dt'),v=parent.querySelector('dd');
     const lr=l.getBoundingClientRect(),vr=v.getBoundingClientRect(),cr=parent.getBoundingClientRect();
     return {labelRight:lr.right,valueLeft:vr.left,right:vr.right,cardRight:cr.right,valueFits:v.scrollWidth<=v.clientWidth+2};
   });
   assert(layout.labelRight+6<=layout.valueLeft&&layout.right<=layout.cardRight+1&&layout.valueFits,'Agenda status collides/clips at '+width+'px / '+status+': '+JSON.stringify(layout));
 }
 await page.close();console.log('PASS: government-stage11 responsive '+width+'px');
}}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});