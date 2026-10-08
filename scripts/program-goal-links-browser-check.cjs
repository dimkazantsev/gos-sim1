/* Real editor and selectors; simulated transport. No production data is changed. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright-core');
const {startTestServer,stopTestServer,closeTestBrowser,cleanTestRoute}=require('./browser-test-runtime.cjs');
const root=path.resolve(__dirname,'..'),name='audit-program-goals-'+require('node:crypto').randomUUID().slice(0,8),dir=path.join(root,'app',name),port=3997;
const screenDir=path.join(root,'.design-review','program-goals');
const initial={
 program:{id:'qa-program',game_id:'qa-game',title:'Доступные общественные услуги',responsible_ministry:'Министерство развития',responsible_minister_id:'qa-author',curator_id:null,national_goal:'Комфортная и безопасная среда для жизни',presidential_priority_id:null,participants:'Министерство и муниципальная администрация',start_date:'2026-01-01',end_date:'2026-12-31',total_budget:'0.00',expected_results:'Доступность услуг в удалённых районах',status:'draft',government_vote_id:null,created_by:'qa-author',created_at:'2026-01-01',updated_at:'2026-01-01',form_version:2},
 goals:[{id:'goal-health',program_id:'qa-program',goal_text:'Повысить доступность медицинской помощи',indicator_name:'Доля жителей с доступом к поликлинике',unit:'%',baseline_value:70,target_value:95,target_year:2026},{id:'goal-education',program_id:'qa-program',goal_text:'Повысить доступность дополнительного образования',indicator_name:'Доля детей, посещающих кружки',unit:'%',baseline_value:40,target_value:80,target_year:2026}],
 components:[1,2,3].map(n=>({id:'component-'+n,program_id:'qa-program',direction_no:n,direction_title:['Медицина','Образование','Социальные услуги'][n-1],component_kind:'project',title:['Две новые поликлиники','Школьные кружки','Выездная медицинская помощь'][n-1],goal_text:['Построить поликлиники в удалённых районах','Открыть бесплатные кружки','Организовать выезды врачей'][n-1],start_date:'2026-01-01',end_date:'2026-12-31',budget:'0.00',target_goal_id:null})),expenses:[],priorities:[]
};
const pageSource=`'use client';
import {useState} from 'react';
import StateProgramEditor from '../../components/game/StateProgramEditor';
import type {ReturnTypeRepublic} from '../../components/game/viewTypes';
export default function QA(){
 const [data,setData]=useState<any>(${JSON.stringify(initial)}),[error,setError]=useState(''),[readonly,setReadonly]=useState(false);
 const g={game:{id:'qa-game'},me:{user_id:'qa-author',kind:'student',role_title:'Министр развития',roster_archived_at:null},teacher:false,members:[{user_id:'qa-author',full_name:'Учебный автор',kind:'student',roster_archived_at:null}],setError:(e:any)=>setError(String(e?.message||e))} as unknown as ReturnTypeRepublic;
 return <main className="simMain" style={{maxWidth:1300,minWidth:0,margin:'0 auto',padding:16}}><button type="button" onClick={()=>setReadonly(v=>!v)}>{readonly?'Редактирование':'Только просмотр'}</button>{error&&<p role="alert">{error}</p>}<StateProgramEditor g={g} {...data} editable={!readonly} onSaved={async()=>{setData(await fetch('/'+${JSON.stringify(name)}+'/qa-data').then(r=>r.json()))}}/></main>;
}`;
let browser,server,serial=0,saved=structuredClone(initial),failSave=false,calls=[],errors=[];
async function choose(page,node,goal){await node.getByRole('button',{name:/Какую цель программы обеспечивает элемент/}).click();await page.getByRole('option',{name:goal}).click();}
async function main(){
 fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(screenDir,{recursive:true});fs.writeFileSync(path.join(dir,'page.tsx'),pageSource);
 try{
  server=startTestServer(root,port,{NEXT_PUBLIC_SUPABASE_URL:'https://program-goal-qa.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:'qa-public-fictional'});let log='';server.stdout.on('data',x=>log+=x);server.stderr.on('data',x=>log+=x);
  for(let n=0;n<120&&!log.includes('Ready in');n++){if(server.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,250));}
  assert(log.includes('Ready in'),log);
  browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/workspace/scratch/5f1ab6c9563c/browser-runtime/extracted/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const context=await browser.newContext({reducedMotion:'reduce'}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/qa-data',r=>r.fulfill({status:200,json:saved}));
  await context.route('**/rest/v1/rpc/save_state_program_draft',async route=>{
   const args=route.request().postDataJSON();calls.push(args);
   if(failSave){await route.fulfill({status:400,json:{message:'QA сохранение временно недоступно'}});return;}
   const p=args.p_payload,k=++serial;
   const goals=p.goals.map((g,i)=>({...g,id:'saved-goal-'+k+'-'+i,program_id:'qa-program'}));
   const components=p.components.map((c,i)=>({...c,id:'saved-component-'+k+'-'+i,program_id:'qa-program',target_goal_id:c.goal_no?goals[c.goal_no-1].id:null,budget:'0.00'}));
   const expenses=p.expenses.map((e,i)=>({...e,id:'saved-expense-'+k+'-'+i,program_id:'qa-program',component_id:components[e.component_no-1].id,position:i+1}));
   const cents=x=>{const [a,b='']=x.split('.');return BigInt(a)*100n+BigInt(b.padEnd(2,'0'));},amount=x=>(x/100n)+'.'+(x%100n).toString().padStart(2,'0');
   for(const c of components)c.budget=amount(expenses.filter(e=>e.component_id===c.id).reduce((s,e)=>s+cents(e.amount),0n));
   saved={program:{...saved.program,...p,total_budget:amount(expenses.reduce((s,e)=>s+cents(e.amount),0n)),updated_at:'saved-'+k},goals,components,expenses,priorities:[]};
   await route.fulfill({status:200,json:'qa-program'});
  });
  const response=await page.goto('http://127.0.0.1:'+port+'/'+name);assert.equal(response.status(),200);
  await page.getByRole('heading',{name:'Цели программы: какого результата добиться'}).waitFor();await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
  const tree=page.getByRole('region',{name:'Дерево направлений и расходов'});
  const first=()=>tree.locator('details').filter({has:page.locator('summary',{hasText:'Две новые поликлиники'})});
  assert.equal(await first().getByRole('button',{name:/Добавить расход к элементу/}).isDisabled(),true,'No expense before outcome selection');
  await choose(page,first(),/Цель 1: Повысить доступность медицинской помощи/);
  assert.match(await first().innerText(),/70 → 95 % к 2026 году/);
  const top=page.getByRole('region',{name:'Цели программы и связанные элементы'});
  assert.equal(await top.getByRole('link',{name:'Направление 1 · Две новые поликлиники'}).count(),1);
  await first().locator('summary').click();assert.equal(await first().evaluate(e=>e.open),false);
  await top.getByRole('link',{name:'Направление 1 · Две новые поликлиники'}).click();assert.equal(await first().evaluate(e=>e.open),true,'Goal navigation opens exact descendant');
  await first().getByRole('button',{name:/Добавить расход к элементу/}).click();
  await first().getByLabel('Индикатор расхода 1 элемента 1.1').fill('Строительство двух поликлиник');await first().getByLabel('Обоснование расхода 1').fill('Доступность медицинской помощи для жителей удалённых районов');await first().getByLabel('Сумма расхода 1, рубли').fill('123,45');
  const second=tree.locator('details').filter({has:page.locator('summary',{hasText:'Школьные кружки'})}),third=tree.locator('details').filter({has:page.locator('summary',{hasText:'Выездная медицинская помощь'})});
  await choose(page,second,/Цель 2: Повысить доступность дополнительного образования/);await choose(page,third,/Цель 1: Повысить доступность медицинской помощи/);
  await page.getByRole('button',{name:'Удалить цель 1'}).click();assert.match(await page.getByRole('alert').filter({hasText:'Сначала выберите для них другую цель'}).innerText(),/Сначала выберите для них другую цель/);assert.equal(await top.getByRole('heading',{name:'Цель 1 и её показатель'}).count(),1);
  await page.getByRole('button',{name:'Сохранить всю форму'}).click();await page.getByRole('status').waitFor();assert.deepEqual(calls[0].p_payload.components.map(c=>c.goal_no),[1,2,1]);assert.equal(calls[0].p_payload.expenses[0].amount,'123.45');
  await page.waitForFunction(()=>[...document.querySelectorAll('details')].some(e=>e.id.includes('saved-component-')));
  assert.equal(await top.getByRole('link').count(),3,'References restored with server-generated IDs');assert.match(await second.innerText(),/40 → 80 % к 2026 году/);
  failSave=true;await first().getByLabel('Название элемента').fill('Мой новый черновик поликлиник');await page.getByRole('button',{name:'Сохранить всю форму'}).click();await page.getByRole('alert').filter({hasText:'Не удалось выполнить действие'}).waitFor();assert.equal(await first().count(),0);
  const changed=tree.locator('details').filter({has:page.locator('summary',{hasText:'Мой новый черновик поликлиник'})});assert.equal(await changed.getByLabel('Название элемента').inputValue(),'Мой новый черновик поликлиник');assert.match(await changed.innerText(),/70 → 95 %/);failSave=false;
  await page.getByRole('button',{name:'Сохранить всю форму'}).click();await page.waitForFunction(()=>[...document.querySelectorAll('details')].some(e=>e.id.includes('saved-component-2-')));
  await page.getByRole('button',{name:'Только просмотр',exact:true}).click();
  assert.equal(await changed.getByRole('button',{name:/Какую цель программы обеспечивает элемент/}).isDisabled(),true);
  await changed.locator('summary').click();await top.getByRole('link',{name:'Направление 1 · Мой новый черновик поликлиник'}).click();assert.equal(await changed.evaluate(e=>e.open),true,'Read-only navigation works');
  const layouts=[];
  for(const width of [320,390,768,1440]){
   await page.setViewportSize({width,height:1000});const layout=await page.locator('main').evaluate(root=>{const clipped=e=>e.closest('table'),bad=[...root.querySelectorAll('input,textarea,.styledSelectTrigger,a')].filter(e=>e.getClientRects().length&&!clipped(e)).filter(e=>{const r=e.getBoundingClientRect();return r.left<0||r.right>innerWidth+1}).map(e=>e.textContent.slice(0,60));return{width:innerWidth,scroll:document.documentElement.scrollWidth,bad};});
   assert(layout.scroll<=width+2,JSON.stringify(layout));assert.deepEqual(layout.bad,[],JSON.stringify(layout));layouts.push(layout);await tree.screenshot({path:path.join(screenDir,'structure-'+width+'.png')});
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(screenDir,'results.json'),JSON.stringify({result:'PASS',checks:['explicit goal selection','exact linked outcome','goal-to-element navigation','expenses gated by goal','protected goal deletion','full save payload','server ID reload','network failure preserves draft','read-only navigation'],layouts,runtimeErrors:errors,transport:'simulated'},null,2));
  console.log('PASS program goal links: 9 interaction scenarios, 4 widths, no browser runtime errors');
 }finally{await closeTestBrowser(browser);await stopTestServer(server);cleanTestRoute(root,dir);}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
