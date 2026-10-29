/* A07: Test the actual deployed apply_post_effects source against an EPHEMERAL
 * PostgreSQL service with 40 and 100 independent client connections.
 * Never use a real Supabase URL; this script intentionally permits localhost only.
 */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {spawn}=require('node:child_process');
const {performance}=require('node:perf_hooks');

assert(['127.0.0.1','localhost','::1'].includes(process.env.PGHOST),'A07 test MUST use an isolated local PostgreSQL server');
assert(process.env.PGDATABASE==='a07_fixture','A07 test MUST use only the disposable a07_fixture DB');
const env={...process.env,PGCONNECT_TIMEOUT:'12',PGOPTIONS:'-c statement_timeout=30000'};
const game='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const party='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const actor='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const postId=n=>'00000000-0000-4000-8000-'+n.toString(16).padStart(12,'0');
const plan=JSON.stringify({metrics:{beta:1,alpha:1},party_support:{[party]:0.1}});
const migration=fs.readFileSync('supabase/migrations/20261025003300_lock_concurrent_impact_metric_updates.sql','utf8');
const a=migration.indexOf('CREATE OR REPLACE FUNCTION private.apply_post_effects(');
const b=migration.indexOf('CREATE OR REPLACE FUNCTION private.apply_rule_effects(',a+1);
assert(a>=0&&b>a,'Extract the real production function from the migration');
const functionSql=migration.slice(a,b).trim();
assert(functionSql.endsWith('$function$;'),'Actual production function must be valid standalone SQL');
assert(functionSql.includes('metric_key=kv.key for update'),'Source function must lock metric before read');
assert(functionSql.includes('order by key'),'Source function must acquire metric locks consistently');

function sql(text){
 return new Promise((resolve,reject)=>{
  const p=spawn('psql',['-X','-A','-t','-q','-v','ON_ERROR_STOP=1','-f','-'],{env});
  let stdout='',stderr='';
  p.stdout.on('data',x=>{stdout+=x.toString()});
  p.stderr.on('data',x=>{stderr+=x.toString()});
  p.on('error',reject);
  p.on('close',code=>code===0?resolve(stdout.trim()):reject(Error('psql exit='+code+' '+stderr.slice(-1800))));
  p.stdin.end(text);
 });
}
const row=id=> "('"+id+"','"+game+"',false,'Изолированное решение','"+
 plan.replace(/'/g,"''")+"')";
const setup=[
 'CREATE SCHEMA private;',
 'CREATE TABLE public.political_posts(id uuid primary key,game_id uuid not null,effects_applied boolean not null default false,title text not null,impact_plan jsonb not null,updated_at timestamptz);',
 'CREATE TABLE public.state_metrics(id uuid primary key default gen_random_uuid(),game_id uuid not null,metric_key text not null,value numeric not null,unique(game_id,metric_key));',
 'CREATE TABLE public.game_parties(id uuid primary key,game_id uuid not null,support numeric not null);',
 'CREATE TABLE public.party_support_history(id bigserial primary key,game_id uuid,party_id uuid,value numeric,previous_value numeric,delta numeric,source_type text,source_id text);',
 'CREATE FUNCTION private.record_metric_change(p_game uuid,p_key text,p_value numeric,p_type text,p_source text,p_actor uuid,p_note text) RETURNS void LANGUAGE plpgsql AS $stub$ BEGIN UPDATE public.state_metrics SET value=p_value WHERE game_id=p_game AND metric_key=p_key; END; $stub$;',
 functionSql,
 "INSERT INTO public.state_metrics(game_id,metric_key,value) VALUES ('"+game+"','alpha',10),('"+game+"','beta',50);",
 "INSERT INTO public.game_parties(id,game_id,support) VALUES ('"+party+"','"+game+"',10);",
 "INSERT INTO public.political_posts(id,game_id,effects_applied,title,impact_plan) VALUES "+Array.from({length:140},(_,i)=>row(postId(i+1))).join(',')+';'
].join('\n');

async function snapshot(){
 const result=await sql("SELECT json_build_object('alpha',(SELECT value FROM public.state_metrics WHERE metric_key='alpha'),'beta',(SELECT value FROM public.state_metrics WHERE metric_key='beta'),'support',(SELECT support FROM public.game_parties WHERE id='"+party+"'),'history',(SELECT count(*) FROM public.party_support_history),'applied',(SELECT count(*) FROM public.political_posts WHERE effects_applied=true))::text;");
 return JSON.parse(result.split('\n').filter(Boolean).pop());
}
async function parallel(ids){
 const start=performance.now();
 await Promise.all(ids.map(id=>sql("SELECT private.apply_post_effects('"+id+"'::uuid,'"+actor+"'::uuid);")));
 return Math.round(performance.now()-start);
}
(async()=>{
 await sql(setup);
 const ms40=await parallel(Array.from({length:40},(_,i)=>postId(i+1)));
 let observed=await snapshot();
 assert.deepEqual(observed,{alpha:50,beta:90,support:14,history:40,applied:40},
 '40 distinct concurrent confirmed effects must all count exactly once');
 // Keep support below its production 0–100 clamp, so lost increments remain observable.
 const ms100=await parallel(Array.from({length:100},(_,i)=>postId(i+41)));
 observed=await snapshot();
 assert.deepEqual(observed,{alpha:150,beta:190,support:24,history:140,applied:140},
 '100 distinct concurrent confirmed effects must preserve every increment and history row');
 const repeatId=postId(141);
 await sql("INSERT INTO public.political_posts(id,game_id,effects_applied,title,impact_plan) VALUES "+row(repeatId)+";");
 const msRetry=await parallel(Array.from({length:100},()=>repeatId));
 observed=await snapshot();
 assert.deepEqual(observed,{alpha:151,beta:191,support:24.1,history:141,applied:141},
 '100 parallel retries of ONE decision must change metrics and support exactly once');
 console.log('PASS isolated PostgreSQL: 40 distinct sessions: '+ms40+'ms; 100 distinct sessions: '+ms100+'ms; 100 same-source retries: '+msRetry+'ms; 0 lost/duplicate increments');
 console.log('Note: Actual apply_post_effects PL/pgSQL with simplified data/history fixtures; NOT 100 independent JWT, Supabase HTTP, Realtime, or live users.');
})().catch(e=>{console.error(e);process.exitCode=1});