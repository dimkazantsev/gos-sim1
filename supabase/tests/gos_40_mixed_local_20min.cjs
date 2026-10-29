/* Real HTTP/Auth runner for a pre-provisioned disposable local Supabase fixture.
   Never substitutes mock results for an unavailable server or missing scenario. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createClient}=require('@supabase/supabase-js');
const allowed={
 chat:new Set(['send_chat_text']),
 documents:new Set(['create_formal_document','update_formal_draft']),
 votes:new Set(['cast_vote_allocation']),
 budget:new Set(['submit_budget_amendment']),
 events:new Set(['submit_event_decision']),
 blitz:new Set(['blitz_open_selected','blitz_answer']),
 stages:new Set(['submit_stage_debrief','manage_game_stage'])
};
const modules=Object.keys(allowed);
const transport={fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.any([...(init?.signal?[init.signal]:[]),AbortSignal.timeout(15000)])})};
function localOrigin(value){
 const parsed=new URL(value);
 assert(['localhost','127.0.0.1','[::1]'].includes(parsed.hostname),'Only an isolated local Supabase is permitted');
 assert(['http:','https:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password&&!parsed.search&&!parsed.hash&&parsed.pathname==='/','Use a bare local Supabase origin');
 return parsed.origin;
}
function parseStudentCount(args){
 const options=args.filter(arg=>arg.startsWith('--students='));
 assert(options.length===args.length&&options.length<=1,'Use one --students=40 or --students=100 option');
 const count=options.length?options[0].slice('--students='.length):'40';
 assert(count==='40'||count==='100','Only 40 or 100 students are supported');
 return Number(count);
}
function latencySummary(samples){
 const labels=[...new Set(samples.map(s=>s.label))];
 return Object.fromEntries(labels.map(label=>{const values=samples.filter(s=>s.label===label).map(s=>s.ms).sort((a,b)=>a-b);return[label,{n:values.length,p95_ms:values[Math.ceil(values.length*.95)-1],p99_ms:values[Math.ceil(values.length*.99)-1]}]}));
}
function createMeasurements(now=()=>performance.now()){
 const samples=[];let attempted=0,completed=0,responseBytes=0;
 async function measure(label,work){
  attempted++;const started=now();
  try{
   const value=await work();
   if(value.error)throw new Error(label+': '+value.error.message);
   responseBytes+=Buffer.byteLength(JSON.stringify(value.data));
   samples.push({label,ms:now()-started,failed:false});return value.data;
  }catch(error){samples.push({label,ms:now()-started,failed:true});throw error}
  finally{completed++}
 }
 function snapshot(){
  const successful=samples.filter(s=>!s.failed),failed=samples.filter(s=>s.failed);
  return {attempted,completed,failed:failed.length,inflight:attempted-completed,response_json_bytes:responseBytes,
   latency_success:latencySummary(successful),latency_failure:latencySummary(failed)};
 }
 return {measure,snapshot};
}
function reportMeasurements(stats){
 return {measured_calls:stats.completed,measured_success_data_json_bytes:stats.response_json_bytes,
  measurement_scope:'Explicitly measured client calls only; a client call can involve multiple HTTP requests. Excludes observer denial, cross-user read, Realtime connection, subscriptions and messages, and sign-out. Durations are client-call durations; response bytes are serialized successful data, not wire bytes.'};
}
async function reconnectSessions(sessions,measure,subscribe,password){
 await settleAll(sessions.map(async session=>{
  const auth=await measure('reauth',()=>session.client.auth.signInWithPassword({email:session.person.email,password}));
  await session.client.realtime.setAuth(auth.session.access_token);await subscribe(session);
 }));
}
async function settleAll(promises){
 const results=await Promise.allSettled(promises),failure=results.find(result=>result.status==='rejected');
 if(failure)throw failure.reason;
 return results.map(result=>result.value);
}
function verifyContract(op,fixture){
 const {args,verify}=op,actor=op.actor==='teacher'?fixture.teacher:fixture.students[op.actor];
 function field(object,key,value){
  assert(value!==undefined&&value!==null&&value!=='','Missing value for verification: '+key);
  assert.deepEqual(object[key],value,'Verification must match the action: '+key);
 }
 function table(name){assert.equal(verify.table,name,'Verification must inspect the action table')}
 function text(value){assert(typeof value==='string'&&value.trim(),'Action text required for verification');return value.trim()}
 switch(op.rpc){
  case 'send_chat_text':table('chat_messages');field(verify.match,'id','$result');field(verify.expect,'text',text(args.p_text));break;
  case 'create_formal_document':table('formal_documents');field(verify.match,'id','$result');field(verify.expect,'title',text(args.p_title));break;
  case 'update_formal_draft':table('formal_documents');field(verify.match,'id',args.p_document_id);field(verify.expect,'body_text',args.p_body_text);break;
  case 'cast_vote_allocation':
   table('game_ballots');field(verify.match,'vote_id',args.p_vote_id);field(verify.match,'voter_id',actor.userId);
   for(const [column,arg] of [['yes_weight','p_yes'],['no_weight','p_no'],['abstain_weight','p_abstain']])field(verify.expect,column,args[arg]);break;
  case 'submit_budget_amendment':
   table('budget_faction_amendments');field(verify.match,'id','$result');field(verify.expect,'from_section',args.p_from);field(verify.expect,'to_section',args.p_to);break;
  case 'submit_event_decision':{
   table('event_decisions');field(verify.match,'assignment_id',args.p_assignment_id);field(verify.match,'actor_id',actor.userId);
   const choice=args.p_choice==='accept'?'option_1':args.p_choice==='reject'?'option_2':args.p_choice;
   assert(typeof choice==='string'&&/^option_[1-6]$/.test(choice),'Valid event choice required');field(verify.expect,'choice',choice);break;
  }
  case 'blitz_open_selected':case 'blitz_answer':
   table('blitz_assignments');field(verify.match,'id',args.p_id);field(verify.match,'user_id',actor.userId);
   field(verify.expect,op.rpc==='blitz_answer'?'answered_at':'started_at','$nonNull');break;
  case 'submit_stage_debrief':table('stage_debriefs');field(verify.match,'id','$result');field(verify.expect,'body',text(args.p_body));break;
  case 'manage_game_stage':
   table('game_stages');field(args,'p_game_id',fixture.gameId);field(verify.match,'game_id',fixture.gameId);field(verify.match,'stage_no',args.p_stage_no);
   assert(['open','close','extend'].includes(args.p_action),'Valid stage action required');
   if(args.p_action==='extend')field(verify.expect,'deadline','$nonNull');
   else field(verify.expect,'status',args.p_action==='open'?'open':'completed');break;
 }
}
function validate(f,studentCount=40){
 assert(f.version===1&&/^LOCAL QA ·/.test(f.title),'Fixture must explicitly name a disposable LOCAL QA game');
 assert(/^[a-f\d-]{36}$/i.test(f.gameId));
 assert.equal(f.students?.length,studentCount,'The selected number of independent student identities is required');
 assert.equal(new Set(f.students.map(s=>s.userId)).size,studentCount);
 assert.equal(new Set(f.students.map(s=>s.email)).size,studentCount);
 for(const person of [...f.students,f.teacher,f.observer])assert(person?.userId&&/@example\.invalid$/.test(person.email),'Only named synthetic identities are allowed');
 assert.equal(new Set([...f.students,f.teacher,f.observer].map(s=>s.userId)).size,studentCount+2,'Fixture identities must be distinct');
 assert.equal(new Set([...f.students,f.teacher,f.observer].map(s=>s.email)).size,studentCount+2,'Fixture emails must be distinct');
 for(const name of modules){
  const operations=f.operations?.[name];assert(operations?.length,'Missing actual write scenario: '+name);
  for(const op of operations){
   assert(op.actor==='teacher'||Number.isInteger(op.actor)&&op.actor>=0&&op.actor<studentCount,'Invalid actor');
   assert(allowed[name].has(op.rpc),'Unsupported operation for '+name+': '+op.rpc);
   assert(op.args&&op.verify?.table&&Object.keys(op.verify?.match||{}).length&&Object.keys(op.verify?.expect||{}).length,'Every confirmed operation needs a nonempty persisted-result verification');
   assert(!op.verify.columns?.includes('*'),'Read only the verified fields');
   assert(Number.isInteger(op.minute)&&op.minute>=0&&op.minute<20,'A write must be scheduled inside the twenty-minute run');
   verifyContract(op,f);
  }
 }
 assert.equal(new Set(f.operations.chat.map(op=>op.actor)).size,studentCount,'Each participant must have a real chat action');
 assert(f.operations.chat.every(op=>Number.isInteger(op.actor)),'Student chat wave must use the selected student identities');
 assert(modules.reduce((n,key)=>n+f.operations[key].length,0)<=1000,'Fixture write budget exceeded');
 assert(f.negativeObserver?.rpc==='manage_game_stage'&&f.negativeObserver.args?.p_game_id===f.gameId,'Observer denial must address this game through the real teacher-only stage operation');
 return f;
}
let currentMeasurements,currentConfirmed,currentCleanupFailures=0;
if(require.main===module&&process.argv.includes('--self-test')){
 assert.equal(localOrigin('http://127.0.0.1:54321'),'http://127.0.0.1:54321');
 for(const url of ['https://example.supabase.co','https://localhost.example.com','http://user:pass@localhost:54321','http://localhost:54321/path'])assert.throws(()=>localOrigin(url));
 assert.throws(()=>validate({version:1,title:'LOCAL QA · test',gameId:'00000000-0000-4000-8000-000000000001',students:[]}));
 console.log('PASS: runner refuses remote/credential-bearing origins and incomplete fixtures. No server/Auth/load run.');
}else if(require.main===module)main().catch(error=>{
 console.error(error.message);
 if(currentMeasurements){const stats=currentMeasurements.snapshot(),{response_json_bytes,...details}=stats;console.error(JSON.stringify({status:'FAIL',partial:true,...details,writes_returned_success:currentConfirmed?.length||0,cleanup_failures:currentCleanupFailures,...reportMeasurements(stats)}))}
 process.exitCode=1;
});
module.exports={localOrigin,validate,parseStudentCount,latencySummary,createMeasurements,reconnectSessions,reportMeasurements};
async function main(){
 const studentCount=parseStudentCount(process.argv.slice(2));
 const url=localOrigin(process.env.SUPABASE_URL||'');
 const anon=process.env.SUPABASE_ANON_KEY,service=process.env.SUPABASE_SERVICE_ROLE_KEY,password=process.env.QA_LOCAL_PASSWORD;
 assert(anon&&service&&password&&process.env.QA_MIXED_FIXTURE,'Local keys, synthetic password and prepared fixture are required');
 const fixture=validate(JSON.parse(fs.readFileSync(process.env.QA_MIXED_FIXTURE,'utf8')),studentCount);
 const confirmed=[],measurements=createMeasurements(),clients=[];currentMeasurements=measurements;currentConfirmed=confirmed;
 const {measure}=measurements;
 console.error('Use a physically separate disposable Supabase instance, not a forwarded or shared database. The marker and fixture checks do not inspect every table or prove physical isolation.');
 const admin=createClient(url,service,{global:transport,auth:{persistSession:false,autoRefreshToken:false}});
 // Install this marker only on an empty disposable stack before provisioning the fixture.
 const guard=await measure('preflight:guard',()=>admin.from('qa_mixed_disposable_guard').select('marker').eq('marker','gos-id-disposable-mixed-v1').limit(1));
 assert(guard.length===1&&guard[0].marker==='gos-id-disposable-mixed-v1','Disposable test marker is missing');
 const games=await measure('preflight:games',()=>admin.from('games').select('id,title').limit(101));
 assert(games.length===1&&games[0].id===fixture.gameId&&games[0].title===fixture.title,'Database must contain only the prepared disposable fixture game');
 const expected=[...fixture.students,fixture.teacher,fixture.observer];
 const auth=await measure('preflight:users',()=>admin.auth.admin.listUsers({page:1,perPage:expected.length+1}));
 assert(auth.users?.length===expected.length&&expected.every(person=>auth.users.some(user=>user.id===person.userId&&user.email===person.email)),'Auth users must exactly match the disposable fixture');
 const roster=await measure('preflight:roster',()=>admin.from('game_members').select('user_id,kind').eq('game_id',fixture.gameId));
 assert.equal(roster.length,expected.length,'The disposable fixture roster must have no extra members');
 for(const [kind,persons] of [['student',fixture.students],['teacher',[fixture.teacher]],['observer',[fixture.observer]]])
  for(const person of persons)assert(roster.some(m=>m.user_id===person.userId&&m.kind===kind),'Fixture role mismatch');
 async function login(person){
  const client=createClient(url,anon,{global:transport,auth:{persistSession:false,autoRefreshToken:false}});
  const session={person,client,channel:null};clients.push(session);
  const auth=await measure('auth',()=>client.auth.signInWithPassword({email:person.email,password}));
  assert.equal(auth.user.id,person.userId);await client.realtime.setAuth(auth.session.access_token);
  return session;
 }
 let failed=false,successReport;
 try{
 const sessions=await settleAll(fixture.students.map(login)),teacher=await login(fixture.teacher),observer=await login(fixture.observer);
 async function subscribe(session){
  session.channel=session.client.channel('local-mixed-'+session.person.userId).on('postgres_changes',{event:'*',schema:'public',table:'game_votes',filter:'game_id=eq.'+fixture.gameId},()=>{});
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Local Realtime connection timed out')),15000);
   session.channel.subscribe(status=>{if(status==='SUBSCRIBED'){clearTimeout(timer);resolve()}else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'){clearTimeout(timer);reject(Error('Local Realtime '+status))}});
  });
 }
 await settleAll(sessions.map(subscribe));
 const readRPC=['get_section_updates','get_my_chat_overview','get_game_achievements','blitz_inbox_counts'];
 const allOps=modules.flatMap(module=>fixture.operations[module].map(op=>({...op,module})));
 const began=performance.now(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 async function verify(item){
  const verifier=item.op.verify;let query=item.session.client.from(verifier.table).select(verifier.columns||Object.keys(verifier.expect).join(','));
  for(const [key,value]of Object.entries(verifier.match))query=query.eq(key,value==='$result'?item.result:value);
  const rows=await measure('verify:'+item.op.module,()=>query.limit(2));
  assert.equal(rows.length,1,'Confirmed write disappeared or duplicate row exists');
  for(const [key,value]of Object.entries(verifier.expect)){
   if(value==='$nonNull')assert(rows[0][key]!==null&&rows[0][key]!==undefined,'Expected persisted value: '+key);
   else assert.deepEqual(rows[0][key],value,'Persisted field differs: '+key);
  }
 }
  for(let minute=0;minute<20;minute++){
   await sleep(Math.max(0,began+minute*60000-performance.now()));
   if(minute===8)await settleAll(sessions.slice(studentCount/2).map(async s=>{if(await s.client.removeChannel(s.channel)!=='ok')throw Error('Realtime channel disconnect failed')}));
   if(minute===10)await reconnectSessions(sessions.slice(studentCount/2),measure,subscribe,password);
   const active=minute>=8&&minute<10?sessions.slice(0,studentCount/2):sessions;
   await settleAll(active.map((s,i)=>{
    const name=readRPC[(minute+i)%readRPC.length];const args=name==='blitz_inbox_counts'?{p_game:fixture.gameId}:{p_game_id:fixture.gameId};
    return measure('read:'+name,()=>s.client.rpc(name,args));
   }));
   await settleAll([teacher,observer].map(s=>measure('role-observation',()=>s.client.rpc('get_section_updates',{p_game_id:fixture.gameId}))));
   const waves=new Map();
   for(const op of allOps.filter(op=>op.minute===minute)){const chain=waves.get(op.actor)||[];chain.push(op);waves.set(op.actor,chain)}
   await settleAll([...waves.values()].map(async chain=>{
    for(const op of chain){
     const session=op.actor==='teacher'?teacher:sessions[op.actor];
     assert(active.includes(session)||session===teacher,'Do not schedule writes for a deliberately offline client');
     const result=await measure('write:'+op.module,()=>session.client.rpc(op.rpc,op.args));
     const item={op,session,result};confirmed.push(item);await verify(item);
    }
   }));
  }
  await sleep(Math.max(0,began+1200000-performance.now()));
  for(const item of confirmed)await verify(item);
  const denied=await observer.client.rpc(fixture.negativeObserver.rpc,fixture.negativeObserver.args);
  assert.equal(denied.error?.code,'42501','Observer denial must be an authorization failure, not an invalid fixture or overloaded server');
  const cross=await sessions[0].client.from('blitz_assignments').select('id').eq('game_id',fixture.gameId).eq('user_id',sessions[1].person.userId).limit(1);
  if(cross.error)throw cross.error;assert.equal(cross.data.length,0,'Another student Blitz assignment leaked');
  assert(performance.now()-began>=1200000,'A real twenty-minute run is required');
  const stats=measurements.snapshot();
  successReport={status:'PASS',environment:'prepared disposable local Supabase with real HTTP/Auth',students:studentCount,teacher:1,observer:1,wall_clock_ms:performance.now()-began,...reportMeasurements(stats),confirmed_writes:confirmed.length,modules:modules.map(module=>({module,writes:confirmed.filter(i=>i.op.module===module).length})),latency:stats.latency_success,limits:'One scheduled read per active student per minute, plus fixture writes and verification; no browser rendering or external-provider capacity claim; no agreed latency acceptance threshold. Isolation must be independently verified; preflight does not inspect all tables.'};
 }catch(error){failed=true;throw error}finally{
  const cleanup=await Promise.allSettled(clients.map(async s=>{
   let failure;
   let removed=false;
   try{if(s.channel){const statuses=await s.client.removeAllChannels();removed=true;if(statuses.some(status=>status!=='ok'))throw Error('Realtime channel cleanup failed')}}catch(error){failure=error;if(!removed){try{s.channel?.teardown()}catch{}try{await s.client.realtime.disconnect()}catch{}}}
   try{const result=await s.client.auth.signOut({scope:'local'});if(result.error)throw result.error}catch(error){failure??=error}
   if(failure)throw failure;
  }));
  currentCleanupFailures=cleanup.filter(result=>result.status==='rejected').length;
  const error=cleanup.find(result=>result.status==='rejected');
  if(error&&!failed)throw error.reason;
 }
 console.log(JSON.stringify(successReport,null,2));
}
