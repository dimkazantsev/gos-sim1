const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const {chromium}=require('playwright-core');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const {partyLogoRect}=require('../components/game/partyLogoCrop.ts');
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<.001,actual+' != '+expected);
const fit=partyLogoRect(1200,600,{zoom:1,x:0,y:0});
near(fit.x,0);near(fit.y,160);near(fit.width,640);near(fit.height,320);
const cropped=partyLogoRect(1200,600,{zoom:2,x:0,y:0});
near(cropped.x,-320);near(cropped.y,0);near(cropped.width,1280);near(cropped.height,640);
const shifted=partyLogoRect(1200,600,{zoom:2,x:25,y:-25});
near(shifted.x,-160);near(shifted.y,-160);
const portrait=partyLogoRect(600,1200,{zoom:1,x:0,y:0});
near(portrait.x,160);near(portrait.y,0);
for(const broken of [{zoom:0,x:0,y:0},{zoom:7,x:0,y:0},{zoom:1,x:Infinity,y:0}])
 assert.throws(()=>partyLogoRect(1200,600,broken));
const view=fs.readFileSync('components/game/PartiesView.tsx','utf8');
const game=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
const editor=fs.readFileSync('components/game/PartyLogoEditor.tsx','utf8');
assert.ok(view.includes("selected.name===me.team"),'Member upload must be available in their own party');
assert.ok(view.includes('canEditDescription&&')&&view.includes('canUploadLogo&&'),'Description editing remains restricted');
assert.ok(view.includes('g.savePartyIdentity(selected.id,undefined,file)'),'Logo upload cannot overwrite another member description');
assert.ok(game.includes('p_description:description?.trim()||null'),'Omitted description is preserved by RPC');
assert.ok(editor.includes('onPointerDown={dragStart}')&&editor.includes('onPointerMove={dragMove}'),'Pointer drag is supported');
assert.ok(editor.includes('type="range"')&&editor.includes('Заполнить квадрат'),'Zoom and fill are available');
const css=fs.readFileSync('app/2026-civic-portal.css','utf8');
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>p&&fs.existsSync(p));
if(!chrome)throw Error('Chrome or Chromium is required for responsive party logo tests');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  for(const width of [320,390,768,1280,1600]){
   const page=await browser.newPage({viewport:{width,height:900}});
   await page.setContent(`<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><style>
   *{box-sizing:border-box}body{margin:0;background:#f4f7fc;font:14px Arial,sans-serif}.civicParties{padding:10px;width:100%;}.partyLogoEditor{width:100%}
   ${css}</style><body><main class="civicParties"><section class="civicPartyTiles"><article class="civicPartyTile active"><button class="civicPartyTileSelect"><span class="civicPartyLogo"><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Crect width='200' height='200' fill='%23597cbe'/%3E%3C/svg%3E"></span><span class="civicPartyTileCopy"><b>ЛДПР</b><small>Либерализм</small></span><span class="civicPartyTileStats">0% поддержка · 0 мандатов</span></button></article></section><section class="civicPartyPublic"><header><span class="civicPartyLogo"><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Crect width='200' height='200' fill='%23597cbe'/%3E%3C/svg%3E"></span><div><h2>ЛДПР</h2><p>Либерализм</p></div></header><details class="civicPartyEditor" open><summary>Оформление партии</summary><div class="partyLogoEditor"><div class="partyLogoEditorWorkspace"><div class="partyLogoCropViewport"><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='200'%3E%3Crect width='400' height='200' fill='%23597cbe'/%3E%3C/svg%3E"></div><div class="partyLogoCropControls"><label>Масштаб<input type="range" value="1"/></label><label>По горизонтали<input type="range" value="0"/></label><label>По вертикали<input type="range" value="0"/></label><div class="partyLogoCropPresets"><button>Поместить полностью</button><button>Заполнить квадрат</button></div><button class="primary">Сохранить эмблему</button></div></div></div></details></section></main></body></html>`);
   const sizes=await page.evaluate(()=>{
    const tile=document.querySelector('.civicPartyTile .civicPartyLogo').getBoundingClientRect();
    const publicLogo=document.querySelector('.civicPartyPublic>header>.civicPartyLogo').getBoundingClientRect();
    const square=document.querySelector('.partyLogoCropViewport').getBoundingClientRect();
    return {tile:{w:tile.width,h:tile.height},main:{w:publicLogo.width,h:publicLogo.height},square:{w:square.width,h:square.height},scroll:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth}
   });
   assert(sizes.tile.w>=63&&sizes.main.w>=79,'Party emblems visible at '+width);
   near(sizes.tile.w,sizes.tile.h);near(sizes.main.w,sizes.main.h);near(sizes.square.w,sizes.square.h);
   assert(sizes.scroll<=sizes.viewport+1,'No horizontal overflow '+width+': '+JSON.stringify(sizes));
   await page.close();
   console.log('PASS '+width+'px: party tile, party profile, cropping layout');
  }
 }finally{await browser.close();}
 console.log('PASS: party logo geometry, participant permission, read-only description, crop controls and responsive layout');
})().catch(e=>{console.error(e);process.exitCode=1});
