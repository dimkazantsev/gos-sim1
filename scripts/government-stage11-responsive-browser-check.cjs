'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright-core');
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&fs.existsSync(p));
if(!chrome)throw Error('Chrome is required for government meeting layout verification');
const css=['app/design-tokens.css','app/globals.css','app/2026-october-refinement.css'].map(p=>fs.readFileSync(p,'utf8')).join('\n');
const html=`<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>
<main style="max-width:1480px;margin:auto;padding:12px">
<section class="govSessionLab"><div class="govMeetingFlow">
<div><span>01</span><strong>Подготовка повестки</strong><small>Из согласованных ГП</small></div>
<div><span>02</span><strong>Утверждение</strong><small>Председателем Правительства</small></div>
<div><span>03</span><strong>Доклад и вопросы</strong><small>На заседании</small></div>
<div><span>04</span><strong>Решение</strong><small>Голосование и публикация</small></div></div>
<section class="govMeetingAgendaCard"><div class="govMeetingAgendaHead"><div><span class="govEyebrow">Официальный документ · Заседание № 1</span><h3>Повестка заседания Правительства</h3>
<p>2 государственные программы · 60 минут. Утверждена Председателем Правительства.</p></div><div class="govMeetingAgendaHeadActions"><button class="secondary">Открыть документ</button><button class="secondary">Обновить</button></div></div>
<div class="govMeetingAgendaActions"><div><strong>Повестка утверждена</strong><small>Председательствующий</small></div><button class="primary">Открыть заседание</button></div></section>
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
 buttons:[...document.querySelectorAll('.govSessionLab button')].map(el=>({height:el.getBoundingClientRect().height,right:el.getBoundingClientRect().right,left:el.getBoundingClientRect().left}))
 }));
 assert(m.scroll<=m.viewport+2,'Horizontal overflow at '+width+': '+JSON.stringify(m));
 assert(m.box.every(b=>b.left>=-1&&b.right<=width+1),'Panels outside viewport at '+width);
 assert(m.buttons.every(b=>b.height>=42&&b.left>=-1&&b.right<=width+1),'Unsafe controls at '+width);
 await page.close();console.log('PASS: government-stage11 responsive '+width+'px');
}}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});