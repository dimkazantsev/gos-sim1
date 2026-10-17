/* Browser regression: print the actual markup in an isolated A4 sheet.
 * No live documents or Supabase writes. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const {chromium}=require('playwright-core');
const handler=fs.readFileSync('components/game/officialDocumentPrint.ts','utf8');
const view=fs.readFileSync('components/game/DocumentsView.tsx','utf8');
assert(view.includes('printOfficialDocument()'),'NPA print button uses isolated A4 print flow');
assert(!view.includes('onClick={()=>window.print()}'),'Do not print the entire application DOM');
assert(handler.includes('@page{size:A4 portrait;margin:16mm 18mm}'),'A4 portrait and sensible document margins');
assert(!handler.includes('body *{visibility:hidden'),'No page-wide visibility hacks');
const output=ts.transpileModule(handler,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
(async()=>{
 const executable=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(x=>x&&fs.existsSync(x));
 assert(executable,'Browser needed for print test');
 const browser=await chromium.launch({headless:true,executablePath:executable,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const page=await browser.newPage({viewport:{width:1100,height:850},acceptDownloads:true});
  const repeated='Текст постановления Государственной Думы Российской Федерации. В соответствии с правовыми основаниями документ рассматривается в установленном порядке. ';
  const docText=Array.from({length:26},(_,i)=>'<p>Пункт '+(i+1)+'. '+repeated.repeat(3)+'</p>').join('');
  await page.setContent('<!doctype html><html lang="ru"><body><main class="legalPortal" style="display:grid;grid-template-columns:9000px 100px"><section><h2>Большая боковая панель</h2></section><article class="formalPaper legalDocumentPaper" style="width:100px;min-height:7000px"><header class="legalMasthead"><div class="formalPaperInstitution">Государственная Дума Федерального Собрания Российской Федерации</div><div class="formalPaperType">Постановление</div></header><div class="formalPaperMeta"><time>17.10.2026</time><span>№ 4</span><span>Москва</span></div><h1>Постановление Государственной Думы</h1><div class="formalPaperBody">'+docText+'</div><div class="formalSignature"><div><b>Председатель Государственной Думы</b></div></div><footer class="legalPaperFooterBar"><span>Государственная Дума Федерального Собрания Российской Федерации</span><button>Печать</button></footer></article></main><button id="print" onclick="window.printOfficialDocument()">Распечатать</button></body></html>');
  await page.addScriptTag({content:'var exports={};'+output+'window.printOfficialDocument=exports.printOfficialDocument;'});
  const popupPromise=page.waitForEvent('popup');
  await page.locator('#print').click();
  const printPage=await popupPromise;
  await printPage.waitForLoadState('domcontentloaded');
  const result=await printPage.evaluate(()=>{
   const paper=document.querySelector('.legalDocumentPaper');
   const a=paper.getBoundingClientRect();
   return {paperWidth:a.width,bodyWidth:document.body.scrollWidth,viewport:innerWidth,
     paragraphs:paper.querySelectorAll('.formalPaperBody p').length,
     title:document.title,printButtons:paper.querySelectorAll('button').length,
     marginRule:[...document.styleSheets].some(sheet=>[...sheet.cssRules].some(rule=>rule.cssText.includes('@page')&&rule.cssText.includes('A4')))};
  });
  assert(result.paperWidth>500&&result.paperWidth<900,'A4 paper must never be narrow: '+JSON.stringify(result));
  assert(result.paperWidth<result.viewport+1,'Print paper fits window');
  assert.equal(result.paragraphs,26,'All document body paragraphs are preserved');
  assert.equal(result.printButtons,0,'Print controls not printed');
  assert(result.marginRule,'A4 print page rule loaded');
  const pdf=await printPage.pdf({preferCSSPageSize:true,printBackground:true});
  const data=Buffer.from(pdf).toString('latin1');
  const boxes=[...data.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([0-9.]+)\s+([0-9.]+)\s*\]/g)];
  assert(boxes.length>0,'PDF has media boxes');
  for(const match of boxes){assert(Math.abs(Number(match[1])-595.3)<3&&Math.abs(Number(match[2])-841.9)<3,
   'Every page has A4 dimensions: '+match[0]);}
  assert(boxes.length>=2&&boxes.length<=9,'Document paginates into conventional A4 pages, not a huge papyrus: '+boxes.length);
  console.log('PASS NPA A4 printing: isolated page, full-width content, '+boxes.length+' A4 pages, original 26 paragraphs, no dashboard.');
 }finally{await browser.close()}
})().catch(err=>{console.error(err);process.exitCode=1});
