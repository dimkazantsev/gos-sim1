/* P1 #415: real StyledSelect and useDialog key handlers in Chromium.
   Synthetic DOM. No login, real scores, Supabase queries or writes. */
const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const {chromium}=require('playwright-core');
const select=fs.readFileSync('components/ui/StyledSelect.tsx','utf8');
const dialog=fs.readFileSync('components/ui/useDialog.ts','utf8');
const start=select.indexOf(' function keydown(e:React.KeyboardEvent<HTMLButtonElement>)');
const end=select.indexOf('\n return <div ref={ref}',start);
assert(start>=0&&end>start,'Find actual selector keyboard handler');
const fn=ts.transpileModule(select.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const hookStart=dialog.indexOf('  const key=(event:KeyboardEvent)=>{');
const hookEnd=dialog.indexOf('\n  // Disabling',hookStart);
assert(hookStart>=0&&hookEnd>hookStart,'Find actual dialog keyboard handler');
const hookFn=ts.transpileModule(dialog.slice(hookStart,hookEnd),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>p&&fs.existsSync(p));
if(!chrome)throw Error('Chromium required for keyboard regression');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox']});
 try{
  for(const width of [320,390,768,1024]){
   const page=await browser.newPage({viewport:{width,height:740}});
   await page.setContent('<!doctype html><html lang="ru"><body><button id="launch">Открыть оценку</button><article id="dialog" role="dialog" aria-modal="true" tabindex="-1"><button id="close">Закрыть оценку</button><button id="grade">Итоговый балл</button><textarea id="note" placeholder="Обоснование"></textarea></article><div id="popup" role="listbox">Оценки 0–3</div></body></html>');
   await page.evaluate(({fn,hookFn})=>{
    const panel=document.querySelector('#dialog'),trigger=document.querySelector('#grade');
    const activePanels=new Set([panel]),close={current:()=>{window.__modalClosed=true}};
    const focusable=()=>Array.from(panel.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')).filter(n=>n.getClientRects().length>0);
    const key=new Function('activePanels','panel','close','focusable',hookFn+'\nreturn key;')(activePanels,panel,close,focusable);
    window.addEventListener('keydown',key);
    window.__modalClosed=false;window.__popupOpen=true;
    const options=[{value:'',label:'Выберите'},{value:'0',label:'0'},{value:'1',label:'1'},{value:'2',label:'2'},{value:'3',label:'3'}];
    const enabled=options.map((o,i)=>({...o,index:i})),cursor=1,open=true;
    const show=()=>{},setCursor=()=>{},onChange=()=>{};
    const setOpen=next=>{window.__popupOpen=next;if(!next)document.querySelector('#popup')?.remove()};
    const keydown=new Function('open','cursor','enabled','options','show','setCursor','onChange','setOpen',fn+'\nreturn keydown;')(open,cursor,enabled,options,show,setCursor,onChange,setOpen);
    trigger.addEventListener('keydown',keydown);
   },{fn,hookFn});
   await page.locator('#grade').focus();await page.keyboard.press('Tab');
   assert.equal(await page.evaluate(()=>window.__popupOpen),false,'Tab closes grade list at '+width);
   assert.equal(await page.evaluate(()=>document.activeElement.id),'note','Tab moves focus to comment at '+width);
   assert.equal(await page.evaluate(()=>window.__modalClosed),false,'Tab must not close modal');
   await page.keyboard.press('Tab');
   assert.equal(await page.evaluate(()=>document.activeElement.id),'close','Modal traps Tab at final input');
   await page.keyboard.press('Shift+Tab');
   assert.equal(await page.evaluate(()=>document.activeElement.id),'note','Shift+Tab moves back to comment');
   await page.keyboard.press('Escape');
   assert.equal(await page.evaluate(()=>window.__modalClosed),true,'Escape closes modal');
   await page.close();
  }
  for(const keyName of ['Escape','Tab']){
   let state=null,prevented=false;
   const handler=new Function('open','cursor','enabled','options','show','setCursor','onChange','setOpen',fn+'\nreturn keydown;')(
    true,1,[{index:0},{index:1}],[{value:''},{value:'1'}],()=>{},()=>{},()=>{},v=>{state=v});
   handler({key:keyName,preventDefault:()=>{prevented=true}});
   assert.equal(state,false,keyName+' must dismiss selector');
   assert.equal(prevented,keyName==='Escape',keyName+' default behavior');
  }
  console.log('PASS grade selector keyboard and dialog focus on 320,390,768,1024px');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
