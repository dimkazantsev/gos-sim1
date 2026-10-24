/* Audits every screen rendered from real ГОС.ID React components.
 * Synthetic preview only: no Supabase calls or data mutation.
 * Checks real Chromium geometry on narrow phones, tablets and desktop.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..');
const preview=path.join(root,'.design-review','gos-sim-preview.html');
const output=path.join(root,'.design-review','responsive-audit.json');
const screenshots=path.join(root,'.design-review','responsive-shots');
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>p&&fs.existsSync(p));
if(!chrome)throw Error('Chromium is required for responsive layout audit');
assert(fs.existsSync(preview),'Run npm run design:preview before audit');
fs.mkdirSync(screenshots,{recursive:true});
const widths=[320,360,390,600,768,1024,1440];
const examples=new Set(['entry','dashboard','teacher','teacher-grades','grades','stages','parties','votes','documents','document-detail','profile','mobile-all','chat-panel','stage-11']);
function shortName(node){
 const parts=[node.tagName.toLowerCase()];
 if(node.id)parts.push('#'+node.id.slice(0,40));
 if(node.classList?.length)parts.push('.'+[...node.classList].slice(0,3).join('.'));
 return parts.join('');
}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage({viewport:{width:1500,height:1040},deviceScaleFactor:1});
 let summary=[];
 try{
  await page.goto(pathToFileURL(preview).href,{waitUntil:'load'});
  const screens=await page.locator('#screen option').evaluateAll(nodes=>nodes.map(n=>({id:n.value,label:n.textContent})));
  assert(screens.length>=30,'The audit must cover the full app preview, not a few hand-picked panels');
  for(const screen of screens){
   await page.evaluate(id=>new Promise((resolve,reject)=>{
    const frame=document.querySelector('#preview');
    let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(timer);resolve(true)};
    const timer=setTimeout(()=>{if(!done){done=true;reject(new Error('Preview did not load '+id))}},15000);
    frame.addEventListener('load',finish,{once:true});
    const select=document.querySelector('#screen');select.value=id;select.dispatchEvent(new Event('change',{bubbles:true}));
   }),screen.id);
   const frame=page.frameLocator('#preview');
   for(const width of widths){
    await page.locator('#preview').evaluate((node,v)=>{node.style.width=v+'px'},width);
    const report=await frame.locator('html').evaluate(html=>{
     const viewport=html.clientWidth,body=document.body;
     const issues=[],limits={offscreen:0,clippedControl:0,collision:0};
     const isVisible=n=>{
      const style=getComputedStyle(n),r=n.getBoundingClientRect();
      return style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)!==0&&r.width>3&&r.height>3;
     };
     const scrollAncestor=n=>{
      for(let p=n.parentElement;p&&p!==document.body;p=p.parentElement){
       const s=getComputedStyle(p);
       if(/auto|scroll/.test(s.overflowX)&&p.scrollWidth>p.clientWidth+4)return true;
      }
      return false;
     };
     const name=n=>(n.tagName.toLowerCase()+(n.id?'#'+n.id:'')+(n.classList?.length?'.'+[...n.classList].slice(0,2).join('.'):'')).slice(0,100);
     for(const el of document.querySelectorAll('button,a,input,textarea,select,summary,[role="button"]')){
      if(!isVisible(el)||scrollAncestor(el))continue;
      const r=el.getBoundingClientRect(),style=getComputedStyle(el);
      const label=(el.getAttribute('aria-label')||el.textContent||el.placeholder||'').trim().replace(/\s+/g,' ').slice(0,80);
      if(r.left < -3||r.right > viewport+3){
       limits.offscreen++;
       if(issues.length<15)issues.push({type:'offscreen',el:name(el),label,left:Math.round(r.left),right:Math.round(r.right)});
      }
      if(el.tagName==='BUTTON' && el.scrollWidth>el.clientWidth+5&&style.overflowX==='hidden'&&
       style.textOverflow!=='ellipsis'&&label.length>7){
       limits.clippedControl++;
       if(issues.length<15)issues.push({type:'clippedControl',el:name(el),label,client:el.clientWidth,scroll:el.scrollWidth});
      }
     }
     // Overlap between peer controls should not depend on viewport shape.
     for(const parent of document.querySelectorAll('div,header,footer,nav,section,article,form')){
      const buttons=[...parent.children].filter(n=>n.matches?.('button,a,input,select,textarea')&&isVisible(n));
      if(buttons.length<2||buttons.length>18)continue;
      for(let i=0;i<buttons.length;i++)for(let j=i+1;j<buttons.length;j++){
       const a=buttons[i],b=buttons[j],ra=a.getBoundingClientRect(),rb=b.getBoundingClientRect();
       const iw=Math.max(0,Math.min(ra.right,rb.right)-Math.max(ra.left,rb.left));
       const ih=Math.max(0,Math.min(ra.bottom,rb.bottom)-Math.max(ra.top,rb.top));
       if(iw>6&&ih>6&&iw*ih>60){
        limits.collision++;
        if(issues.length<15)issues.push({type:'collision',parent:name(parent),a:name(a),b:name(b),overlap:[Math.round(iw),Math.round(ih)]});
       }
      }
     }
     return {viewport,rootOverflow:html.scrollWidth-html.clientWidth,bodyOverflow:body.scrollWidth-html.clientWidth,limits,issues};
    });
    summary.push({screen:screen.id,label:screen.label,width,...report});
    const mustShot=((width===390||width===768)&&examples.has(screen.id)) || (width===320&&['parties','metric-modal'].includes(screen.id));
    if(mustShot)await page.locator('#preview').screenshot({path:path.join(screenshots,screen.id+'-'+width+'.png')});
   }
  }
  const problemRows=summary.filter(row=>row.rootOverflow>3||row.bodyOverflow>3||Object.values(row.limits).some(n=>n>0));
  const byScreen=Object.entries(problemRows.reduce((acc,r)=>{const x=acc[r.screen]||(acc[r.screen]={screen:r.screen,label:r.label,widths:[],issues:[],maxOverflow:0});x.widths.push(r.width);x.maxOverflow=Math.max(x.maxOverflow,r.rootOverflow,r.bodyOverflow);for(const issue of r.issues)if(x.issues.length<8)x.issues.push({width:r.width,...issue});return acc},{}));
  const report={generated_at:new Date().toISOString(),source:'synthetic React component preview in Chromium',screen_count:screens.length,widths,combinations:summary.length,problems:problemRows.length,screen_findings:byScreen.map(([,v])=>v),results:summary};
  fs.writeFileSync(output,JSON.stringify(report,null,2));
  console.log('RESPONSIVE-AUDIT '+JSON.stringify({screens:screens.length,widths,combinations:summary.length,problem_combinations:problemRows.length,problem_screens:byScreen.length}));
  for(const [,item] of byScreen.slice(0,45))console.log('RESPONSIVE-FINDING '+JSON.stringify(item));
  console.log('RESPONSIVE-REPORT '+output);
  assert.equal(problemRows.length,0,'Measured responsive overlap/overflow remains: '+JSON.stringify(byScreen.map(([,x])=>({screen:x.screen,widths:x.widths,issues:x.issues.slice(0,3)}))));
 }finally{await page.close();await browser.close()}
})().catch(e=>{console.error('RESPONSIVE-AUDIT-ERROR',e);process.exitCode=1});
