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
// This isolated UI fixture presents an adopted act for revision/signing controls.
Object.assign(initial.formalDocuments[1],{current_step:3,status_code:'signed',status_label:'Подписано',metadata:{revision:1}});
export default function FlowCheck(){
 const [data,setData]=useState<any>(initial),[view,setView]=useState('registry'),[output,setOutput]=useState('');
 useEffect(()=>{document.body.dataset.flowReady='yes'},[]);
 const g={...data,availableActors:()=>data.teacher?[{key:'teacher',label:'GOS//SIMS · Нейтральная публикация'},{key:'participant',label:data.me.full_name},{key:'minjust',label:'Министерство юстиции Российской Федерации'},{key:'gd',label:'Государственная Дума'}]:[{key:'participant',label:data.me.full_name},{key:'office',label:data.me.role_title},{key:'gd',label:'Государственная Дума'}],
  refresh:async()=>{setData((old:any)=>{const deleted=(window as any).__flowDeleted||[],approved=(window as any).__flowApproved||[];return {...old,politicalPosts:[...approved.filter((p:any)=>!old.politicalPosts.some((x:any)=>x.id===p.id)),...old.politicalPosts].filter((p:any)=>!deleted.includes(p.id))}})},setError:(message:string)=>setOutput(message),judgeAction:async()=>true,
  createPoliticalPost:async(p:any,files:File[])=>{
   setOutput(JSON.stringify({...p,files:files.map(f=>f.name)}));
   setData((old:any)=>({...old,politicalPosts:[{...old.politicalPosts[0],id:'published-ui-post',author_id:old.me.user_id,title:p.title,body:p.body,tags:p.tags,actor_key:p.actorKey,actor_label:p.actorKey==='teacher'?'GOS//SIMS':p.actorLabel,source_key:null,context:{stage_no:11},created_at:new Date().toISOString()},...old.politicalPosts],postFormalLinks:[...old.postFormalLinks,...p.formalIds.map((id:string)=>({post_id:'published-ui-post',formal_document_id:id}))]}));return 'published-ui-post';
  },updatePoliticalPost:async(id:string,p:any)=>{setData((old:any)=>({...old,politicalPosts:old.politicalPosts.map((x:any)=>x.id===id?{...x,title:p.title,body:p.body,tags:p.tags}:x)}));return true},
  addMediaToPoliticalPost:async()=>true,createVoteFromPost:async()=>null,
  createFormalDocument:async()=>null,advanceFormalDocument:async()=>false,
  updateFormalDraft:async(id:string,title:string,body:string,metadata:any)=>{setOutput(JSON.stringify({kind:'document-edit',id,title,body,metadata}));setData((old:any)=>({...old,formalDocuments:old.formalDocuments.map((d:any)=>d.id===id?{...d,title,body_text:body,metadata:{...d.metadata,revision:(d.metadata?.revision||1)+1},updated_at:new Date().toISOString()}:d)}));return true},acceptPoliticalPost:async()=>true,rejectPoliticalPost:async()=>true
 } as unknown as ReturnTypeRepublic;
 return <main style={{padding:'16px',maxWidth:1120,margin:'0 auto'}}>
  <nav aria-label="Проверяемый раздел" style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:20}}><button onClick={()=>setView('registry')}>Правовой портал</button><button onClick={()=>setView('process')}>Политический процесс</button><button onClick={()=>setView('body')}>Регистрация органа</button><button onClick={()=>setData((old:any)=>({...old,teacher:!old.teacher,me:old.teacher?old.members[1]:initial.me}))}>{data.teacher?'Режим участника':'Режим преподавателя'}</button></nav>
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
  for(const width of [320,390,768,1440]){
   const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce',hasTouch:width<600,isMobile:width<600});
   const page=await context.newPage(),errors=[],metricCalls=[],toolCalls=[],discussions=new Map(),deleted=[],proposals=[];page.on('pageerror',e=>errors.push(e.message));
   function discussion(kind,id){const key=kind+':'+id;if(!discussions.has(key))discussions.set(key,{likes:2,dislikes:0,mine:0,views:7,comment_count:0,comments:[],recorded:false});return discussions.get(key)}
   await page.route('https://*.supabase.co/**',async route=>{
    const url=route.request().url(),rpc=url.split('/rpc/')[1]?.split('?')[0],p=rpc?route.request().postDataJSON():null;let response=rpc?null:[];
    if(rpc==='set_post_state_metric')metricCalls.push(p);
    if(rpc==='get_formal_document_tools')response={can_edit:p.p_document_id!=='formal-demo',can_manage:true,can_copy:true,can_sign:p.p_document_id!=='formal-demo',vote_required:p.p_document_id==='formal-demo',open_vote:p.p_document_id==='formal-demo',next_owner:'system',next_action:'Опубликовать'};
    if(['send_formal_document','sign_formal_document'].includes(rpc)){toolCalls.push({rpc,...p});response=1}
    if(['get_civic_discussion','record_civic_view','react_to_civic_content','comment_on_civic_content','delete_civic_comment'].includes(rpc)){
     const d=discussion(p.p_kind||'post',p.p_target||'');
     if(rpc==='record_civic_view'&&!d.recorded){d.views++;d.recorded=true}
     if(rpc==='react_to_civic_content'){if(d.mine===1)d.likes--;if(d.mine===-1)d.dislikes--;d.mine=p.p_value;if(d.mine===1)d.likes++;if(d.mine===-1)d.dislikes++}
     if(rpc==='comment_on_civic_content'){d.comments.push({id:'comment-ui-'+d.comments.length,author_id:'teacher-demo',full_name:'Преподаватель',body:p.p_body,created_at:new Date().toISOString()});d.comment_count=d.comments.length;response='comment-ui-0'}
     if(rpc==='delete_civic_comment'){for(const data of discussions.values()){data.comments=data.comments.filter(x=>x.id!==p.p_comment_id);data.comment_count=data.comments.length}}
     if(rpc==='get_civic_discussion')response=d;
    }
    if(url.includes('/rest/v1/media_news_proposals'))response=proposals.filter(x=>!url.includes('status=eq.pending')||x.status==='pending');
    if(rpc==='submit_media_news'){toolCalls.push({rpc,...p});proposals.push({id:'proposal-ui',author_id:'student-0',title:p.p_title,body:p.p_body,tags:p.p_tags,submitted_actor:p.p_actor_key==='office'?'Депутат Государственной Думы':'Анна Миронова',status:'pending',review_note:null,created_at:new Date().toISOString(),post_id:null,formal_ids:p.p_formal_ids,external_url:p.p_external_url,internal_view:p.p_internal_view,files:p.p_files});response='proposal-ui'}
    if(rpc==='review_media_news'){toolCalls.push({rpc,...p});const proposal=proposals.find(x=>x.id===p.p_proposal_id);proposal.status=p.p_approve?'approved':'rejected';proposal.review_note=p.p_note;response='published-media-ui-post';if(p.p_approve)await page.evaluate(item=>{window.__flowApproved=[item]},{...fixture.politicalPosts[0],id:response,actor_key:'media',actor_label:'Средства массовой информации',author_id:proposal.author_id,title:proposal.title,body:proposal.body,source_key:'media:proposal-ui',context:{automatic:true},created_at:new Date().toISOString()})}
    if(rpc==='delete_process_post'){toolCalls.push({rpc,...p});deleted.push(p.p_post_id);await page.evaluate(ids=>{window.__flowDeleted=ids},deleted)}
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(response)});
   });
   await page.goto(address);await page.waitForFunction(()=>document.body.dataset.flowReady==='yes');
   await page.locator('.formalRegistryRow').first().click();await page.locator('.formalPaper').waitFor({state:'visible'});
   assert.equal(await page.getByRole('button',{name:'Редактировать текст',exact:true}).count(),0,'An open ballot locks document editing');
   await page.getByRole('button',{name:'Процедура и история',exact:true}).click();await page.locator('.formalActions').waitFor({state:'visible'});
   await page.getByRole('button',{name:'К списку документов',exact:true}).click();await page.locator('.formalRegistry').waitFor({state:'visible'});
   await page.locator('.formalRegistryRow').filter({hasText:'— документ 1'}).click();
   await page.getByRole('button',{name:'Редактировать текст',exact:true}).first().click();
   await page.getByRole('textbox',{name:'Название редактируемого документа',exact:true}).fill('Уточнённое постановление');
   await page.getByRole('textbox',{name:'Редактируемый текст документа',exact:true}).fill('Новая редакция учебного постановления.');
   if(width<600)assert.equal(await page.locator('.formalEditBody').evaluate(el=>getComputedStyle(el).fontSize),'16px','Readable mobile text prevents automatic input zoom');
   await page.screenshot({path:path.join(screens,'registry-live-editor-'+width+'.png')});
   await page.getByRole('button',{name:'Сохранить текст',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('.formalPaperBody')?.textContent.includes('Новая редакция'));
   const savedDoc=JSON.parse(await page.locator('#flow-output').textContent());assert.equal(savedDoc.kind,'document-edit');assert.equal(savedDoc.metadata.expected_revision,1,'Save includes the revision being edited');
   const delivery=page.locator('.documentDelivery');await delivery.locator('summary').click();
   await delivery.getByRole('button',{name:/Получатель/}).click();await page.getByRole('option',{name:/Анна Миронова/}).first().click();
   await delivery.getByLabel('Сопроводительный текст',{exact:true}).fill('Ознакомьтесь с новой редакцией.');
   await delivery.getByRole('button',{name:'Направить копию',exact:true}).click();
   await page.locator('.documentToolSuccess').filter({hasText:'Документ направлен'}).waitFor();
   assert.equal(toolCalls.filter(x=>x.rpc==='send_formal_document').at(-1).p_recipient_id,'student-0');
   assert.equal(toolCalls.filter(x=>x.rpc==='send_formal_document').at(-1).p_move,false);
   await page.getByRole('button',{name:'Подписать редакцию',exact:true}).click();await page.locator('.documentToolSuccess').filter({hasText:'Редакция подписана'}).waitFor();
   assert.equal(toolCalls.filter(x=>x.rpc==='sign_formal_document').at(-1).p_document_id,'formal-long-0');
   const docDiscussion=page.locator('.formalDetail>.civicDiscussion');await docDiscussion.getByRole('button',{name:'Нравится',exact:true}).scrollIntoViewIfNeeded();
   await page.waitForFunction(()=>!document.querySelector('.formalDetail .civicDiscussionStats button')?.disabled);
   await docDiscussion.getByRole('button',{name:'Нравится',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.formalDetail .civicDiscussionStats button[aria-label="Нравится"]')?.textContent==='3');
   await docDiscussion.getByRole('button',{name:'Не нравится',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.formalDetail .civicDiscussionStats button[aria-label="Нравится"]')?.textContent==='2');
   await docDiscussion.getByRole('button',{name:/Комментарии/}).click();await docDiscussion.getByRole('textbox',{name:'Ваш комментарий',exact:true}).fill('Комментарий к новой редакции документа.');
   await docDiscussion.getByRole('button',{name:'Отправить',exact:true}).click();await docDiscussion.locator('.civicCommentContent p').filter({hasText:'Комментарий к новой редакции'}).waitFor();
   const historyPosition=await page.locator('.formalDetail').evaluate(el=>{const paper=el.querySelector('.formalPaper').getBoundingClientRect(),history=el.querySelector('.formalHistory').getBoundingClientRect();return history.top>=paper.bottom});assert(historyPosition,'Document history is below the document');
   await page.screenshot({path:path.join(screens,'registry-live-discussion-'+width+'.png')});
   await page.getByRole('button',{name:'К списку документов',exact:true}).click();
   await page.getByRole('button',{name:/Создать \/ загрузить/}).click();
   await page.getByRole('button',{name:'Использовать образец',exact:true}).click();
   assert((await page.locator('.formalTextEditor').inputValue()).length>30,'Editable template opens');
   await page.locator('.formalTextEditor').fill('Текст документа для проверки редактора.');
   await page.getByRole('navigation',{name:'Проверяемый раздел'}).getByRole('button',{name:'Политический процесс',exact:true}).click();
   await page.locator('.wallPostAvatar img[alt="GOS//SIMS"]').evaluate(img=>img.decode());
   await page.locator('#process-rating-demo .ratingNewsVisual').scrollIntoViewIfNeeded();
   assert.equal(await page.locator('#process-rating-demo .ratingVisualValues').textContent(),'Было 65 %Стало 68 %','News shows recorded before/after values');
   await page.screenshot({path:path.join(screens,'process-live-news-'+width+'.png')});
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
   const postEditor=page.locator('#process-published-ui-post .processInlineEditor');await postEditor.waitFor();
   await composer.locator('summary').first().click();
   await composer.getByRole('textbox',{name:'Заголовок публикации',exact:true}).fill('Новый черновик сохранён');
   await postEditor.getByRole('textbox',{name:'Редактируемый текст публикации',exact:true}).fill('Отредактированный текст публикации.');
   await postEditor.getByRole('button',{name:'Сохранить изменения',exact:true}).click();
   assert.equal(await composer.getByRole('textbox',{name:'Заголовок публикации',exact:true}).inputValue(),'Новый черновик сохранён','Editing preserves creation draft');
   await composer.locator('summary').first().click();assert((await page.locator('#process-published-ui-post .postRichText').textContent()).includes('Отредактированный'));
   const postDiscussion=page.locator('#process-published-ui-post .civicDiscussion');await postDiscussion.scrollIntoViewIfNeeded();
   await page.waitForFunction(()=>!document.querySelector('#process-published-ui-post button[aria-label="Нравится"]')?.disabled);
   await postDiscussion.getByRole('button',{name:'Нравится',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#process-published-ui-post button[aria-label="Нравится"]')?.getAttribute('aria-pressed')==='true');
   await postDiscussion.getByRole('button',{name:/Комментарии/}).click();await postDiscussion.getByRole('textbox',{name:'Ваш комментарий',exact:true}).fill('Комментарий к публикации.');
   await postDiscussion.getByRole('button',{name:'Отправить',exact:true}).click();await postDiscussion.locator('.civicComment').waitFor();
   assert.equal(await postDiscussion.locator('.civicViewCount').textContent(),'8','Recorded participant view is shown');
   await page.screenshot({path:path.join(screens,'process-live-discussion-'+width+'.png')});
   await postDiscussion.getByRole('button',{name:'Удалить комментарий',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#process-published-ui-post .civicComment'));
   await page.locator('#process-published-ui-post').getByRole('button',{name:'Изменить показатели',exact:true}).click();
   const editor=page.getByRole('dialog',{name:'Показатели публикации'});
   const heights=await editor.locator('.metricDirectorGrid .styledSelectTrigger,.metricValueControl').evaluateAll(nodes=>nodes.map(x=>x.getBoundingClientRect().height));
   assert.equal(heights.length,3);assert(Math.max(...heights)-Math.min(...heights)<=1,'Metric fields match: '+heights);
   await editor.getByRole('spinbutton',{name:'Новое значение',exact:true}).fill('71');await editor.getByLabel('Обоснование',{exact:true}).fill('Основание, связанное с публикацией.');
   await editor.getByRole('button',{name:'Применить изменение',exact:true}).click();await editor.getByRole('status').waitFor();
   assert.equal(metricCalls.at(-1).p_post_id,'published-ui-post');assert.equal(metricCalls.at(-1).p_value,71);
   await page.screenshot({path:path.join(screens,'process-live-metric-'+width+'.png')});
   await page.keyboard.press('Escape');assert.equal(await editor.count(),0,'Escape closes metric dialog');
   await page.getByRole('navigation',{name:'Проверяемый раздел'}).getByRole('button',{name:'Режим участника',exact:true}).click();
   await composer.locator('summary').first().click();
   await composer.getByRole('button',{name:/Опубликовать от имени/}).click();await page.getByRole('option',{name:'Депутат Государственной Думы',exact:true}).click();
   await composer.getByRole('textbox',{name:'Заголовок публикации',exact:true}).fill('Новость участника для согласования');
   await composer.getByRole('textbox',{name:'Текст публикации',exact:true}).fill('Учебный материал для публичной новости.');
   await composer.getByRole('button',{name:'Предложить новость в СМИ',exact:true}).click();
   const queue=page.locator('.mediaProposalQueue');await queue.waitFor();await queue.locator('summary').click();
   await queue.getByRole('button',{name:/Новость участника для согласования/}).click();
   assert((await queue.locator('.mediaProposalBy').textContent()).includes('Депутат Государственной Думы'),'Office author is retained in the proposal');
   assert.equal(toolCalls.filter(x=>x.rpc==='submit_media_news').at(-1).p_actor_key,'office');
   await page.getByRole('navigation',{name:'Проверяемый раздел'}).getByRole('button',{name:'Режим преподавателя',exact:true}).click();
   await queue.getByLabel('Комментарий к решению',{exact:true}).fill('Согласовано для публикации.');
   await page.screenshot({path:path.join(screens,'process-live-news-review-'+width+'.png')});
   await queue.getByRole('button',{name:'Опубликовать в СМИ',exact:true}).click();await page.locator('#process-published-media-ui-post').waitFor();
   assert.equal(toolCalls.filter(x=>x.rpc==='review_media_news').at(-1).p_approve,true);
   page.once('dialog',dialog=>dialog.accept());await page.locator('#process-justice-demo').getByRole('button',{name:'Удалить публикацию',exact:true}).click();
   await page.waitForFunction(()=>!document.querySelector('#process-justice-demo'));
   assert.equal(toolCalls.filter(x=>x.rpc==='delete_process_post').at(-1).p_post_id,'justice-demo','Teacher can remove an automatic publication');
   const viewport=await page.locator('.processPortal').evaluate(el=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,offenders:[...el.querySelectorAll('input,textarea,button')].filter(x=>x.getClientRects().length).map(x=>x.getBoundingClientRect().toJSON()).filter(r=>r.left<-1||r.right>document.documentElement.clientWidth+1)}));
   assert.equal(viewport.offenders.length,0,'Process controls fit '+width+': '+JSON.stringify(viewport));assert(viewport.scroll<=viewport.width+1,'No horizontal page overflow at '+width);
   await page.getByRole('navigation',{name:'Проверяемый раздел'}).getByRole('button',{name:'Регистрация органа',exact:true}).click();
   await page.locator('.civicRegistration>summary').click();
   const body=page.locator('.civicCustomBody');await body.locator('summary').click();
   await page.getByRole('spinbutton',{name:'Установленный состав органа',exact:true}).fill('12');assert.equal(await page.getByRole('spinbutton',{name:'Установленный состав органа',exact:true}).inputValue(),'12');
   assert.deepEqual(errors,[],'No browser runtime errors');
   console.log('PASS Real registry revision/delivery/signing controls, document/post reactions/comments/views, inline editor with retained draft, student office proposal, teacher media approval/deletion, picker, tags, links, attachment, metric RPC and body number at '+width+'px');
   await context.close();
  }
 }catch(e){console.error(logs);throw e}
 finally{if(browser)await browser.close();if(server)server.kill('SIGTERM');fs.rmSync(route,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
