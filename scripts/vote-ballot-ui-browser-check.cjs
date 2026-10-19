const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..');
require.extensions['.tsx']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
 fileName:file
}).outputText,file);
const Ballot=require('../components/game/VoteBallotControls.tsx').default;
const src=fs.readFileSync(path.join(root,'components/game/VoteBallotControls.tsx'),'utf8');
const css=fs.readFileSync(path.join(root,'app/vote-ballot-panel.css'),'utf8');
const layout=fs.readFileSync(path.join(root,'app/layout.tsx'),'utf8');
assert(layout.includes("import './vote-ballot-panel.css';"),'CSS must be imported in the application');
assert(src.includes('setPartial(e.target.checked);setSplit(false)'),'Quantity mode must disable split');
assert(src.includes('setSplit(e.target.checked);if(e.target.checked)setPartial(false)'),'Split must disable quantity mode');
assert(src.includes('total>0&&total<=maxWeight'),'Combined split votes must stay inside the current cap');
assert(src.includes('integer(amount)&&amount>0&&amount<=maxWeight'),'One-choice votes must use a valid subset of mandates');
assert(src.includes('!canCast||!valid||busy'),'Server voting rules still disable invalid actions');
assert(src.includes('await onSubmit(y,n,a)'),'Ballot submission keeps the established RPC pathway');
assert(css.includes('var(--gs-accent)')&&css.includes('var(--gs-border)'),'Use approved project tokens');
assert(css.includes(':focus-within')&&css.includes('focus')||css.includes(':focus-within'),'Keyboard focus is visible');
const cssBundle=['app/design-tokens.css','app/globals.css','app/design-views.css','app/2026-civic-portal.css','app/vote-ballot-panel.css'].map(file=>fs.readFileSync(path.join(root,file),'utf8')).join('\n');
const original=React.useState;
function htmlFor({partial=false,split=false,canCast=true,maxWeight=225}){
 let index=0;const states=[partial,split,maxWeight,Math.floor(maxWeight/3),Math.floor(maxWeight/3),Math.floor(maxWeight/3),false];
 React.useState=(initial)=>[states[index++]??initial,()=>{}];
 try{
  const rendered=renderToStaticMarkup(React.createElement(Ballot,{
   vote:{voting_mode:'mandate',allow_abstain:true},maxWeight,canCast,onSubmit:async()=>true
  }));
  return '<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+cssBundle+'</style></head><body><main class="civicVotes" style="padding:12px;max-width:1500px;margin:auto"><div class="proceduralVoteActions">'+rendered+'</div></main></body></html>';
 }finally{React.useState=original}
}
assert.match(htmlFor({}),/Доступные депутатские голоса/);
assert.match(htmlFor({partial:true}),/Количество голосов/);
assert.match(htmlFor({split:true}),/Распределено/);
assert.match(htmlFor({}),/За/);
assert.match(htmlFor({canCast:false}),/disabled=""/);
const executable=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(x=>x&&fs.existsSync(x));
if(!executable)throw Error('Chromium is required to check actual responsive layout');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:executable,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  for(const mode of ['default','partial','split']){
   for(const width of [320,375,430,768,820,1024,1440]){
    const page=await browser.newPage({viewport:{width,height:900}});
    await page.setContent(htmlFor({partial:mode==='partial',split:mode==='split'}));
    const geo=await page.evaluate(()=>{
     const panel=document.querySelector('.civicBallotModern');
     const selectors=['.civicBallotMode','.civicBallotQuota','.civicBallotAmount input','.civicBallotChoices button','.civicBallotSplitField input','.civicBallotSubmit'];
     const outer=panel.getBoundingClientRect();
     const items=selectors.flatMap(s=>Array.from(panel.querySelectorAll(s))).map(el=>{
      const b=el.getBoundingClientRect();return {tag:el.tagName,cls:el.className,left:b.left,right:b.right,top:b.top,bottom:b.bottom,height:b.height}
     });
     return {outer:{left:outer.left,right:outer.right},view:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,panelOverflow:panel.scrollWidth-panel.clientWidth,items}
    });
    assert(geo.scroll<=geo.view+2,`Horizontal page scroll: ${mode} ${width}px, ${JSON.stringify(geo)}`);
    assert(geo.panelOverflow<=2,`Panel overflow: ${mode} ${width}px`);
    for(const item of geo.items){
     assert(item.left>=geo.outer.left-2&&item.right<=geo.outer.right+2,
      `Control outside panel: ${mode} ${width}px ${JSON.stringify(item)}`);
     if(item.tag==='BUTTON')assert(item.height>=44,`Touch target too small: ${mode} ${width}px`);
    }
    if(mode==='partial')assert(geo.items.some(x=>x.tag==='INPUT'),'The quantity input is visible');
    if(mode==='split')assert(geo.items.filter(x=>x.tag==='INPUT').length>=3,'Split has three inputs');
    await page.close();
    console.log('PASS: '+mode+' ballot at '+width+'px');
   }
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
