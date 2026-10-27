const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const runner=path.join(__dirname,'gos_40_mixed_local_20min.cjs');
const {localOrigin,validate,parseStudentCount,latencySummary}=require(runner);
assert.equal(parseStudentCount([]),40);
assert.equal(parseStudentCount(['--students=100']),100);
for(const value of ['0','41','101','100.5','NaN'])assert.throws(()=>parseStudentCount(['--students='+value]));
assert.throws(()=>parseStudentCount(['--students=40','--students=100']));
assert.throws(()=>parseStudentCount(['--students','100']));
assert.throws(()=>parseStudentCount(['--student=100']));
for(const url of ['https://example.supabase.co','http://localhost.example.com','http://user:pass@localhost:54321','http://localhost:54321/path'])assert.throws(()=>localOrigin(url));
const latency=latencySummary([{label:'read',ms:100},...Array.from({length:99},(_,i)=>({label:'read',ms:i+1}))]);
assert.deepEqual(latency.read,{n:100,p95_ms:95,p99_ms:99});
assert.deepEqual(latencySummary([{label:'write',ms:3},{label:'read',ms:8},{label:'write',ms:7}]),{write:{n:2,p95_ms:7,p99_ms:7},read:{n:1,p95_ms:8,p99_ms:8}});
function fixture(count){
 const students=Array.from({length:count},(_,i)=>({userId:String(i),email:`s${i}@example.invalid`}));
 const gameId='00000000-0000-4000-8000-000000000001';
 const operation=(actor,rpc,args,table,match,expect)=>({actor,minute:0,rpc,args,verify:{table,match,expect}});
 return {version:1,title:'LOCAL QA · test',gameId,students,teacher:{userId:'t',email:'teacher@example.invalid'},observer:{userId:'o',email:'observer@example.invalid'},operations:{
  chat:students.map((_,actor)=>operation(actor,'send_chat_text',{p_text:'QA message'},'chat_messages',{id:'$result'},{text:'QA message'})),
  documents:[operation('teacher','create_formal_document',{p_title:'QA document'},'formal_documents',{id:'$result'},{title:'QA document'})],
  votes:[operation(0,'cast_vote_allocation',{p_vote_id:'vote',p_yes:1,p_no:0,p_abstain:0},'game_ballots',{vote_id:'vote',voter_id:'0'},{yes_weight:1,no_weight:0,abstain_weight:0})],
  budget:[operation('teacher','submit_budget_amendment',{p_from:'04',p_to:'09'},'budget_faction_amendments',{id:'$result'},{from_section:'04',to_section:'09'})],
  events:[operation(0,'submit_event_decision',{p_assignment_id:'assignment',p_choice:'option_1'},'event_decisions',{assignment_id:'assignment',actor_id:'0'},{choice:'option_1'})],
  blitz:[operation(0,'blitz_open_selected',{p_id:'attempt'},'blitz_assignments',{id:'attempt',user_id:'0'},{started_at:'$nonNull'})],
  stages:[operation('teacher','manage_game_stage',{p_game_id:gameId,p_stage_no:1,p_action:'open'},'game_stages',{game_id:gameId,stage_no:1},{status:'open'})]
 },negativeObserver:{rpc:'manage_game_stage',args:{p_game_id:gameId}}};
}
for(const count of [40,100]){
 assert.equal(validate(fixture(count),count).students.length,count);
 assert.throws(()=>validate(fixture(count),count===40?100:40));
 const invalid=fixture(count);invalid.operations.chat[0].actor=count;
 assert.throws(()=>validate(invalid,count));
 for(const module of ['chat','documents','votes','budget','events','blitz','stages']){
  const wrong=fixture(count);wrong.operations[module][0].rpc=module==='stages'?'send_chat_text':'manage_game_stage';
  assert.throws(()=>validate(wrong,count),'Reject unrelated RPC in '+module);
  const wrongTable=fixture(count);wrongTable.operations[module][0].verify.table='games';
  assert.throws(()=>validate(wrongTable,count),'Reject unrelated verification table in '+module);
  const wrongMatch=fixture(count);wrongMatch.operations[module][0].verify.match={id:'unrelated'};
  assert.throws(()=>validate(wrongMatch,count),'Reject unrelated verification row in '+module);
  const wrongOutcome=fixture(count);wrongOutcome.operations[module][0].verify.expect={id:'unrelated'};
  assert.throws(()=>validate(wrongOutcome,count),'Reject unrelated outcome in '+module);
 }
 const alternate=fixture(count);
 alternate.operations.documents[0]={actor:'teacher',minute:0,rpc:'update_formal_draft',args:{p_document_id:'doc',p_body_text:'new'},verify:{table:'formal_documents',match:{id:'doc'},expect:{body_text:'new'}}};
 alternate.operations.blitz[0]={actor:0,minute:0,rpc:'blitz_answer',args:{p_id:'attempt'},verify:{table:'blitz_assignments',match:{id:'attempt',user_id:'0'},expect:{answered_at:'$nonNull'}}};
 alternate.operations.stages[0]={actor:0,minute:0,rpc:'submit_stage_debrief',args:{p_body:'QA debrief'},verify:{table:'stage_debriefs',match:{id:'$result'},expect:{body:'QA debrief'}}};
 assert.doesNotThrow(()=>validate(alternate,count));
}
const blocked=spawnSync(process.execPath,[runner,'--students=100'],{encoding:'utf8',env:{...process.env,SUPABASE_URL:'https://example.supabase.co',SUPABASE_ANON_KEY:'x',SUPABASE_SERVICE_ROLE_KEY:'x',QA_LOCAL_PASSWORD:'x',QA_MIXED_FIXTURE:'x'}});
assert.notEqual(blocked.status,0);assert.match(blocked.stderr,/Only an isolated local Supabase is permitted/);
console.log('PASS: local-only 40/100 fixtures and p95/p99 nearest-rank; no network load.');
