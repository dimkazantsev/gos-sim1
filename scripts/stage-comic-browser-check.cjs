/* Real React components, synthetic SQL snapshots, mocked read-only network. No production writes. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),{chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..'),route=path.join(root,'app/stage-comic-test-route'),shots=path.join(root,'.design-review/screenshots');
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&fs.existsSync(p));
if(!chrome)throw Error('Chrome is required for stage comic interaction checks');
const fixture=JSON.parse(fs.readFileSync(path.join(root,'.design-review/stage-comic-results.json'),'utf8'));
const source=`'use client';
import {useState} from 'react';
import RepublicComic from '../../components/game/RepublicComic';
import StageComics from '../../components/game/StageComics';
import type {Stage} from '../../components/game/types';
const gameId='${fixture.gameId}';
export default function Test(){const [archive,setArchive]=useState(false),[auto,setAuto]=useState(false),[other,setOther]=useState(false),[blocked,setBlocked]=useState(false),[status,setStatus]=useState(false),[teacherPreview,setTeacherPreview]=useState(false);
const stages=Array.from({length:16},(_,i)=>({stage_no:i+1,status:'completed'})) as Stage[];
return <main><button onClick={()=>setArchive(true)}>Открыть архив</button><button onClick={()=>{setTeacherPreview(true);setArchive(true)}}>Макеты преподавателя</button><button onClick={()=>setAuto(true)}>Автопоказ итогов</button><button onClick={()=>{setBlocked(true);setAuto(true)}}>Автопоказ после проверки</button><button onClick={()=>setOther(!other)}>Сменить игру</button><output id="auto-open">{String(status)}</output>
{blocked&&<section role="dialog" aria-modal="true" aria-label="Текущая проверка"><h2>Текущая проверка</h2><button onClick={()=>setBlocked(false)}>Закончить проверку</button></section>}
<RepublicComic teacherPreview={teacherPreview} gameId={other?'other-game':gameId} open={archive} initialView="archive" onClose={()=>setArchive(false)}/>
<StageComics key={other?'other-game':gameId} gameId={other?'other-game':gameId} userId="test-user" stages={auto?stages:[]} enabled={auto} onOpenChange={setStatus}/></main>}
`;
let server,browser;const logs=[];const url='http://localhost:3995/stage-comic-test-route';
async function main(){
 fs.mkdirSync(route,{recursive:true});fs.mkdirSync(shots,{recursive:true});fs.writeFileSync(path.join(route,'page.tsx'),source);
 server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'dev','-p','3995'],{cwd:root,stdio:['ignore','pipe','pipe'],env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'fixture'}});
 for(const p of [server.stdout,server.stderr])p.on('data',s=>{logs.push(String(s));if(logs.length>35)logs.shift()});
 try{
  for(let i=0;i<60;i++){if(server.exitCode!==null)throw Error(logs.join(''));try{if((await fetch(url,{signal:AbortSignal.timeout(5000)})).ok)break}catch{}if(i===59)throw Error('Comic fixture failed to start');await new Promise(r=>setTimeout(r,800))}
  browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
  for(const {width,height} of [{width:320,height:640},{width:390,height:844},{width:768,height:1000},{width:1440,height:900},{width:1024,height:600}]){
   const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'}),page=await context.newPage(),errors=[],calls=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('https://*.supabase.co/**',async route=>{
    const address=new URL(route.request().url());let data=[];
    if(address.pathname.endsWith('/republic_comic_chapters')){
     calls.push(address.search);data=address.searchParams.get('game_id')==='eq.'+fixture.gameId?fixture.chapters:[];
     const requested=address.searchParams.get('stage_no');if(requested)data=data.filter(c=>requested.slice(4,-1).split(',').map(Number).includes(c.stage_no));
    }
    await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
   });
   await page.goto(url);await page.getByRole('button',{name:'Открыть архив',exact:true}).click();
   await page.getByRole('button',{name:/Итоги · Этап 1 · 2 слайда/}).waitFor();
   assert.equal(await page.locator('.comicDialog .comicArtwork').count(),11,'Eleven themed archive covers');
   for(const chapter of fixture.chapters){
    const label=chapter.stage_no===16?/Эпилог · 4 слайда/:chapter.stage_no===3?/Итоги · Этапы 2 и 3/:chapter.stage_no===5?/Итоги · Этапы 4 и 5/:new RegExp('Итоги · Этап '+chapter.stage_no+' · '+(chapter.stage_no===1?2:3)+' слайда');
    await page.getByRole('button',{name:label}).click();
    const n=chapter.stage_no===16?4:chapter.stage_no===1?2:3;
    for(let scene=1;scene<=n;scene++){
     const frame=page.locator('.comicFrame');await frame.locator('img').evaluate(img=>img.decode());
     assert.equal(await frame.getAttribute('data-comic-slide'),String(scene));assert.equal(await page.locator('.comicDot').count(),n);
     assert.equal(await frame.getAttribute('data-cinematic-chapter'),'true');assert(await frame.locator('svg').count()>0,'Facts use icons');
     const geometry=await page.getByRole('dialog').evaluate(panel=>{const r=panel.getBoundingClientRect(),frame=panel.querySelector('.comicFrame'),footer=panel.querySelector('footer').getBoundingClientRect();return {right:r.right,bottom:r.bottom,scroll:document.documentElement.scrollWidth,width:innerWidth,height:innerHeight,frameBottom:frame.getBoundingClientRect().bottom,footerTop:footer.top}});
     assert(geometry.right<=width+2&&geometry.scroll<=width+2,'No horizontal overflow');assert(geometry.bottom<=height+2&&geometry.frameBottom<=geometry.footerTop+2,'Reader and controls fit viewport');
     await frame.locator('.comicOverlay strong').scrollIntoViewIfNeeded();
     if(chapter.stage_no===7&&scene===1)assert((await frame.textContent()).includes('Избранный участник'),'Actual election winner is visible');
     if(chapter.stage_no===1&&scene===2)assert((await frame.textContent()).includes('Тестовая партия'),'Original party snapshot survived the rename');
     if(chapter.stage_no===16&&scene===1)assert((await frame.textContent()).includes('30'),'Real aggregate participant count');
     if((chapter.stage_no===7||chapter.stage_no===16)&&scene===1)await page.screenshot({path:path.join(shots,'stage-comic-'+chapter.stage_no+'-'+width+'.png')});
     await page.getByRole('button',{name:scene===n?'Вернуться в архив':'Следующая сцена',exact:true}).click();
    }
   }
   await page.getByRole('button',{name:'Закрыть комикс',exact:true}).click();
   await page.getByRole('button',{name:'Автопоказ после проверки',exact:true}).click();await page.getByRole('dialog',{name:'Текущая проверка',exact:true}).waitFor();
   await page.waitForTimeout(150);assert.equal(await page.locator('.comicDialog').count(),0,'Existing attempt keeps priority');
   await page.getByRole('button',{name:'Закончить проверку',exact:true}).click();await page.locator('.comicFrame[data-comic-stage="1"]').waitFor();
   const autoCalls=calls.length;
   for(const chapter of fixture.chapters){
    await page.locator('.comicFrame[data-comic-stage="'+chapter.stage_no+'"]').waitFor();
    await page.getByRole('button',{name:'Закрыть комикс',exact:true}).click();
   }
   await page.locator('.comicDialog').waitFor({state:'hidden'});assert.equal(calls.length,autoCalls,'No extra requests per slide/chapter');
   await page.reload();await page.getByRole('button',{name:'Автопоказ итогов',exact:true}).click();await page.waitForTimeout(200);assert.equal(await page.locator('.comicDialog').count(),0,'Reload does not replay viewed results');
   await page.getByRole('button',{name:'Сменить игру',exact:true}).click();await page.waitForTimeout(150);assert.equal(await page.locator('.comicDialog').count(),0,'Another game cannot inherit result queue');
   await page.getByRole('button',{name:'Открыть архив',exact:true}).click();
   await page.getByText('Этапы пока не завершены.',{exact:false}).waitFor();
   assert.equal(await page.locator('.comicDialog .comicArtwork').count(),0,'Student with zero completed stages sees only prologue');
   await page.getByRole('button',{name:'Закрыть комикс',exact:true}).click();
   await page.getByRole('button',{name:'Макеты преподавателя',exact:true}).click();
   await page.getByText('Предпросмотр преподавателя:',{exact:false}).waitFor();
   assert.equal(await page.locator('.comicDialog .comicArtwork').count(),11,'Teacher sees all eleven draft covers in an empty game');
   await page.getByRole('button',{name:/Макет · Предпросмотр · Этап 1 · 3 слайда/}).click();
   assert.equal(await page.locator('.comicDot').count(),3,'Teacher stage preview contains three slides');
   assert((await page.locator('.comicFrame').textContent()).includes('Ожидает завершения'),'Teacher draft explicitly masks game results');
   await page.getByRole('button',{name:'Закрыть комикс',exact:true}).click();
   await page.getByRole('button',{name:'Макеты преподавателя',exact:true}).click();
   await page.getByRole('button',{name:/Макет · Эпилог · 4 слайда/}).click();
   assert.equal(await page.locator('.comicDot').count(),4,'Teacher epilogue preview contains four slides');
   assert(!(await page.locator('.comicFrame').textContent()).includes('Тестовая партия'),'Empty preview must not reveal fixture game data');
   await page.getByRole('button',{name:'Закрыть комикс',exact:true}).click();
   assert.deepEqual(errors,[],'No React runtime errors at '+width+'px');await context.close();
   console.log('PASS '+width+'×'+height+': 11 themed chapters, three/four slides, icons, actual names/counts, scroll/controls, modal priority, automatic queue, no per-slide requests, reload/game isolation');
  }
 }finally{await browser?.close();server?.kill('SIGTERM');fs.rmSync(route,{recursive:true,force:true})}
}
main().catch(e=>{console.error(e);console.error(logs.join(''));process.exitCode=1});
