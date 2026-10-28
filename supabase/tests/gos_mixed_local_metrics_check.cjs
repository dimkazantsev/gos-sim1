const assert=require('node:assert/strict');
const {spawn,spawnSync}=require('node:child_process');
const path=require('node:path'),fs=require('node:fs'),os=require('node:os'),http=require('node:http');
const runner=path.join(__dirname,'gos_40_mixed_local_20min.cjs');
const {localOrigin,validate,parseStudentCount,latencySummary,createMeasurements,reconnectSessions,reportMeasurements}=require(runner);
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
 const duplicate=fixture(count);duplicate.observer.userId=duplicate.students[0].userId;assert.throws(()=>validate(duplicate,count));
 const duplicateEmail=fixture(count);duplicateEmail.teacher.email=duplicateEmail.students[0].email;assert.throws(()=>validate(duplicateEmail,count));
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
async function disposableChecks(){
 const {PGlite}=require('@electric-sql/pglite'),sql=fs.readFileSync(path.join(__dirname,'mixed_disposable_guard.sql'),'utf8');
 for(const scenario of ['empty','existing-user','existing-game']){
  const db=new PGlite();try{
   await db.exec('create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id integer); create table public.games(id integer);');
   if(scenario==='existing-user')await db.exec('insert into auth.users values (1)');
   if(scenario==='existing-game')await db.exec('insert into public.games values (1)');
   if(scenario==='empty'){
    await db.exec(sql);await db.exec('set role authenticated');await assert.rejects(db.query('select * from public.qa_mixed_disposable_guard'));
    await db.exec('reset role; set role service_role');const result=await db.query('select marker from public.qa_mixed_disposable_guard');assert.equal(result.rows[0].marker,'gos-id-disposable-mixed-v1');
   }else{
    await assert.rejects(db.exec(sql),/must be empty/);const result=await db.query("select to_regclass('public.qa_mixed_disposable_guard') as name");assert.equal(result.rows[0].name,null);
   }
  }finally{await db.close()}
 }
 const input=fixture(40),people=[...input.students,input.teacher,input.observer],roles=[...input.students.map(person=>({user_id:person.userId,kind:'student'})),{user_id:input.teacher.userId,kind:'teacher'},{user_id:input.observer.userId,kind:'observer'}];
 let scenario='',requests=[];
 const server=http.createServer((req,res)=>{
  requests.push({method:req.method,path:req.url.split('?')[0]});
  const route=req.url.split('?')[0];let body;
  if(route==='/rest/v1/qa_mixed_disposable_guard')body=scenario==='marker-missing'?[]:[{marker:'gos-id-disposable-mixed-v1'}];
  else if(route==='/rest/v1/games')body=[{id:input.gameId,title:input.title},...(scenario==='extra-game'?[{id:'other',title:'LOCAL QA · other'}]:[])];
  else if(route==='/rest/v1/game_members')body=[...roles,...(scenario==='extra-member'?[{user_id:'foreign',kind:'student'}]:[])];
  else if(route==='/auth/v1/admin/users')body={users:[...people.map(person=>({id:person.userId,email:person.email})),...(scenario==='extra-user'?[{id:'foreign',email:'foreign@example.invalid'}]:[])]};
  else if(route==='/auth/v1/token'){res.writeHead(401,{'Content-Type':'application/json'});res.end(JSON.stringify({message:'intentional stop after preflight'}));return}
  else{res.writeHead(404,{'Content-Type':'application/json'});res.end('{}');return}
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(body));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const fixtureFile=path.join(os.tmpdir(),'gos-mixed-guard-'+process.pid+'.json');
 try{
  fs.writeFileSync(fixtureFile,JSON.stringify(input),{flag:'wx'});
  for(scenario of ['marker-missing','extra-user','extra-game','extra-member','valid']){
   requests=[];const child=spawn(process.execPath,[runner],{env:{...process.env,SUPABASE_URL:'http://127.0.0.1:'+server.address().port,SUPABASE_ANON_KEY:'x',SUPABASE_SERVICE_ROLE_KEY:'x',QA_LOCAL_PASSWORD:'x',QA_MIXED_FIXTURE:fixtureFile}});
   let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
   const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)});assert.notEqual(code,0);
   assert.match(stderr,/physically separate disposable Supabase/);assert.match(stderr,/do not inspect every table/);
   assert.equal(requests[0]?.path,'/rest/v1/qa_mixed_disposable_guard','Guard checked before any game access');
   if(scenario==='valid')assert(requests.some(r=>r.path==='/auth/v1/token'),'An exact fixture can proceed to login');
   else{assert(!requests.some(r=>r.method!=='GET'),'Foreign or unmarked data cannot reach authentication or writes');assert.match(stderr,/disposable|fixture|Database/i)}
  }
 }finally{server.close();if(fs.existsSync(fixtureFile))fs.unlinkSync(fixtureFile)}
}
async function measurementChecks(){
 await disposableChecks();
 let now=0;const tracker=createMeasurements(()=>now);
 assert.deepEqual(await tracker.measure('read',async()=>{now+=10;return {data:{ok:true},error:null}}),{ok:true});
 await assert.rejects(tracker.measure('read',async()=>{now+=20;return {data:null,error:{message:'failure'}}}),/failure/);
 await assert.rejects(tracker.measure('write',async()=>{now+=30;throw Error('network')}),/network/);
 let resolve;const pending=tracker.measure('write',()=>new Promise(done=>{resolve=done}));
 let snapshot=tracker.snapshot();assert.equal(snapshot.attempted,4);assert.equal(snapshot.completed,3);assert.equal(snapshot.failed,2);assert.equal(snapshot.inflight,1);
 assert.equal(snapshot.latency_success.read.p95_ms,10);assert.equal(snapshot.latency_failure.read.p99_ms,20);assert.equal(snapshot.latency_failure.write.p99_ms,30);
 now+=40;resolve({data:{ok:true},error:null});await pending;snapshot=tracker.snapshot();assert.equal(snapshot.inflight,0);assert.equal(snapshot.completed,4);
 assert.equal(snapshot.response_json_bytes,Buffer.byteLength(JSON.stringify({ok:true}))*2);
 const summary=reportMeasurements(snapshot);
 assert.equal(summary.measured_calls,4);assert.equal(summary.measured_success_data_json_bytes,snapshot.response_json_bytes);
 assert(!('requests' in summary),'The measured calls must not be presented as all requests');
 assert.match(summary.measurement_scope,/Realtime/);assert.match(summary.measurement_scope,/observer denial/);assert.match(summary.measurement_scope,/cross-user/);assert.match(summary.measurement_scope,/wire bytes/);
 let releaseReconnect;const gate=new Promise(resolve=>{releaseReconnect=resolve});const started=[],subscribed=[];
 const sessions=['one','two'].map(name=>({person:{email:name},client:{auth:{signInWithPassword:async()=>{started.push(name);await gate;return{data:{session:{access_token:name}},error:null}}},realtime:{setAuth:async token=>assert.equal(token,name)}}}));
 const reconnect=reconnectSessions(sessions,tracker.measure,async session=>{subscribed.push(session.person.email)},'synthetic');
 await Promise.resolve();assert.deepEqual(started,['one','two'],'Reconnect starts independent sessions concurrently');
 releaseReconnect();await reconnect;assert.deepEqual(subscribed.sort(),['one','two']);
 const server=http.createServer((req,res)=>{res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({message:'synthetic preflight failure'}))});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const fixtureFile=path.join(os.tmpdir(),'gos-load-fixture-'+process.pid+'.json');
 try{
  fs.writeFileSync(fixtureFile,JSON.stringify(fixture(100)),{flag:'wx'});
  const child=spawn(process.execPath,[runner,'--students=100'],{env:{...process.env,SUPABASE_URL:'http://127.0.0.1:'+server.address().port,SUPABASE_ANON_KEY:'x',SUPABASE_SERVICE_ROLE_KEY:'x',QA_LOCAL_PASSWORD:'x',QA_MIXED_FIXTURE:fixtureFile}});
  let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)});
  assert.notEqual(code,0,'Preflight failure cannot pass');
  const report=stderr.split(/\r?\n/).filter(line=>line.startsWith('{')).map(line=>JSON.parse(line)).find(line=>line.status==='FAIL');
  assert(report?.partial,'Preflight failure emits an explicitly partial report');
  assert.equal(report.attempted,1);assert.equal(report.completed,1);assert.equal(report.failed,1);assert.equal(report.inflight,0);
  assert.equal(report.latency_failure['preflight:guard'].n,1,'Failed request latency is retained');
  assert.equal(report.measured_calls,1);assert(!('requests' in report));assert(!('response_json_bytes' in report));
  assert.match(report.measurement_scope,/Realtime/);assert.match(report.measurement_scope,/wire bytes/);
 }finally{server.close();if(fs.existsSync(fixtureFile))fs.unlinkSync(fixtureFile)}
 console.log('PASS: local-only fixtures, p95/p99 and completed/failed/inflight measurements; local synthetic HTTP only.');
}
measurementChecks().catch(error=>{console.error(error);process.exitCode=1});
