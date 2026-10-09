/* Actual second-reading Panel; fictional HTTP fixtures. PostgreSQL security,
 * registered majority and publication are verified by rollback SQL separately. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto'),{chromium}=require('playwright-core');
const {startTestServer,stopTestServer,closeTestBrowser,cleanTestRoute}=require('./browser-test-runtime.cjs');
const root=path.resolve(__dirname,'..'),routeName='audit-budget-law-'+randomUUID().slice(0,8),dir=path.join(root,'app',routeName),port=4001;
const output=path.join(root,'.design-review','budget-law-amendments');
const source=`'use client';
import {useState} from 'react';
import BudgetLawAmendmentsPanel from '../../components/game/BudgetLawAmendmentsPanel';
import type {ReturnTypeRepublic} from '../../components/game/viewTypes';
export default function QA(){
 const [readOnly,setReadOnly]=useState(false),[notice,setNotice]=useState(''),[gate,setGate]=useState<any>(null);
 const document:any={id:'qa-budget-law',game_id:'qa-budget-game',workflow_key:'budget',doc_type:'federal_budget',status_code:'reading2',updated_at:'2026-10-09T00:00:00Z'};
 const g={game:{id:'qa-budget-game',status:'running'},me:{user_id:'qa-author',kind:'teacher'},teacher:true,members:[{user_id:'qa-author',full_name:'Учебный субъект инициативы'}],setError:(e:any)=>setNotice(String(e?.message||e)),refresh:async()=>{}} as unknown as ReturnTypeRepublic;
 return <main style={{maxWidth:1100,margin:'auto',padding:12,minWidth:0}}><button type="button" onClick={()=>setReadOnly(x=>!x)}>{readOnly?'Редактирование':'Только просмотр'}</button><BudgetLawAmendmentsPanel g={g} document={document} readOnly={readOnly} onOpenVotes={id=>setNotice('Голосование '+id)} onPendingChange={setGate}/><output id="qa-gate" data-checked={!!gate?.checked} data-pending={!!gate?.pending}/><output role="status" id="qa-notice">{notice}</output></main>;
}`;
function fixtures(){
 const c={revenue:40283300,expenditure:44069700,deficit:3786400,financing:3786401,cost:1,expense_items:[{id:'protected',amount:.00000001}],expense_lines:[{key:'04',label:'Национальная экономика',baseline:4843700,base_amount:4843700,amount:4843700},{key:'07',label:'Образование',baseline:1682900,base_amount:1682900,amount:1682900.00000001},{key:'09',label:'Здравоохранение',baseline:1904900,base_amount:1904900,amount:1904900},{key:'13',label:'Обслуживание государственного долга',baseline:3880900,base_amount:3880900,amount:3880900}]};
 return {state:{document_id:'qa-budget-law',status_code:'reading2',revision:1,subjects:['gd_deputy'],can_manage:true,can_submit:true,base_ready:true,pending_count:0,open_vote_id:null,calculation:structuredClone(c),first_reading:structuredClone(c),amendments:[],packs:[]},calls:[],selected:[],failRead:false};
}
async function transport(context,f){
 await context.route('https://budget-law-qa.supabase.co/**',async route=>{
  const req=route.request(),url=new URL(req.url()),rpc=url.pathname.split('/rpc/')[1];if(!rpc){await route.fulfill({status:200,json:[]});return;}
  const p=req.postDataJSON();f.calls.push({rpc,...p});let response=null;
  switch(rpc){
   case 'get_budget_law_amendments':if(f.failRead){await route.fulfill({status:400,json:{code:'P0001',message:'Не удалось проверить текущую редакцию бюджета'}});return;}response=f.state;break;
   case 'submit_budget_law_amendment':{
    assert.equal(p.p_document_id,'qa-budget-law');assert.equal(p.p_revision,f.state.revision);assert.equal(p.p_subject_key,'gd_deputy');
    f.state.amendments.push({id:'qa-amendment-'+f.state.amendments.length,author_id:'qa-author',subject_key:p.p_subject_key,title:p.p_title,rationale:p.p_rationale,competence_note:'',from_section:p.p_from,to_section:p.p_to,amount:p.p_amount,source_calculation:structuredClone(f.state.calculation),status:'submitted',vote_id:null,review_note:null,stale:false,can_withdraw:true});f.state.pending_count++;response=f.state.amendments.at(-1).id;break;
   }
   case 'open_budget_law_amendment_vote':{
    assert.equal(p.p_document_id,'qa-budget-law');f.selected=[...p.p_amendment_ids];assert.deepEqual(f.selected,['qa-amendment-0'],'Only checked amendment enters the package');
    f.state.open_vote_id='qa-selected-package';f.state.packs.unshift({id:'qa-pack',vote_id:'qa-selected-package',status:'voting',result_label:null});for(const a of f.state.amendments)if(f.selected.includes(a.id)){a.status='voting';a.vote_id=f.state.open_vote_id;a.can_withdraw=false;}response=f.state.open_vote_id;break;
   }
   case 'close_budget_law_amendment_vote':{
    assert.equal(p.p_vote_id,'qa-selected-package');f.state.open_vote_id=null;f.state.revision++;f.state.packs[0].status='accepted';f.state.packs[0].result_label='Выбранные бюджетные поправки приняты';
    for(const a of f.state.amendments){if(f.selected.includes(a.id)){a.status='accepted';f.state.pending_count--;for(const l of f.state.calculation.expense_lines)if(l.key===a.from_section||l.key===a.to_section){l.amount+=l.key===a.from_section?-a.amount:a.amount;l.base_amount+=l.key===a.from_section?-a.amount:a.amount;}}else if(a.status==='submitted')a.stale=true;}response={result:'passed'};break;
   }
   case 'reject_budget_law_amendment':{const a=f.state.amendments.find(x=>x.id===p.p_amendment_id);assert(a&&!f.selected.includes(a.id));assert(p.p_note.length>=10);a.status='rejected';a.review_note=p.p_note;a.can_withdraw=false;f.state.pending_count--;response=null;break;}
   default:throw Error('Unknown fixture RPC '+rpc);
  }
  await route.fulfill({status:200,json:response});
 });
}
async function layout(page,label){
 const result=await page.locator('main').evaluate(main=>({width:innerWidth,scroll:document.documentElement.scrollWidth,clipped:[...main.querySelectorAll('button,input,textarea')].filter(e=>e.getClientRects().length&&!e.closest('table')).filter(e=>{const r=e.getBoundingClientRect();return r.left< -1||r.right>innerWidth+1}).map(e=>e.getAttribute('aria-label')||e.textContent)}));
 assert(result.scroll<=result.width+2,label+': page overflow '+JSON.stringify(result));assert.deepEqual(result.clipped,[],label+': clipped controls');return result;
}
let server,browser,log='';
async function main(){
 fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(dir,'page.tsx'),source);
 try{
  server=startTestServer(root,port,{NEXT_PUBLIC_SUPABASE_URL:'https://budget-law-qa.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'qa-fictional-public'});for(const s of[server.stdout,server.stderr])s.on('data',x=>{log=(log+x).slice(-12000)});
  for(let n=0;n<120&&!log.includes('Ready in');n++){if(server.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,250));}assert(log.includes('Ready in'),log);
  browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/workspace/scratch/5f1ab6c9563c/browser-runtime/extracted/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});const results=[];
  for(const width of[320,1440]){
   const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'}),page=await context.newPage(),f=fixtures(),errors=[];page.on('pageerror',e=>errors.push(e.message));await transport(context,f);
   const response=await page.goto('http://127.0.0.1:'+port+'/'+routeName);assert.equal(response.status(),200,'QA page served');await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
   const panel=page.getByRole('region',{name:'Поправки ко второму чтению бюджета'});await panel.getByRole('heading',{name:'Предложить перераспределение',exact:true}).waitFor();await layout(page,'empty '+width);assert.equal(await page.locator('#qa-gate').getAttribute('data-checked'),'true');assert.equal(await page.locator('#qa-gate').getAttribute('data-pending'),'false');
   assert.equal(await panel.getByRole('button',{name:/Из какого раздела перенести/}).count(),1,'Project select component reused');
   await panel.getByLabel('Название поправки',{exact:true}).fill('Одна копейка на здравоохранение');await panel.getByLabel('Сумма перераспределения, ₽',{exact:true}).fill('0,01');await panel.getByLabel('Обоснование поправки',{exact:false}).fill('Направляем одну копейку на здравоохранение и сохраняем отдельные мероприятия и региональные заявки.');
   const submit=panel.getByRole('button',{name:'Внести бюджетную поправку',exact:true});
   if(await submit.isDisabled()){console.log('DEBUG disabled form',await panel.locator('form').evaluate(form=>({text:form.innerText,values:[...form.querySelectorAll('input,textarea')].map(e=>e.value)})),f.state);await panel.screenshot({path:path.join(output,'disabled-'+width+'.png')});}
   await submit.click();await panel.locator('[data-budget-law-amendment="qa-amendment-0"]').waitFor();assert.equal(f.calls.find(x=>x.rpc==='submit_budget_law_amendment').p_amount,.00000001,'Rubles/kopecks are canonical eight-decimal millions');
   assert.equal(await page.locator('#qa-gate').getAttribute('data-pending'),'true');
   await panel.getByLabel('Название поправки',{exact:true}).fill('Предложение вне выбранного пакета');await panel.getByLabel('Сумма перераспределения, ₽',{exact:true}).fill('1000000,00');await panel.getByLabel('Обоснование поправки',{exact:false}).fill('Это предложение рассматривается отдельно и не должно попасть в пакет без выбора депутата.');await panel.getByRole('button',{name:'Внести бюджетную поправку',exact:true}).click();await panel.locator('[data-budget-law-amendment="qa-amendment-1"]').waitFor();
   const first=panel.locator('[data-budget-law-amendment="qa-amendment-0"]');assert.match(await first.getByRole('table').innerText(),/0,01 ₽/);const colors=await first.getByRole('table').evaluate(table=>({before:getComputedStyle(table.querySelector('del')).backgroundColor,after:getComputedStyle(table.querySelector('ins')).backgroundColor}));assert.notEqual(colors.before,colors.after,'Before and after have distinct colors and labelled columns');await layout(page,'two proposals '+width);await panel.screenshot({path:path.join(output,'proposals-'+width+'.png')});
   await first.getByRole('checkbox',{name:'Включить в пакет: Одна копейка на здравоохранение',exact:true}).check();await panel.getByRole('button',{name:'Голосовать по выбранным поправкам',exact:true}).click();await panel.getByRole('button',{name:'Завершить голосование по пакету',exact:true}).waitFor();assert.deepEqual(f.selected,['qa-amendment-0']);assert.equal(f.state.amendments[1].status,'submitted','Unselected proposal remains separate');
   await panel.getByRole('button',{name:'Завершить голосование по пакету',exact:true}).click();await first.getByText('Принята и включена в проект',{exact:true}).waitFor();assert.equal(f.state.calculation.expenditure,f.state.first_reading.expenditure);assert.equal(f.state.calculation.revenue,f.state.first_reading.revenue);assert.equal(await page.locator('#qa-gate').getAttribute('data-pending'),'true','Unresolved unselected proposal keeps whole reading blocked');
   const second=panel.locator('[data-budget-law-amendment="qa-amendment-1"]');await second.getByLabel('Причина невключения в пакет',{exact:true}).fill('Обоснование требует новой редакции после рассмотрения выбранного пакета.');await second.getByRole('button',{name:'Не включать в пакет',exact:true}).click();await second.getByText('Отклонена',{exact:true}).waitFor();assert.equal(await page.locator('#qa-gate').getAttribute('data-pending'),'false');await layout(page,'accepted '+width);await panel.screenshot({path:path.join(output,'accepted-'+width+'.png')});
   await page.getByRole('button',{name:'Только просмотр',exact:true}).click();await panel.getByRole('button',{name:'Обновить поправки',exact:true}).waitFor();assert.equal(await panel.getByRole('button',{name:'Внести бюджетную поправку',exact:true}).count(),0,'Readonly cannot submit');assert.equal(await panel.getByRole('button',{name:'Голосовать по выбранным поправкам',exact:true}).count(),0,'Readonly cannot open packages');
   await page.getByRole('button',{name:'Редактирование',exact:true}).click();await panel.getByRole('button',{name:'Внести бюджетную поправку',exact:true}).waitFor();f.failRead=true;await panel.getByRole('button',{name:'Обновить поправки',exact:true}).click();await panel.getByRole('alert').waitFor();assert.equal(await page.locator('#qa-gate').getAttribute('data-checked'),'false','Failed load fails closed');assert.equal(await panel.getByRole('button',{name:'Внести бюджетную поправку',exact:true}).count(),0,'Failure cannot expose mutation form');
   assert.deepEqual(errors,[],'No uncaught runtime errors');results.push({width,result:'PASS',runtimeErrors:errors,transport:'simulated'});await context.close();console.log('PASS Budget second-reading Panel '+width+'px');
  }
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({result:'PASS',results},null,2));
 }finally{await closeTestBrowser(browser);await stopTestServer(server);cleanTestRoute(root,dir);}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
