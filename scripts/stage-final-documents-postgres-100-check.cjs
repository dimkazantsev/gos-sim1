'use strict';
// Issue #491. Real production SQL functions under 100 independent Postgres
// connections, 16 stage-document readiness checks per connection.
// Intentionally simplified *other* readiness conditions; NO real Auth/RLS,
// NO complete stage workflow, NO production DB traffic.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {spawn}=require('node:child_process');
const {performance}=require('node:perf_hooks');
assert.equal(process.env.GITHUB_ACTIONS,'true');
assert.equal(process.env.GOS_FINAL_DOCUMENT_QA,'LOCAL-100');
assert(['localhost','127.0.0.1','::1'].includes(process.env.PGHOST));
assert.equal(process.env.PGDATABASE,'a07_fixture');
const env={...process.env,PGCONNECT_TIMEOUT:'12',PGOPTIONS:'-c statement_timeout=40000'};
const docSQL=fs.readFileSync('supabase/migrations/20261018152000_three_distinct_gd_resolutions_and_publication_rights.sql','utf8');
const guardSQL=fs.readFileSync('supabase/migrations/20261018050000_all_stage_final_documents_guard.sql','utf8');
const policy=docSQL.match(/CREATE OR REPLACE FUNCTION private\.stage_required_final_documents[\s\S]*?\$function\$;/i)?.[0];
const guard=guardSQL.match(/CREATE OR REPLACE FUNCTION private\.guard_stage_finalization[\s\S]*?\$guard\$;/i)?.[0];
assert(policy&&guard,'Original production SQL functions required');
assert(policy.includes("'gd_chair_resolution'")&&policy.includes("'financial_economic'"));
const games=Array.from({length:100},(_,i)=>'a7c10000-0000-4000-8000-'+String(i+1).padStart(12,'0'));
const guarded=new Set([2,3,4,5,7,8,9,10,11,14,15]);
function sql(source){
 return new Promise((resolve,reject)=>{
  const p=spawn('psql',['-X','-A','-t','-q','-v','ON_ERROR_STOP=1','-f','-'],{env});
  let out='',err='';
  p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);
  p.on('error',reject);
  p.on('close',n=>n===0?resolve(out.trim()):reject(Error(err.slice(-2000))));
  p.stdin.end(source);
 });
}
const fixture=[
 'create schema private;',
 'create role anon;create role authenticated;',
 'create table public.qa_games(game_id uuid primary key);',
 'create table public.game_stages(game_id uuid,stage_no integer,status text,primary key(game_id,stage_no));',
 "create table public.formal_documents(id uuid primary key default gen_random_uuid(),game_id uuid,stage_no integer,doc_type text,subject_key text,title text,status_code text,metadata jsonb default '{}'::jsonb);",
 'create table public.qa_gate_results(game_id uuid,stage_no integer,allowed boolean,code text,primary key(game_id,stage_no));',
 'create table public.qa_transitions(game_id uuid,stage_no integer,previous_status text,next_status text);',
 policy,
 "create function private.stage_readiness_json(p_game uuid,p_stage integer) returns jsonb language sql stable as $qa$ select jsonb_build_object('ready',not exists(select 1 from jsonb_array_elements(private.stage_required_final_documents(p_game,p_stage)) item where not coalesce((item->>'fulfilled')::boolean,false)),'blockers',jsonb_build_array('Отсутствует обязательный итоговый документ')) $qa$;",
 guard,
 'create trigger stage_final_document_readiness_guard before update of status on public.game_stages for each row execute function private.guard_stage_finalization();',
 "create function public.qa_track_stage_transition() returns trigger language plpgsql as $qa$ begin if old.status is distinct from new.status then insert into public.qa_transitions values(new.game_id,new.stage_no,old.status,new.status);end if;return new;end;$qa$;",
 'create trigger qa_track_stage_transition after update of status on public.game_stages for each row execute function public.qa_track_stage_transition();'
].join('\n');
function exercise(game){
 return [
  'do $qa$',
  'declare k integer;',
  'begin',
  ' for k in 1..16 loop',
  '  begin',
  "   update public.game_stages set status='completed' where game_id='"+game+"' and stage_no=k;",
  "   insert into public.qa_gate_results values('"+game+"',k,true,null);",
  '  exception when others then',
  "   insert into public.qa_gate_results values('"+game+"',k,false,sqlstate);",
  '  end;',
  ' end loop;',
  'end;$qa$;'
 ].join('\n');
}
async function json(query){const result=await sql('select ('+query+')::text;');return JSON.parse(result.split('\n').at(-1));}
const pick=(a,p)=>{const sorted=[...a].sort((a,b)=>a-b);return Math.round(sorted[Math.ceil(sorted.length*p)-1]);};
async function main(){
 await sql(fixture);
 await sql('insert into public.qa_games values '+games.map(g=>"('"+g+"')").join(',')+';'+
  "insert into public.game_stages select game_id,n,'open' from public.qa_games cross join generate_series(1,16) n;");
 const started=performance.now();
 const tasks=await Promise.allSettled(games.map(async g=>{const start=performance.now();await sql(exercise(g));return performance.now()-start;}));
 const failed=tasks.filter(x=>x.status==='rejected').map(x=>x.reason.message);
 assert.deepEqual(failed,[],'All 100 concurrent connections must complete: '+failed.slice(0,2));
 const matrix=await json("select json_agg(row_to_json(x) order by stage_no) from (select stage_no,count(*)::int n,count(*) filter(where allowed)::int accepted,count(*) filter(where not allowed)::int rejected from public.qa_gate_results group by stage_no) x");
 assert.equal(matrix.length,16);
 for(const row of matrix){
  assert.equal(row.n,100,'All stages checked for 100 games');
  assert.equal(row.accepted,guarded.has(row.stage_no)?0:100,'Preserve mandatory document gate at stage '+row.stage_no);
 }
 const initial=await json("select json_build_object('checked',(select count(*) from public.qa_gate_results),'completed',(select count(*) from public.game_stages where status='completed'),'rejected',(select count(*) from public.qa_gate_results where not allowed),'transitions',(select count(*) from public.qa_transitions))");
 assert.deepEqual(initial,{checked:1600,completed:500,rejected:1100,transitions:500});
 const g=games[0], stage10=games[1];
 const resolution=(key)=>"insert into public.formal_documents(game_id,stage_no,doc_type,subject_key,title,status_code,metadata) values('"+g+"',4,'gd_resolution','gd','QA official decision','published','{\"document_kind\":\"stage4_office_result\",\"source_result_key\":\""+key+"\"}');";
 await sql(['gd_chair','gd_deputies','gd_committees'].map(resolution).join('\n'));
 await sql(["do $qa$ begin","begin","update public.game_stages set status='completed' where game_id='"+g+"' and stage_no=4;","raise exception 'Premature completion succeeded';","exception when sqlstate '23514' then null;end;","end;$qa$;"].join('\n'));
 await sql("insert into public.formal_documents(game_id,stage_no,doc_type,subject_key,title,status_code,metadata) values('"+g+"',4,'other','gd','Протокол заседания Государственной Думы','published','{\"template_key\":\"minutes\"}');");
 await sql("insert into public.formal_documents(game_id,stage_no,doc_type,subject_key,title,status_code,metadata) values "+
  "('"+stage10+"',10,'state_program','government','QA programme','draft','{}'),"+
  "('"+stage10+"',10,'other','government','QA financial evidence','draft','{\"template_key\":\"financial_economic\"}');");
 await sql("update public.game_stages set status='completed' where game_id='"+stage10+"' and stage_no=10;");
 const retries=await Promise.allSettled(Array.from({length:100},()=>
  sql("update public.game_stages set status='completed' where game_id='"+g+"' and stage_no=4;")));
 assert.deepEqual(retries.filter(x=>x.status==='rejected').map(x=>x.reason.message),[],
  '100 closing retries after complete documents must succeed');
 const final=await json("select json_build_object('stage4',(select count(*) from public.game_stages where game_id='"+g+"' and stage_no=4 and status='completed'),'stage4_transitions',(select count(*) from public.qa_transitions where game_id='"+g+"' and stage_no=4),'prepared_stage10',(select count(*) from public.game_stages where game_id='"+stage10+"' and stage_no=10 and status='completed'),'transitions',(select count(*) from public.qa_transitions))");
 assert.equal(final.stage4,1);assert.equal(final.stage4_transitions,1);
 assert.equal(final.prepared_stage10,1);
 assert.equal(final.transitions,502);
 const delays=tasks.map(x=>x.value);
 console.log(JSON.stringify({status:'PASS',scope:'Unchanged production document requirement and completion trigger, simplified non-document readiness, disposable PostgreSQL; NOT full gameplay/RLS/Auth',
  independentConnections:100,stages:16,checked:1600,rejectedMissingDocuments:1100,acceptedNoDocumentRequirement:500,
  afterPublishingStage4DocumentsAccepted:100,stage4Transitions:1,stage10PreparedDocumentsAllowed:true,
  errors:0,totalMs:Math.round(performance.now()-started),clientLatencyMs:{p50:pick(delays,.5),p95:pick(delays,.95),p99:pick(delays,.99)},productionRequests:0}));
}
main().catch(e=>{console.error('FAIL 100-stage document gate: '+(e.stack||e));process.exitCode=1});
