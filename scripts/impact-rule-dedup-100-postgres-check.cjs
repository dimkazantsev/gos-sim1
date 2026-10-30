'use strict';
// #491: Real production apply_rule_effects against disposable Postgres.
// Check 100 distinct sources and 100 competing repeats of one source.
// No production secrets, no Auth JWT, no browser load.
const assert=require('node:assert/strict'),fs=require('node:fs'),{spawn}=require('node:child_process'),{performance}=require('node:perf_hooks');
assert(['localhost','127.0.0.1','::1'].includes(process.env.PGHOST),'Only disposable local DB');
assert.equal(process.env.PGDATABASE,'a07_fixture');
assert.equal(process.env.GOS_RULE_QA,'LOCAL-100');
const env={...process.env,PGCONNECT_TIMEOUT:'12',PGOPTIONS:'-c statement_timeout=30000'};
const G='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const R='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const A='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MIG='supabase/migrations/20261025003300_lock_concurrent_impact_metric_updates.sql';
const migration=fs.readFileSync(MIG,'utf8');
const start=migration.indexOf('CREATE OR REPLACE FUNCTION private.apply_rule_effects(');
const end=migration.indexOf('CREATE OR REPLACE FUNCTION public.revert_impact_entry(',start);
assert(start!==-1&&end>start);
const oldBody=migration.slice(start,end).trim();
const migrationNext='supabase/migrations/20261030090000_serialize_same_source_impact_rule.sql';
const production=fs.existsSync(migrationNext)?fs.readFileSync(migrationNext,'utf8'):oldBody;
assert(production.includes('private.apply_rule_effects('));
function sql(command){
 return new Promise((resolve,reject)=>{
  const proc=spawn('psql',['-X','-A','-t','-q','-v','ON_ERROR_STOP=1','-f','-'],{env});
  let stdout='',stderr='';proc.stdout.on('data',x=>stdout+=x);proc.stderr.on('data',x=>stderr+=x);
  proc.on('error',reject);proc.on('close',n=>n===0?resolve(stdout.trim()):reject(Error(stderr.slice(-1800))));
  proc.stdin.end(command);
 });
}
const setup=[
 'create schema private;',
 'create table public.impact_rules(id uuid primary key,game_id uuid,rule_key text,enabled boolean,auto_apply boolean,conditions jsonb,effects jsonb,label text);',
 'create table public.impact_ledger(id bigserial primary key,game_id uuid,rule_id uuid,rule_key text,source_type text,source_id text,actor_id uuid,effects jsonb,note text, unique(game_id,rule_key,source_type,source_id));',
 'create table public.state_metrics(id uuid primary key default gen_random_uuid(),game_id uuid,metric_key text,value numeric,min_value numeric,max_value numeric,unique(game_id,metric_key));',
 'create table public.game_parties(id uuid primary key,game_id uuid,support numeric,name text);',
 'create table public.game_members(game_id uuid,user_id uuid,team text);',
 'create table public.party_support_history(id bigserial primary key,game_id uuid,party_id uuid,value numeric,previous_value numeric,delta numeric,source_type text,source_id text);',
 'create function private.impact_condition_matches(jsonb,jsonb) returns boolean language sql as $$select true$$;',
 'create function private.record_metric_change(uuid,text,numeric,text,text,uuid,text) returns void language plpgsql as $$begin update public.state_metrics set value=$3 where game_id=$1 and metric_key=$2;end$$;',
 production,
 "insert into public.impact_rules values ('"+R+"','"+G+"','qa-100',true,true,'{}','{\"metrics\":{\"alpha\":1,\"beta\":1},\"actor_party_support\":0.1}','Isolated QA');",
 "insert into public.state_metrics(game_id,metric_key,value) values ('"+G+"','alpha',10),('"+G+"','beta',50);",
 "insert into public.game_parties values ('"+R+"','"+G+"',10,'QA party');",
 "insert into public.game_members values ('"+G+"','"+A+"','QA party');"
].join('\n');
const call=source=>"select private.apply_rule_effects('"+G+"',r,'qa','"+source+"','"+A+"','{}'::jsonb,'qa') from public.impact_rules r where r.id='"+R+"';";
const snapshot=async()=>{
 const s=await sql("select json_build_object('alpha',(select value from public.state_metrics where metric_key='alpha'),'beta',(select value from public.state_metrics where metric_key='beta'),'support',(select support from public.game_parties where id='"+R+"'),'ledger',(select count(*) from public.impact_ledger),'history',(select count(*) from public.party_support_history))::text;");
 return JSON.parse(s.split('\n').at(-1));
};
async function parallel(items){const t=performance.now();const results=await Promise.allSettled(items.map(callText=>sql(callText)));return{ms:Math.round(performance.now()-t),failures:results.filter(r=>r.status==='rejected').map(r=>r.reason.message),returns:results.filter(r=>r.status==='fulfilled').map(r=>r.value)};}
(async()=>{
 await sql(setup);
 const distinct=await parallel(Array.from({length:100},(_,i)=>call('distinct-'+i)));
 assert.deepEqual(distinct.failures,[],'100 independent rule effects must commit without errors: '+distinct.failures.slice(0,3));
 assert.deepEqual(await snapshot(),{alpha:110,beta:150,support:20,ledger:100,history:100},'All 100 distinct effects persist once');
 const repeat=await parallel(Array.from({length:100},()=>call('same-100')));
 assert.deepEqual(repeat.failures,[],'100 retries for one source must be safely idempotent, not raise unique violations: '+repeat.failures.slice(0,3));
 assert.equal(repeat.returns.filter(x=>x==='t').length,1,'Only one call may apply effect');
 assert.deepEqual(await snapshot(),{alpha:111,beta:151,support:20.1,ledger:101,history:101},'Same-source effects must apply exactly once');
 console.log(JSON.stringify({status:'PASS',scope:'Actual production apply_rule_effects PL/pgSQL, disposable PostgreSQL and simplified game tables, not browser/JWT traffic',clients:100,distinctMs:distinct.ms,sameSourceRetryMs:repeat.ms,distinctCommitted:100,sameSourceCommitted:1,errors:0,lostOrDuplicateEffects:0,productionRequests:0}));
})().catch(e=>{console.error('FAIL impact rule dedup: '+(e.stack||e));process.exitCode=1});
