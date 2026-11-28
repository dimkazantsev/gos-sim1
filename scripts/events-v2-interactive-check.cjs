'use strict';
// Actual EventWorkspace, actual React click handlers and Supabase JS transport.
// The browser's REST requests are routed to a disposable PGlite fixture;
// this is NOT a hosted Supabase Auth/PostgREST/Realtime test.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright-core');
const {startTestServer,stopTestServer,cleanTestRoute,closeTestBrowser}=require('./browser-test-runtime.cjs');
module.exports=async function({db,q,rows,one,as,game,teacher,sender,expert,third,guest,sc,ac}){
 const root=path.resolve(__dirname,'..'),routeDir=path.join(root,'app','events-v2-ci-fixture');
 const port=3187,app='http://127.0.0.1:'+port,api='http://127.0.0.1:3188';
 assert.equal(process.env.GITHUB_ACTIONS,'true');assert.ok(!fs.existsSync(routeDir));
 const members=[{user_id:teacher,full_name:'Преподаватель',kind:'teacher',role_title:'Преподаватель'},{user_id:sender,full_name:'Первый участник',kind:'student',role_title:'Депутат'},{user_id:expert,full_name:'Второй участник',kind:'student',role_title:'Член экономического комитета'},{user_id:third,full_name:'Третий участник',kind:'student',role_title:'Депутат'},{user_id:guest,full_name:'Гость',kind:'observer',role_title:'Гость'}];
 const ids=Object.fromEntries(members.map(m=>[m.user_id,m.full_name]));
 const assign=(c,ids)=>one('SELECT public.assign_event_case_at_stage($1,$2,7) n',[c,ids]);
 await as(teacher);assert.equal((await assign(sc,[sender])).n,1);assert.equal((await assign(ac,[sender,expert,third])).n,3);await db.exec('RESET ROLE');
 const [singleTitle,allTitle]=await Promise.all([one('SELECT title FROM event_cases WHERE id=$1',[sc]),one('SELECT title FROM event_cases WHERE id=$1',[ac])]).then(x=>x.map(v=>v.title));
 fs.mkdirSync(routeDir);
 fs.writeFileSync(path.join(routeDir,'page.tsx'),`'use client';
import {useEffect,useState} from 'react';
import EventWorkspace from '../../components/game/EventWorkspace';
import {setGameRealtimeConnection} from '../../components/game/useGameTableSync';
import type {ReturnTypeRepublic} from '../../components/game/viewTypes';
const members=${JSON.stringify(members)},names=${JSON.stringify(ids)},game={id:${JSON.stringify(game)}};
export default function Fixture(){const [uid,setUid]=useState('');useEffect(()=>{setUid(new URLSearchParams(location.search).get('u')||'');setGameRealtimeConnection(game.id,true);return()=>setGameRealtimeConnection(game.id,false)},[]);const me=members.find(m=>m.user_id===uid);if(!me)return null;const g={game,me,members,teacher:me.kind==='teacher',names,profiles:[],parties:[],refreshEventEffects:async()=>{}} as unknown as ReturnTypeRepublic;return <main><EventWorkspace g={g} readOnly={me.kind==='observer'}/></main>}`);
 let server,browser,serverLog='',chain=Promise.resolve(),requests=[],unexpected=[];
 const headers={'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'*','content-type':'application/json'};
 const operations={
  get_event_workspace_feed_bootstrap:['SELECT public.get_event_workspace_feed_bootstrap($1,$2) v',b=>[b.p_game_id,b.p_include_ready_count]],
  list_visible_event_cases:['SELECT public.list_visible_event_cases($1,$2) v',b=>[b.p_game_id,b.p_case_ids]],
  invite_event_collaborator:['SELECT public.invite_event_collaborator($1,$2) v',b=>[b.p_case,b.p_recipient]],
  respond_event_invitation:['SELECT public.respond_event_invitation($1,$2) v',b=>[b.p_id,b.p_accept]],
  submit_event_decision:['SELECT public.submit_event_decision($1,$2,$3) v',b=>[b.p_assignment_id,b.p_choice,b.p_rationale]],
  finalize_event_case_round:['SELECT public.finalize_event_case_round($1,$2) v',b=>[b.p_case_id,b.p_round]]
 };
 async function context(u,width){
  const ctx=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
  await ctx.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin===app)return route.continue();
   if(url.origin!==api){unexpected.push(url.origin);return route.abort()}
   if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
   const op=url.pathname.replace('/rest/v1/','');let body=request.postDataJSON?.()||{};
   requests.push({u,op,method:request.method(),choice:body.p_choice});
   const task=chain.then(async()=>{
    try{
     await as(u);let data;
     if(op.startsWith('rpc/')&&operations[op.slice(4)]){
      const [sql,args]=operations[op.slice(4)];data=(await one(sql,args(body))).v??null;
     }else if(op==='event_case_routing'){data=[];} // no regional scenario in fixture
     else if(op==='event_discussion_messages'){data=[];} // no messages created
     else throw Error('Unexpected REST operation: '+op);
     await route.fulfill({status:200,headers,body:JSON.stringify(data)});
    }catch(e){unexpected.push(op+': '+e.message);await route.fulfill({status:400,headers,body:JSON.stringify({code:e.code||'TEST_ERROR',message:e.message})});}
    finally{await db.exec('RESET ROLE')}
   });chain=task.catch(()=>{});await task;
  });
  const page=await ctx.newPage();page.setDefaultTimeout(30000);
  await page.goto(app+'/events-v2-ci-fixture?u='+u,{waitUntil:'domcontentloaded',timeout:120000});
  return {ctx,page};
 }
 async function open(p,title){await p.bringToFront();await p.getByRole('button',{name:'Открыть ситуацию «'+title+'»',exact:true}).click();await p.getByRole('dialog').waitFor();}
 async function refresh(p){await p.bringToFront();await p.getByRole('button',{name:'Обновить список событий и результаты'}).click();}
 async function clickChoice(p,n){await p.getByRole('dialog').getByRole('button',{name:new RegExp('^Вариант '+n+'(?:\\s|$)')}).click();}
 async function waitText(p,s){await p.getByRole('dialog').getByText(s,{exact:false}).first().waitFor();}
 async function close(p){await p.getByRole('button',{name:'Закрыть событие'}).click();}
 try{
  server=startTestServer(root,port,{NEXT_PUBLIC_SUPABASE_URL:api,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'fixture-only',NEXT_TELEMETRY_DISABLED:'1'});
  for(const stream of [server.stdout,server.stderr])stream.on('data',x=>{serverLog=(serverLog+x).slice(-8000)});
  for(let i=0;i<100;i++){try{const r=await fetch(app+'/events-v2-ci-fixture');if(r.ok)break}catch{}if(i===99)throw Error('Local Next.js not ready: '+serverLog);await new Promise(r=>setTimeout(r,1000))}
  const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser','/opt/google/chrome/chrome'].find(p=>p&&fs.existsSync(p));assert.ok(chrome);
  browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
  const {page:p}=await context(sender,390);
  await open(p,singleTitle);assert.equal(await p.locator('[data-best-option]').count(),0);
  await p.getByLabel('Кому передать ситуацию').selectOption(expert);
  await p.getByRole('button',{name:'Передать ситуацию',exact:true}).click();
  await waitText(p,'Ожидаем подтверждения передачи ситуации.');
  const {page:e}=await context(expert,768);await open(e,singleTitle);
  await e.getByRole('button',{name:'Принять ситуацию',exact:true}).click();
  await e.locator('.eventAnswerChoice:enabled').first().waitFor();
  await clickChoice(e,1);await waitText(e,'Итог голосования:');
  await e.locator('[data-best-option=true]').waitFor();
  await waitText(e,'Учебное последствие');
  // Ensure the visible final details are refreshed, not only the outcome row.
  assert.equal(requests.filter(x=>x.u===expert&&x.op==='rpc/list_visible_event_cases').length>=2,true);
  await p.bringToFront();await refresh(p);await waitText(p,'Ситуация передана.');
  assert.equal(await p.locator('.eventAnswerChoice:enabled').count(),0);
  await close(p);await close(e);
  const {page:t}=await context(third,1440);
  for(const [page,n] of [[p,1],[e,2],[t,3]]){await open(page,allTitle);await clickChoice(page,n);await page.locator('.eventAnswerChoice:disabled').first().waitFor();}
  for(const [page,n] of [[p,1],[e,1],[t,2]]){await refresh(page);await waitText(page,'Второй тур голосования');await page.locator('.eventAnswerChoice:enabled').first().waitFor();await clickChoice(page,n);}
  await waitText(t,'Итог голосования:');assert.equal(await t.locator('[data-best-option]').count(),0);
  const {page:v}=await context(guest,320);await open(v,allTitle);assert.equal(await v.locator('.eventAnswerChoice:enabled').count(),0);
  const {page:teacherPage}=await context(teacher,1440);await open(teacherPage,singleTitle);await waitText(teacherPage,'Кредит кейса: 0,5 балла');
  await chain;await db.exec('RESET ROLE');
  assert.equal((await one('SELECT winner FROM event_case_outcomes WHERE case_id=$1',[sc])).winner,'option_1');
  assert.equal((await one('SELECT winner FROM event_case_outcomes WHERE case_id=$1',[ac])).winner,'option_1');
  assert.equal((await one('SELECT count(*)::int n FROM event_decisions WHERE case_id=$1',[ac])).n,6);
  assert.equal(requests.filter(r=>r.op==='rpc/submit_event_decision').length,7);
  assert.equal(requests.filter(r=>r.choice?.startsWith('round2:')).length,3);
  assert.deepEqual(unexpected.filter(x=>!x.startsWith('https://fonts.')),[]);
  console.log(JSON.stringify({result:'PASS real EventWorkspace clicks against isolated candidate SQL through intercepted REST',roles:5,votes:7,round2:3,requests:requests.length,externalRequests:unexpected.length,scope:'not hosted Auth/PostgREST/Realtime'}));
 }catch(e){console.error('Local browser test failed:',serverLog.slice(-3000));throw e}
 finally{await closeTestBrowser(browser);await chain;await stopTestServer(server);cleanTestRoute(root,routeDir)}
};
