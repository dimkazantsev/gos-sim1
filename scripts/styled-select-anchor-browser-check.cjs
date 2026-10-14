/** Browser regression for detached fixed dropdown menus.
 * Covers short and long lists, scrolling containers, narrow/mobile widths.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const Module=require('node:module');
const ts=require('typescript');
const {chromium}=require('playwright-core');
const path='components/ui/selectMenuPlacement.ts';
const moduleFile=new Module(path,module);
moduleFile.filename=path;moduleFile.paths=module.paths;
moduleFile._compile(ts.transpileModule(fs.readFileSync(path,'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText,path);
const {placeSelectMenu}=moduleFile.exports;
const selectSource=fs.readFileSync('components/ui/StyledSelect.tsx','utf8');
assert(selectSource.includes('placeSelectMenu(r,popup.current?.scrollHeight??0'),'The component must measure real menu height');
assert(selectSource.includes('useLayoutEffect(()=>{if(open)position()}'),'Layout must be updated before browser paint');
assert(selectSource.includes("window.addEventListener('scroll',scroll,true)"),'Nested scroll tracking must remain');
assert(selectSource.includes('ResizeObserver(position)'),'Dynamic trigger and menu resizing must be tracked');
assert(selectSource.includes('createPortal('),'Portalled menu stays above clipping cards');
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(f=>f&&fs.existsSync(f));
if(!chrome)throw Error('Chrome/Chromium required for dropdown layout regression');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox']});
 try {
  const page=await browser.newPage();
  await page.addScriptTag({content:'window.placeSelectMenu='+placeSelectMenu.toString()+';'});
  const widths=[320,390,768,1024,1440];
  for(const width of widths){
   const height=width<=390?640:width<=768?760:900;
   await page.setViewportSize({width,height});
   for(const rows of [2,12]){
    for(const side of ['below','above']){
     const top=side==='above'?height-78:24;
     const metrics=await page.evaluate(({width,height,top,rows})=>{
      document.body.innerHTML=`<button id="selectTrigger" style="position:fixed;top:${top}px;left:30px;width:${Math.min(270,width-38)}px;height:43px">Этап</button><div id="selectMenu" style="position:fixed;box-sizing:border-box;padding:5px;border:1px solid #dce4ee;border-radius:12px;overflow-y:auto;background:#fff"></div>`;
      const trigger=document.querySelector('#selectTrigger'),menu=document.querySelector('#selectMenu');
      for(let i=0;i<rows;i++){const b=document.createElement('button');b.textContent=i+' Выбор этапа';b.style.cssText='display:block;box-sizing:border-box;width:100%;min-height:46px;border:0';menu.appendChild(b)}
      const r=trigger.getBoundingClientRect();
      const p=window.placeSelectMenu(r,menu.scrollHeight,{width:innerWidth,height:innerHeight});
      Object.assign(menu.style,{left:p.left+'px',top:p.top+'px',width:p.width+'px',maxHeight:p.maxHeight+'px'});
      const b=menu.getBoundingClientRect();
      return {r:{top:r.top,bottom:r.bottom,left:r.left,right:r.right},b:{top:b.top,bottom:b.bottom,left:b.left,right:b.right,height:b.height},rows,p,viewport:{width,height}};
     },{width,height,top,rows});
     const m=metrics;
     assert(m.b.left>=7&&m.b.right<=width-7,`Horizontal overflow at ${width}, ${rows} items: ${JSON.stringify(m)}`);
     if(side==='above'){
      assert(Math.abs(m.r.top-m.b.bottom-6)<=3,`Detached ABOVE menu ${width}px / ${rows} rows: ${JSON.stringify(m)}`);
      assert(m.b.top>=7,`Above menu clipped: ${JSON.stringify(m)}`);
     }else{
      assert(Math.abs(m.b.top-m.r.bottom-6)<=2,`Detached BELOW menu ${width}px / ${rows} rows: ${JSON.stringify(m)}`);
      assert(m.b.bottom<=height-7,`Below menu overflow: ${JSON.stringify(m)}`);
     }
    }
   }
  }
  // Browser's nested scroll changes the trigger rectangle while the menu lives in body.
  await page.setViewportSize({width:390,height:720});
  const nested=await page.evaluate(()=>{
   document.body.innerHTML='<div id="scroll" style="position:absolute;top:160px;left:18px;height:310px;width:350px;overflow:auto;border:1px solid #ccc"><div style="height:360px"></div><button id="selectTrigger" style="width:210px;height:46px">Этап</button><div style="height:420px"></div></div><div id="selectMenu" style="position:fixed;overflow-y:auto;box-sizing:border-box;padding:6px;border:1px solid #ccc;background:#fff"></div>';
   const scroller=document.querySelector('#scroll'),trigger=document.querySelector('#selectTrigger'),menu=document.querySelector('#selectMenu');
   for(let i=0;i<2;i++){const b=document.createElement('button');b.textContent=i+' этап';b.style.cssText='display:block;width:100%;min-height:44px';menu.appendChild(b)}
   const positions=[];
   for(const scrollY of [150,190,210]){
    scroller.scrollTop=scrollY;
    const r=trigger.getBoundingClientRect();
    const p=window.placeSelectMenu(r,menu.scrollHeight,{width:innerWidth,height:innerHeight});
    Object.assign(menu.style,{left:p.left+'px',top:p.top+'px',width:p.width+'px',maxHeight:p.maxHeight+'px'});
    const rect=menu.getBoundingClientRect();
    positions.push({trigger:r.top,menuBottom:rect.bottom,menuTop:rect.top,triggerBottom:r.bottom});
   }
   return positions;
  });
  nested.forEach((p,i)=>{
   const gapAbove=Math.abs(p.trigger-p.menuBottom-6),gapBelow=Math.abs(p.menuTop-p.triggerBottom-6);
   assert(Math.min(gapAbove,gapBelow)<=3,`Detached after nested scroll ${i}: ${JSON.stringify(p)}`);
  });
  console.log('PASS: portalled selectors attached at 5 viewport widths, 2/12 options and nested scroll positions');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
