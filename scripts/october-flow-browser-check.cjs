/* Real React interactions with fictional game data; RPC payloads are intercepted.
   The actual server permissions and persistence are checked separately in rollback SQL. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..'),route=path.join(root,'app/october-flow-test-route'),screens=path.join(root,'.design-review/screenshots');
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser','/opt/google/chrome/chrome'].find(p=>p&&fs.existsSync(p));
if(!chrome)throw Error('Chrome is required for interface interactions');
const fixture=JSON.parse(fs.readFileSync(path.join(root,'.design-review/fixture.json'),'utf8'));
const source=String.raw`'use client';
import {useState,useEffect} from 'react';
import DocumentsView from '../../components/game/DocumentsView';
import PoliticalWallView from '../../components/game/PoliticalWallView';
import InstitutionRegistrationPanel from '../../components/game/InstitutionRegistrationPanel';
import type {ReturnTypeRepublic} from '../../components/game/viewTypes';
import type {View} from '../../components/game/types';
const initial=`+JSON.stringify(fixture)+String.raw`;
export default function FlowCheck(){
 const [data,setData]=useState<any>(initial),[view,setView]=useState('registry'),[output,setOutput]=useState('');
 useEffect(()=>{document.body.dataset.flowReady='yes'},[]);
 const g={...data,availableActors:()=>[{key:'teacher',label:'GOS//SIMS · Нейтральная публикация'},{key:'participant',label:data.me.full_name},{key:'minjust',label:'Министерство юстиции Российской Федерации'},{key:'gd',label:'Государственная Дума'}],
  refresh:async()=>{},setError:(message:string)=>setOutput(message),judgeAction:async()=>true,
  createPoliticalPost:async(p:any,files:File[])=>{
   setOutput(JSON.stringify({...p,files:files.map(f=>f.name)}));
   setData((old:any)=>({...old,politicalPosts:[{...old.politicalPosts[0],id:'published-ui-post',title:p.title,body:p.body,tags:p.tags,actor_key:p.actorKey,actor_label:p.actorKey==='teacher'?'GOS//SIMS':p.actorLabel,source_key:null,context:{stage_no:11},created_at:new Date().toISOString()},...old.politicalPosts],postFormalLinks:[...old.postFormalLinks,...p.formalIds.map((id:string)=>({post_id:'published-ui-post',formal_document_id:id}))]}));return 'published-ui-post';
  },updatePoliticalPost:async(id:string,p:any)=>{setData((old:any)=>({...old,politicalPosts:old.politicalPosts.map((x:any)=>x.id===id?{...x,title:p.title,body:p.body,tags:p.tags}:x)}));return true},
  addMediaToPoliticalPost:async()=>true,createVoteFromPost:async()=>null,
  createFormalDocument:async()=>null,advanceFormalDocument:async()=>false,
  updateFormalDraft:async()=>false,acceptPoliticalPost:async()=>true,rejectPoliticalPost:async()=>true
 } as unknown as ReturnTypeRepublic;
 return <main style={{padding:'16px',maxWidth:1120,margin:'0 auto'}}>
  <nav aria-label="Проверяемый раздел" style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:20}}><button onClick={()=>setView('registry')}>Правовой портал</button><button onClick={()=>setView('process')}>Политический процесс</button><button onClick={()=>setView('body')}>Регистрация органа</button></nav>
  {view==='registry'&&<DocumentsView g={g} onOpenVotes={()=>{}}/>}
  {view==='process'&&<PoliticalWallView g={g} onOpenVotes={()=>{}} onOpenDocument={()=>setView('registry')} onNavigate={(v:View)=>{if(v==='documents')setView('registry')}}/>}
  {view==='body'&&<InstitutionRegistrationPanel g={g}/>}
  <output id="flow-output" style={{display:'none'}}>{output}</output>
 </main>;
}
`;
let server,browser;
const address='http://127.0.0.1:3995/october-flow-test-route';
async function ready(){
 for(let n=0;n<60;n++){
  if(server.exitCode!==null)throw Error('Next.js dev server exited');
  try{if((await fetch(address,{signal:AbortSignal.timeout(5000)})).ok)return}catch{}
  await new Promise(r=>setTimeout(r,1000));
 }throw Error('Interface route did not become ready');
}
(async()=>{
 fs.mkdirSync(route,{recursive:true});fs.writeFileSync(path.join(route,'page.tsx'),source);fs.mkdirSync(screens,{recursive:true});
 server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port','3995'],{cwd:root,env:{...process.env,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'build-placeholder-key'},stdio:['ignore','pipe','pipe']});
 let logs='';for(const stream of [server.stdout,server.stderr])stream.on('data',x=>{logs=(logs+x.toString()).slice(-5000)});
 try{
  await ready();browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
  for(const width of [390,1440]){
   const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce',hasTouch:width===390,isMobile:width===390});
   const page=await context.newPage(),errors=[],metricCalls=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('https://*.supabase.co/**',async route=>{
    if(route.request().url().includes('/rpc/set_post_state_metric'))metricCalls.push(route.request().postDataJSON());
    await route.fulfill({status:200,contentType:'application/json',body:route.request().url().includes('/rpc/')?'null':'[]'});
   });
   await page.goto(address);await page.waitForFunction(()=>document.body.dataset.flowReady==='yes');
   await page.locator('.formalRegistryRow').first().click();await page.locator('.formalPaper').waitFor({state:'visible'});
   await page.getByRole('button',{name:'Процедура и история',exact:true}).click();await page.locator('.formalActions').waitFor({state:'visible'});
   await page.getByRole('button',{name:'К списку документов',exact:true}).click();await page.locator('.formalRegistry').waitFor({state:'visible'});
   await page.getByRole('button',{name:/Создать \/ загрузить/}).click();
   await page.getByRole('button',{name:'Использовать образец',exact:true}).click();
   assert((await page.locator('.formalTextEditor').inputValue()).length>30,'Editable template opens');
   await page.locator('.formalTextEditor').fill('Текст документа для проверки редактора.');
   await page.getByRole('navigation',{name:'Проверяемый раздел'}).getByRole('button',{name:'Политический процесс',exact:true}).click();
   const composer=page.locator('.wallComposer');assert.equal(await composer.locator('.processComposerBody').isVisible(),false,'Composer starts folded');
   await composer.locator('summary').first().click();
   assert(await composer.locator('.wallAvatar img[alt="GOS//SIMS"]').isVisible(),'Teacher uses game logo');
   await page.getByRole('textbox',{name:'Заголовок публикации',exact:true}).fill('Проверка публикации');
   await page.getByRole('textbox',{name:'Текст публикации',exact:true}).fill('Проект решения готов к обсуждению. ');
   await composer.getByRole('button',{name:/Ход игры/}).click();
   assert((await page.getByRole('textbox',{name:'Текст публикации',exact:true}).inputValue()).includes('#ходигры_gpyasu'),'Tag inserts into text');
   await composer.getByRole('button',{name:/Добавить НПА из реестра/}).click();
   const picker=page.getByRole('dialog',{name:'Выбрать НПА из реестра'});await picker.getByRole('searchbox',{name:'Поиск НПА'}).fill('НПА-2026-014');
   await picker.locator('.npaPickerList button').first().click();await picker.getByRole('button',{name:/Готово/}).click();
   assert.equal(await composer.locator('.npaPicked').count(),1,'Selected document attached to draft');
   await composer.getByRole('button',{name:'Ссылка в тексте',exact:true}).click();
   await composer.getByLabel('Текст ссылки',{exact:true}).fill('Правовой портал');await composer.getByLabel('Адрес',{exact:true}).fill('https://pravo.gov.ru/');
   await composer.getByRole('button',{name:'Вставить ссылку',exact:true}).click();
   await composer.locator('input[type=file]').setInputFiles({name:'Пояснение.txt',mimeType:'text/plain',buffer:Buffer.from('Учебное вложение')});
   const bounds=await composer.evaluate(el=>({width:document.documentElement.clientWidth,offenders:[...el.querySelectorAll('input,textarea,button')].filter(x=>x.getClientRects().length).map(x=>x.getBoundingClientRect().toJSON()).filter(r=>r.left<-1||r.right>document.documentElement.clientWidth+1)}));
   assert.equal(bounds.offenders.length,0,'Expanded composer fits '+width+': '+JSON.stringify(bounds));
   await page.screenshot({path:path.join(screens,'process-live-composer-'+width+'.png')});
   await composer.getByRole('button',{name:'Опубликовать',exact:true}).click();await page.locator('#process-published-ui-post').waitFor();
   const submitted=JSON.parse(await page.locator('#flow-output').textContent());assert.equal(submitted.actorKey,'teacher');assert.deepEqual(submitted.formalIds,['formal-demo']);assert.deepEqual(submitted.files,['Пояснение.txt']);assert(submitted.tags.includes('ходигры_gpyasu'));assert(submitted.body.includes('[Правовой портал](https://pravo.gov.ru/)'));
   await page.locator('#process-published-ui-post').getByRole('button',{name:'Редактировать',exact:true}).click();
   await page.getByRole('textbox',{name:'Текст публикации',exact:true}).fill('Отредактированный текст публикации.');
   await composer.getByRole('button',{name:'Сохранить изменения',exact:true}).click();assert((await page.locator('#process-published-ui-post .postRichText').textContent()).includes('Отредактированный'));
   await page.locator('#process-published-ui-post').getByRole('button',{name:'Изменить показатели',exact:true}).click();
   const editor=page.getByRole('dialog',{name:'Показатели публикации'});
   const heights=await editor.locator('.metricDirectorGrid .styledSelectTrigger,.metricValueControl').evaluateAll(nodes=>nodes.map(x=>x.getBoundingClientRect().height));
   assert.equal(heights.length,3);assert(Math.max(...heights)-Math.min(...heights)<=1,'Metric fields match: '+heights);
   await editor.getByRole('spinbutton',{name:'Новое значение',exact:true}).fill('71');await editor.getByLabel('Обоснование',{exact:true}).fill('Основание, связанное с публикацией.');
   await editor.getByRole('button',{name:'Применить изменение',exact:true}).click();await editor.getByRole('status').waitFor();
   assert.equal(metricCalls.at(-1).p_post_id,'published-ui-post');assert.equal(metricCalls.at(-1).p_value,71);
   await page.screenshot({path:path.join(screens,'process-live-metric-'+width+'.png')});
   await page.keyboard.press('Escape');assert.equal(await editor.count(),0,'Escape closes metric dialog');
   await page.getByRole('navigation',{name:'Проверяемый раздел'}).getByRole('button',{name:'Регистрация органа',exact:true}).click();
   await page.locator('.civicRegistration>summary').click();
   const body=page.locator('.civicCustomBody');await body.locator('summary').click();
   await page.getByRole('spinbutton',{name:'Установленный состав органа',exact:true}).fill('12');assert.equal(await page.getByRole('spinbutton',{name:'Установленный состав органа',exact:true}).inputValue(),'12');
   assert.deepEqual(errors,[],'No browser runtime errors');
   console.log('PASS Real registry, template, post editor, NPA picker, tags, inline link, attachment, metric RPC and body number at '+width+'px');
   await context.close();
  }
 }catch(e){console.error(logs);throw e}
 finally{if(browser)await browser.close();if(server)server.kill('SIGTERM');fs.rmSync(route,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
