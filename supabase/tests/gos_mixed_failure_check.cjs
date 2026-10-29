const assert=require('node:assert/strict');
const path=require('node:path');
const fixture={version:1,title:'LOCAL QA · synthetic',gameId:'00000000-0000-4000-8000-000000000001',students:Array.from({length:40},(_,i)=>({userId:`student-${i}`,email:`s${i}@example.invalid`})),teacher:{userId:'teacher',email:'teacher@example.invalid'},observer:{userId:'observer',email:'observer@example.invalid'}};
const op=(actor,rpc,args,table,match,expect)=>({actor,minute:0,rpc,args,verify:{table,match,expect}});
fixture.operations={
 chat:fixture.students.map((_,i)=>op(i,'send_chat_text',{p_text:'QA'},'chat_messages',{id:'$result'},{text:'QA'})),
 documents:[op('teacher','create_formal_document',{p_title:'QA'},'formal_documents',{id:'$result'},{title:'QA'})],
 votes:[op(0,'cast_vote_allocation',{p_vote_id:'vote',p_yes:1,p_no:0,p_abstain:0},'game_ballots',{vote_id:'vote',voter_id:'student-0'},{yes_weight:1,no_weight:0,abstain_weight:0})],
 budget:[op('teacher','submit_budget_amendment',{p_from:'04',p_to:'09'},'budget_faction_amendments',{id:'$result'},{from_section:'04',to_section:'09'})],
 events:[op(0,'submit_event_decision',{p_assignment_id:'assignment',p_choice:'option_1'},'event_decisions',{assignment_id:'assignment',actor_id:'student-0'},{choice:'option_1'})],
 blitz:[op(0,'blitz_open_selected',{p_id:'attempt'},'blitz_assignments',{id:'attempt',user_id:'student-0'},{started_at:'$nonNull'})],
 stages:[op('teacher','manage_game_stage',{p_game_id:fixture.gameId,p_stage_no:1,p_action:'open'},'game_stages',{game_id:fixture.gameId,stage_no:1},{status:'open'})]
};
fixture.negativeObserver={rpc:'manage_game_stage',args:{p_game_id:fixture.gameId}};

if(process.env.GOS_MIXED_FAKE_PRELOAD==='1'){
 const fs=require('node:fs'),read=fs.readFileSync,Module=require('node:module'),load=Module._load;
 fs.readFileSync=function(file,...args){return file==='synthetic-fixture'?JSON.stringify(fixture):read.call(this,file,...args)};
 const people=[...fixture.students,fixture.teacher,fixture.observer],mode=process.env.GOS_MIXED_FAKE_MODE;
 let offlineFailure=false;
 if(mode.startsWith('offline-')){
  for(const operations of Object.values(fixture.operations))for(const operation of operations)operation.minute=11;
  const schedule=global.setTimeout;
  global.setTimeout=(callback,delay,...args)=>schedule(callback,delay>=30000?0:delay,...args);
 }
 const rows={qa_mixed_disposable_guard:[{marker:'gos-id-disposable-mixed-v1'}],games:[{id:fixture.gameId,title:fixture.title}],game_members:people.map(p=>({user_id:p.userId,kind:p===fixture.teacher?'teacher':p===fixture.observer?'observer':'student'}))};
 let number=0;
 Module._load=function(name,...args){
  if(name!=='@supabase/supabase-js')return load.call(this,name,...args);
  return {createClient(){
   if(number++===0)return {from(table){return {select(){return this},eq(){return this},limit(){return Promise.resolve({data:rows[table],error:null})},then(resolve,reject){return Promise.resolve({data:rows[table],error:null}).then(resolve,reject)}}},auth:{admin:{listUsers:async()=>({data:{users:people.map(p=>({id:p.userId,email:p.email}))},error:null})}}};
   let email='';return {auth:{async signInWithPassword(input){email=input.email;if(mode==='login'&&email==='s0@example.invalid')return {data:null,error:{message:'synthetic login failure'}};if(mode==='login'&&email==='s1@example.invalid'){await new Promise(resolve=>setTimeout(resolve,100));console.log('late-operation-finished')}return {data:{user:{id:people.find(p=>p.email===email).userId},session:{access_token:'synthetic'}},error:null}},async signOut(){console.log('signed-out:'+email);return {error:mode==='write'&&email==='s0@example.invalid'?{message:'synthetic logout failure'}:null}}},realtime:{async setAuth(){},async disconnect(){console.log('socket-closed:'+email);return 'ok'}},channel(){return {on(){return this},subscribe(callback){if(mode==='subscribe'&&email==='s0@example.invalid')callback('CHANNEL_ERROR');else if(mode==='subscribe'&&email==='s1@example.invalid')setTimeout(()=>{console.log('late-operation-finished');callback('SUBSCRIBED')},100);else callback('SUBSCRIBED')},teardown(){console.log('channel-teardown:'+email)}}},async removeChannel(){if(mode.startsWith('offline-')&&email==='s20@example.invalid'){offlineFailure=true;return mode==='offline-timeout'?'timed out':'error'}return mode==='read'&&email==='s0@example.invalid'?'timed out':'ok'},async removeAllChannels(){if(mode==='cleanup-throw'&&email==='s0@example.invalid')throw Error('synthetic cleanup exception');console.log('channels-torn-down:'+email);await this.realtime.disconnect();return [mode.startsWith('cleanup-')&&email==='s0@example.invalid'?(mode==='cleanup-timeout'?'timed out':'error'):mode==='read'&&email==='s0@example.invalid'?'timed out':'ok']},
    async rpc(name){if(offlineFailure)throw Error('unexpected read after failed disconnect');if((mode==='read'||mode.startsWith('cleanup-'))&&email==='s0@example.invalid')return {data:null,error:{message:'synthetic read failure'}};if(mode==='read'&&email==='s1@example.invalid'){await new Promise(resolve=>setTimeout(resolve,100));console.log('late-operation-finished')}if(mode==='write'&&name==='send_chat_text'&&email==='s0@example.invalid'||mode==='write'&&name==='create_formal_document')return {data:null,error:{message:'synthetic write failure'}};if(mode==='write'&&name==='send_chat_text'&&email==='s1@example.invalid'){await new Promise(resolve=>setTimeout(resolve,100));console.log('late-operation-finished')}return {data:name==='send_chat_text'?'synthetic-message':[],error:null}},
    from(){return {select(){return this},eq(){return this},limit(){return Promise.resolve({data:[{text:'QA'}],error:null})}}}};
  }};
 };
}else{
 const {spawnSync}=require('node:child_process');
 const runner=path.join(__dirname,'gos_40_mixed_local_20min.cjs');
 for(const mode of ['login','subscribe','read','write']){
  const child=spawnSync(process.execPath,['--require',__filename,runner],{encoding:'utf8',timeout:5000,env:{...process.env,GOS_MIXED_FAKE_PRELOAD:'1',GOS_MIXED_FAKE_MODE:mode,SUPABASE_URL:'http://127.0.0.1:54321',SUPABASE_ANON_KEY:'x',SUPABASE_SERVICE_ROLE_KEY:'x',QA_LOCAL_PASSWORD:'x',QA_MIXED_FIXTURE:'synthetic-fixture'}});
  assert.notEqual(child.status,0,mode+' failure must fail the run');
  const report=child.stderr.split(/\r?\n/).filter(line=>line.startsWith('{')).map(line=>JSON.parse(line)).find(item=>item.status==='FAIL');
  assert(report?.partial,mode+' failure must produce a partial report');
  assert.equal(report.inflight,0,mode+': all started measurements must settle before the partial report');
  assert.equal(report.attempted,report.completed,mode+': partial report counts every started measurement');
  assert.equal(report.cleanup_failures,mode==='read'||mode==='write'?1:0,mode+': cleanup errors must be visible in the partial report');
  if(mode==='read')assert.match(child.stderr,/synthetic read failure/,'Cleanup must not hide the original operation error');
  const lines=child.stdout.split(/\r?\n/),late=lines.indexOf('late-operation-finished'),firstSignOut=lines.findIndex(line=>line.startsWith('signed-out:'));
  assert(late>=0&&firstSignOut>late,mode+': cleanup must wait for slow operations');
  assert.equal(lines.filter(line=>line.startsWith('signed-out:')).length,mode==='login'?40:42,mode+': every created client must be signed out');
  if(mode==='write')assert.equal(report.writes_returned_success,39,'Partial report includes successful writes, including the late response');
 }
 for(const mode of ['offline-timeout','offline-error','cleanup-timeout','cleanup-error','cleanup-throw']){
  const child=spawnSync(process.execPath,['--require',__filename,runner],{encoding:'utf8',timeout:5000,env:{...process.env,GOS_MIXED_FAKE_PRELOAD:'1',GOS_MIXED_FAKE_MODE:mode,SUPABASE_URL:'http://127.0.0.1:54321',SUPABASE_ANON_KEY:'x',SUPABASE_SERVICE_ROLE_KEY:'x',QA_LOCAL_PASSWORD:'x',QA_MIXED_FIXTURE:'synthetic-fixture'}});
  assert.notEqual(child.status,0,mode+' must fail the run');
  const report=child.stderr.split(/\r?\n/).filter(line=>line.startsWith('{')).map(line=>JSON.parse(line)).find(item=>item.status==='FAIL');
  assert(report?.partial&&report.inflight===0,mode+' must report settled measurements');
  if(mode.startsWith('offline-')){assert.match(child.stderr,/Realtime channel disconnect failed/);assert.doesNotMatch(child.stderr,/unexpected read after failed disconnect/)}
  else{assert.match(child.stderr,/synthetic read failure/);assert.equal(report.cleanup_failures,1);assert.match(child.stdout,mode==='cleanup-throw'?/channel-teardown:s0@example\.invalid/:/channels-torn-down:s0@example\.invalid/);assert.match(child.stdout,/socket-closed:s0@example\.invalid/)}
 }
 const {reconnectSessions,createMeasurements}=require(runner);
 (async()=>{
  let release,finished=false;const gate=new Promise(resolve=>{release=resolve}),tracker=createMeasurements();
  const sessions=['fail','slow'].map(name=>({person:{email:name},client:{auth:{signInWithPassword:async()=>name==='fail'?{data:null,error:{message:'failure'}}:(await gate,{data:{session:{access_token:name}},error:null})},realtime:{setAuth:async()=>{}}}}));
  const reconnect=reconnectSessions(sessions,tracker.measure,async()=>{},'synthetic').catch(()=>{finished=true});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false,'Failed reconnect waits for another pending reconnect');
  release();await reconnect;assert.equal(finished,true);assert.equal(tracker.snapshot().inflight,0);
  console.log('PASS: failed logins, subscriptions, reconnects, reads and writes wait for started operations, clean up and report settled counts. Synthetic clients; no network.');
 })().catch(error=>{console.error(error);process.exitCode=1});
}
