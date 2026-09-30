/* Regression: all case artwork stays bound to its case, across viewport sizes. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..'),out=path.join(root,'.design-review'),shots=path.join(out,'screenshots');
const originalResolve=Module._resolveFilename;
Module._resolveFilename=function(request,...args){return originalResolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,...args)};
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,file);
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),EventComic=require('../components/game/EventComic').default,EventCaseTile=require('../components/game/EventCaseTile').default;
const {eventSceneFrame}=require('../components/game/eventSceneFrame');
const cases=JSON.parse(fs.readFileSync(path.join(root,'content/events-v2.json'),'utf8'));
assert.equal(cases.length,50);
assert.equal(new Set(cases.map(c=>JSON.stringify(eventSceneFrame(c.case_key,c.comic_scene.scene_id)))).size,50);
assert.equal(eventSceneFrame('bank-curated-v2-13','scene-21').number,13,'Case key wins over a stale scene id');
let css=fs.readFileSync(path.join(root,'app/globals.css'),'utf8').replace(/@import '\.\/([^']+)' layer\(legacy\);/g,(_,file)=>'@layer legacy {'+fs.readFileSync(path.join(root,'app',file),'utf8')+'}');
for(const match of fs.readFileSync(path.join(root,'app/layout.tsx'),'utf8').matchAll(/import ['"]\.\/([^'"]+\.css)['"]/g)){if(match[1]!=='globals.css')css+='\n'+fs.readFileSync(path.join(root,'app',match[1]),'utf8')}
const illustration=c=>renderToStaticMarkup(React.createElement(EventComic,{title:c.title,category:c.category,caseKey:c.case_key,scene:c.comic_scene,silent:true})).replaceAll('/event-comics/',pathToFileURL(path.join(root,'public/event-comics/')).href);
const cards=cases.map(c=>renderToStaticMarkup(React.createElement(EventCaseTile,{item:{...c,id:c.case_key},summary:true,selected:c===cases[12],meta:c.category,onClick:()=>{}})).replaceAll('/event-comics/',pathToFileURL(path.join(root,'public/event-comics/')).href)).join('');
fs.mkdirSync(shots,{recursive:true});const fixture=path.join(out,'event-cards.html');
const detail='<article class="eventBankDetail"><small>'+cases[12].category+'</small><h4>'+cases[12].title+'</h4><p>'+cases[12].situation+'</p><button>Назначить участнику</button></article>';
fs.writeFileSync(fixture,'<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'\nbody{margin:0;padding:16px;box-sizing:border-box;background:#f6f8fc}main{min-width:0}button{font-family:inherit}</style><main class="autoEventBankBody"><div class="eventBankWorkspace"><div class="eventBankTiles">'+cards+'</div>'+detail+'</div></main></html>');
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser','/opt/google/chrome/chrome'].find(p=>p&&fs.existsSync(p));
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const page=await browser.newPage();
  for(const width of [320,390,768,1440]){
   await page.setViewportSize({width,height:1000});await page.goto(pathToFileURL(fixture).href,{waitUntil:'networkidle'});
   const geometry=await page.locator('.eventBankTiles').evaluate(el=>{const tiles=[...el.children],r=el.getBoundingClientRect(),d=document.querySelector('.eventBankDetail').getBoundingClientRect();return {client:el.clientWidth,scroll:el.scrollWidth,document:document.documentElement.scrollWidth,viewport:innerWidth,tops:tiles.map(c=>Math.round(c.getBoundingClientRect().top)),first:tiles[0].getBoundingClientRect().toJSON(),second:tiles[1].getBoundingClientRect().toJSON(),list:r.toJSON(),detail:d.toJSON()}});
   assert(geometry.scroll<=geometry.client+1,'Tile grid must not scroll horizontally');
   assert(geometry.document<=geometry.viewport+1,'No document overflow at '+width);
   assert(new Set(geometry.tops).size>1,'Tiles wrap downward');
   assert.equal(geometry.first.top,geometry.second.top,'First tiles share a row');
   assert(geometry.second.left>geometry.first.left,'Tiles run left to right');
   if(width===1440)assert(geometry.detail.left>=geometry.list.right,'Description is to the right of the bank');
   const clips=await page.locator('svg[data-scene]').evaluateAll(els=>els.map(svg=>({overflow:getComputedStyle(svg).overflow,view:svg.getAttribute('viewBox'),clip:svg.querySelector('g').getAttribute('clip-path'),rect:!!svg.querySelector('clipPath>rect')})));
   assert(clips.every(c=>c.overflow==='hidden'&&c.view.startsWith('0 0 ')&&c.clip&&c.rect),'Every illustration must paint only its own clipped scene');
   assert.equal(await page.locator('[data-case] svg[data-scene]').count(),50);
   const hashes=new Set();
   for(const number of [6,10,13,21,41,42,43,44,45,46,47,48,49,50]){
    const svg=page.locator('[data-case="bank-curated-v2-'+String(number).padStart(2,'0')+'"] svg');
    assert.equal(await svg.getAttribute('data-scene'),String(number));
    const buffer=await svg.screenshot();hashes.add(crypto.createHash('sha256').update(buffer).digest('hex'));
   }
   assert.equal(hashes.size,14,'Distinct scenes must never collapse to the same visible panel');
   await page.screenshot({path:path.join(shots,'event-cards-'+width+'.png'),fullPage:true});
   console.log('PASS Separate case scenes and wrapping card grid and selected case panel at '+width+'px');
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
