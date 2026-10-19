const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const path=require('node:path');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..');
const code=fs.readFileSync(path.join(root,'components/game/DocumentsView.tsx'),'utf8');
const css=fs.readFileSync(path.join(root,'app/2026-npa-workspace-canonical.css'),'utf8');
const registryCss=fs.readFileSync(path.join(root,'app/2026-npa-registry-canonical.css'),'utf8');
const oldCss=fs.readFileSync(path.join(root,'app/2026-document-workflow-v2.css'),'utf8');
const layout=fs.readFileSync(path.join(root,'app/layout.tsx'),'utf8');
const app=fs.readFileSync(path.join(root,'components/GameClient.tsx'),'utf8');
const parsed=ts.createSourceFile('DocumentsView.tsx',code,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX);
assert.equal(parsed.parseDiagnostics.length,0,'Document view must parse as TSX');
assert(code.includes("const selected=useMemo(()=>detailOpen?(filtered.find(d=>d.id===selectedId)||filtered[0]):undefined,[filtered,selectedId,detailOpen])"),'Closed registry cannot select first document and issue detail queries');
assert(code.includes("setDetailOpen(false);setSelectedId('');onSelectDocument?.();setEditing(false);setScrollOpenedDocument(false)"),'Back button closes detail, clears selection and navigation focus');
assert(code.includes('hidden={!detailOpen}'),'Document detail must continue to use hidden state');
assert(code.includes('hidden={detailOpen}'),'Registry must be shown when detail closes');
assert(app.includes('onSelectDocument={rememberDocument}'),'Parent must clear route focus on back');
assert(app.includes("documentId:id||''"),'Parent remembers empty document focus');
assert(css.includes('.legalPortal .formalWorkspace > .formalDetail[hidden]{display:none!important}'),'Hidden selector must explicitly override legacy grid');
assert(registryCss.includes('.legalPortal .registryDashboard[hidden]{display:none!important}'),'Registry hidden state is also covered');
assert(oldCss.includes('display:grid!important;'),'Check regression against actual overriding legacy style');
assert(layout.indexOf("import './2026-npa-workspace-canonical.css';")>layout.indexOf("import './2026-document-workflow-v2.css';"),'The canonical fix must follow the legacy display rule');
const files=['app/design-tokens.css','app/design-views.css','app/2026-civic-portal.css','app/2026-document-workflow-v2.css','app/2026-npa-registry-canonical.css','app/2026-npa-workspace-canonical.css'];
const styles=files.map(f=>fs.readFileSync(path.join(root,f),'utf8')).join('\n');
const markup='<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+styles+'</style></head><body><div class="formalPage legalPortal"><section class="formalWorkspace"><aside class="formalRegistry registryDashboard" hidden><button class="open" type="button">Открыть документ</button></aside><article id="npa-document-workspace" class="formalDetail" data-tab="unified"><div class="legalDetailToolbar"><button class="legalBackToRegistry" type="button">Реестр НПА</button><div class="legalWorkspaceLabel">Документ и процедура</div></div><div>Текст документа</div></article></section></div><script>document.querySelector(".legalBackToRegistry").onclick=()=>{document.querySelector(".formalDetail").hidden=true;document.querySelector(".registryDashboard").hidden=false;};document.querySelector(".open").onclick=()=>{document.querySelector(".formalDetail").hidden=false;document.querySelector(".registryDashboard").hidden=true;};</script></body></html>';
const exe=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>p&&fs.existsSync(p));
if(!exe)throw Error('Chromium required for real browser CSS regression');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:exe,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  for(const width of [320,390,650,820,1024,1440]){
   const page=await browser.newPage({viewport:{width,height:800}});
   await page.setContent(markup);
   assert(await page.locator('.formalDetail').isVisible(),'Detail must initially be visible');
   await page.getByRole('button',{name:'Реестр НПА'}).click();
   assert(await page.locator('.registryDashboard').isVisible(),'Registry must be visible after back at '+width);
   assert(!await page.locator('.formalDetail').isVisible(),'Detail must be hidden after back at '+width);
   const hiddenDisplay=await page.locator('.formalDetail').evaluate(x=>getComputedStyle(x).display);
   assert.equal(hiddenDisplay,'none','Hidden detail must beat display:grid!important at '+width);
   await page.getByRole('button',{name:'Открыть документ'}).click();
   assert(await page.locator('.formalDetail').isVisible(),'Detail reopens at '+width);
   assert(!await page.locator('.registryDashboard').isVisible(),'Registry disappears during detail at '+width);
   const geometry=await page.locator('.formalDetail').evaluate(x=>({scroll:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth,right:x.getBoundingClientRect().right}));
   assert(geometry.scroll<=geometry.viewport+2,'No horizontal overflow at '+width+'px '+JSON.stringify(geometry));
   await page.close();
   console.log('PASS registry-back/open at '+width+'px');
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
