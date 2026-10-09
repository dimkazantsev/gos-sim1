/* Actual Budget components with fictional HTTP fixtures. PostgreSQL authorization,
 * adoption, publication and one-time fiscal effects are verified separately. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto'),{chromium}=require('playwright-core');
const {startTestServer,stopTestServer,closeTestBrowser,cleanTestRoute}=require('./browser-test-runtime.cjs');
const root=path.resolve(__dirname,'..'),name='audit-budget-workflow-'+randomUUID().slice(0,8),dir=path.join(root,'app',name),port=3998;
const output=path.join(root,'.design-review','budget-workflow'),baseline=require('../data/federal-budget-2026.json'),references=require('../data/regions.json');
const Module=require('node:module'),ts=require('typescript'),resolve=Module._resolveFilename;
Module._resolveFilename=function(request,...args){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,...args)};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {calculateFederalBudget,newBudgetDraft}=require('../components/game/federalBudgetMath');

const pageSource=`'use client';
import {useState} from 'react';
import BudgetView from '../../components/game/BudgetView';
import BudgetDocumentAnnex from '../../components/game/BudgetDocumentAnnex';
import type {ReturnTypeRepublic} from '../../components/game/viewTypes';
export default function QA(){
 const [readOnly,setReadOnly]=useState(false),[notice,setNotice]=useState(''),[doc,setDoc]=useState<any>(null);
 const g={game:{id:'qa-budget-game',status:'active'},me:{user_id:'qa-budget-teacher',kind:'teacher',full_name:'Учебный преподаватель',role_title:'Преподаватель',roster_archived_at:null},teacher:true,members:[],parties:[],formalDocuments:[],votes:[],setError:(e:any)=>setNotice(String(e?.message||e)),refresh:async()=>{},refreshBudgetPulse:async()=>{}} as unknown as ReturnTypeRepublic;
 return <main className="budget-qa-shell"><aside aria-hidden="true">Учебная республика</aside><div className="budget-qa-content"><nav aria-label="Режим проверки"><button type="button" onClick={()=>setReadOnly(v=>!v)}>{readOnly?'Редактирование':'Только просмотр'}</button><button type="button" onClick={()=>setDoc(null)}>Вернуться к бюджету</button></nav>
 {!doc?<BudgetView g={g} readOnly={readOnly} onOpenDocument={id=>{setNotice('Открыт проект '+id);setDoc((window as any).__budgetDocument)}} onOpenVotes={id=>setNotice('Открыто голосование '+id)} onOpenEvents={()=>setNotice('Открыты региональные события')} onOpenStage={n=>setNotice('Открыт этап '+n)}/>:<BudgetDocumentAnnex document={doc} onOpenBudget={()=>setDoc(null)} onOpenVotes={id=>setNotice('Открыто голосование '+id)}/>}
 <output id="budget-test-output" role="status">{notice}</output></div><style>{'.budget-qa-shell{display:grid;grid-template-columns:240px minmax(0,1fr);gap:20px;max-width:1440px;padding:20px;margin:auto}.budget-qa-shell aside{padding:20px;border:1px solid #e2e4ef;border-radius:20px}.budget-qa-content{min-width:0}.budget-qa-content output{display:block;overflow-wrap:anywhere}.budget-qa-content>nav{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}@media(max-width:900px){.budget-qa-shell{display:block;padding:12px}.budget-qa-shell aside{display:none}}'}</style></main>;
}`;

function region(r,i){return {...r,region_code:r.code,game_id:'qa-budget-game',budget_year:2026,enterprises:900+i*7,employees_per_firm:14,monthly_wage:56000,profit_per_firm:3,consumption_per_firm:4,expenditure:24000+i*70,transfer_in:4000+i*15,debt:1800,budget_credit_cash:0,compliance:.92,activity_multiplier:1,cost_multiplier:1,observations:{}};}
function programme(id,status,year,amount){return {program:{id,game_id:'qa-budget-game',title:id==='qa-program-2026'?'Доступная медицина':'Программа вне расчётного года',responsible_ministry:'Министерство здравоохранения',total_budget:amount,status:status==='approved'?'adopted':'ready',signed_at:'2026-09-01T00:00:00Z',signed_by:'qa-budget-prime-minister'},commitment:{id:'commitment-'+id,program_id:id,game_id:'qa-budget-game',budget_year:year,amount,status,signed_at:'2026-09-01T00:00:00Z',signed_by:'qa-budget-prime-minister'},indicators:id==='qa-program-2026'?'Доля жителей с доступом к медицинской помощи: 70% → 95% к 2026 году.':'',expense_breakdown:id==='qa-program-2026'?[{indicator_name:'Один диагностический комплекс',justification:'Оснастить поликлинику для приёма 300 пациентов в смену.',amount,budget_year:year,component_title:'Новая районная поликлиника'}]:[]};}
function fixtures(){
 const regions=references.map(region),policy={key_rate:16,fx_rate:80,oil_price:75,cutoff_price:60,inflation:6,federal_expenditure:500000,municipal_expenditure:200000,baseline_economy:50,baseline_trust:50},context={policy,metrics:{economy:50,public_trust:50},can_change_rate:true};
 const state={anchor:{key_rate:16,fx_rate:80,oil_price:75,inflation:6,enterprises:regions.reduce((n,r)=>n+r.enterprises,0),economy:50,trust:50},internal_debt:baseline.internal_debt_end,external_debt:baseline.external_debt_end,reserve_remaining:baseline.reserve_available_model,service_adjustment:0,revenue_adjustment:0,last_financing:{...baseline.financing},last_plan_id:null,last_document_id:null,financing_rates:{},month:0,version:1};
 const regional_events=[{id:'qa-event-54',title:'Строительство районной поликлиники',situation:'Жители удалённых муниципальных округов Новосибирской области добираются до врача более двух часов. Регион предлагает построить поликлинику и обеспечить её инженерной инфраструктурой. Необходимо обосновать расходы, результат и региональное софинансирование до включения федеральной помощи в проект бюджета.',status:'ready',region_code:'54',assigned:false,budget_request:{section_key:'09',kind:'subsidy',amount:1250,cofinancing:250,expected_result:'Поликлиника на 300 посещений в смену введена в эксплуатацию, время поездки сокращено до 30 минут.',indicator:{name:'Время поездки до поликлиники',baseline:120,target:30,unit:'минут'},estimate:[{name:'Строительство и оснащение',amount:1200},{name:'Инженерная инфраструктура',amount:300}],justification:'Доступность медицинской помощи и замена изношенной муниципальной инфраструктуры.'}},{id:'qa-event-22',title:'Восстановление моста после паводка',situation:'Паводок повредил мост и прервал транспортное сообщение с тремя населёнными пунктами. Восстановление требует проверки сметы и приоритетов транспортной инфраструктуры.',status:'ready',region_code:'22',assigned:false,budget_request:{section_key:'04',kind:'subsidy',amount:500,cofinancing:100,expected_result:'Мост восстановлен и сообщение с населёнными пунктами открыто.',indicator:{name:'Доступные населённые пункты',baseline:0,target:3,unit:'пунктов'},estimate:[{name:'Восстановление моста',amount:600}],justification:'Паводок нарушил доставку товаров и доступ жителей к публичным услугам.'}}];
 const programmes=[programme('qa-program-2026','approved',2026,'123456789.12'),programme('qa-program-2027','approved',2027,'900000000.00'),programme('qa-program-planned','planned',2026,'700000000.00')];
 const restoredDraft={...newBudgetDraft(),base_reallocations:{'04':-.00000001,'09':.00000001}};
 return {regions,rates:[],context,state,regional_events,programmes,plans:[{id:'qa-restored-budget',title:restoredDraft.title,draft:restoredDraft,revision:1,status:'draft',document_id:null,registry_no:null,updated_at:'2026-10-09T00:00:00Z'}],requests:[],contracts:[],calls:[],unknownRpcs:[],failSave:false};
}
function filterRows(rows,url){
 return rows.filter(row=>[...url.searchParams].every(([key,value])=>{if(['select','order','limit','offset'].includes(key))return true;if(value.startsWith('eq.'))return String(row[key])===value.slice(3);if(value==='not.is.null')return row[key]!=null;if(value.startsWith('in.('))return value.slice(4,-1).split(',').includes(String(row[key]));return true;}));
}
async function mockTransport(context,page,f){
 await context.route('https://budget-workflow-qa.supabase.co/**',async route=>{
  const request=route.request(),url=new URL(request.url()),rpc=url.pathname.split('/rpc/')[1],p=rpc?request.postDataJSON():null;let response=[];
  if(rpc)f.calls.push({rpc,...p});
  switch(rpc){
   case 'get_fiscal_budget':response={regions:f.regions,rates:f.rates,proposals:[],ledger:[],can_propose:true};break;
   case 'get_fiscal_context':response=f.context;break;
   case 'get_fiscal_legal_plans':response={plans:[],programs:[]};break;
   case 'list_regional_cases':response=f.regional_events.map(e=>({...e,comic_scene:{region_code:e.region_code}}));break;
   case 'get_budget_simulator':response={state:f.state,plans:f.plans,requests:f.requests,contracts:f.contracts,ledger:[],can_prepare:true,can_request:true,event_count:f.regional_events.length,regional_events:f.regional_events};break;
   case 'get_signed_state_program_budget':response=f.programmes.map(x=>({...x.program,ministry:x.program.responsible_ministry,program_status:x.program.status,indicators:x.indicators,expense_breakdown:x.expense_breakdown,years:[{year:x.commitment.budget_year,amount:x.commitment.amount,status:x.commitment.status}]}));break;
   case 'get_budget_amendments':response={party_ids:[],can_open:true,can_apply:true,can_submit_neutral:true,amendments:[]};break;
   case 'start_regional_case':{const event=f.regional_events.find(e=>e.id===p.p_case_id);assert(event,'Only an actual regional event can be selected');event.assigned=true;event.status='assigned';response='qa-assignment-'+event.id;break;}
   case 'create_budget_event_transfer_request':{
    const event=f.regional_events.find(e=>e.id===p.p_event_case_id);assert(event?.assigned,'The event must be started before the request');
    assert.equal(event.region_code,p.p_region,'An event cannot be moved to a different region');
    assert(p.p_expected_result.trim().length>=20,'A request must specify its expected outcome');
    f.requests.unshift({id:'qa-transfer-'+f.requests.length,region_code:p.p_region,region_name:f.regions.find(r=>r.region_code===p.p_region).name,kind:p.p_kind,amount:p.p_amount,cofinancing:p.p_cofinancing,purpose:p.p_purpose,expected_result:p.p_expected_result,section_key:p.p_section,status:'requested',document_id:null,event_case_id:event.id,event_title:event.title});response=f.requests[0].id;break;
   }
   case 'save_budget_simulator':{
    if(f.failSave){await route.fulfill({status:400,json:{code:'P0001',message:'Учебное сохранение временно недоступно'}});return;}
    let plan=f.plans.find(x=>x.id===p.p_plan_id);if(!plan){plan={id:'qa-plan-'+f.plans.length,status:'draft',revision:0,document_id:null,registry_no:null,updated_at:'2026-10-09T00:00:00Z'};f.plans.unshift(plan);}
    Object.assign(plan,{title:p.p_draft.title,draft:structuredClone(p.p_draft),revision:plan.revision+1});response={id:plan.id,revision:plan.revision,draft:plan.draft};break;
   }
   case 'create_budget_simulator_document':{
    const plan=f.plans.find(x=>x.id===p.p_plan_id);assert(plan,'The law must use a saved shared plan');Object.assign(plan,{status:'document',document_id:'qa-budget-law',registry_no:'ФЗ-Б-2026-1'});
    const snapshot={...calculateFederalBudget(plan.draft,f.state,f.context,f.regions,f.rates,f.requests),transfer_requests:f.requests.filter(r=>plan.draft.transfer_ids.includes(r.id)),program_expenses:f.programmes.filter(p=>plan.draft.expense_items.some(i=>i.program_id===p.program.id)).map(p=>({program_id:p.program.id,title:p.program.title,indicators:p.indicators,expense_breakdown:p.expense_breakdown}))};
    await page.evaluate(doc=>window.__budgetDocument=doc,{id:'qa-budget-law',title:'О федеральном бюджете на 2026 год',document_type:'federal_law',registry_no:'ФЗ-Б-2026-1',status_code:'draft',metadata:{budget_simulator_plan_id:plan.id,budget_snapshot:snapshot,budget_amendments:[]}});response='qa-budget-law';break;
   }
   case undefined:{
    const table=url.pathname.split('/').at(-1);if(table==='state_program_budget_commitments')response=filterRows(f.programmes.map(p=>p.commitment),url);else if(table==='state_programs')response=filterRows(f.programmes.map(p=>p.program),url);break;
   }
   default:f.unknownRpcs.push(rpc);response=null;
  }
  await route.fulfill({status:200,json:response});
 });
}
async function layout(page,label){
 const result=await page.locator('main').evaluate(root=>{
  const visible=e=>!!e.getClientRects().length&&e.getBoundingClientRect().height>0;
  const clipped=[...root.querySelectorAll('button,input,textarea,.styledSelectTrigger')].filter(visible).filter(e=>!e.closest('table')).filter(e=>{const r=e.getBoundingClientRect();return r.left<-1||r.right>innerWidth+1}).map(e=>(e.getAttribute('aria-label')||e.textContent||e.tagName).slice(0,100));
  return {viewport:innerWidth,scroll:document.documentElement.scrollWidth,clipped};
 });
 assert(result.scroll<=result.viewport+2,label+': page overflow '+JSON.stringify(result));assert.deepEqual(result.clipped,[],label+': clipped controls');return result;
}
async function openTab(page,label){const nav=page.getByRole('tablist',{name:'Разделы бюджетного расчёта'});const button=nav.getByRole('tab').filter({hasText:label});assert.equal(await button.count(),1,'One tab for '+label);await button.click();assert.equal(await button.getAttribute('aria-selected'),'true','Active tab is exposed to assistive technology');}
let server,browser,log='';const runtimeRecoveries=[];
async function loadPage(page,width){
 const source=path.join(dir,'page.tsx');
 if(!fs.existsSync(source)){fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(source,pageSource);runtimeRecoveries.push({width,reason:'QA source missing before navigation'});}
 let response=await page.goto('http://127.0.0.1:'+port+'/'+name);
 if(response.status()===404){
  const existed=fs.existsSync(source);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(source,pageSource+'\n');runtimeRecoveries.push({width,reason:'Recreated isolated QA route after HTTP 404',sourcePreviouslyExisted:existed});
  await new Promise(r=>setTimeout(r,500));response=await page.goto('http://127.0.0.1:'+port+'/'+name);
 }
 assert.equal(response.status(),200,'QA page HTTP response; source exists='+fs.existsSync(source)+'; Next log='+log);
}
async function main(){
 fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(dir,'page.tsx'),pageSource);
 try{
  server=startTestServer(root,port,{NEXT_PUBLIC_SUPABASE_URL:'https://budget-workflow-qa.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'qa-public-fictional'});for(const s of [server.stdout,server.stderr])s.on('data',x=>{log=(log+x).slice(-12000)});
  for(let n=0;n<120&&!log.includes('Ready in');n++){if(server.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,250));}assert(log.includes('Ready in'),log);
  browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/workspace/scratch/5f1ab6c9563c/browser-runtime/extracted/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const results=[];
  for(const width of [320,390,768,1440]){
   const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'}),page=await context.newPage(),f=fixtures(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));await mockTransport(context,page,f);
   await loadPage(page,width);await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
   const sim=page.getByRole('region',{name:'Федеральный бюджетный симулятор'});await sim.locator('[data-budget-kpi=income]').waitFor();
   const nav=sim.getByRole('tablist',{name:'Разделы бюджетного расчёта'}),tabs=await nav.getByRole('tab').allTextContents();assert.deepEqual(tabs.map(s=>s.replace(/\s+/g,' ').trim().replace(/^\d+\s*/,'')),['Доходы','Регионы','Расходы','Баланс','Проект ФЗ']);
   await openTab(page,'Доходы');await layout(page,'income '+width);await sim.screenshot({path:path.join(output,'income-'+width+'.png')});
   assert.equal(await sim.getByRole('table',{name:/Доходы/}).count(),1,'Revenue is a real table');assert.equal(await sim.locator('[data-budget-income-detail]').count(),12,'Each revenue article shows its own formula');
   assert.match(await sim.innerText(),/Ставка/);assert.match(await sim.innerText(),/База/);assert.match(await sim.innerText(),/Налог на прибыль/);assert.match(await sim.innerText(),/Утилизационный сбор/);
   const initialBase=Number(await sim.locator('[data-budget-income-detail="vat"] [data-budget-base]').getAttribute('data-budget-base'));
   f.regions.find(r=>r.region_code==='54').enterprises*=1.1;
   await sim.getByRole('button',{name:'Обновить федеральный бюджет',exact:true}).click();
   await page.waitForFunction(base=>Number(document.querySelector('[data-budget-income-detail="vat"] [data-budget-base]')?.getAttribute('data-budget-base'))>base,initialBase);
   const expandedBase=Number(await sim.locator('[data-budget-income-detail="vat"] [data-budget-base]').getAttribute('data-budget-base'));
   const initialVat=Number(await sim.locator('[data-budget-income-detail="vat"] [data-budget-article-amount]').getAttribute('data-budget-article-amount'));
   f.rates.push({region_code:'00',tax_key:'vat',rate:24});await sim.getByRole('button',{name:'Обновить федеральный бюджет',exact:true}).click();
   await page.waitForFunction(amount=>Number(document.querySelector('[data-budget-income-detail="vat"] [data-budget-article-amount]')?.getAttribute('data-budget-article-amount'))>amount,initialVat);
   assert.match(await sim.locator('[data-budget-income-detail="vat"]').innerText(),/24%/,'The article displays the adopted game rate');
   assert(Math.abs(Number(await sim.locator('[data-budget-income-detail="vat"] [data-budget-base]').getAttribute('data-budget-base'))-expandedBase)<.1,'Tax policy is not silently counted as additional economic growth');
   await sim.getByText('Обоснованные изменения прогнозной базы',{exact:true}).click();await sim.getByLabel('Изменение базы: Нефтегазовые доходы, %').fill('-2.5');
   await sim.getByLabel('Название расчета').fill('Учебный бюджет: проверка полной процедуры');
   await sim.getByRole('button',{name:'Обновить федеральный бюджет',exact:true}).click();assert.equal(await sim.getByLabel('Изменение базы: Нефтегазовые доходы, %').inputValue(),'-2.5','Background refresh preserves an unfinished forecast');
   await openTab(page,'Регионы');await layout(page,'regions '+width);await sim.screenshot({path:path.join(output,'regions-'+width+'.png')});
   assert.equal(await sim.locator('svg path[role=button]').count(),89,'Every region can be reached from the map');
   const regionPath=sim.locator('svg path[role=button]').first();
   await regionPath.click();
   assert.equal(await regionPath.evaluate(el=>getComputedStyle(el).outlineStyle),'none','Pointer selection cannot create a rectangular SVG focus outline');
   assert.equal(await regionPath.evaluate(el=>getComputedStyle(el).boxShadow),'none','Pointer selection cannot create a rectangular box shadow');
   await regionPath.focus();
   assert.equal(await regionPath.evaluate(el=>getComputedStyle(el).outlineStyle),'none','Keyboard focus uses the region silhouette instead of a rectangle');
   await regionPath.press('Enter');
   assert.equal(await regionPath.getAttribute('aria-pressed'),'true','Keyboard activation selects the focused region');
   await sim.locator('svg path[role=button][aria-label^="Новосибирская область"]').click();
   assert.equal(await sim.getByRole('button',{name:/Включить в (проект|расходы)/}).count(),0,'Transfer approval is reserved for expenditure planning');
   const ownTransfers=f.regions.find(r=>r.region_code==='54').transfer_in,event=sim.locator('[data-budget-regional-event="qa-event-54"]');
   await event.getByRole('button',{name:'Начать событие',exact:true}).click();await event.getByRole('button',{name:'Подготовить заявку',exact:true}).waitFor();
   await event.getByRole('button',{name:'Подготовить заявку',exact:true}).click();const requestForm=sim.getByRole('region',{name:'Заявка по региональному событию'});
   assert.equal(await requestForm.getByLabel('Запрашиваемая сумма, ₽').inputValue(),'1250000000','The event estimate is translated to rubles for the author');
   await requestForm.getByLabel('Ожидаемый результат заявки').fill('');await requestForm.getByRole('button',{name:'Направить заявку в расходы',exact:true}).click();
   await sim.getByRole('alert').waitFor();assert.equal(f.calls.filter(c=>c.rpc==='create_budget_event_transfer_request').length,0,'An incomplete event outcome is rejected before mutation');
   await requestForm.getByLabel('Ожидаемый результат заявки').fill(f.regional_events[0].budget_request.expected_result);
   await layout(page,'event request form '+width);await requestForm.screenshot({path:path.join(output,'event-request-'+width+'.png')});
   await requestForm.getByRole('button',{name:'Направить заявку в расходы',exact:true}).click();await event.getByText('Заявка подана',{exact:true}).waitFor();
   const transferCall=f.calls.find(c=>c.rpc==='create_budget_event_transfer_request');assert.equal(transferCall.p_event_case_id,'qa-event-54');assert.equal(transferCall.p_region,'54');assert.equal(transferCall.p_amount,1250);assert.equal(transferCall.p_cofinancing,250);assert.equal(transferCall.p_section,'09');assert.equal(f.requests[0].status,'requested');assert.equal(f.regions.find(r=>r.region_code==='54').transfer_in,ownTransfers,'A saved request has not received money');
   assert.match(await sim.locator('svg path[role=button]').filter({has:page.locator('title',{hasText:'Новосибирская'})}).getAttribute('aria-label'),/ожидающих заявок 1/,'The regional map now reflects the request');
   await sim.getByRole('button',{name:'Таблица',exact:true}).click();assert.equal(await sim.getByRole('table',{name:'Доходы, расходы и заявки регионов · млн ₽'}).count(),1);await layout(page,'regional table '+width);await sim.getByRole('button',{name:'Карта',exact:true}).click();
   await openTab(page,'Расходы');await layout(page,'expenses '+width);await sim.screenshot({path:path.join(output,'expenses-'+width+'.png')});
   assert.equal(await sim.locator('[data-budget-expense]').count(),14,'All functional expenditure sections remain present');assert.match(await sim.innerText(),/Доступная медицина/);
   assert.equal(Number(await sim.locator('[data-budget-expense="04"] [data-budget-base-amount]').getAttribute('data-budget-base-amount')),4843699.99999999,'The source appropriation retains the one-kopeck reduction');assert.match(await sim.locator('[data-budget-expense="04"]').innerText(),/Поправки II чтения: -0,01 ₽/);assert.equal(Number(await sim.locator('[data-budget-expense="09"] [data-budget-base-amount]').getAttribute('data-budget-base-amount')),1904900.00000001,'The target appropriation retains the same one-kopeck increase');assert.match(await sim.locator('[data-budget-expense="09"]').innerText(),/Поправки II чтения: \+0,01 ₽/);
   const programmes=sim.getByRole('region',{name:'Государственные программы в расходах'});assert.equal(await programmes.getByRole('button',{name:'Включить программу',exact:true}).count(),1,'Only an adopted 2026 annual programme can be included');
   const programmeCard=programmes.locator('article').filter({hasText:'Доступная медицина'});await programmeCard.getByText('Расходы и показатели подписанной программы',{exact:true}).click();assert.match(await programmeCard.innerText(),/70% → 95%/);assert.match(await programmeCard.innerText(),/Один диагностический комплекс/);assert.match(await programmeCard.innerText(),/123\s*456\s*789,12/,'The actual signed programme estimate remains in rubles');
   if(width===320){
    const heading=await programmes.getByRole('heading',{name:'Государственные программы · 2026'}).boundingBox(),textColumn=await programmeCard.locator('div').first().boundingBox();assert(heading.width>180&&heading.height<70,'The programme heading is readable instead of wrapping by letters');assert(textColumn.width>200,'The programme title has a full mobile text column');
   }
   await programmes.getByRole('button',{name:/^Раздел расходов: Доступная медицина/}).click();await page.getByRole('option',{name:'Здравоохранение',exact:true}).click();
   await programmes.getByRole('button',{name:'Включить программу',exact:true}).click();assert.equal(await programmes.getByRole('button',{name:'Включить программу',exact:true}).count(),0,'The included annual programme cannot be added twice');
   await sim.getByText('Добавить расходное мероприятие',{exact:true}).click();await sim.getByLabel('Название мероприятия').fill('Дополнительные школьные места');await sim.getByLabel('Показатель и ожидаемый результат').fill('Введено 120 новых школьных мест');await sim.getByLabel('Сумма нового расхода, ₽').fill('123456789,12');await sim.getByLabel('Обоснование нового расхода').fill('Устранение дефицита школьных мест в быстрорастущем муниципальном округе.');
   await sim.getByRole('button',{name:/^Раздел нового расхода/}).click();await page.getByRole('option',{name:'Образование',exact:true}).click();await sim.getByRole('button',{name:'Добавить в расходы',exact:true}).click();assert.equal(await sim.locator('[data-budget-expense-item]').count(),2,'Programme and authored expense have separate justifications');
   await sim.getByText('Изменить объём базовых обязательств',{exact:true}).click();await sim.getByLabel('Изменение расходов: Здравоохранение, %').fill('100');
   const beforeTransfer=Number(await sim.locator('[data-budget-expense-total]').getAttribute('data-budget-expense-total')),requestCard=sim.locator('[data-budget-request="qa-transfer-0"]');assert.match(await requestCard.innerText(),/Строительство районной поликлиники/);assert.match(await requestCard.innerText(),/Ожидаемый результат/);
   await requestCard.getByRole('button',{name:'Включить в расходы',exact:true}).click();assert.equal(await requestCard.getByRole('button',{name:'Исключить из расходов',exact:true}).count(),1);
   assert(Math.abs(Number(await sim.locator('[data-budget-expense-total]').getAttribute('data-budget-expense-total'))-beforeTransfer-1250)<.000001,'The selected subsidy is added once to the healthcare total');
   assert.equal(f.requests[0].status,'requested','Local expenditure approval still does not grant money');
   await openTab(page,'Баланс');await layout(page,'balance '+width);assert.equal(await sim.locator('[data-financing-source]').count(),7,'Borrowing and reserve sources remain separate from revenue');
   await sim.locator('[data-financing-source="bank_credit"]').getByLabel(/Объ[её]м, трлн ₽/).fill('0.0161');await sim.locator('[data-financing-source="external"]').getByLabel(/Объ[её]м, трлн ₽/).fill('0.0323');
   assert(Number(await sim.locator('[data-budget-funding-gap]').getAttribute('data-budget-funding-gap'))>0,'Additional obligations must be financed');
   await sim.locator('[data-financing-source="ofz_fixed"]').getByRole('button',{name:'Покрыть остаток',exact:true}).click();assert.equal(Number(await sim.locator('[data-budget-funding-gap]').getAttribute('data-budget-funding-gap')),0,'Gap closure also finances the new coupon cost with no residual kopeck');
   await openTab(page,'Проект ФЗ');await layout(page,'law '+width);await sim.screenshot({path:path.join(output,'law-'+width+'.png')});
   assert.match(await sim.innerText(),/Первое чтение ГД/);assert.match(await sim.innerText(),/Второе чтение ГД/);assert.match(await sim.innerText(),/Третье чтение ГД/);assert.match(await sim.innerText(),/Совет Федерации, Президент и опубликование/);
   await sim.getByLabel('Обоснование и приоритеты').fill('Увеличиваем доступность медицинской помощи, сохраняем точные годовые ассигнования программы и смету региональной поликлиники. Дополнительные расходы и проценты покрываем размещением ОФЗ.');
   f.failSave=true;await sim.getByRole('button',{name:'Сохранить общий расчёт',exact:true}).click();await sim.getByRole('alert').waitFor();assert.equal(await sim.getByLabel('Название расчета').inputValue(),'Учебный бюджет: проверка полной процедуры','An unsuccessful save preserves the local draft');assert.equal(f.plans.length,1);assert.equal(f.plans[0].revision,1,'Failed save cannot overwrite the shared revision');f.failSave=false;
   await sim.getByRole('button',{name:'Сохранить общий расчёт',exact:true}).click();await sim.getByRole('status').filter({hasText:'Расчет сохранен для всей группы'}).waitFor();
   const saved=f.calls.filter(c=>c.rpc==='save_budget_simulator').at(-1).p_draft;assert.deepEqual(saved.base_reallocations,{'04':-.00000001,'09':.00000001},'A canonical second-reading reallocation survives ordinary editing and resaving');assert.deepEqual(saved.transfer_ids,['qa-transfer-0']);assert.equal(saved.expense_items.filter(i=>i.program_id==='qa-program-2026').length,1);assert.equal(saved.expense_items.find(i=>i.program_id==='qa-program-2026').amount,123.45678912);assert.match(saved.expense_items.find(i=>i.program_id==='qa-program-2026').indicator,/70% → 95%/);assert.equal(saved.expense_items.find(i=>i.title==='Дополнительные школьные места').amount,123.45678912);assert.equal(saved.spending_changes['09'],100);assert.equal(saved.financing.bank_credit,16100,'Decimal-billion input is canonical in the RPC payload');assert.equal(saved.financing.external,32300,'Another decimal-billion input is canonical');assert.equal(f.state.last_plan_id,null,'Saving does not enact the federal budget');
   const projectTabs=sim.getByRole('tablist',{name:'Сохранённые проекты бюджета'});
   assert.equal(await projectTabs.getByRole('tab').count(),2,'Saved project and new-variant tabs replace the disconnected button');
   await projectTabs.getByRole('tab',{name:/Создать вариант/}).click();
   await sim.getByLabel('Название расчета').fill('Альтернативный вариант без сохранения');
   await projectTabs.getByRole('tab',{name:/Учебный бюджет: проверка полной процедуры/}).click();
   assert.equal(await sim.getByLabel('Название расчета').inputValue(),'Учебный бюджет: проверка полной процедуры','Switching returns to saved plan');
   await projectTabs.getByRole('tab',{name:/Новый вариант/}).click();
   assert.equal(await sim.getByLabel('Название расчета').inputValue(),'Альтернативный вариант без сохранения','Unsaved draft survives switching');
   await projectTabs.getByRole('tab',{name:/Учебный бюджет: проверка полной процедуры/}).click();
   await sim.getByRole('button',{name:'Создать проект ФЗ о бюджете',exact:true}).click();const annex=page.getByRole('region',{name:'Расчётные приложения к бюджету'});await annex.waitFor();assert.equal(f.state.last_plan_id,null,'Creating the law does not bypass Duma, Council or presidential signature');
   await annex.getByText('Приложение 1. Ставки, базы и статьи доходов',{exact:true}).click();assert.equal(await annex.getByRole('table',{name:'Денежные базы и доходы · млн ₽'}).locator('tbody tr').count(),12,'The law retains the exact detailed revenue breakdown');
   await annex.getByText('Приложение 3. Государственные программы и мероприятия',{exact:true}).click();const itemTable=annex.getByRole('table',{name:'Подробные ассигнования · ₽'});assert.equal(await itemTable.locator('tbody tr').count(),2);assert.match(await itemTable.innerText(),/123\s*456\s*789,12/,'The annex preserves itemised rubles and kopecks');
   const programmeEstimate=annex.getByRole('table',{name:'Подписанная смета госпрограммы на 2026 год · ₽'});assert.equal(await programmeEstimate.locator('tbody tr').count(),1,'The original signed programme expense is also present');assert.match(await programmeEstimate.innerText(),/Один диагностический комплекс/);assert.match(await programmeEstimate.innerText(),/123\s*456\s*789,12/);assert.match(await annex.innerText(),/70% → 95%/);
   await annex.getByText('Приложение 4. Утверждаемые региональные заявки',{exact:true}).click();assert.match(await annex.innerText(),/Строительство районной поликлиники/);assert.match(await annex.innerText(),/300 посещений/);await layout(page,'law annex '+width);await annex.screenshot({path:path.join(output,'annex-'+width+'.png')});
   await page.getByRole('button',{name:'Вернуться к бюджету',exact:true}).click();await sim.locator('[data-budget-kpi=income]').waitFor();
   await page.getByRole('button',{name:'Только просмотр',exact:true}).click();await openTab(page,'Доходы');assert(await sim.getByLabel('Название расчета').isDisabled(),'Readonly mode protects the shared title');
   await openTab(page,'Проект ФЗ');const save=sim.getByRole('button',{name:'Сохранить общий расчёт',exact:true}),create=sim.getByRole('button',{name:/(Создать проект ФЗ о бюджете|Открыть проект в реестре)/});assert(await save.isDisabled(),'Readonly cannot save a shared plan');assert(await create.isDisabled(),'Readonly cannot create a federal law');
   await nav.getByRole('tab').filter({hasText:'Регионы'}).focus();await page.keyboard.press('Enter');assert.equal(await nav.getByRole('tab').filter({hasText:'Регионы'}).getAttribute('aria-selected'),'true','The flow can be followed with the keyboard');await page.keyboard.press('ArrowRight');assert.equal(await nav.getByRole('tab').filter({hasText:'Расходы'}).getAttribute('aria-selected'),'true','Arrow-key navigation follows the sequential flow');await page.keyboard.press('Home');assert.equal(await nav.getByRole('tab').filter({hasText:'Доходы'}).getAttribute('aria-selected'),'true');await page.keyboard.press('End');assert.equal(await nav.getByRole('tab').filter({hasText:'Проект ФЗ'}).getAttribute('aria-selected'),'true');
   assert.equal(f.state.last_plan_id,null,'Browsing and editing do not enact a budget');assert.deepEqual(errors,[],'No uncaught browser runtime errors');assert.deepEqual(f.unknownRpcs,[],'Every mocked RPC must have an explicit fixture');
   results.push({width,result:'PASS',runtimeErrors:errors,transport:'simulated'});await context.unrouteAll({behavior:'ignoreErrors'});await context.close();console.log('PASS Budget workflow component layout '+width+'px');
  }
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({result:'PASS',results,runtimeRecoveries},null,2));
 }finally{await closeTestBrowser(browser);await stopTestServer(server);cleanTestRoute(root,dir);}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
