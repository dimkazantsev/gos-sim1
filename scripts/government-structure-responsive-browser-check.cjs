const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const {chromium}=require('playwright-core');

const component=fs.readFileSync('components/game/GovernmentFormationWorkspace.tsx','utf8');
const parsed=ts.createSourceFile('GovernmentFormationWorkspace.tsx',component,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX);
assert.equal(parsed.parseDiagnostics.length,0,'Government workspace TSX must parse');
assert(component.includes("stageNo===8?'isStructureStage '"),'Scoped Stage 8 layout, Stage 9 unchanged');
assert(component.includes('stageNo===9&&<b>{titles[p.key]}</b>'),'No duplicate title inside Stage 8 cards');
assert(component.includes('<textarea rows={2} disabled={!editable}'),'Keep role-controlled title editing');
assert(component.includes("e.target.value.replace(/\\s*[\\r\\n]+\\s*/g,' ')"),'Pasted line breaks must not corrupt canonical ministry names');
assert(component.includes("onClick={()=>void saveStructure(false)}")&&component.includes("onClick={()=>void saveStructure(true)}"),'Save and presidential submission remain wired');
assert(component.includes("onClick={()=>void reviewStructure('revision')}")&&component.includes("onClick={()=>void reviewStructure('approve')}"),'Presidential approval/revision remain wired');

const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>p&&fs.existsSync(p));
if(!chrome)throw Error('Chromium required for Stage 8 desktop/tablet/mobile regression');
const css=['app/design-tokens.css','app/2026-stage-system.css','app/stage-operations.css'].map(p=>fs.readFileSync(p,'utf8')).join('\n');
const names=[
 ['Социальная политика','Министерство по социальной политике','Труд, демография, культура, образование, здравоохранение'],
 ['Экономическая политика','Министерство по экономической политике','Финансы, налоги, транспорт, энергетика и развитие'],
 ['Внешняя политика','Министерство по внешней политике','Международные отношения и внешнеполитическая координация'],
 ['Оборона и безопасность','Министерство по обороне и внутренней безопасности','Оборона, безопасность государства и силовой блок'],
 ['Внутренняя политика и государство','Министерство по внутренней политике и государству','Общественные организации, национальности, гражданское общество']
];
const cards=names.map(([label,title,scope],i)=>`<article class="gov8MinistryCard route-${i>2?'sf':'duma'}"><header><span>${String(i+1).padStart(2,'0')}</span><div><small>${label}</small></div></header><p>${scope}</p><label class="gov8MinistryTitle">Название министерства<textarea rows="2">${title}</textarea></label></article>`).join('');
const html=`<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
*{box-sizing:border-box}body{margin:0;font:15px/1.5 Arial,sans-serif;background:#f1f4f9}
${css}
</style></head><body><main class="stageOperations" style="padding:12px"><div class="stageOperationsModules"><section class="gov8Ministries isStructureStage"><header class="gov8SectionHead"><div><span class="gov8SectionIcon"></span><div><small>Структура Правительства</small><h3>Названия пяти министерств</h3></div></div><span class="gov8StatusPill">Черновик</span></header><div class="gov8MinistryGrid">${cards}</div><div class="gov8StructureActions"><button class="secondary">Сохранить названия</button><button class="primary">Представить структуру Президенту</button></div></section></div></main></body></html>`;
const eq=(a,b,why)=>assert(Math.abs(a-b)<=2,why+' ('+a+' vs '+b+')');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  for(const width of [1440,1024,768,390,360]){
   const page=await browser.newPage({viewport:{width,height:900},deviceScaleFactor:1});
   await page.setContent(html);
   const data=await page.evaluate(()=>{
    const rect=x=>{const r=x.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
    const cards=[...document.querySelectorAll('.gov8MinistryCard')],buttons=[...document.querySelectorAll('.gov8StructureActions button')];
    return {gridCols:getComputedStyle(document.querySelector('.gov8MinistryGrid')).gridTemplateColumns.split(' ').filter(Boolean).length,
      rows:cards.map(rect),inputs:[...document.querySelectorAll('textarea')].map(el=>({height:el.getBoundingClientRect().height,scrollHeight:el.scrollHeight,visible:el.offsetParent!==null,value:el.value,fontSize:getComputedStyle(el).fontSize})),
      buttons:buttons.map(rect),scroll:document.documentElement.scrollWidth,viewport:innerWidth,
      cardCount:cards.length,buttonCount:buttons.length};
   });
   assert.equal(data.cardCount,5);
   assert.equal(data.buttonCount,2);
   assert.equal(data.gridCols,width>1180?3:width>700?2:1,'Expected responsive ministry grid at '+width);
   assert(data.scroll<=data.viewport+2,'No horizontal overflow at '+width);
   for(const card of data.rows)assert(card.right<=width-10&&card.left>=10,'Card must fit viewport at '+width);
   for(const [i,input]of data.inputs.entries()){
    assert(input.visible&&input.height>=60,'Ministry title '+i+' is readable at '+width);
    assert(input.value===names[i][1],'The complete saved ministry title is present');
    assert(input.scrollHeight<=input.height+6,'Full ministry title should be visible without internal scrolling at '+width+' / card '+i);
   }
   for(const button of data.buttons){assert(button.left>=10&&button.right<=width-10,'Action button fits '+width);assert(button.height>=42,'Touch target height at '+width)}
   if(width===1440){
    eq(data.rows[0].top,data.rows[1].top,'First row aligned');
    eq(data.rows[0].top,data.rows[2].top,'Third card aligned');
    eq(data.rows[3].left,data.rows[0].left,'Fourth card aligned left in column one');
    eq(data.rows[4].left,data.rows[1].left,'Fifth card aligned left in column two');
    eq(data.rows[3].top,data.rows[4].top,'Second row aligned');
   }
   if(width<=700){for(let i=1;i<5;i++)assert(data.rows[i].top>data.rows[i-1].bottom-1,'Cards stack vertically');assert(data.buttons[1].top>=data.buttons[0].bottom-1,'Mobile actions stack');}
   console.log('PASS Stage 8 five ministry cards and buttons at '+width+'px ('+data.gridCols+' columns, no overflow)');
   await page.close();
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});