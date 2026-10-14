/* Regression: dense student action logs must not overlap at any viewport. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright-core');
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(s=>s&&fs.existsSync(s));
if(!chrome)throw Error('Chrome/Chromium is required for the journal layout test');
const journal=fs.readFileSync('components/game/ClassroomJournal.tsx','utf8');
for(const name of ['gosJournalRecord','gosJournalRecordTime','gosJournalRecordBody','gosJournalRecordAuthor','gosJournalRecordSection','gosJournalRecordAction'])
 assert(journal.includes(name),'Live journal component must still render '+name);
const css=[
 'app/teacher-operations.css',
 'app/teacher-ui-polish.css',
 'app/2026-october-refinement.css',
 'app/journal-mobile-isolated.css',
 'app/2026-stage-party-grades-repair.css',
 'app/2026-profile-grade-layout.css'
].map(p=>fs.readFileSync(p,'utf8')).join('\n');
const escaped=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const rows=Array.from({length:50},(_,i)=>{
 const fullName=i%3===0?'Тестов Тест Тестович':'Петрова Александра Александровна';
 const section=i%4===0?'Политический процесс':'Обзор игры';
 const action=i%5===0?'Перешёл в раздел «Мой профиль» и ознакомился с доступными полномочиями':'Перешёл в раздел «Обзор игры»';
 return '<article class="gosJournalRecord">'+
   '<time class="gosJournalRecordTime" datetime="2026-10-15T03:47:00">15 окт., 03:47</time>'+
   '<div class="gosJournalRecordBody">'+
    '<strong class="gosJournalRecordAuthor">'+escaped(fullName)+'</strong>'+
    '<span class="gosJournalRecordSection">'+escaped(section)+'</span>'+
    '<p class="gosJournalRecordAction">'+escaped(action)+'</p>'+
   '</div></article>';
}).join('');
const markup='<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+
 '*{box-sizing:border-box}body{margin:0;font:14px Arial,sans-serif;background:#f6f8fd}'+
 '.classroomJournal{width:100%;max-width:1120px;margin:0 auto;padding:16px;min-width:0;background:white}'+
 css+'</style></head><body><section class="classroomJournal">'+
 '<header class="journalHeader"><div><small>АКТИВНОСТЬ И ПРИСУТСТВИЕ</small><h2>Мой журнал действий</h2><p>Ваши действия и переходы по разделам игры.</p></div></header>'+
 '<div class="journalFeed" role="region" aria-label="Записи журнала">'+rows+'</div></section></body></html>';
function overlap(a,b){return Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox']});
 try {
  const page=await browser.newPage();
  for(const width of [320,390,430,650,768,1024,1440]){
   await page.setViewportSize({width,height:720});
   await page.setContent(markup,{waitUntil:'domcontentloaded'});
   const metrics=await page.evaluate(()=>{
    const feed=document.querySelector('.journalFeed');
    const feedBox=feed.getBoundingClientRect();
    const records=[...feed.querySelectorAll('.gosJournalRecord')];
    const box=el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height}};
    const results=records.slice(0,15).map(node=>{
      const row=box(node),time=box(node.querySelector('time')),author=box(node.querySelector('.gosJournalRecordAuthor'));
      const section=box(node.querySelector('.gosJournalRecordSection')),action=box(node.querySelector('.gosJournalRecordAction'));
      const content=box(node.querySelector('.gosJournalRecordBody'));
      return {row,time,author,section,action,content};
    });
    return {
      feed:box(feed),feedDisplay:getComputedStyle(feed).display,
      scrollHeight:feed.scrollHeight,clientHeight:feed.clientHeight,
      rowsCount:records.length,
      shrink:getComputedStyle(records[0]).flexShrink,
      all:results,bodyWidth:document.documentElement.scrollWidth
    };
   });
   assert.equal(metrics.rowsCount,50,'All 50 events render at '+width);
   assert.equal(metrics.feedDisplay,'flex','The journal uses a non-compressing column layout');
   assert.equal(metrics.shrink,'0','Record flex-shrink must remain disabled');
   assert(metrics.scrollHeight>metrics.clientHeight,'The feed scrolls rather than squashing 50 events');
   assert(metrics.bodyWidth<=width+2,'No horizontal page overflow at '+width);
   for(let i=0;i<metrics.all.length;i++){
    const row=metrics.all[i];
    assert(row.row.height>=65,'Journal row compressed at '+width+' / '+i+': '+JSON.stringify(row));
    assert(row.row.bottom>=row.action.bottom-1,'Action lies outside its row '+width+' / '+i);
    assert(row.section.top>=row.author.bottom-1,'Name and category overlap at '+width+' / '+i);
    assert(row.action.top>=row.section.bottom-1,'Category and action overlap at '+width+' / '+i);
    assert(row.content.left>=row.row.left-1&&row.content.right<=row.row.right+1,'Content escapes row '+width+' / '+i);
    if(i>0)assert(metrics.all[i-1].row.bottom<=row.row.top+1,'Consecutive journal records overlap at '+width+' / '+i);
   }
   const scrolled=await page.evaluate(()=>{
    const feed=document.querySelector('.journalFeed');
    feed.scrollTop=feed.scrollHeight;
    const all=[...feed.querySelectorAll('.gosJournalRecord')];
    const a=all[all.length-2].getBoundingClientRect(),b=all[all.length-1].getBoundingClientRect();
    return {lastTop:b.top,penultimateBottom:a.bottom,actualScroll:feed.scrollTop};
   });
   assert(scrolled.actualScroll>0,'Journal should scroll to older events');
   assert(scrolled.lastTop>=scrolled.penultimateBottom-1,'Older journal rows overlap after scroll at '+width);
   console.log('PASS journal records '+width+'px / 50 rows / no overlap / scroll');
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
