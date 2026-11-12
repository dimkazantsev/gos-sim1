const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),resolve=Module._resolveFilename;
Module._resolveFilename=function(request,...args){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,...args)};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {calculateFederalBudget:calc,newBudgetDraft,defaultSimulatorState,coverFundingGap,billions}=require('../components/game/federalBudgetMath');
const {fiscalForecast}=require('../components/game/fiscalMath');
const base=require('../data/federal-budget-2026.json');
const regions=[{region_code:'54',enterprises:1000,activity_multiplier:1.2,employees_per_firm:10,monthly_wage:50000,profit_per_firm:3,consumption_per_firm:4,expenditure:20000,transfer_in:3000,debt:4000,compliance:1,cost_multiplier:1,profile:'industrial'}];
const context={policy:{key_rate:16,fx_rate:80,oil_price:75,inflation:6,baseline_economy:50,baseline_trust:50},metrics:{economy:50,public_trust:50}};
const state=defaultSimulatorState(context,regions),draft=newBudgetDraft(),run=(d=draft,s=state,c=context,r=regions,rates=[],requests=[])=>calc(d,s,c,r,rates,requests);
const first=run();
const {previewBudgetAmendment}=require('../components/game/budgetAmendmentMath');
const redistribution=previewBudgetAmendment(draft,first,[],'04','09',10000);
assert.equal(redistribution.error,'');
const recalculated=run(redistribution.draft);
assert.equal(recalculated.expenditure,first.expenditure,'An amendment is a reallocation, not additional spending');
assert.equal(recalculated.income_lines.reduce((n,l)=>n+l.amount,0),first.income_lines.reduce((n,l)=>n+l.amount,0));
assert.equal(recalculated.expense_lines.find(l=>l.key==='04').amount,first.expense_lines.find(l=>l.key==='04').amount-10000);
assert.equal(recalculated.expense_lines.find(l=>l.key==='09').amount,first.expense_lines.find(l=>l.key==='09').amount+10000);
for(const key of ['funding_gap','debt_total','annual_interest','deficit','financing'])assert.equal(recalculated[key],first[key],key+' is preserved');
assert(previewBudgetAmendment(draft,first,[],'04','04',1000).error);
assert(previewBudgetAmendment(draft,first,[],'13','04',1000).error);
assert(previewBudgetAmendment(draft,first,[],'04','09',NaN).error);
assert(previewBudgetAmendment(draft,first,[],'04','09',0).error);
assert(previewBudgetAmendment(draft,first,[],'04','09',1000001).error);
assert(previewBudgetAmendment(draft,first,[],'08','07',300000).error,'Source model floor is protected');
const protectedRequest={id:'earmarked',amount:500000,kind:'subsidy',section_key:'07',status:'requested'};
const protectedDraft={...draft,spending_changes:{'07':-79},transfer_ids:['earmarked']},protectedBase=run(protectedDraft,state,context,regions,[],[protectedRequest]);
assert.match(previewBudgetAmendment(protectedDraft,protectedBase,[protectedRequest],'07','09',800000).error,/целевые трансферты/);
const inflatedContext={...context,policy:{...context.policy,inflation:12}},inflated=run(draft,state,inflatedContext);
const inflatedProposal=previewBudgetAmendment(draft,inflated,[],'04','09',20000);
assert.equal(run(inflatedProposal.draft,state,inflatedContext).expenditure,inflated.expenditure,'Nominal reallocation respects the current cost multiplier');
assert.equal(first.revenue,40283300);assert.equal(first.expenditure,44069700);assert.equal(first.deficit,3786400);assert.equal(first.funding_gap,0);
assert.equal(first.internal_debt,37436200);assert.equal(first.external_debt,6231900);
assert.equal(first.activity,1,'Existing activity is part of the calibration, not a second multiplier');
assert.equal(base.income_lines.reduce((s,l)=>s+l.amount,base.income_rounding),base.revenue);
assert.equal(base.expense_lines.reduce((s,l)=>s+l.amount,base.expense_rounding),base.expenditure);
const adopted={...state,last_plan_id:'adopted',financing_rates:{ofz_fixed:16}};
assert.equal(run(draft,adopted,{...context,policy:{...context.policy,key_rate:24}}).annual_interest,first.annual_interest,'Issued fixed coupon is not indexed to the key rate');
const healthcare={...draft,spending_changes:{'09':10}};
assert.equal(run(healthcare).expenditure-first.expenditure,190490,'10% of 1 904 900 million');
const loans={...draft,financing:{...draft.financing,bank_credit:1000}};
assert.equal(run(loans).revenue,first.revenue,'Borrowing is not income');
assert.equal(run(loans).internal_debt-first.internal_debt,1000);
assert.equal(run(loans).expenditure-first.expenditure,95,'19% annual interest, half-year convention');
const credit={id:'credit',kind:'budget_credit',amount:1000,section_key:'04',status:'requested'},sub={id:'sub',kind:'subsidy',amount:2000,section_key:'04',status:'requested'};
const transferDraft={...draft,transfer_ids:['credit','sub']},tr=run(transferDraft,state,context,regions,[],[credit,sub]);
assert.equal(tr.expenditure-first.expenditure,2000,'Loan principal never becomes a sector expense');
assert.equal(tr.funding_need-first.funding_need,3000,'Financing covers additional expense and credit outflow');
const covered=coverFundingGap(transferDraft,'ofz_fixed',state,context,regions,[],[credit,sub]);
assert(run(covered,state,context,regions,[],[credit,sub]).funding_gap<=.01,'Funding closure includes its own interest cost');
assert(run(draft,state,context,[{...regions[0],enterprises:1100}]).revenue>first.revenue);
assert(run(draft,state,{...context,policy:{...context.policy,key_rate:24}}).revenue<first.revenue);
assert(run(draft,state,{...context,policy:{...context.policy,inflation:12}}).expenditure>first.expenditure);
assert(run(draft,state,{...context,policy:{...context.policy,oil_price:50}}).revenue<first.revenue);
assert(run(draft,state,context,regions,[{region_code:'00',tax_key:'vat',rate:24}]).revenue>first.revenue);
const foreign=run(draft,state,{...context,policy:{...context.policy,fx_rate:100}});
assert.equal(foreign.external_debt,7789875,'25% FX revaluation of anchor-denominated principal');
const stored={...state,external_debt:foreign.external_debt/foreign.fx*state.anchor.fx_rate};
assert.equal(run(draft,stored,{...context,policy:{...context.policy,fx_rate:100}}).external_debt,foreign.external_debt,'Publishing never compounds FX revaluation');
const risk=run(draft,{...state,service_adjustment:1200,revenue_adjustment:-500});
assert.equal(risk.internal_debt,first.internal_debt,'Lender insolvency never cancels debt');
assert.equal(risk.revenue,first.revenue-500);assert.equal(risk.expenditure,first.expenditure+1200);
const surplus=run({...draft,income_changes:{oil_gas:100}});assert(surplus.surplus>0&&surplus.deficit===0);
assert(run({...draft,financing:{...draft.financing,reserves:5000000}}).reserve_remaining<0,'Overuse is visible before server validation');
const regional=fiscalForecast(regions[0],[]),regionalCredit=fiscalForecast({...regions[0],budget_credit_cash:1000},[]);
assert.equal(regionalCredit.revenue,regional.revenue,'Regional loans are not transfer income');assert.equal(regionalCredit.financing,1000);
const plainMoney=value=>value.replace(/[\u00a0\u202f]/g,' ');
assert.equal(billions(742000),'742\u00a0млрд\u00a0₽','Formatted labels use nonbreaking spaces');
assert.match(plainMoney(billions(742000)),/742 млрд ₽$/);assert.match(plainMoney(billions(40283300)),/40[,.]28 трлн ₽$/);
const cases=require('../content/budget-cases-2026.json'),old=require('../content/events-legal-2026.json');
assert.equal(cases.length,14);assert.equal(cases.filter(c=>c.comic_scene.region_code).length,8);
assert(cases.every(c=>c.situation.length>=500&&c.effect_plan.options.every(o=>o.description.length>=250)));
assert.equal(new Set([...cases,...old].map(c=>c.case_key)).size,cases.length+old.length);
assert.equal(new Set([...cases,...old].map(c=>c.situation.replace(/\s+/g,' ').trim().toLowerCase())).size,cases.length+old.length);
console.log('PASS Budget: verified 2026 totals, 14 sectors, borrowing vs income, interest vs principal, transfers vs loans, financing closure, enterprises, taxes, oil, rates, inflation, FX, risks, surplus, reserves and 14 distinct legal cases');


/* Budget seeding guard: execute the real SQL helper against an isolated
 * PGlite database, without Supabase credentials or production writes. */
(async()=>{
 const {PGlite}=require('@electric-sql/pglite');
 const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261112012920_budget_case_seed_guard.sql'),'utf8');
 assert(migration.includes('if v_templates_missing then perform private.seed_budget_cases(p_game_id);end if;'));
 assert(migration.includes('if v_regions_missing then perform private.seed_budget_regional_cases(p_game_id);end if;'));
 assert(migration.includes('perform private.apply_budget_simulator_plan(p_game_id,row_id)'),
  'Published budget plans must still apply');
 assert(migration.includes('perform private.apply_budget_financial_outcome(p_game_id,row_id)'),
  'Resolved financial cases must still apply');
 assert(migration.includes('perform private.dispatch_budget_risks(p_game_id)'),
  'Deferred risk dispatch stays enabled');
 assert(migration.includes('REVOKE ALL ON FUNCTION private.budget_seed_status(uuid)'),
  'Private guard is not exposed to clients');
 const helper=migration.slice(
  migration.indexOf('CREATE OR REPLACE FUNCTION private.budget_seed_status('),
  migration.indexOf('REVOKE ALL ON FUNCTION private.budget_seed_status(')).trim();
 const keys=[...new Set([...helper.matchAll(/'budget-region-2026-[^']+'/g)].map(m=>m[0].slice(1,-1)))];
 assert.equal(keys.length,16,'Catalog contains 16 canonical regional budget cases');
 const db=new PGlite();
 try{
  await db.exec('CREATE SCHEMA private; CREATE TABLE private.budget_case_templates(case_key text PRIMARY KEY);');
  await db.exec('CREATE TABLE public.event_cases(game_id uuid NOT NULL,case_key text NOT NULL,UNIQUE(game_id,case_key));');
  await db.exec(helper);
  const a='00000000-0000-4000-8000-000000000101',b='00000000-0000-4000-8000-000000000102';
  const status=async(game)=> (await db.query('SELECT * FROM private.budget_seed_status($1::uuid)',[game])).rows[0];
  await db.query("INSERT INTO private.budget_case_templates VALUES('budget-demo-a'),('budget-demo-b')");
  assert.deepEqual(status?Object.values(await status(a)):[],[true,true],'An empty game must seed both collections');
  for(const key of ['budget-demo-a','budget-demo-b',...keys])await db.query('INSERT INTO public.event_cases VALUES($1,$2)',[a,key]);
  assert.deepEqual(Object.values(await status(a)),[false,false],'Completed sets do not run seed routines');
  assert.deepEqual(Object.values(await status(b)),[true,true],'Another game cannot reuse another game\'s seeded state');
  await db.query('DELETE FROM public.event_cases WHERE game_id=$1 AND case_key=$2',[a,keys[0]]);
  assert.deepEqual(Object.values(await status(a)),[false,true],'A missing regional case must reseed');
  await db.query('INSERT INTO public.event_cases VALUES($1,$2)',[a,keys[0]]);
  await db.query("DELETE FROM public.event_cases WHERE game_id=$1 AND case_key='budget-demo-a'",[a]);
  assert.deepEqual(Object.values(await status(a)),[true,false],'A missing template must reseed');
  await db.query('INSERT INTO public.event_cases VALUES($1,$2)',[a,'budget-demo-a']);
  for(let i=0;i<100;i++)assert.deepEqual(Object.values(await status(a)),[false,false]);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM public.event_cases WHERE game_id=$1',[a])).rows[0].n,18,
   '100 repeated views do not mutate any case rows');
  console.log('PASS: Budget seed guard, 16 canonical cases, 100 no-op reads, cross-game isolation, partial-seed repair, preserved financial side effects');
 }finally{await db.close()}
})().catch(err=>{console.error(err);process.exitCode=1});


/* Read-only plan-selection parity with the pre-optimization simulator,
 * and strict preservation of the mutating preparation phase. */
(async()=>{
 const {PGlite}=require('@electric-sql/pglite');
 const source=fs.readFileSync(path.join(root,'supabase/migrations/20261112033448_budget_pulse_lean_read_split.sql'),'utf8');
 const helper=source.slice(source.indexOf('CREATE OR REPLACE FUNCTION private.prepare_budget_simulator'),
  source.indexOf('REVOKE ALL ON FUNCTION private.prepare_budget_simulator'));
 const simulator=source.slice(source.indexOf('CREATE OR REPLACE FUNCTION public.get_budget_simulator'),
  source.indexOf('CREATE OR REPLACE FUNCTION public.get_budget_pulse'));
 const pulse=source.slice(source.indexOf('CREATE OR REPLACE FUNCTION public.get_budget_pulse'));
 assert(helper.includes('private.is_game_member(p_game_id)'),'Original member check remains inside shared preparer');
 assert(helper.includes('private.ensure_budget_simulator(p_game_id)'),'First-time initialization remains');
 assert(helper.includes('private.seed_budget_cases(p_game_id)')&&helper.includes('private.seed_budget_regional_cases(p_game_id)'),'Missing case recovery remains');
 assert(helper.includes('private.apply_budget_simulator_plan(p_game_id,row_id)'),'Published plan application remains');
 assert(helper.includes('private.apply_budget_financial_outcome(p_game_id,row_id)'),'Resolved budget outcome application remains');
 assert(helper.includes('private.dispatch_budget_risks(p_game_id)'),'Due financial risk dispatch remains');
 assert(source.includes('REVOKE ALL ON FUNCTION private.prepare_budget_simulator(uuid)'),'Private preparer cannot be called directly by users');
 assert(simulator.includes("return jsonb_build_object('state'")&&simulator.includes("'regional_events'")&&simulator.includes("'contracts'")&&simulator.includes("'ledger'"),'Full simulator response remains unchanged');
 assert(!pulse.includes('simulation:=public.get_budget_simulator('),'Budget pulse must not build full simulator response');
 assert(pulse.includes("perform pg_advisory_xact_lock(hashtextextended('gos-budget-pulse:'"),'The budget pulse serialization lock remains');
 assert(pulse.includes('private.calculate_budget_simulator(p_game_id,draft)'),'The economic calculation is unchanged');
 assert(pulse.includes('insert into budget_income_history(')&&pulse.includes('update state_metrics'),'History and metric synchronization are preserved');
 const from=pulse.indexOf(' select x into plan\n from jsonb_array_elements((');
 const to=pulse.indexOf(';\n if plan is null',from);
 assert(from>0&&to>from,'Extract the actual fast plan selection from the migration');
 const sql=pulse.slice(from,to).replace('select x into plan','select x').replaceAll('p_game_id','$1');
 const db=new PGlite();
 try{
  await db.exec("CREATE TABLE public.budget_simulator_plans(id uuid PRIMARY KEY,game_id uuid NOT NULL,status text,updated_at timestamptz,document_id uuid,title text,draft jsonb,revision integer);");
  await db.exec("CREATE TABLE public.formal_documents(id uuid PRIMARY KEY,registry_no text);");
  const gameA='00000000-0000-4000-8000-000000000101',gameB='00000000-0000-4000-8000-000000000102',gameEmpty='00000000-0000-4000-8000-000000000103';
  const oldPlans=async(g)=>(await db.query(
   "select coalesce(jsonb_agg(to_jsonb(p) order by p.updated_at desc),'[]'::jsonb) as plans from (select pl.*,d.registry_no from public.budget_simulator_plans pl left join public.formal_documents d on d.id=pl.document_id where pl.game_id=$1 order by pl.updated_at desc limit 30)p",[g])).rows[0].plans;
  const parity=async(g)=>{
   const old=await oldPlans(g);
   const expected=old.filter(p=>p.status==='draft')[0]||old[0]||null;
   const got=(await db.query(sql,[g])).rows[0]?.x||null;
   assert.deepEqual(got,expected,'Plan and all its fields must match the original 30-plan JSON selection');
  };
  await parity(gameEmpty);
  await db.query("INSERT INTO public.formal_documents VALUES('00000000-0000-4000-8000-000000000905','Б-001')");
  for(let i=1;i<=35;i++){
   const id='00000000-0000-4000-8000-'+String(i).padStart(12,'0');
   await db.query('INSERT INTO public.budget_simulator_plans VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',[
    id,gameA,i===2||i===29?'draft':i%3===0?'published':'document',
    new Date(Date.UTC(2026,0,1,0,i)).toISOString(),i===29?'00000000-0000-4000-8000-000000000905':null,
    'План '+i,{title:'План '+i,financing:{ofz_fixed:i}},i
   ]);
  }
  await db.query("INSERT INTO public.budget_simulator_plans VALUES ('00000000-0000-4000-8000-000000000800',$1,'draft',now(),NULL,'Чужой план','{}',1)",[gameB]);
  await parity(gameA);await parity(gameB);await parity(gameEmpty);
  await db.query("UPDATE public.budget_simulator_plans SET status='published' WHERE game_id=$1 AND status='draft'",[gameA]);
  await parity(gameA);
  await db.query("DELETE FROM public.budget_simulator_plans WHERE game_id=$1 AND id='00000000-0000-4000-8000-000000000035'",[gameA]);
  await parity(gameA);
  console.log('PASS: Budget pulse plan selection matches full simulator for empty, cross-game, 35-plan, draft and no-draft cases; shared side effects and economic calculation retained');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});


/* Test actual Postgres signature logic against a tiny isolated PGlite schema.
   No production writes, no live Supabase accounts, no new service required. */
(async()=>{
 const {PGlite}=require('@electric-sql/pglite');
 const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261112083000_budget_forecast_fingerprint_cache.sql'),'utf8');
 const signature=migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION private.budget_forecast_signature('),migration.indexOf('REVOKE ALL ON FUNCTION private.budget_forecast_signature('));
 const pulse=migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.get_budget_pulse('));
 assert.equal((migration.match(/CREATE TABLE private.budget_forecast_cache/g)||[]).length,1);
 assert(migration.includes('ALTER TABLE private.budget_forecast_cache ENABLE ROW LEVEL SECURITY'));
 assert(migration.includes('REVOKE ALL ON private.budget_forecast_cache FROM PUBLIC,anon,authenticated'));
 assert(migration.includes('REVOKE ALL ON FUNCTION private.budget_forecast_signature(uuid,jsonb)'));
 assert(pulse.indexOf('perform private.prepare_budget_simulator(p_game_id)')<pulse.indexOf('v_signature:=private.budget_forecast_signature(p_game_id,draft)'),'Financial consequences always apply before cache lookup');
 assert(pulse.indexOf('perform pg_advisory_xact_lock(')<pulse.indexOf('v_signature:=private.budget_forecast_signature('),'The old per-game lock protects cache fill');
 assert(pulse.includes('calculation:=private.calculate_budget_simulator(p_game_id,draft);'),'A changed input still uses the exact original calculator');
 assert(pulse.includes('where c.game_id=p_game_id and c.input_signature=v_signature'),'No cross-game cache hits');
 assert(pulse.includes('where budget_forecast_cache.input_signature is distinct from excluded.input_signature'),'No write on a cache hit');
 assert(pulse.includes("select * into latest from budget_income_history")&&pulse.includes('insert into budget_income_history('),'Fresh history remains outside the forecast cache');
 assert(pulse.includes("update state_metrics set label='Доходы бюджета'"),'Budget metric write guard retained');
 assert(!signature.includes("metric_key='budget'"),'The derived budget metric must not invalidate its own cache');
 const db=new PGlite();
 try{
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA private;");
  const ddl=[
   'CREATE TABLE public.games(id uuid PRIMARY KEY,status text)',
   'CREATE TABLE private.budget_baseline(year integer PRIMARY KEY,data jsonb)',
   'CREATE TABLE public.budget_simulator_state(game_id uuid PRIMARY KEY,revenue_adjustment numeric)',
   'CREATE TABLE public.game_fiscal_policy(game_id uuid PRIMARY KEY,key_rate numeric)',
   'CREATE TABLE public.game_fiscal_regions(game_id uuid,region_code text,enterprises numeric,PRIMARY KEY(game_id,region_code))',
   'CREATE TABLE public.game_fiscal_rates(game_id uuid,region_code text,tax_key text,rate numeric,PRIMARY KEY(game_id,region_code,tax_key))',
   'CREATE TABLE public.state_metrics(id uuid PRIMARY KEY,game_id uuid,metric_key text,value numeric)',
   'CREATE TABLE public.budget_transfer_requests(id uuid PRIMARY KEY,game_id uuid,event_case_id uuid,region_code text,amount numeric)',
   'CREATE TABLE public.event_cases(id uuid PRIMARY KEY,game_id uuid,title text)',
   'CREATE TABLE public.fiscal_region_reference(code text PRIMARY KEY,name text)',
   'CREATE TABLE public.state_programs(id uuid PRIMARY KEY,game_id uuid,title text)',
   'CREATE TABLE public.state_program_goals(id uuid PRIMARY KEY,game_id uuid,indicator_name text)',
   'CREATE TABLE public.state_program_components(id uuid PRIMARY KEY,game_id uuid,title text)',
   'CREATE TABLE public.state_program_expenses(id uuid PRIMARY KEY,game_id uuid,amount numeric)',
   'CREATE TABLE public.state_program_budget_commitments(program_id uuid,budget_year integer,game_id uuid,amount numeric,PRIMARY KEY(program_id,budget_year))'
  ];
  for(const stmt of ddl)await db.exec(stmt);
  await db.exec(migration.slice(migration.indexOf('CREATE TABLE private.budget_forecast_cache('),migration.indexOf('-- Per-game signature')));
  await db.exec(signature);
  const a='00000000-0000-4000-8000-000000000101',b='00000000-0000-4000-8000-000000000102';
  await db.query("INSERT INTO public.games VALUES($1,'active'),($2,'active')",[a,b]);
  await db.query("INSERT INTO private.budget_baseline VALUES(2026,'{\"2026\":true}'::jsonb)");
  const draft={title:'Исходный прогноз',financing:{ofz_fixed:60}};
  const sig=async(g=a,d=draft)=>(await db.query('SELECT private.budget_forecast_signature($1::uuid,$2::jsonb) AS sig',[g,JSON.stringify(d)])).rows[0].sig;
  const initial=await sig();
  assert.equal(initial,await sig());
  assert.notEqual(initial,await sig(a,{...draft,note:'Changed'}),'Changing the selected draft invalidates');
  await db.query("INSERT INTO public.state_metrics VALUES ('00000000-0000-4000-8000-000000000111',$1,'budget',12)",[a]);
  assert.equal(initial,await sig(),'The derived budget metric must not cause a cache storm');
  await db.query("UPDATE public.state_metrics SET value=13 WHERE game_id=$1 AND metric_key='budget'",[a]);
  assert.equal(initial,await sig(),'Budget history synchronization does not invalidate');
  const sources=[
   ["state","INSERT INTO public.budget_simulator_state VALUES($1,15)"],
   ["policy","INSERT INTO public.game_fiscal_policy VALUES($1,16)"],
   ["region","INSERT INTO public.game_fiscal_regions VALUES($1,'54',100)"],
   ["rate","INSERT INTO public.game_fiscal_rates VALUES($1,'00','vat',22)"],
   ["economy","INSERT INTO public.state_metrics VALUES ('00000000-0000-4000-8000-000000000112',$1,'economy',50)"],
   ["program","INSERT INTO public.state_programs VALUES('00000000-0000-4000-8000-000000000211',$1,'Программа')"],
   ["goal","INSERT INTO public.state_program_goals VALUES('00000000-0000-4000-8000-000000000212',$1,'Показатель')"],
   ["component","INSERT INTO public.state_program_components VALUES('00000000-0000-4000-8000-000000000213',$1,'Компонент')"],
   ["expense","INSERT INTO public.state_program_expenses VALUES('00000000-0000-4000-8000-000000000214',$1,100)"],
   ["commitment","INSERT INTO public.state_program_budget_commitments VALUES('00000000-0000-4000-8000-000000000211',2026,$1,100)"]
  ];
  let previous=await sig();
  for(const [name,statement] of sources){
   await db.query(statement,[a]);
   const next=await sig();
   assert.notEqual(next,previous,name+' changes the budget signature');
   previous=next;
  }
  await db.query("INSERT INTO public.event_cases VALUES('00000000-0000-4000-8000-000000000321',$1,'Ситуация')",[a]);
  assert.equal(previous,await sig(),'Unreferenced event case is not a calculation input');
  await db.query("INSERT INTO public.fiscal_region_reference VALUES('54','Область')");
  assert.equal(previous,await sig(),'Unreferenced region name is not a calculation input');
  await db.query("INSERT INTO public.budget_transfer_requests VALUES('00000000-0000-4000-8000-000000000322',$1,'00000000-0000-4000-8000-000000000321','54',500)",[a]);
  const withTransfer=await sig();
  assert.notEqual(withTransfer,previous,'Transfer changes the signature');
  await db.query("UPDATE public.event_cases SET title='Новая ситуация' WHERE game_id=$1",[a]);
  const withCase=await sig();
  assert.notEqual(withCase,withTransfer,'Related event label changes the calculation payload');
  await db.query("UPDATE public.fiscal_region_reference SET name='Новая область' WHERE code='54'");
  const withRegion=await sig();
  assert.notEqual(withRegion,withCase,'Transfer region name changes the payload');
  await db.query("INSERT INTO public.state_metrics VALUES ('00000000-0000-4000-8000-000000000113',$1,'economy',77)",[b]);
  assert.equal(withRegion,await sig(a),'Another game cannot invalidate this game');
  await db.query("UPDATE private.budget_baseline SET data='{\"2026\":false}'::jsonb WHERE year=2026");
  assert.notEqual(withRegion,await sig(),'The baseline invalidates all cached forecasts');
  await db.query('INSERT INTO private.budget_forecast_cache(game_id,input_signature,calculation) VALUES($1,$2,$3::jsonb)',[a,initial,JSON.stringify({revenue:42})]);
  assert.equal((await db.query('SELECT calculation->>\\'revenue\\' AS rev FROM private.budget_forecast_cache WHERE game_id=$1',[a])).rows[0].rev,'42');
  const row=(await db.query("SELECT relrowsecurity AS enabled FROM pg_class WHERE oid='private.budget_forecast_cache'::regclass")).rows[0];
  assert(row.enabled,'Private cache table has RLS enabled');
  console.log('PASS: Budget cache signature invalidates for all calculation inputs and linked transfer labels, isolates games, ignores derived budget metric, RLS enabled');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
