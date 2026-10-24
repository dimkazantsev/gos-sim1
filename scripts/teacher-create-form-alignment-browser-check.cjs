/* Browser layout regression for TeacherGameSessions: no production writes. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright-core');
const {startTestServer,stopTestServer,closeTestBrowser,cleanTestRoute}=require('./browser-test-runtime.cjs');
const root=path.resolve(__dirname,'..');
const routeDir=path.join(root,'app','teacher-session-layout-test');
const url='http://127.0.0.1:3993/teacher-session-layout-test';
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium',chromium.executablePath()].find(p=>p&&fs.existsSync(p));
if(!chrome)throw Error('Chromium required');
const fixture=[
 "'use client';",
 "import TeacherGameSessions from '../../components/game/TeacherGameSessions';",
 "export default function Page(){return <main style={{maxWidth:1460,margin:'0 auto',padding:12,width:'100%',boxSizing:'border-box'}}><TeacherGameSessions/></main>}"
].join('\n');
async function ready(server){
 for(let i=0;i<35;i++){
  if(server.exitCode!==null)throw Error('Next exited');
  try{const r=await fetch(url,{signal:AbortSignal.timeout(1800)});if(r.ok)return}catch{}
  await new Promise(resolve=>setTimeout(resolve,800));
 }
 throw Error('Next fixture not ready');
}
async function main(){
 fs.mkdirSync(routeDir,{recursive:true});
 fs.writeFileSync(path.join(routeDir,'page.tsx'),fixture);
 let server,browser;
 try{
  server=startTestServer(root,3993,{NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'build-placeholder-key'});
  await ready(server);
  browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
  for(const width of [1440,1024,820,768,600,390,320]){
   const page=await browser.newPage({viewport:{width,height:920},deviceScaleFactor:1,reducedMotion:'reduce'});
   await page.route('**/rest/v1/rpc/list_my_teacher_games',route=>route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{"is_admin":true,"games":[]}'}));
   await page.goto(url,{waitUntil:'domcontentloaded'});
   await page.getByRole('button',{name:'Создать игру',exact:true}).click();
   const form=page.locator('.gosTeacherCreateForm');
   const teacher=form.locator('.gosTeacherCreateCodeField').nth(0);
   const student=form.locator('.gosTeacherCreateCodeField').nth(1);
   const game=form.locator('.gosTeacherCreateGameCode');
   const box=async(el)=>el.evaluate(x=>{const r=x.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height,scroll:x.scrollWidth,client:x.clientWidth}});
   const inputs=[await box(teacher.locator('input')),await box(student.locator('input'))];
   const buttons=[await box(teacher.locator('button')),await box(student.locator('button'))];
   const hints=[await box(teacher.locator('.gosTeacherCreateCodeHint')),await box(student.locator('.gosTeacherCreateCodeHint'))];
   const cards=[await box(teacher),await box(student)],panel=await box(form);
   assert(cards.every(x=>x.left>=panel.left-1&&x.right<=panel.right+1),'Cards escape form at '+width);
   for(const item of [...inputs,...buttons,...hints]){
    assert(item.left>=panel.left-1&&item.right<=panel.right+1,'Form overflow at '+width+': '+JSON.stringify(item));
    assert(item.scroll<=item.client+2,'Text or input clipped at '+width+': '+JSON.stringify(item));
   }
   assert(inputs.every(x=>x.height>=44)&&buttons.every(x=>x.height>=42),'Touch target at '+width);
   if(width>960){
    assert(Math.abs(inputs[0].top-inputs[1].top)<=2,'Inputs misaligned at '+width+': '+JSON.stringify(inputs));
    assert(Math.abs(buttons[0].top-buttons[1].top)<=2,'Buttons misaligned at '+width+': '+JSON.stringify(buttons));
    assert(Math.abs(hints[0].top-hints[1].top)<=2,'Help misaligned at '+width+': '+JSON.stringify(hints));
    assert(Math.abs(cards[0].height-cards[1].height)<=2,'Card heights differ at '+width);
   }else assert(cards[1].top>=cards[0].bottom+6,'Mobile roles must stack at '+width);
   assert((await box(game.locator('input'))).width>=100,'Game code field at '+width);
   await teacher.getByRole('button',{name:'Сгенерировать код'}).click();
   const t=await teacher.locator('input').inputValue();
   assert(t.startsWith('TCH-'),'Teacher code prefix');
   assert.equal(await student.locator('input').inputValue(),'','Teacher generator changes student code');
   await student.getByRole('button',{name:'Сгенерировать код'}).click();
   assert((await student.locator('input').inputValue()).startsWith('STD-'),'Student code prefix');
   assert.equal(await teacher.locator('input').inputValue(),t,'Student generator changes teacher code');
   await game.getByRole('button',{name:'Сгенерировать код игры'}).click();
   assert((await game.locator('input').inputValue()).startsWith('GOS-'),'Game code prefix');
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
   assert(overflow<=2,'Viewport overflow at '+width+'px: '+overflow);
   await page.close();
   console.log('PASS: form '+width+'px aligned with independent generation');
  }
 }finally{await closeTestBrowser(browser);await stopTestServer(server);cleanTestRoute(root,routeDir)}
}
main().catch(e=>{console.error(e);process.exitCode=1});
