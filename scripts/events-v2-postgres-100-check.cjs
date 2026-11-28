'use strict';
// Actual candidate SQL on disposable PostgreSQL, never a hosted endpoint.
const fs=require('node:fs'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.GOS_EVENTS_DISPOSABLE,'YES');assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGDATABASE,'gos_events_fixture');
const id=n=>'25000000-0000-4000-8000-'+String(n).padStart(12,'0');
const game=id(1),caseId=id(2),teacher=id(3),foreign=id(4),guest=id(5),users=Array.from({length:100},(_,i)=>id(100+i));
function sql(input){return new Promise((resolve,reject)=>{
 const p=spawn('psql',['-XAtq','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','5432','-U','postgres','-d','gos_events_fixture','-f','-'],{env:{PATH:process.env.PATH,PGPASSWORD:process.env.PGPASSWORD,PGCONNECT_TIMEOUT:'20',PGOPTIONS:'-c statement_timeout=45000'}});
 let out='',err='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.on('error',reject);p.on('close',c=>c===0?resolve(out.trim().split('\n').at(-1)):reject(Error('psql '+c+': '+err.slice(-1000))));p.stdin.end(input);
});}
async function wave(round){
 const start=Date.now()/1000+12;
 const result=await Promise.allSettled(users.map((user,i)=>sql(`
 SELECT set_config('request.jwt.claim.sub','${user}',false);
 SELECT set_config('bench.ready',(extract(epoch from clock_timestamp())<${start})::text,false);
 SELECT pg_sleep(greatest(0,${start}-extract(epoch from clock_timestamp())));
 CREATE FUNCTION pg_temp.cast_fixture() RETURNS jsonb LANGUAGE plpgsql AS $b$
 DECLARE ts timestamptz:=clock_timestamp(); BEGIN
 PERFORM public.submit_event_decision('${id(1000+i)}','${round===2?'round2:':''}option_${i<(round===1?50:51)?1:2}',NULL);
 RETURN jsonb_build_object('ready',current_setting('bench.ready')::boolean,'ms',extract(epoch from clock_timestamp()-ts)*1000);
 END $b$;
 SELECT pg_temp.cast_fixture();`)));
 const failed=result.filter(r=>r.status==='rejected');assert.equal(failed.length,0,failed.map(r=>String(r.reason)).slice(0,5).join('; '));
 const durations=result.map(r=>JSON.parse(r.value));assert.equal(durations.filter(x=>x.ready).length,100,'All clients must arrive before synchronized release');
 const ms=durations.map(x=>x.ms).sort((a,b)=>a-b);console.log(JSON.stringify({round,parallelClients:100,p50_ms:ms[49],p95_ms:ms[94],p99_ms:ms[98],max_ms:ms[99]}));
}
(async()=>{
 const plan={rules_version:2,options:[{key:'option_1',lawful:true,trust:2,metric_effects:{elite_support:-2}},{key:'option_2',lawful:true,trust:-1,metric_effects:{elite_support:2}}]};
 const statements=[fs.readFileSync('scripts/events-v2-individual-fixture.sql','utf8'),fs.readFileSync('supabase/changes/events_v2_individual_transfer_candidate.sql','utf8'),fs.readFileSync('supabase/changes/events_v2_collective_candidate.sql','utf8'),`
 SET check_function_bodies=on;
 CREATE TRIGGER guard BEFORE INSERT OR UPDATE ON event_assignments FOR EACH ROW EXECUTE FUNCTION private.guard_event_assignment();
 CREATE TRIGGER snapshot BEFORE INSERT ON event_decisions FOR EACH ROW EXECUTE FUNCTION private.snapshot_event_office();
 CREATE TRIGGER authority AFTER INSERT ON event_case_outcomes FOR EACH ROW EXECUTE FUNCTION private.record_event_authority();
 INSERT INTO games VALUES('${game}','${teacher}');
 INSERT INTO game_members(game_id,user_id,kind,role_title) VALUES('${game}','${teacher}','teacher','Преподаватель'),('${game}','${guest}','observer','Гость'),('${foreign}','${foreign}','student','Участник');
 INSERT INTO game_members(game_id,user_id,kind,role_title) VALUES ${users.map(u=>"('"+game+"','"+u+"','student','Участник')").join(',')};
 INSERT INTO game_stages(game_id,stage_no,status,deadline) VALUES('${game}',7,'open',now()+interval '1 day');
 INSERT INTO state_metrics(game_id,metric_key,value,min_value,max_value) VALUES('${game}','lawfulness',50,0,100),('${game}','elite_support',50,0,100);
 INSERT INTO event_cases(id,game_id,audience,status,effect_plan,decision_options,title) VALUES('${caseId}','${game}','all','ready','${JSON.stringify(plan)}','["А","Б"]','Тест');
 INSERT INTO event_assignments(id,case_id,game_id,recipient_id,stage_no) VALUES ${users.map((u,i)=>"('"+id(1000+i)+"','"+caseId+"','"+game+"','"+u+"',7)").join(',')};
 `];await sql(statements.join('\n'));
 await wave(1);
 assert.equal(await sql("SELECT count(*) FROM event_case_outcomes WHERE case_id='"+caseId+"'"),'0');
 assert.equal(await sql("SELECT comic_scene->>'vote_round' FROM event_cases WHERE id='"+caseId+"'"),'2');
 await wave(2);
 const result=JSON.parse(await sql(`SELECT jsonb_build_object('votes',(SELECT count(*) FROM event_decisions WHERE case_id='${caseId}'),'outcomes',(SELECT count(*) FROM event_case_outcomes WHERE case_id='${caseId}'),'winner',(SELECT winner FROM event_case_outcomes WHERE case_id='${caseId}'),'legal',(SELECT count(*) FROM event_authority_evidence WHERE case_id='${caseId}'),'lawfulness',(SELECT value FROM state_metrics WHERE game_id='${game}' AND metric_key='lawfulness'),'elite',(SELECT value FROM state_metrics WHERE game_id='${game}' AND metric_key='elite_support'))`));
 assert.deepEqual(result,{votes:200,outcomes:1,winner:'option_1',legal:0,lawfulness:50,elite:48});
 for(const u of [guest,foreign,users[0]])await assert.rejects(()=>sql("SELECT set_config('request.jwt.claim.sub','"+u+"',false); SELECT public.submit_event_decision('"+id(1001)+"','round2:option_1',NULL);"),/psql/);
 console.log('PASS 100 real concurrent PostgreSQL sessions per round; fixture only, no hosted load');
})().catch(e=>{console.error(e.message);process.exitCode=1});
