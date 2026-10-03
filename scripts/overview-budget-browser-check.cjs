/* Actual React panels with explicitly fictional API responses. Database scope,
   correction bridge and idempotency are tested by overview-budget-integration-check.sql. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript'),{spawn}=require('node:child_process'),{chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..'),route=path.join(root,'app/overview-budget-test-route'),shots=path.join(root,'.design-review/screenshots');
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&fs.existsSync(p));if(!chrome)throw Error('Chrome is required for overview checks');
const originalResolve=Module._resolveFilename;Module._resolveFilename=function(request,...args){return originalResolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,...args)};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {calculateFederalBudget,newBudgetDraft,defaultSimulatorState}=require('../components/game/federalBudgetMath');
const initial=JSON.parse(fs.readFileSync(path.join(root,'.design-review/fixture.json'),'utf8'));
const source=`'use client';
import {useEffect,useState} from 'react';
import TeacherView from '../../components/game/TeacherView';
import TeacherMetricStudio from '../../components/game/TeacherMetricStudio';
import StateMetricsDock from '../../components/game/StateMetricsDock';
import FederalBudgetSimulator from '../../components/game/FederalBudgetSimulator';
import {useBudgetPulse,withBudgetIncome} from '../../components/game/useBudgetPulse';
import type {ReturnTypeRepublic} from '../../components/game/viewTypes';
const initial=${JSON.stringify(initial)};
export default function Test(){const [section,setSection]=useState('overview'),[teacher,setTeacher]=useState(true),[notice,setNotice]=useState('');
 const pulse=useBudgetPulse(initial.game.id,true);
 useEffect(()=>{document.body.dataset.overviewReady='yes';document.body.dataset.overviewTeacher=String(teacher)},[teacher]);
 const g={...initial,...pulse,teacher,me:teacher?initial.me:initial.members[1],metrics:withBudgetIncome(initial.metrics,pulse.budgetPulse),metricHistory:[...initial.metricHistory.filter(h=>h.metric_key!=='budget'),...(pulse.budgetPulse?.history||[])],refresh:pulse.refreshBudgetPulse,setError:setNotice,nextStage:async()=>{},setTurn:()=>{}} as unknown as ReturnTypeRepublic;
 return <main className='overview-test-shell'><aside aria-hidden='true'>Проверка с боковой навигацией</aside><div className='overview-test-content'><nav aria-label='Навигация проверки'><button onClick={()=>setSection('overview')}>Обзор для проверки</button><button onClick={()=>setSection('metrics')}>Показатели для проверки</button><button onClick={()=>setSection('budget')}>Бюджет для проверки</button><button onClick={()=>setTeacher(!teacher)}>Переключить роль</button><button onClick={()=>void pulse.refreshBudgetPulse()}>Обновить общий прогноз</button></nav>
 {section==='overview'&&teacher?<TeacherView g={g} onNavigate={v=>{setNotice('Переход: '+v);if(v==='budget')setSection('budget')}} onOpenProcesses={()=>setNotice('Переход: actions')} onOpenStages={()=>setNotice('Переход: stages')}/>:section==='budget'?<FederalBudgetSimulator g={g} context={null} regions={[]} rates={[]} readOnly={false} onOpenDocument={()=>{}} onOpenEvents={()=>{}} onSaved={pulse.refreshBudgetPulse}/>:<><StateMetricsDock g={g}/>{teacher&&<TeacherMetricStudio g={g}/>}</>}
 <output id='overview-test-output'>{notice}</output><style>{'.overview-test-shell{display:grid;grid-template-columns:220px minmax(0,1fr);gap:20px;max-width:1440px;padding:20px;margin:auto}.overview-test-shell>aside{padding:20px;border:1px solid #dedbea;border-radius:18px}.overview-test-content{min-width:0}.overview-test-content>nav{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px}.overview-test-content>nav>button{min-height:44px;padding:10px;font-size:12px;border-radius:9px}.overview-test-content output{display:block;overflow-wrap:anywhere}@media(max-width:900px){.overview-test-shell{display:block;padding:12px}.overview-test-shell>aside{display:none}}'}</style></div></main>;
}`;
const url='http://127.0.0.1:3995/overview-budget-test-route';let server,browser,logs='';
async function ready(){for(let i=0;i<60;i++){if(server.exitCode!==null)throw Error(logs);try{if((await fetch(url,{signal:AbortSignal.timeout(5000)})).ok)return}catch{}await new Promise(r=>setTimeout(r,1000));}throw Error('Overview route unavailable: '+logs);}
async function geometry(page,label){const r=await page.evaluate(()=>{
 const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0};
 const panel=document.querySelector('[aria-label="Мониторинг текущей игры"]')||document.querySelector('[aria-label="Федеральный бюджетный симулятор"]')||document.querySelector('.metricDirectorStudio');
 const bounds=panel.getBoundingClientRect();
 const clipped=[...panel.querySelectorAll('article,button,strong,dt,dd,h2')].filter(visible).filter(e=>{const r=e.getBoundingClientRect();return r.left<bounds.left-2||r.right>bounds.right+2}).map(e=>e.textContent.slice(0,100));
 const cards=[...panel.querySelectorAll('[data-overview-card]')].map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}});
 const overlap=cards.some((a,i)=>cards.some((b,j)=>j>i&&a.x<b.x+b.w-1&&a.x+a.w>b.x+1&&a.y<b.y+b.h-1&&a.y+a.h>b.y+1));
 const touch=[...panel.querySelectorAll('button')].filter(visible).map(e=>e.getBoundingClientRect().height);
 const refresh=panel.querySelector('button[aria-label="Обновить показатели обзора"]');let iconOffset=0;
 if(refresh){const b=refresh.getBoundingClientRect(),s=refresh.querySelector('svg').getBoundingClientRect();iconOffset=Math.max(Math.abs(b.x+b.width/2-s.x-s.width/2),Math.abs(b.y+b.height/2-s.y-s.height/2));}
 return {width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,clipped,overlap,touch,iconOffset};
 });if(r.clipped.length||r.overlap||r.scroll>r.width+2)await page.screenshot({path:path.join(shots,'overview-budget-failure.png'),fullPage:true});assert(r.scroll<=r.width+2,label+': overflow '+JSON.stringify(r));assert.deepEqual(r.clipped,[],label+': clipped elements');assert(!r.overlap,label+': overlapping cards');assert(r.touch.every(h=>h>=43),label+': touch target below 44px');assert(r.iconOffset<=2,label+': refresh icon is off center');}
(async()=>{fs.mkdirSync(route,{recursive:true});fs.mkdirSync(shots,{recursive:true});fs.writeFileSync(path.join(route,'page.tsx'),source);
 server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port','3995'],{cwd:root,env:{...process.env,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'build-placeholder-key'},stdio:['ignore','pipe','pipe']});for(const p of [server.stdout,server.stderr])p.on('data',s=>{logs=(logs+s).slice(-9000)});
 try{await ready();browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
  for(const width of [320,390,768,1024,1440]){
   const context=await browser.newContext({viewport:{width,height:1000},hasTouch:width<600,isMobile:width<600,reducedMotion:'reduce'}),page=await context.newPage(),errors=[],calls=[],plans=[],state=defaultSimulatorState(null,[]),history=[];
   let apiError=false;
   const stats={as_of:new Date().toISOString(),students:18,online:7,active_day:12,actions_day:129,stages_total:16,stages_completed:3,stages_overdue:1,documents_total:27,documents_draft:9,documents_published:4,documents_moving:14,votes_open:3,votes_closed:6,votes_failed_quorum:2,ballots_open:17,parties_total:5,parties_registered:3,parties_waiting:2,party_files:21,mandates:450,mandates_available:413,mandates_allocated:450,cases_active:8,case_invites_waiting:4,cases_resolved:26,posts_public:31,media_waiting:3,grades_final:44,grades_waiting:7,grade_average:2.45,changes_day:19};
   const calculation=()=>calculateFederalBudget(plans.find(p=>p.status==='draft')?.draft||plans[0]?.draft||newBudgetDraft(),state,null,[],[],[]);
   function shared(){const calc=calculation(),plan=plans.find(p=>p.status==='draft')||plans[0],last=history.at(-1);if(!last||last.value!==calc.revenue||last.source_id!==(plan?.id||null))history.push({id:history.length+1,game_id:initial.game.id,metric_id:initial.metrics.find(m=>m.metric_key==='budget').id,metric_key:'budget',value:calc.revenue,previous_value:last?.value??null,delta:last?calc.revenue-last.value:0,source_type:'budget_forecast',source_id:plan?.id||null,actor_id:null,note:'Общий расчет для проверки',recorded_at:new Date().toISOString()});return {game_id:initial.game.id,mode:plan?.status||'baseline',plan_id:plan?.id||null,document_id:null,plan_revision:plan?.revision||null,note:'Общий расчет для проверки.',calculation:calc,as_of:new Date().toISOString(),history};}
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('https://*.supabase.co/**',async route=>{
    const request=route.request(),rpc=request.url().split('/rpc/')[1]?.split('?')[0],p=rpc?request.postDataJSON():null;let response=[];
    if(rpc){calls.push({rpc,...p});if(p.p_game_id)assert.equal(p.p_game_id,initial.game.id,'RPC classroom scope');}
    if(apiError&&(rpc==='get_budget_pulse'||rpc==='get_teacher_overview'))return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'503',message:'Service temporarily unavailable'})});
    if(rpc==='get_teacher_overview')response=stats;
    if(rpc==='get_budget_pulse')response=shared();
    if(rpc==='get_budget_simulator')response={state,plans,requests:[],contracts:[],ledger:[],can_prepare:await page.evaluate(()=>document.body.dataset.overviewTeacher!=='false'),can_request:true,event_count:0};
    if(rpc==='set_state_metric_and_post'){state.revenue_adjustment+=p.p_value-calculation().revenue;response=null;}
    if(rpc==='save_budget_simulator'){let plan=plans.find(x=>x.id===p.p_plan_id);if(!plan){plan={id:'shared-test-plan',revision:0,status:'draft',document_id:null,registry_no:null,updated_at:new Date().toISOString()};plans.unshift(plan);}Object.assign(plan,{title:p.p_draft.title,draft:p.p_draft,revision:plan.revision+1});response={id:plan.id,revision:plan.revision};}
    await route.fulfill({contentType:'application/json',body:JSON.stringify(response)});
   });
   await page.goto(url);await page.locator('[data-teacher-overview=ready]').waitFor();await page.locator('[data-budget-shared=income][data-budget-value]').waitFor();
   assert.equal(await page.locator('[data-overview-card]').count(),8);assert.equal((await page.locator('[data-overview-kpi=actions_day]').textContent()).trim(),'129');assert.equal((await page.locator('[data-overview-kpi=online]').textContent()).trim(),'7');assert.equal((await page.locator('[data-overview-kpi=documents]').textContent()).trim(),'27');assert.equal(await page.locator('[data-budget-shared=income]').getAttribute('data-budget-value'),'40283300');await geometry(page,'overview '+width);
   await page.getByRole('button',{name:'Регистрация партий 2',exact:false}).click();await page.locator('#teacher-tab-parties').evaluate(e=>{if(e.getAttribute('aria-selected')!=='true')throw Error('Queue did not open parties');});
   await page.getByRole('tab',{name:'Обзор',exact:true}).click();await page.locator('[data-teacher-overview=ready]').waitFor();
   stats.actions_day=257;await page.getByRole('button',{name:'Обновить показатели обзора',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-overview-kpi=actions_day]')?.textContent==='257');
   await page.getByRole('button',{name:'Показатели для проверки'}).click();const metric=page.locator('.statePulseMetric.metric-budget');await metric.locator('strong').waitFor();assert.equal(await metric.getAttribute('data-budget-metric-value'),'40283300');
   await page.locator('.metricDirectorCards').getByRole('button',{name:/Доходы бюджета/}).click();await page.getByRole('spinbutton',{name:'Новое значение',exact:true}).fill('40285800');await page.getByPlaceholder('Что произошло и почему изменился показатель?').fill('Проверка изменения общего прогноза на 2500 миллионов рублей.');await page.getByRole('button',{name:'Применить изменение',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.metric-budget')?.getAttribute('data-budget-metric-value')==='40285800');assert.equal(state.revenue_adjustment,2500);await geometry(page,'consequences '+width);
   await metric.click();await page.getByRole('dialog').waitFor();assert.match(await page.locator('.metricHeroValue').textContent(),/40,3 трлн ₽/);assert(!await page.getByRole('dialog').textContent().then(t=>t.includes('742')));await page.getByRole('button',{name:'Закрыть показатель',exact:true}).click();
   await page.getByRole('button',{name:'Бюджет для проверки'}).click();await page.locator('[data-budget-shared=income][data-budget-value="40285800"]').waitFor();const simulator=page.getByRole('region',{name:'Федеральный бюджетный симулятор'});assert.match(await simulator.locator('[data-budget-kpi=income]').textContent(),/40,29 трлн ₽/);
   await simulator.getByLabel('Изменение базы: Нефтегазовые доходы, %').fill('5');assert.equal(await simulator.locator('[data-budget-shared=income]').getAttribute('data-budget-value'),'40285800','Unsaved calculator does not alter shared income');assert.match(await simulator.textContent(),/Несохраненный расчет/);
   await simulator.getByRole('button',{name:'Сохранить общий расчет',exact:true}).click();const saved=calculation().revenue;await page.locator('[data-budget-shared=income][data-budget-value="'+saved+'"]').waitFor();assert(saved>40285800);await geometry(page,'saved budget '+width);
   await page.getByRole('button',{name:'Обзор для проверки'}).click();await page.locator('[data-budget-shared=income][data-budget-value="'+saved+'"]').waitFor();assert.match(await page.locator('[aria-label="Общий федеральный прогноз"]').textContent(),/Общий сохраненный черновик/);
   apiError=true;await page.getByRole('button',{name:'Обновить показатели обзора'}).click();await page.getByRole('alert').filter({hasText:/Не удалось|Недоступ|Соединен|Сервис|Попробуйте|Временно/i}).first().waitFor();assert(!await page.getByRole('alert').first().textContent().then(t=>t.includes('Service temporarily')));assert.equal(await page.locator('[data-overview-kpi=actions_day]').textContent(),'257','Last snapshot survives network failure');apiError=false;await page.getByRole('button',{name:'Обновить показатели обзора'}).click();await page.waitForFunction(()=>!document.querySelector('[role=alert]'));
   await page.getByRole('button',{name:'Переключить роль'}).click();await page.locator('.metric-budget[data-budget-metric-value="'+saved+'"]').waitFor();assert.equal(await page.locator('[data-teacher-overview]').count(),0,'Teacher monitoring is not rendered for a student');assert.equal(await page.locator('.metricDirectorStudio').count(),0);assert.equal(calls.filter(c=>c.rpc==='set_state_metric_and_post').length,1);assert.deepEqual(errors,[],'Uncaught component errors');
   await context.close();console.log('PASS authoritative overview, shared income, correction, unsaved isolation, saved draft, student visibility, Russian errors and geometry '+width+'px');
  }
 }finally{if(browser)await browser.close();if(server&&server.exitCode===null){server.kill('SIGTERM');await new Promise(r=>setTimeout(r,600));}fs.rmSync(route,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
