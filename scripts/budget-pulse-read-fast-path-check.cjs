'use strict';
// Disposable PGlite fixture: real candidate/reference SQL, stubbed financial operations.
// No production credentials, traffic or copied player data.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const candidate=fs.readFileSync('docs/performance/budget-pulse-read-fast-path-candidate.sql','utf8');
const deployed=fs.readFileSync('supabase/migrations/20261125051110_budget_pulse_read_fast_path.sql','utf8');
assert(deployed.includes(candidate.replace('-- Candidate only. NOT an applied migration.','-- Verified conservative budget snapshot; existing write and fallback path retained.')),'Live migration contains exact SQL candidate tested below');
const reference=candidate.slice(candidate.indexOf('CREATE OR REPLACE FUNCTION public.get_budget_pulse('))
 .replace('public.get_budget_pulse(','public.get_budget_pulse_reference(')
 .replace(';v_read_snapshot jsonb;',';')
 .replace(/ -- No lock, preparation,[\s\S]*? -- Unchanged slow path:[^\n]*\n/,'');
assert(!reference.includes('read_current_budget_pulse')&&!reference.includes('v_read_snapshot'));
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const [g,student,teacher,observer,foreign,stranger,doc,plan,risk]=Array.from({length:9},(_,i)=>uuid(i+1));
const q=v=>"'"+v+"'",G=q(g),D=q(doc),P=q(plan),R=q(risk);
const setup=`
create schema private;create schema auth;create role anon;create role authenticated;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth,public,private to authenticated;
create table game_members(game_id uuid,user_id uuid,kind text);
insert into game_members values (${G},${q(student)},'student'),(${G},${q(teacher)},'teacher'),(${G},${q(observer)},'observer');
create function private.is_game_member(p uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.game_members where game_id=p and user_id=auth.uid())$$;
create table private.budget_baseline(year int primary key,data jsonb);insert into private.budget_baseline values (2026,'{"financing":{}}');
create table formal_documents(id uuid primary key,game_id uuid,registry_no text,status_code text);
create table budget_simulator_plans(id uuid primary key,game_id uuid,document_id uuid,status text,updated_at timestamptz default now(),draft jsonb,title text,revision int);
create table game_fiscal_policy(game_id uuid primary key,monetary_last_settled_on date,monetary_started_at timestamptz);
insert into game_fiscal_policy values (${G},(now() at time zone 'Asia/Barnaul')::date,now()-interval '30 days');
create table budget_simulator_state(game_id uuid primary key,month int);insert into budget_simulator_state values (${G},3);
create table fiscal_region_reference(code text primary key);insert into fiscal_region_reference values ('01'),('02');
create table game_fiscal_regions(game_id uuid,region_code text);insert into game_fiscal_regions values (${G},'01'),(${G},'02');
create table event_cases(id uuid primary key,game_id uuid,case_key text);
create table event_case_outcomes(case_id uuid,game_id uuid);
create table budget_simulator_ledger(game_id uuid,source_key text);
create table private.budget_deferred_risks(game_id uuid,case_id uuid,dispatched_at timestamptz,due_at timestamptz,due_month int);
create table fiscal_change_ledger(game_id uuid,source_type text,created_at timestamptz,before_values jsonb,after_values jsonb);
create table state_metrics(id uuid primary key default gen_random_uuid(),game_id uuid,metric_key text,label text,value numeric,previous_value numeric,unit text,is_public bool,group_key text,description text,min_value numeric,max_value numeric,sort_order int,updated_at timestamptz default now(),unique(game_id,metric_key));
create table budget_income_history(id bigint generated always as identity primary key,game_id uuid,plan_id uuid,value numeric,previous_value numeric,expenditure numeric,mode text,note text,recorded_at timestamptz default clock_timestamp());
create table private.budget_forecast_cache(game_id uuid primary key,input_signature text,calculation jsonb,updated_at timestamptz default now());
create table private.fixture_input(game_id uuid primary key,revision int,revenue numeric,templates_missing bool,regions_missing bool);
insert into private.fixture_input values (${G},1,1000,false,false);
create table private.slow_path_calls(kind text);
create function private.budget_seed_status(p uuid) returns table(templates_missing boolean,regions_missing boolean) language sql stable as $$select templates_missing,regions_missing from private.fixture_input where game_id=p$$;
create function private.budget_forecast_signature(p uuid,d jsonb) returns text language sql stable as $$select md5(d::text||revision::text||revenue::text) from private.fixture_input where game_id=p$$;
create function private.calculate_budget_simulator(p uuid,d jsonb) returns jsonb language sql stable as $$select jsonb_build_object('revenue',revenue,'expenditure',1100,'fixture',revision) from private.fixture_input where game_id=p$$;
create function private.settle_monetary_inflation(p uuid) returns numeric language plpgsql as $$begin insert into private.slow_path_calls values('settle');return 0;end$$;
create function private.prepare_budget_simulator(p uuid) returns void language plpgsql as $$begin insert into private.slow_path_calls values('prepare');end$$;
`;
(async()=>{
 const db=new PGlite();await db.waitReady;
 try{
  await db.exec(setup);await db.exec(reference);await db.exec(candidate);
  await db.exec('revoke all on function public.get_budget_pulse(uuid) from public;grant execute on function public.get_budget_pulse(uuid) to authenticated;');
  async function value(sql){return (await db.query(sql)).rows[0].value}
  async function as(uid,sql){await db.exec("select set_config('request.jwt.claim.sub',"+q(uid)+",false);set role authenticated;");try{return await value(sql)}finally{await db.exec('reset role')}}
  const call='select public.get_budget_pulse('+G+') as value',refCall='select public.get_budget_pulse_reference('+G+') as value';
  const helper='select private.read_current_budget_pulse('+G+') as value';
  const omitClock=({as_of,...rest})=>rest;
  const expected=await as(student,refCall);await db.exec('delete from private.slow_path_calls');
  for(const uid of [student,teacher,observer]){
   await db.exec('begin read only');
   try{assert.deepEqual(omitClock(await as(uid,call)),omitClock(expected))}finally{await db.exec('rollback')}
  }
  assert.equal(await value('select count(*)::int as value from private.slow_path_calls'),0);
  for(const role of ['authenticated','anon'])assert.equal(await value("select has_function_privilege("+q(role)+",'private.read_current_budget_pulse(uuid)','execute') as value"),false);
  await assert.rejects(as(stranger,call),/Нет доступа/);
  await assert.rejects(as(student,"select public.get_budget_pulse("+q(foreign)+") as value"),/Нет доступа/);
  const cases=[
   ['cache missing','delete from private.budget_forecast_cache'],
   ['signature changed','update private.fixture_input set revision=2,revenue=1200'],
   ['history value mismatch','update budget_income_history set value=999'],
   ['history expenditure mismatch','update budget_income_history set expenditure=999'],
   ['history missing','delete from budget_income_history'],
   ['metric mismatch','update state_metrics set value=999'],
   ['metric missing','delete from state_metrics'],
   ['policy missing','delete from game_fiscal_policy'],
   ['state missing','delete from budget_simulator_state'],
   ['region missing',"delete from game_fiscal_regions where region_code='02'"],
   ['templates missing','update private.fixture_input set templates_missing=true'],
   ['regional cases missing','update private.fixture_input set regions_missing=true'],
   ['pending publication',"insert into formal_documents values("+D+","+G+",'QA','published');insert into budget_simulator_plans(id,game_id,document_id,status,draft,title,revision) values("+P+","+G+","+D+",'document','{}','QA',1)"],
   ['pending outcome',"insert into event_cases values("+R+","+G+",'budget-risk-fixture');insert into event_case_outcomes values("+R+","+G+")"],
   ['due risk time',"insert into event_cases values("+R+","+G+",'budget-risk-fixture');insert into private.budget_deferred_risks values("+G+","+R+",null,now()-interval '1 minute',99)"],
   ['due risk month',"insert into event_cases values("+R+","+G+",'budget-risk-fixture');insert into private.budget_deferred_risks values("+G+","+R+",null,now()+interval '1 day',3)"],
   ['due monetary',"update game_fiscal_policy set monetary_last_settled_on=(now() at time zone 'Asia/Barnaul')::date-2;insert into fiscal_change_ledger values("+G+",'macro',now()-interval '2 days','{\"key_rate\":10}','{\"key_rate\":11}')"]
  ];
  for(const [name,mutation] of cases){
   await db.exec('begin');
   try{
    await db.exec(mutation);assert.equal(await value(helper),null,name);
    const actual=await as(student,call);assert(actual.calculation,name);
    assert.equal(await value('select count(*)::int as value from private.slow_path_calls'),2,name+' invokes unchanged slow path');
    if(name==='signature changed')assert.equal(actual.calculation.revenue,1200);
   }finally{await db.exec('rollback')}
  }
  await db.exec('begin');
  try{
   await db.exec('delete from state_metrics;delete from budget_income_history');await as(observer,call);
   assert.equal(await value('select count(*)::int as value from state_metrics'),0);
   assert.equal(await value('select count(*)::int as value from budget_income_history'),0);
  }finally{await db.exec('rollback')}
  console.log(JSON.stringify({status:'PASS',fullJsonRoles:3,deniedForeignAndStranger:2,privateHelperRevoked:true,fallbackCases:cases.length,observerWrites:0,fixture:'PGlite with stub financial side effects; not full production schema or concurrent load',productionRequests:0}));
 }finally{await db.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
