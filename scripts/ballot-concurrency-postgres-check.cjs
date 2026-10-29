'use strict';
/* Isolated fixture only: production RPC/trigger bodies with simplified eligibility and schema. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const gameId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const voteId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const fortyId='cccccccc-cccc-4ccc-8ccc-cccccccccccc',retryId='dddddddd-dddd-4ddd-8ddd-dddddddddddd',raceId='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const studentId=n=>'00000000-0000-4000-8000-'+n.toString(16).padStart(12,'0');
function actualFunction(file,name,delimiter){
 const source=fs.readFileSync(path.join(root,'supabase/migrations',file),'utf8');
 const start=source.toLowerCase().indexOf('create or replace function '+name.toLowerCase()+'(');
 assert(start>=0,'Missing production function '+name);
 const body=source.indexOf(delimiter,start),end=source.indexOf(delimiter,body+delimiter.length);
 assert(body>=0&&end>body,'Invalid function body for '+name);
 return source.slice(start,end+delimiter.length)+';';
}
function bootstrap(count){
 assert([40,100].includes(count));
 const cast=actualFunction('20261021210700_legacy_signed_program_agenda_ballot_compatibility.sql','public.cast_vote_allocation','$function$');
 const finalize=actualFunction('20261017000500_vote_auto_close_full_registered_quorum.sql','private.finalize_procedural_vote','$function$');
 const close=actualFunction('20261017000500_vote_auto_close_full_registered_quorum.sql','public.close_procedural_vote','$manual$');
 const auto=actualFunction('20261017000500_vote_auto_close_full_registered_quorum.sql','private.close_vote_after_last_registered_ballot','$auto$');
 const source=fs.readFileSync(path.join(root,'supabase/migrations/20261020095000_presidential_appointment_vote_completion_guard.sql'),'utf8');
 const marker=source.indexOf('-- Защита серверного закрытия голосований.'),start=source.indexOf('DO $patch$',marker),end=source.indexOf('$patch$;',start+3);
 assert(marker>=0&&start>marker&&end>start,'Missing production close guard migration');
 const closeGuard=source.slice(start,end+'$patch$;'.length);
 return `
create schema auth; create schema private;
create table public.game_votes(id uuid primary key, game_id uuid not null, status text, procedure_key text, voting_mode text, allow_abstain boolean, electorate_snapshot jsonb, institution_key text, stage_no int, quorum_kind text, quorum_value numeric, majority_kind text, majority_value numeric, tie_breaker_chair boolean, formal_document_id uuid, pass_transition text, fail_transition text, result_code text, result_label text, result_yes numeric, result_no numeric, result_abstain numeric, result_eligible numeric, result_cast numeric, result_present numeric, result_quorum_met boolean, closed_at timestamptz, decision_note text);
create table public.game_ballots(vote_id uuid not null, voter_id uuid not null, choice text, weight numeric, yes_weight numeric, no_weight numeric, abstain_weight numeric, unique(vote_id,voter_id));
create table public.game_members(game_id uuid,user_id uuid,kind text,role_title text,primary key(game_id,user_id));
create table public.institution_session_registrations(game_id uuid,user_id uuid,stage_no int,institution_key text);
create table public.institution_units(id uuid,game_id uuid,head_user_id uuid);
create table public.government_program_agenda(session_id uuid,game_id uuid,vote_id uuid,status text);
create table public.government_sessions(id uuid,game_id uuid,status text,stage_no int);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function private.is_game_member(g uuid) returns boolean language sql stable as $$ select exists(select 1 from public.game_members where game_id=g and user_id=auth.uid()) $$;
create function private.is_game_teacher(g uuid) returns boolean language sql stable as $$ select exists(select 1 from public.game_members where game_id=g and user_id=auth.uid() and kind='teacher') $$;
create function private.vote_eligible_weight(v public.game_votes,u uuid) returns numeric language sql stable as $$ select coalesce((v.electorate_snapshot->'weights'->>u::text)::numeric,0) $$;
create function private.vote_total_eligible_weight(v public.game_votes) returns numeric language sql stable as $$ select (select coalesce(sum(value::numeric),0) from jsonb_each_text(v.electorate_snapshot->'weights')) $$;
create function private.vote_present_weight(v public.game_votes) returns numeric language sql stable as $$ select private.vote_total_eligible_weight(v) $$;
create function private.is_budget_document(uuid) returns boolean language sql immutable as $$ select false $$;
create function private.can_close_procedural_vote(g uuid,u uuid,body text,doc uuid) returns boolean language sql stable as $$ select exists(select 1 from public.game_members where game_id=g and user_id=u and kind='teacher') $$;
create function private.apply_formal_vote_transition(uuid,text,uuid,uuid,text) returns void language plpgsql as $$ begin return; end $$;
${cast}
${finalize}
${close}
${closeGuard}
${auto}
create trigger zz_auto_close_after_registered_ballots after insert or update of choice,weight,yes_weight,no_weight,abstain_weight on public.game_ballots for each row execute function private.close_vote_after_last_registered_ballot();
insert into public.game_members(game_id,user_id,kind,role_title) select '${gameId}',('00000000-0000-4000-8000-'||lpad(to_hex(n),12,'0'))::uuid,'student','Участник' from generate_series(1,${count}) n;
insert into public.institution_session_registrations(game_id,user_id,stage_no,institution_key) select game_id,user_id,1,'gd' from public.game_members;
insert into public.game_votes(id,game_id,status,procedure_key,voting_mode,allow_abstain,electorate_snapshot,institution_key,stage_no,quorum_kind,quorum_value,majority_kind,majority_value,tie_breaker_chair) select '${voteId}','${gameId}','open','ordinary','individual',true,jsonb_build_object('attendance_required',true,'weights',jsonb_object_agg(user_id::text,1)),'gd',1,'none',0,'simple',0,false from public.game_members;
`;
}
function assertDisposable(env){
 assert(env.GITHUB_ACTIONS==='true'&&env.GOS_BALLOT_DISPOSABLE==='YES'&&env.PGHOST==='127.0.0.1'&&env.PGDATABASE==='gos_vote_concurrency_fixture','Requires isolated, disposable GitHub Actions PostgreSQL service');
}
function latencies(values){
 assert(values.length>0&&values.every(v=>Number.isFinite(v)&&v>=0));
 const sorted=[...values].sort((a,b)=>a-b),percentile=n=>Math.round(sorted[Math.ceil(sorted.length*n)-1]*100)/100;
 return {n:sorted.length,p95_ms:percentile(.95),p99_ms:percentile(.99)};
}
function sql(text){
 const env={PATH:process.env.PATH,PGPASSWORD:process.env.PGPASSWORD,PGCONNECT_TIMEOUT:'15',PGOPTIONS:'-c statement_timeout=30000'};
 return new Promise((resolve,reject)=>{
  const p=spawn('psql',['-X','-A','-t','-q','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','5432','-U','postgres','-d','gos_vote_concurrency_fixture','-f','-'],{env});
  let out='',err='';p.stdout.on('data',v=>out+=v);p.stderr.on('data',v=>err+=v);
  p.on('error',reject);p.on('close',code=>code===0?resolve(out.trim().split('\n').at(-1)):reject(Error('psql exit '+code+': '+err.slice(-1000))));p.stdin.end(text);
 });
}
async function wave(ids,target,close=false){
 const start=Date.now()/1000+8;
 const jobs=ids.map(id=>sql(`select set_config('request.jwt.claim.sub','${studentId(id)}',false);\nselect set_config('bench.ready',(extract(epoch from clock_timestamp())<${start})::text,false);\nselect pg_sleep(greatest(0,${start}-extract(epoch from clock_timestamp())));\ncreate function pg_temp.run_ballot() returns jsonb language plpgsql as $bench$ declare started timestamptz:=clock_timestamp(); ready boolean:=current_setting('bench.ready')::boolean; begin perform public.cast_vote_allocation('${target}',1,0,0); return jsonb_build_object('ok',true,'ready',ready,'ms',extract(epoch from clock_timestamp()-started)*1000); exception when others then return jsonb_build_object('ok',false,'ready',ready,'error',sqlerrm,'ms',extract(epoch from clock_timestamp()-started)*1000); end $bench$;\nselect pg_temp.run_ballot();`));
 if(close)jobs.push(sql(`select set_config('request.jwt.claim.sub','${studentId(101)}',false);\nselect set_config('bench.ready',(extract(epoch from clock_timestamp())<${start})::text,false);\nselect pg_sleep(greatest(0,${start}-extract(epoch from clock_timestamp())));\nselect json_build_object('ready',current_setting('bench.ready')::boolean,'outcome',public.close_procedural_vote('${target}',null))::text;`));
 const settled=await Promise.allSettled(jobs);
 const failed=settled.filter(item=>item.status==='rejected');
 assert.equal(failed.length,0,'All PostgreSQL client processes must complete: '+failed.map(x=>x.reason).join('; '));
 const result=settled.map(item=>JSON.parse(item.value));
 if(close){const closing=result.pop();assert(closing.ready&&['passed','rejected','no_quorum'].includes(closing.outcome.result),'Authorized close must be ready and succeed')}
 assert(result.every(item=>item.ready),'Every ballot connection must be ready before the common start');
 return result;
}
function prepareRuns(){
 return `insert into public.game_votes select '${fortyId}',game_id,status,procedure_key,voting_mode,allow_abstain,jsonb_set(electorate_snapshot,'{weights}',(select jsonb_object_agg(user_id::text,1) from public.game_members where user_id in (${Array.from({length:40},(_,i)=>"'"+studentId(i+1)+"'").join(',')}))),institution_key,stage_no,quorum_kind,quorum_value,majority_kind,majority_value,tie_breaker_chair,formal_document_id,pass_transition,fail_transition,result_code,result_label,result_yes,result_no,result_abstain,result_eligible,result_cast,result_present,result_quorum_met,closed_at,decision_note from public.game_votes where id='${voteId}';\ninsert into public.game_votes select ids.id::uuid,game_id,status,procedure_key,voting_mode,allow_abstain,electorate_snapshot,institution_key,stage_no,quorum_kind,quorum_value,majority_kind,majority_value,tie_breaker_chair,formal_document_id,pass_transition,fail_transition,result_code,result_label,result_yes,result_no,result_abstain,result_eligible,result_cast,result_present,result_quorum_met,closed_at,decision_note from public.game_votes cross join (values('${retryId}'),('${raceId}')) ids(id) where game_votes.id='${voteId}';\ninsert into public.game_members values('${gameId}','${studentId(101)}','teacher','Преподаватель');`;
}
async function run(){
 assertDisposable(process.env);
 assert(process.env.PGPASSWORD,'Disposable service password required');
 const empty=await sql("select (current_database()='gos_vote_concurrency_fixture' and not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p','v','m','f') and n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp%'))::text;");
 assert.equal(empty,'true','Refusing to initialize a non-empty database');
 await sql(bootstrap(100));
 await sql(prepareRuns());
 const report={scope:'Isolated PostgreSQL with actual ballot, patched close and auto-close bodies; simplified eligibility and schema; only the auto-close trigger is installed (six other production ballot triggers are excluded). Server function time only, no Auth/HTTP/Realtime.',percentiles:'Nearest-rank p95/p99 with sample count; p99 from small samples is unstable.',waves:{}};
 for(const [count,id] of [[40,fortyId],[100,voteId]]){
  const records=await wave(Array.from({length:count},(_,i)=>i+1),id);
  assert(records.every(r=>r.ok),'Every distinct participant ballot must succeed: '+JSON.stringify(records.filter(r=>!r.ok)));
  const state=JSON.parse(await sql(`select json_build_object('count',(select count(*) from public.game_ballots where vote_id='${id}'),'status',status,'yes',result_yes,'cast',result_cast)::text from public.game_votes where id='${id}';`));
  assert.deepEqual(state,{count,status:'closed',yes:count,cast:count},'No lost ballots and closure must count all ballots');
  report.waves[count]=latencies(records.map(r=>Number(r.ms)));
 }
 const retry=await wave(Array(40).fill(1),retryId);
 assert(retry.every(r=>r.ok),'Simultaneous retries should succeed while the remaining electorate has not voted');
 const retried=JSON.parse(await sql(`select json_build_object('count',(select count(*) from public.game_ballots where vote_id='${retryId}'),'status',status)::text from public.game_votes where id='${retryId}';`));
 assert.deepEqual(retried,{count:1,status:'open'},'Retrying one voter must not produce duplicate ballots');
 report.waves.same_voter_retries=latencies(retry.map(r=>Number(r.ms)));
 const race=await wave(Array.from({length:100},(_,i)=>i+1),raceId,true);
 const accepted=race.filter(r=>r.ok),rejected=race.filter(r=>!r.ok);
 assert(rejected.every(r=>/Голосование завершено/.test(r.error)),'Only closed-vote failures are acceptable during manual closure');
 const final=JSON.parse(await sql(`select json_build_object('count',(select count(*) from public.game_ballots where vote_id='${raceId}'),'status',status,'yes',result_yes,'cast',result_cast)::text from public.game_votes where id='${raceId}';`));
 assert.deepEqual(final,{count:accepted.length,status:'closed',yes:accepted.length,cast:accepted.length},'Manual close and competing ballots must agree exactly');
 report.waves.close_race={attempted:race.length,accepted:accepted.length,closed_rejections:rejected.length,...(accepted.length?latencies(accepted.map(r=>Number(r.ms))):{})};
 console.log(JSON.stringify(report));
}
module.exports={bootstrap,prepareRuns,studentId,gameId,voteId,fortyId,retryId,raceId,latencies,assertDisposable};
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1});
