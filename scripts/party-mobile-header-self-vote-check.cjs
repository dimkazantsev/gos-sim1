/* Regression: mobile party header proportions and voluntary personal chair votes. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright-core');
const source=fs.readFileSync('components/game/PartyChairElection.tsx','utf8');
const sql=fs.readFileSync('supabase/migrations/20261024011500_party_chair_early_self_vote.sql','utf8');
const cssPath='app/party-mobile-header-compact.css';
const layout=fs.readFileSync('app/layout.tsx','utf8');
assert(layout.includes("import './party-mobile-header-compact.css'"),'Compact header style must be loaded after global views');
assert(source.includes('Проголосовать за себя'),'Personal vote action must be visible');
assert(source.includes('cast(me.user_id)'),'Self vote must target authenticated member');
assert(source.includes("const ready=members.length>=1"),'A single member must be able to vote');
assert(sql.includes('v_members>=2 and v_votes>=v_members'),'No election with one member');
assert(sql.includes("pi.status='pending'"),'Pending invitations block result');
assert(sql.includes('v_uid uuid:=auth.uid()'),'Voter authenticated on server');
assert(sql.includes('candidate_id=excluded.candidate_id'),'Changing votes remains possible');
assert(!sql.includes("if (select count(*) from public.game_members gm where gm.game_id=p.game_id and gm.kind='student' and gm.team=p.name and gm.roster_archived_at is null)<2 then"),'No solo vote submission rejection');
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>p&&fs.existsSync(p));
if(!chrome)throw Error('Chrome/Chromium required');
const styles=['app/globals.css','app/design-views.css','app/2026-civic-portal.css','app/2026-stage-party-grades-repair.css',cssPath]
 .map(p=>fs.readFileSync(p,'utf8')).join('\n');
const markup='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+
 '*{box-sizing:border-box}body{margin:0;background:#f5f7fc}.partyPage{min-height:690px;width:100%;padding:10px}'+styles+
 '</style></head><body><main class="partyPage civicParties">'+
 '<header class="pageHeader"><div><h1>Партии и фракции</h1><p>Публичные программы, партийные документы, руководство и состав.</p></div><span class="gosPartyStageBadge isActive">Этап 01 открыт</span></header>'+
 '<input class="civicPartySearch" placeholder="Поиск партий" aria-label="Поиск партий">'+
 '<section class="civicPartyTiles"><article class="civicPartyTile"><button class="civicPartyTileSelect"><span>П</span><span>Учебная партия</span></button></article></section>'+
 '</main></body></html>';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  for(const width of [320,390,428,650,768,1280]){
   const page=await browser.newPage({viewport:{width,height:920}});
   await page.setContent(markup);
   const m=await page.evaluate(()=>{
    const r=sel=>{const q=document.querySelector(sel).getBoundingClientRect();return{top:q.top,bottom:q.bottom,left:q.left,right:q.right,height:q.height}};
    return {header:r('.pageHeader'),heading:r('.pageHeader h1'),paragraph:r('.pageHeader p'),badge:r('.gosPartyStageBadge'),search:r('.civicPartySearch'),tiles:r('.civicPartyTiles'),overflow:document.documentElement.scrollWidth-innerWidth};
   });
   assert(m.overflow<=2,'No horizontal overflow at '+width+': '+JSON.stringify(m));
   if(width<=700){
    assert(m.header.height<275,'Oversized header at '+width+': '+m.header.height);
    assert(m.badge.top>=m.paragraph.bottom-1,'Stage badge must follow heading at '+width);
    assert(m.header.bottom-m.badge.bottom<32,'No gap under badge at '+width);
    assert(m.search.top-m.header.bottom<44,'Search stays near header at '+width);
    assert(m.tiles.top-m.header.bottom<150,'Party tiles follow header at '+width);
   }
   if(width===390)await page.screenshot({path:'/tmp/gos-party-hero-mobile.png',fullPage:true});
   await page.close();
  }
  console.log('PASS Party responsive hero 320-1280px + safe early self-voting gate');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
