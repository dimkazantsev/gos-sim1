/* Render real stage components with explicit fictional data; mock only transport.
   The test route is temporary and is removed even after a failed assertion. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright-core');
const {startTestServer,closeTestBrowser,stopTestServer,cleanTestRoute}=require('./browser-test-runtime.cjs');
const root=path.resolve(__dirname,'..'),routeDir=path.join(root,'app','stage-operations-test-route'),screens=path.join(root,'.design-review','screenshots');
const Module=require('node:module'),resolveFile=Module._resolveFilename;
Module._resolveFilename=function(request,...args){return resolveFile.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,...args)};
const chrome=[process.env.CHROME_BIN,chromium.executablePath(),'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser','/opt/google/chrome/chrome'].find(p=>p&&fs.existsSync(p));
if(!chrome)throw Error('Chromium is required');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pageSource=String.raw`'use client';
import {useEffect,useState} from 'react';
import StageWorkspace from '../../components/game/StageWorkspace';
import fixture from '../../.design-review/fixture.json';
import type {ReturnTypeRepublic} from '../../components/game/viewTypes';
export default function QA(){
 const [no,setNo]=useState(8),[kind,setKind]=useState('teacher'),[error,setError]=useState('');
 useEffect(()=>{document.body.dataset.stageQa='ready'},[]);
 const raw:any=fixture,me=kind==='teacher'?raw.me:{...raw.members.find((m:any)=>m.kind==='student'),kind};
 const data={...raw,game:{...raw.game,current_round:no},me,teacher:kind==='teacher',error,setError,currentStage:raw.stages.find((s:any)=>s.stage_no===no),
 crises:[{id:'crisis-qa',game_id:raw.game.id,status:'active',stage_no:15,crisis_type:'Наводнение',intensity:'high',description:'Учебный кризис: требуется согласовать эвакуацию и защиту инфраструктуры.',response_deadline:new Date(Date.now()+1200000).toISOString(),created_at:new Date().toISOString()}],
 availableActors:()=>[{key:'teacher',label:'Преподаватель'},{key:'participant',label:me.full_name}],canVote:()=>true,ballotWeight:()=>1,tally:()=>({yes:3,no:0,abstain:0}),quorum:()=>({eligible:5,present:3,cast:3,needed:3,met:true})};
 const record=(name:string,value:string)=>{document.body.dataset.qaNavigation=name+':'+value};
 const g=new Proxy(data,{get:(target:any,key)=>key in target?target[key]:()=>{}}) as ReturnTypeRepublic;
 return <><div style={{padding:8,display:'flex',gap:8,flexWrap:'wrap'}} aria-label="QA fixture controls"><select aria-label="QA stage" value={no} onChange={e=>{setNo(Number(e.target.value));setError('')}}>{Array.from({length:16},(_,i)=><option key={i} value={i+1}>{i+1}</option>)}</select><select aria-label="QA role" value={kind} onChange={e=>setKind(e.target.value)}>{['teacher','student','observer'].map(k=><option key={k}>{k}</option>)}</select></div>{error&&<p role="alert">{error}</p>}<main className="simMain" style={{width:'100%',maxWidth:1440,minWidth:0,margin:'0 auto',padding:'16px'}}><StageWorkspace key={no+kind} g={g} stage={{...raw.stages.find((s:any)=>s.stage_no===no),status:'open'}} onBack={()=>record('stage','all')} onOpenStage={setNo} onOpenVotes={id=>record('vote',id||'all')} onOpenDocument={id=>record('document',id)} onNavigate={view=>record('view',view)}/></main></>;
}`;
const now=new Date().toISOString(),game='design-preview',user='student-0';
const program={id:'program-qa',game_id:game,title:'Развитие городской среды',responsible_ministry:'Министерство социальной политики',responsible_minister_id:user,curator_id:'student-2',national_goal:'Комфортная и безопасная среда для жизни',participants:'Министерство и районные команды',start_date:'2026-01-01',end_date:'2026-12-31',total_budget:1000,expected_results:'Безопасность и доступность городской инфраструктуры',status:'draft',created_by:user,created_at:now,updated_at:now};
const portfolios=['social','economic','defence','foreign','internal'];
const units=portfolios.flatMap((key,i)=>['committee','ministry'].map(kind=>({id:kind+'-'+key,game_id:game,unit_kind:kind,unit_key:key,title:(kind==='committee'?'Комитет':'Министерство')+' '+['социальной политики','экономической политики','обороны и безопасности','внешней политики','внутренней политики'][i],description:'Учебное направление',mandate_capacity:kind==='committee'?90:null,capacity_min:3,capacity_max:5,head_user_id:'student-'+i})));
const districtKeys=['railway','industrial','lenin','october','central'];
const districts=districtKeys.map((district_key,i)=>({id:'district-'+i,game_id:game,district_key,title:['Железнодорожный','Индустриальный','Ленинский','Октябрьский','Центральный'][i]+' район',head_user_id:'student-'+i}));
const reflection={id:'reflection-qa',game_id:game,user_id:user,phase_key:'foundation',decision_memory:'Мы согласовали программу и распределили обязанности.',causal_analysis:'Распределение обязанностей повысило качество подготовки.',effectiveness:'Решение сократило время согласования документов.',improvement:'Добавить прозрачную историю принятых решений.',status:'submitted',teacher_feedback:'Покажите конкретный документ.',updated_at:now};
const project={id:'project-qa',game_id:game,team_name:'Октябрьская команда',district_key:'october',problem_title:'Безопасный путь к школе',location_text:'Барнаул, Октябрьский район',problem_description:'Полевые наблюдения подтверждают отсутствие безопасного перехода.',legal_competence:'Вопросы благоустройства и местной дорожной инфраструктуры.',proposed_solution:'Освещение, разметка и пешеходная инфраструктура.',estimated_cost:1500000,expected_effect:'Снижение риска для пешеходов и доступность маршрута.',status:'draft',created_by:user,created_at:now,updated_at:now};
const tables={institution_units:units,institution_assignments:units.map((u,i)=>({id:'assignment-'+i,game_id:game,unit_id:u.id,unit_kind:u.unit_kind,user_id:u.head_user_id,party_id:'party-0',assignment_role:'head',created_at:now})),government_structures:[{game_id:game,status:'approved',...Object.fromEntries(portfolios.map((key,i)=>[key+'_title',units.find(u=>u.unit_kind==='ministry'&&u.unit_key===key).title]))}],government_nominations:[{id:'nomination-qa',game_id:game,stage_no:8,office_key:'prime_minister',office_title:'Председатель Правительства Российской Федерации',office_kind:'prime_minister',route:'president_to_duma',candidate_user_id:user,candidate_name:'Анна Миронова',attempt_no:1,status:'appointed',vote_id:null,created_at:now}],institution_session_registrations:[],game_voting_body_members:[],game_office_assignments:[{game_id:game,user_id:user,status:'active',role_title:'Президент Российской Федерации'},{game_id:game,user_id:user,status:'active',role_title:'Министр социальной политики'}],state_programs:[program],state_program_goals:[{id:'goal-qa',game_id:game,program_id:program.id,goal_text:'Безопасный доступ к общественным услугам',indicator_name:'Доступность',unit:'%',baseline_value:70,target_value:90,target_year:2026}],state_program_components:[1,2,3].map(n=>({id:'component-'+n,game_id:game,program_id:program.id,direction_no:n,direction_title:'Направление '+n,component_kind:'project',title:'Развитие инфраструктуры '+n,goal_text:'Измеримый результат развития',start_date:'2026-01-01',end_date:'2026-12-31',budget:100})),state_program_budget_years:[],presidential_addresses:[{id:'address-qa',game_id:game,title:'Послание Президента',body_text:'Учебное послание о приоритетах развития государства.',video_url:'https://example.com/video',status:'draft',created_at:now,updated_at:now}],presidential_priorities:[{id:'priority-qa',game_id:game,address_id:'address-qa',priority_no:1,title:'Качество городской среды',description:'Учебный приоритет'}],government_sessions:[{id:'gov-session-qa',game_id:game,session_no:1,title:'Рассмотрение программ',time_limit_minutes:60,status:'draft',chair_user_id:'student-2',created_at:now}],government_program_agenda:[{id:'gov-item-qa',game_id:game,session_id:'gov-session-qa',program_id:program.id,agenda_no:1,report_minutes:7,status:'pending',vote_id:null}],duma_sessions:[{id:'duma-session-qa',game_id:game,session_no:1,title:'Парламентское заседание',status:'draft',chair_user_id:'student-1',scheduled_start:now,scheduled_end:new Date(Date.now()+3600000).toISOString(),created_at:now}],duma_agenda_items:[],municipal_districts:districts,municipal_district_members:districts.map((d,i)=>({id:'district-member-'+i,game_id:game,district_id:d.id,user_id:'student-'+i,assignment_role:'head'})),municipal_mayor_elections:[],municipal_mayor_candidates:[],municipal_mayor_ballots:[],municipal_projects:[project],municipal_project_members:[{project_id:project.id,game_id:game,user_id:user}],municipal_project_evidence:[],game_reflections:[reflection],crisis_information_requests:[{id:'request-qa',crisis_id:'crisis-qa',game_id:game,requester_id:user,question:'Какие мосты доступны для эвакуации?',answer:null,status:'pending',created_at:now}],crisis_responses:[{id:'response-qa',crisis_id:'crisis-qa',game_id:game,user_id:user,role_title:'Министр',action_plan:'Согласовать эвакуацию с компетентными органами и организовать транспорт.',legal_basis:'Полномочия органа по защите населения.',resources:'Транспорт и резервные средства.',public_message:'Сообщить населению безопасные маршруты.',teacher_note:'Уточните ответственных лиц.',status:'reviewed',created_at:now,updated_at:now}],game_role_consequences:[]};
tables.government_nominations.push(...units.filter(u=>u.unit_kind==='ministry').map((u,i)=>({id:'minister-'+u.unit_key,game_id:game,stage_no:9,office_key:'ministry_'+u.unit_key,office_title:u.title,office_kind:i===0?'deputy_pm':['defence','internal'].includes(u.unit_key)?'security_minister':'duma_minister',route:['defence','internal'].includes(u.unit_key)?'president_after_sf':'pm_to_duma',candidate_user_id:u.head_user_id,candidate_name:['Анна Миронова','Илья Соколов','Мария Волкова','Павел Орлов','София Смирнова'][i],attempt_no:1,status:'appointed',vote_id:null,formal_document_id:null,appointment_document_id:null,created_at:now})));
// Explicit fictional, populated records exercise early-stage forms as well as empty states.
const qaCandidates=[0,1].map((n)=>({id:'pres-candidate-'+n,game_id:game,user_id:'student-'+n,party_id:'party-'+n,created_by:'student-'+n,display_name:['Анна Миронова','Павел Соколов'][n],nomination_type:'party',registration_status:n?'submitted':'registered',photo_path:null,program_summary:'Учебная программа из десяти положений.',campaign_statement:'Учебное обращение к избирателям.',registration_attempts:1,legal_error_count:0,rating_penalty:0,registration_number:'QA-'+n,registration_decision_no:null,registration_decision_at:null,registration_public_summary:'Учебное решение комиссии',cec_submitted_at:now,cec_submission_version:1,archived_at:null,created_at:now}));
Object.assign(tables,{
 presidential_candidates:qaCandidates,
 presidential_candidate_program_points:qaCandidates.flatMap(c=>Array.from({length:10},(_,i)=>({id:c.id+'-point-'+i,game_id:game,candidate_id:c.id,point_no:i+1,body:'Учебное положение программы о развитии общественных услуг '+(i+1)}))),
 presidential_election_settings:[{game_id:game,system_type:'absolute',threshold_pct:50,poll_enabled:true,status:'round1',result:{}}],
 presidential_campaign_materials:[{id:'material-qa',game_id:game,candidate_id:qaCandidates[0].id,author_id:user,title:'Обращение о приоритетах развития',body:'Учебный материал кандидата для проверки комиссии. Требуется проверить выходные данные и законность публикации.',material_type:'leaflet',print_run:100,publisher_name:'Учебный штаб',production_date:'2026-10-08',imprint_text:'Учебные выходные данные',external_url:null,files:[],status:'pending',review_note:null,cec_errors:null,cec_response:null,penalty_points:0,penalty_reason:null,post_id:null,created_at:now}],
 presidential_scorecards:qaCandidates.map(c=>({game_id:game,candidate_id:c.id,round_no:1,teacher_program_pct:70,teacher_campaign_pct:65,game_rating_pct:80,poll_pct:40,teacher_runoff_pct:null,computed_pct:63})),
 parliamentary_election_rules:[{id:'parliament-rule-qa',game_id:game,system_type:'mixed',allocation_method:'dhondt',majoritarian_method:'plurality',proportional_share:50,rationale:'Учебное обоснование смешанной системы.',status:'adopted',vote_id:null,proposed_by:user,created_at:now}],
 regional_election_rules:[{id:'region-rule-qa',game_id:game,method:'agreement',rationale:'Учебный договор о региональном представительстве.',status:'allocated',vote_id:null,proposed_by:user,created_at:now}],
 ghost_voting_policies:[{id:'ghost-policy-qa',game_id:game,policy_mode:'justified',rationale:'Учебное правило отсутствия депутатов.',status:'adopted',vote_id:null,proposed_by:user,adopted_at:now,created_at:now}],
 office_elections:[{id:'leader-election-qa',game_id:game,stage_no:4,office_key:'gd_chair',office_title:'Председатель ГД',round_no:1,vote_mode:'open',status:'nomination',winner_candidate_id:null,parent_election_id:null,created_at:now},{id:'committee-election-qa',game_id:game,stage_no:4,office_key:'committee:committee-social',office_title:'Председатель комитета',round_no:1,vote_mode:'open',status:'nomination',winner_candidate_id:null,parent_election_id:null,created_at:now}],
 office_candidates:[{id:'office-candidate-qa',game_id:game,election_id:'leader-election-qa',user_id:user,party_id:'party-0',created_at:now}]
});
const calls=[];let readinessFailure=false,browser,server;
async function bounds(page,width){
 const data=await page.locator('.stageOperations').evaluate(root=>{
  const visible=e=>e.getClientRects().length&&!e.closest('[hidden]');
  const bad=[...root.querySelectorAll('input,select,textarea')].filter(visible).map(e=>{const r=e.getBoundingClientRect();return {name:e.getAttribute('aria-label')||e.closest('label')?.textContent.slice(0,90)||e.tagName,left:r.left,right:r.right,width:r.width}}).filter(r=>r.left< -2||r.right>innerWidth+2);
  const icons=[...root.querySelectorAll('.stageOperationsTabs>button,.stageOperationsBreadcrumb>button,.stageOperationsMeta>button')].filter(visible).map(e=>{const b=e.getBoundingClientRect(),s=e.querySelector('svg')?.getBoundingClientRect();return s?Math.abs(s.y+s.height/2-b.y-b.height/2):0});
  const first=[...root.querySelectorAll('input,select,textarea')].filter(visible).find(e=>e.getBoundingClientRect().right>innerWidth+2);const chain=[];for(let e=first;e;e=e.parentElement){const s=getComputedStyle(e);chain.push({cls:e.className,tag:e.tagName,width:e.getBoundingClientRect().width,min:s.minWidth,grid:s.gridTemplateColumns,display:s.display});}const overflow=[...root.querySelectorAll('*')].filter(visible).filter(e=>e.getBoundingClientRect().right>innerWidth+2&&!e.closest('.stageOperationsTabs')).slice(0,12).map(e=>({cls:e.className,tag:e.tagName,width:e.getBoundingClientRect().width,min:getComputedStyle(e).minWidth,grid:getComputedStyle(e).gridTemplateColumns}));return {stage:root.dataset.stage,panel:root.querySelector('.stageOperationsPane:not([hidden])')?.getAttribute('aria-label'),scroll:document.documentElement.scrollWidth,width:innerWidth,bad,chain,overflow,iconOffset:Math.max(0,...icons)};
 });
 if(data.scroll>width+3||data.bad.length)await page.screenshot({path:path.join(screens,'stage-layout-failure.png'),fullPage:true});
 assert(data.scroll<=width+3,'Horizontal document overflow: '+JSON.stringify(data));assert.deepEqual(data.bad,[],'Fields outside viewport: '+JSON.stringify(data));assert(data.iconOffset<=2.5,'Header/tab icon is not centered: '+data.iconOffset);
}
async function main(){
 fs.mkdirSync(routeDir,{recursive:true});fs.mkdirSync(screens,{recursive:true});fs.writeFileSync(path.join(routeDir,'page.tsx'),pageSource);
 server=startTestServer(root,3996,{NEXT_PUBLIC_SUPABASE_URL:'https://stage-qa.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'qa-placeholder'});
 const log=[];for(const stream of [server.stdout,server.stderr])stream.on('data',c=>{log.push(String(c));if(log.length>60)log.shift();fs.writeFileSync(path.join(root,'.design-review','stage-browser-server.log'),log.join(''))});
 try{
  for(let i=0;i<20;i++){try{if((await fetch('http://127.0.0.1:3996/stage-operations-test-route',{signal:AbortSignal.timeout(2000)})).ok)break}catch{}await sleep(500);if(i===19)throw Error('QA server not ready: '+log.join('').slice(-4000))}
  browser=await chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],channels=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await context.route('https://stage-qa.supabase.co/**',async route=>{
   const url=new URL(route.request().url()),key=url.pathname.split('/').pop();let data=[];
   calls.push({key,path:url.pathname+url.search,body:route.request().postDataJSON()});
   if(url.pathname.includes('/rpc/')){
    if(key==='get_stage_readiness'){if(readinessFailure){await route.fulfill({status:503,json:{message:'QA: connection unavailable'}});return;}const no=route.request().postDataJSON().p_stage_no;data={stage_no:no,ready:false,blockers:['Завершите обязательную процедуру этапа '+no],warnings:['Проверьте материалы'],metrics:{}};}
    else if(key==='get_state_program_readiness')data={ready:false,issues:['Добавьте годовое финансирование'],goals:1,directions:3,components:3,total_budget:1000,component_budget:300};
    else if(key==='get_presidential_candidate_readiness')data={ready:true,issues:[],program_points:10,accepted_documents:5,required_documents:5,support_group:0,signatures:0,nomination_type:'party'};
    else if(key==='get_presidential_cec_auto_review')data={ready:true,recommended_status:'registered',error_count:0,manual_count:0,issues:[],items:[],program_points:10,support_group:0,signatures:0,legal_basis:[]};
    else if(key==='ensure_duma_committees'){tables.institution_units=[...tables.institution_units,...units.filter(u=>u.unit_kind==='committee'&&!tables.institution_units.some(row=>row.id===u.id))];data=null;}
    else if(key==='submit_government_nomination'){const b=route.request().postDataJSON(),id='new-nomination-'+calls.length;tables.government_nominations.push({id,game_id:game,stage_no:b.p_office_key.startsWith('ministry_')?9:8,office_key:b.p_office_key,office_title:b.p_office_title,office_kind:b.p_office_kind,route:b.p_office_kind==='security_minister'?'president_after_sf':b.p_office_kind==='prime_minister'?'president_to_duma':'pm_to_duma',candidate_user_id:b.p_candidate_user_id,candidate_name:b.p_candidate_name,attempt_no:1,status:b.p_office_kind==='security_minister'?'consultation_pending':'submitted',vote_id:null,formal_document_id:null,appointment_document_id:null,created_at:now});data=id;}
    else if(key==='get_committee_matrix')data=units.filter(u=>u.unit_kind==='committee').flatMap(u=>[65,50,35].map((m,i)=>({unit_id:u.id,party_id:'party-'+i,party_name:['Новая перспектива','Город и люди','Общий курс'][i],color:'#2453e6',quota:Math.round(m*90/150),students:1})));
    else if(key==='get_fiscal_budget')data={regions:[],rates:[],proposals:[],ledger:[],can_propose:true};
    else if(key==='get_fiscal_legal_plans')data={plans:[],programs:[]};
    else if(key==='get_fiscal_context')data=null;
    else if(key==='get_budget_simulator'){const ts=require('typescript');const saved=require.extensions['.ts'];require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,resolveJsonModule:true,esModuleInterop:true}}).outputText,file);const math=require('../components/game/federalBudgetMath.ts');data={state:math.defaultSimulatorState(null,[]),plans:[],requests:[],contracts:[],ledger:[],can_prepare:true,can_request:true,event_count:0};if(saved)require.extensions['.ts']=saved;else delete require.extensions['.ts'];}
    else data=null;
   }else if(url.pathname.includes('/rest/v1/')){
    data=structuredClone(tables[key]||[]);
    for(const [k,v]of url.searchParams){if(v.startsWith('eq.'))data=data.filter(row=>String(row[k])===v.slice(3));else if(v.startsWith('in.('))data=data.filter(row=>v.slice(4,-1).split(',').includes(String(row[k])));else if(v.startsWith('like.'))data=data.filter(row=>String(row[k]).startsWith(v.slice(5).replace('%','')));else if(v==='is.null')data=data.filter(row=>row[k]==null);}
    if(route.request().headers().accept?.includes('vnd.pgrst.object'))data=data[0]||null;
   }
   await route.fulfill({status:200,json:data});
  });
  await context.routeWebSocket(/stage-qa\.supabase\.co/,ws=>ws.onMessage(message=>{
   const m=JSON.parse(String(message)),array=Array.isArray(m);
   const [join,ref,topic,event,payload]=array?m:[m.join_ref,m.ref,m.topic,m.event,m.payload];
   const reply=response=>ws.send(JSON.stringify(array?[join,ref,topic,'phx_reply',{status:'ok',response}]:{join_ref:join,ref,topic,event:'phx_reply',payload:{status:'ok',response}}));
   if(event==='phx_join'){const bindings=(payload.config?.postgres_changes||[]).map((binding,id)=>({...binding,id:id+1}));channels.push({ws,topic,array,bindings});reply({postgres_changes:bindings});}
   else if(event==='heartbeat'||event==='phx_leave'){if(event==='phx_leave')for(let i=channels.length-1;i>=0;i--)if(channels[i].ws===ws&&channels[i].topic===topic)channels.splice(i,1);reply({});}
  }));
  function broadcast(table,row){let sent=0;for(const channel of channels){const ids=channel.bindings.filter(b=>b.table===table).map(b=>b.id);if(!ids.length)continue;const payload={ids,data:{schema:'public',table,type:'UPDATE',commit_timestamp:new Date().toISOString(),record:row,old_record:{},columns:Object.keys(row).map(name=>({name,type:'text'})),errors:null}};channel.ws.send(JSON.stringify(channel.array?[null,null,channel.topic,'postgres_changes',payload]:{topic:channel.topic,event:'postgres_changes',payload,ref:null}));sent++;}return sent;}
  await page.goto('http://127.0.0.1:3996/stage-operations-test-route');await page.waitForFunction(()=>document.body.dataset.stageQa==='ready');await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
  for(const no of Array.from({length:16},(_,i)=>i+1)){
   await page.getByLabel('QA stage').selectOption(String(no));await page.waitForSelector('.stageOperations[data-stage="'+no+'"]');await sleep(250);
   for(const width of [320,390,768,1024,1440,1920]){
    await page.setViewportSize({width,height:1000});
    for(const tab of ['Работа','Маршрут и правила','Материалы','Проверка','Настройки']){
     const btn=page.locator('.stageOperationsTabs').getByRole('button',{name:tab,exact:tab!=='Материалы'});await btn.click();await bounds(page,width);
    }
    await page.locator('.stageOperationsTabs').getByRole('button',{name:'Работа',exact:true}).click();
    if(width===390||width===1440)await page.screenshot({path:path.join(screens,'stage-'+no+'-'+width+'.png'),fullPage:true});
   }
   console.log('PASS stage '+no+': 6 viewport widths × 5 working panels');
  }
  // Every early-stage subpanel is checked with populated forms.
  for(const no of [6,7]){
   await page.getByLabel('QA stage').selectOption(String(no));await sleep(400);
   const names=no===6?['Моё досье','Подача в ЦИК','Кандидаты','Решения ЦИК']:['Кампания','Голосование и соцопрос','Итоги и инаугурация'];
   for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:1000});
    for(const name of names){await page.locator(no===6?'.cecTabs':'.stage7Tabs').getByRole('button',{name}).click();await bounds(page,width);}
   }
   await page.locator(no===6?'.cecTabs':'.stage7Tabs').getByRole('button',{name:names[0]}).click();
   await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:path.join(screens,'stage-'+no+'-populated-1440.png'),fullPage:true});
   console.log('PASS populated stage '+no+': all internal panels at 4 widths');
   if(no===6){
    const contrasts=await page.locator('.cecHeadSide').evaluate(el=>{
     const rgb=value=>value.match(/[\d.]+/g).slice(0,3).map(Number);
     const luminance=value=>rgb(value).map(c=>{const s=c/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4}).reduce((v,c,i)=>v+c*[.2126,.7152,.0722][i],0);
     const background=luminance(getComputedStyle(el).backgroundColor);
     return [...el.querySelectorAll('b,span')].map(node=>{const foreground=luminance(getComputedStyle(node).color);return {text:node.textContent,ratio:(Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05)}});
    });
    assert(contrasts.every(item=>item.ratio>=4.5),'CEC header text contrast: '+JSON.stringify(contrasts));
    console.log('PASS CEC header text contrast exceeds 4.5:1');
   }
  }
  await page.getByLabel('QA stage').selectOption('9');await sleep(300);
  assert.equal(await page.locator('.committeeGrid,.committeeElectionBoard').count(),0);
  assert.equal(await page.locator('.ministryGrid .unitHead select').count(),0);
  assert.equal(await page.getByRole('button',{name:'Зафиксировать',exact:true}).count(),0);
  console.log('PASS stage 9 has no committees or bypass for minister appointments');
  await page.getByLabel('QA stage').selectOption('8');await sleep(250);
  assert.equal(await page.locator('.gov8MinistryNomination,.gov8DeputyChoice').count(),0,'Minister appointments must not remain at stage 8');
  const savedNominations=structuredClone(tables.government_nominations);
  const savedUnits=structuredClone(tables.institution_units),savedAssignments=structuredClone(tables.institution_assignments);
  tables.government_nominations=tables.government_nominations.filter(n=>n.stage_no===8);
  tables.institution_units=tables.institution_units.map(u=>u.unit_kind==='ministry'?{...u,head_user_id:null}:u);
  tables.institution_assignments=tables.institution_assignments.filter(a=>!savedUnits.some(u=>u.id===a.unit_id&&u.unit_kind==='ministry'));
  await page.getByLabel('QA stage').selectOption('9');await page.locator('.gov8MinistryNomination input').first().waitFor();
  assert.equal(await page.locator('.gov8MinistryNomination').count(),5);
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:1000});await bounds(page,width);await page.screenshot({path:path.join(screens,'stage-9-nominations-'+width+'.png'),fullPage:true});}
  const nameField=page.locator('.gov8MinistryNomination').first().getByLabel('Ф.И.О. кандидатуры');
  await nameField.pressSequentially('Учебная кандидатура министра',{delay:10});assert.equal(await nameField.inputValue(),'Учебная кандидатура министра');
  await page.locator('.stageOperationsTabs').getByRole('button',{name:'Материалы',exact:false}).click();await page.locator('.stageOperationsTabs').getByRole('button',{name:'Работа',exact:true}).click();
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await sleep(300);assert.equal(await nameField.inputValue(),'Учебная кандидатура министра');
  await page.locator('.gov8MinistryNomination').first().getByRole('button',{name:'Внести кандидатуру',exact:true}).click();
  await page.locator('.gov8AgendaMain').getByText('Учебная кандидатура министра',{exact:true}).waitFor();
  const nominationCall=calls.findLast(c=>c.key==='submit_government_nomination');assert.equal(nominationCall.body.p_office_key,'ministry_social');assert.equal(nominationCall.body.p_candidate_name,'Учебная кандидатура министра');
  assert(calls.some(c=>c.path.includes('institution_session_registrations')&&c.path.includes('stage_no=eq.9')));
  tables.government_nominations=savedNominations;
  tables.institution_units=savedUnits;tables.institution_assignments=savedAssignments;
  console.log('PASS stage 8 structure only; stage 9 five nomination forms at four widths, stable typing and saved candidature');
  await page.getByLabel('QA stage').selectOption('1');await page.locator('.stageOperationsTabs').getByRole('button',{name:'Материалы',exact:false}).click();
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:1000});await bounds(page,width);const gaps=await page.locator('.stagePartySyncGrid article').first().evaluate(el=>({display:getComputedStyle(el).display,gap:parseFloat(getComputedStyle(el).gap),nameDisplay:getComputedStyle(el.querySelector('b')).display,ideologyDisplay:getComputedStyle(el.querySelector('small')).display}));assert.equal(gaps.display,'flex');assert(gaps.gap>=12);assert.equal(gaps.nameDisplay,'block');assert.equal(gaps.ideologyDisplay,'block');await page.screenshot({path:path.join(screens,'stage-1-materials-'+width+'.png'),fullPage:true});}
  assert.equal(await page.getByRole('button',{name:'Открыть партии',exact:false}).count(),1,'Party material action must not duplicate');
  await page.getByLabel('QA stage').selectOption('5');
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:1000});await bounds(page,width);const modes=await page.locator('.ghostPolicyModes').evaluate(el=>[...el.querySelectorAll('button')].map(b=>{const title=b.querySelector('span').getBoundingClientRect(),description=b.querySelector('small').getBoundingClientRect();return {display:getComputedStyle(b).display,gap:description.top-title.bottom}}));assert(modes.every(m=>m.display==='grid'&&m.gap>=6),'Ghost voting labels must be separated: '+JSON.stringify(modes));await page.screenshot({path:path.join(screens,'stage-5-options-'+width+'.png'),fullPage:true});}
  await page.getByRole('radio',{name:'Запрещено',exact:false}).focus();await page.keyboard.press('ArrowRight');assert.equal(await page.getByRole('radio',{name:'По уважительной причине',exact:false}).getAttribute('aria-checked'),'true');
  console.log('PASS screenshot fixes: material rows and Ghost voting options at four widths; radio keyboard control');
  tables.institution_units=units.filter(u=>u.unit_kind==='ministry');tables.institution_assignments=[];
  await page.getByLabel('QA stage').selectOption('4');await page.getByRole('button',{name:'Создать комитеты ГД',exact:true}).waitFor();
  assert.equal(await page.locator('.ministryGrid').count(),0);
  await page.getByRole('button',{name:'Создать комитеты ГД',exact:true}).click();await page.locator('.committeeGrid .committeeUnit').nth(4).waitFor();
  assert(calls.some(c=>c.key==='ensure_duma_committees'));
  assert.equal(await page.locator('.dumaElection .dumaElectionList article').count(),1,'Committee elections must not appear as Duma leadership elections');
  const second=await context.newPage();await second.goto('http://127.0.0.1:3996/stage-operations-test-route');await second.getByLabel('QA stage').selectOption('4');await second.locator('.committeeGrid .committeeUnit').nth(4).waitFor();
  tables.institution_units[5].title='Комитет с обновлённым названием';assert(broadcast('institution_units',tables.institution_units[5])>=2);
  await Promise.all([page,second].map(p=>p.locator('.committeeGrid').getByRole('heading',{name:'Комитет с обновлённым названием',exact:true}).waitFor()));await second.close();
  tables.institution_units=structuredClone(units);
  console.log('PASS stage 4 committee creation, separate elections, and Realtime to two clients');
  await page.setViewportSize({width:390,height:1000});await page.getByLabel('QA stage').selectOption('10');await page.locator('.programEdit summary').click();
  const passportTitle=page.locator('.programEditBody').getByLabel('Название ГП',{exact:true});await passportTitle.fill('Мой несохранённый паспорт');
  tables.state_programs[0].title='Обновление с другого устройства';tables.state_programs[0].updated_at=new Date(Date.now()+1000).toISOString();
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await sleep(350);assert.equal(await passportTitle.inputValue(),'Мой несохранённый паспорт');
  await page.locator('.stageOperationsTabs').getByRole('button',{name:'Маршрут и правила',exact:true}).click();await page.locator('.stageOperationsTabs').getByRole('button',{name:'Работа',exact:true}).click();assert.equal(await passportTitle.inputValue(),'Мой несохранённый паспорт');
  console.log('PASS program draft survives remote refresh and panel changes');
  const mobile=await context.newPage();mobile.on('pageerror',e=>errors.push(String(e)));await mobile.setViewportSize({width:390,height:1000});await mobile.goto('http://127.0.0.1:3996/stage-operations-test-route');await mobile.getByLabel('QA stage').selectOption('10');await mobile.locator('.programPassportHead h3').waitFor();
  tables.state_programs[0].title='Общее изменение программы для всех устройств';tables.state_programs[0].updated_at=new Date(Date.now()+2000).toISOString();
  assert(broadcast('state_programs',tables.state_programs[0])>=2,'Both viewport clients must subscribe to program updates');
  await Promise.all([page,mobile].map(p=>p.waitForFunction(()=>document.querySelector('.programPassportHead h3')?.textContent==='Общее изменение программы для всех устройств')));
  assert.equal(await passportTitle.inputValue(),'Мой несохранённый паспорт');await mobile.locator('.programEdit summary').click();assert.equal(await mobile.locator('.programEditBody').getByLabel('Название ГП',{exact:true}).inputValue(),'Общее изменение программы для всех устройств');await mobile.close();
  console.log('PASS one Realtime update reaches desktop and mobile clients; local draft is preserved');

  readinessFailure=true;await page.locator('.stageOperationsTabs').getByRole('button',{name:'Проверка',exact:true}).click();await page.getByRole('button',{name:'Перепроверить',exact:true}).click();await page.getByRole('heading',{name:'Проверка недоступна'}).waitFor();const failureAlert=page.locator('.stageReadinessPanel [role="alert"]');await failureAlert.waitFor({state:'visible'});assert((await failureAlert.textContent()).trim().length>20);readinessFailure=false;
  await page.getByRole('button',{name:'Перепроверить',exact:true}).click();await page.getByRole('heading',{name:'Есть незавершённые процедуры'}).waitFor();console.log('PASS readiness failure is visible and retry recovers');
  await page.getByLabel('QA role').selectOption('student');await page.getByLabel('QA stage').selectOption('16');await sleep(250);
  const decision=page.locator('.reflectionGrid textarea').first();await decision.fill('Моя несохранённая рефлексия о причинных связях');tables.game_reflections[0].decision_memory='Серверное обновление';await page.evaluate(()=>window.dispatchEvent(new Event('online')));await sleep(350);assert.equal(await decision.inputValue(),'Моя несохранённая рефлексия о причинных связях');
  assert.equal(await page.locator('.stageOperationsTabs').getByRole('button',{name:'Настройки',exact:true}).count(),0);console.log('PASS student reflection draft survives reconnection; teacher settings hidden');
  await page.getByLabel('QA role').selectOption('observer');await page.getByLabel('QA stage').selectOption('10');await sleep(250);assert.equal(await page.locator('.stageOperationsControls').evaluate(el=>el.disabled),true);assert.equal(await page.locator('.stageOperationsControls input').first().isDisabled(),true);assert.equal(await page.locator('.stageOperationsTabs').getByRole('button',{name:'Настройки',exact:true}).count(),0);console.log('PASS observer controls are locked');
  assert.deepEqual(errors,[],'Browser runtime errors: '+errors.join('\n'));assert(calls.some(c=>c.key==='get_stage_readiness'),'Actual readiness RPC was called');
  fs.writeFileSync(path.join(root,'.design-review','stage-operations-browser-results.json'),JSON.stringify({stages:16,widths:[320,390,768,1024,1440,1920],panels:5,layouts:480,roles:['teacher','student','observer'],draftProtection:true,realtimeTwoDevices:true,readinessRetry:true,runtimeErrors:errors,checkedAt:new Date().toISOString()},null,2));
 }finally{try{await closeTestBrowser(browser)}finally{try{await stopTestServer(server)}finally{cleanTestRoute(root,routeDir)}}}
}
main().catch(e=>{console.error(e);process.exitCode=1});
