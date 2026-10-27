/* Real HTTP/Auth runner for a pre-provisioned disposable local Supabase fixture.
   Never substitutes mock results for an unavailable server or missing scenario. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createClient}=require('@supabase/supabase-js');
const modules=['chat','documents','votes','budget','events','blitz','stages'];
const allowed=new Set(['send_chat_text','create_formal_document','update_formal_draft','cast_vote_allocation','submit_budget_amendment','submit_event_decision','blitz_open_selected','blitz_answer','submit_stage_debrief','manage_game_stage']);
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
function validate(f,studentCount=40){
 assert(f.version===1&&/^LOCAL QA ·/.test(f.title),'Fixture must explicitly name a disposable LOCAL QA game');
 assert(/^[a-f\d-]{36}$/i.test(f.gameId));
 assert.equal(f.students?.length,studentCount,'The selected number of independent student identities is required');
 assert.equal(new Set(f.students.map(s=>s.userId)).size,studentCount);
 assert.equal(new Set(f.students.map(s=>s.email)).size,studentCount);
 for(const person of [...f.students,f.teacher,f.observer])assert(person?.userId&&/@example\.invalid$/.test(person.email),'Only named synthetic identities are allowed');
 for(const name of modules){
  const operations=f.operations?.[name];assert(operations?.length,'Missing actual write scenario: '+name);
  for(const op of operations){
   assert(op.actor==='teacher'||Number.isInteger(op.actor)&&op.actor>=0&&op.actor<studentCount,'Invalid actor');
   assert(allowed.has(op.rpc),'Unsupported or destructive operation: '+op.rpc);
   assert(op.args&&op.verify?.table&&Object.keys(op.verify?.match||{}).length&&Object.keys(op.verify?.expect||{}).length,'Every confirmed operation needs a nonempty persisted-result verification');
   assert(!op.verify.columns?.includes('*'),'Read only the verified fields');
   assert(Number.isInteger(op.minute)&&op.minute>=0&&op.minute<20,'A write must be scheduled inside the twenty-minute run');
  }
 }
 assert.equal(new Set(f.operations.chat.map(op=>op.actor)).size,studentCount,'Each participant must have a real chat action');
 assert(f.operations.chat.every(op=>Number.isInteger(op.actor)),'Student chat wave must use the selected student identities');
 assert(modules.reduce((n,key)=>n+f.operations[key].length,0)<=1000,'Fixture write budget exceeded');
 assert(f.negativeObserver?.rpc==='manage_game_stage'&&f.negativeObserver.args?.p_game_id===f.gameId,'Observer denial must address this game through the real teacher-only stage operation');
 return f;
}
if(require.main===module&&process.argv.includes('--self-test')){
 assert.equal(localOrigin('http://127.0.0.1:54321'),'http://127.0.0.1:54321');
 for(const url of ['https://example.supabase.co','https://localhost.example.com','http://user:pass@localhost:54321','http://localhost:54321/path'])assert.throws(()=>localOrigin(url));
 assert.throws(()=>validate({version:1,title:'LOCAL QA · test',gameId:'00000000-0000-4000-8000-000000000001',students:[]}));
 console.log('PASS: runner refuses remote/credential-bearing origins and incomplete fixtures. No server/Auth/load run.');
}else if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1});
module.exports={localOrigin,validate,parseStudentCount,latencySummary};
async function main(){
 const studentCount=parseStudentCount(process.argv.slice(2));
 const url=localOrigin(process.env.SUPABASE_URL||'');
 const anon=process.env.SUPABASE_ANON_KEY,service=process.env.SUPABASE_SERVICE_ROLE_KEY,password=process.env.QA_LOCAL_PASSWORD;
 assert(anon&&service&&password&&process.env.QA_MIXED_FIXTURE,'Local keys, synthetic password and prepared fixture are required');
 const fixture=validate(JSON.parse(fs.readFileSync(process.env.QA_MIXED_FIXTURE,'utf8')),studentCount);
 const admin=createClient(url,service,{global:transport,auth:{persistSession:false,autoRefreshToken:false}});
 // A local address alone is insufficient: refuse copied production data.
 const games=await admin.from('games').select('id,title').limit(101);
 if(games.error)throw games.error;
 assert(games.data.length<101&&games.data.every(g=>/^LOCAL QA ·/.test(g.title)),'Database contains games not explicitly disposable');
 assert(games.data.some(g=>g.id===fixture.gameId&&g.title===fixture.title),'Prepared test game is missing');
 const roster=await admin.from('game_members').select('user_id,kind').eq('game_id',fixture.gameId);
 if(roster.error)throw roster.error;
 for(const [kind,persons] of [['student',fixture.students],['teacher',[fixture.teacher]],['observer',[fixture.observer]]])
  for(const person of persons)assert(roster.data.some(m=>m.user_id===person.userId&&m.kind===kind),'Fixture role mismatch');
 const samples=[],confirmed=[];let responseBytes=0,requests=0;
 async function measure(label,work){
  const start=performance.now();const value=await work();samples.push({label,ms:performance.now()-start});requests++;
  if(value.error)throw new Error(label+': '+value.error.message);
  responseBytes+=Buffer.byteLength(JSON.stringify(value.data));return value.data;
 }
 async function login(person){
  const client=createClient(url,anon,{global:transport,auth:{persistSession:false,autoRefreshToken:false}});
  const auth=await measure('auth',()=>client.auth.signInWithPassword({email:person.email,password}));
  assert.equal(auth.user.id,person.userId);await client.realtime.setAuth(auth.session.access_token);
  return {person,client,channel:null};
 }
 const sessions=await Promise.all(fixture.students.map(login)),teacher=await login(fixture.teacher),observer=await login(fixture.observer);
 async function subscribe(session){
  session.channel=session.client.channel('local-mixed-'+session.person.userId).on('postgres_changes',{event:'*',schema:'public',table:'game_votes',filter:'game_id=eq.'+fixture.gameId},()=>{});
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Local Realtime connection timed out')),15000);
   session.channel.subscribe(status=>{if(status==='SUBSCRIBED'){clearTimeout(timer);resolve()}else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'){clearTimeout(timer);reject(Error('Local Realtime '+status))}});
  });
 }
 try{await Promise.all(sessions.map(subscribe))}catch(error){await Promise.all(sessions.map(s=>s.client.removeAllChannels()));throw error}
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
 try{
  for(let minute=0;minute<20;minute++){
   await sleep(Math.max(0,began+minute*60000-performance.now()));
   if(minute===8)await Promise.all(sessions.slice(studentCount/2).map(s=>s.client.removeChannel(s.channel)));
   if(minute===10)for(const session of sessions.slice(studentCount/2)){
    const auth=await measure('reauth',()=>session.client.auth.signInWithPassword({email:session.person.email,password}));
    await session.client.realtime.setAuth(auth.session.access_token);await subscribe(session);
   }
   const active=minute>=8&&minute<10?sessions.slice(0,studentCount/2):sessions;
   await Promise.all(active.map((s,i)=>{
    const name=readRPC[(minute+i)%readRPC.length];const args=name==='blitz_inbox_counts'?{p_game:fixture.gameId}:{p_game_id:fixture.gameId};
    return measure('read:'+name,()=>s.client.rpc(name,args));
   }));
   await Promise.all([teacher,observer].map(s=>measure('role-observation',()=>s.client.rpc('get_section_updates',{p_game_id:fixture.gameId}))));
   const waves=new Map();
   for(const op of allOps.filter(op=>op.minute===minute)){const chain=waves.get(op.actor)||[];chain.push(op);waves.set(op.actor,chain)}
   await Promise.all([...waves.values()].map(async chain=>{
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
  const latency=latencySummary(samples);
  console.log(JSON.stringify({status:'PASS',environment:'prepared disposable local Supabase with real HTTP/Auth',students:studentCount,teacher:1,observer:1,wall_clock_ms:performance.now()-began,requests,response_json_bytes:responseBytes,confirmed_writes:confirmed.length,modules:modules.map(module=>({module,writes:confirmed.filter(i=>i.op.module===module).length})),latency,limits:'No browser rendering or external-provider capacity claim; no agreed latency acceptance threshold.'},null,2));
 }finally{
  await Promise.all([...sessions,teacher,observer].map(async s=>{if(s.channel)await s.client.removeChannel(s.channel);await s.client.auth.signOut({scope:'local'})}));
 }
}
