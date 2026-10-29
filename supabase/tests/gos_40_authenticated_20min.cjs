const {createClient}=require('@supabase/supabase-js');
const assert=require('node:assert/strict');

const url=process.env.SUPABASE_URL;
const anon=process.env.SUPABASE_ANON_KEY;
const service=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!anon||!service)throw new Error('Local Supabase environment is incomplete');
const origin=new URL(url);
if(!['localhost','127.0.0.1'].includes(origin.hostname))throw new Error('Refusing to run against a non-local project');
if(!['http:','https:'].includes(origin.protocol)||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/')throw new Error('Use a bare local Supabase origin');
const clientCount=Number(process.env.QA_CLIENTS||40);
if(![40,100].includes(clientCount))throw new Error('QA_CLIENTS must be 40 or 100');
const duration=Number(process.env.QA_DURATION_SECONDS||1200);
if(!Number.isFinite(duration)||duration<1200)throw new Error('Acceptance run must last at least 20 real minutes');

const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
const password='Blitz-QA-2026!strong';
const gameId='11111111-1111-4111-8111-111111111111';

async function createUser(i){
 const email=`blitz-qa-${i}@example.invalid`;
 const made=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{qa:true}});
 if(made.error)throw made.error;
 return {i,email,id:made.data.user.id};
}
// Provision local GoTrue users in bounded groups; the actual game RPC waves
// below still run with 100 concurrent independent JWT sessions.
async function inBatches(items,batchSize,work){
 const values=[];
 for(let i=0;i<items.length;i+=batchSize){
  values.push(...await Promise.all(items.slice(i,i+batchSize).map(work)));
 }
 return values;
}
async function login(u){
 const client=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
 const s=await client.auth.signInWithPassword({email:u.email,password});
 if(s.error)throw s.error;
 assert.equal(s.data.user.id,u.id);
 if(!s.data.session?.access_token)throw new Error('Missing session access token');
 await client.realtime.setAuth(s.data.session.access_token);
 return {...u,client};
}
async function main(){
 const marker=await admin.from('qa_blitz_disposable_guard').select('marker').eq('marker','gos-id-disposable-blitz-v1').maybeSingle();
 if(marker.error||!marker.data)throw new Error('Disposable local test marker is missing');
 const existingUsers=await admin.auth.admin.listUsers({page:1,perPage:1});
 if(existingUsers.error||!Array.isArray(existingUsers.data?.users)||existingUsers.data.users.length)throw new Error('Disposable Auth must be empty before the test');
 const existingGames=await admin.from('games').select('id').limit(1);
 if(existingGames.error||!Array.isArray(existingGames.data)||existingGames.data.length)throw new Error('Disposable game database must be empty before the test');
 const teacher=await createUser(0);
 const students=await inBatches(Array.from({length:clientCount},(_,k)=>k+1),10,createUser);
 let r=await admin.from('games').insert({id:gameId,title:'Blitz local QA',game_code:'BLITZQA',owner_id:teacher.id});
 if(r.error)throw r.error;
 r=await admin.from('game_members').insert([
  {game_id:gameId,user_id:teacher.id,full_name:'QA Teacher',kind:'teacher'},
  ...students.map(u=>({game_id:gameId,user_id:u.id,full_name:`QA Student ${u.i}`,kind:'student'}))
 ]);
 if(r.error)throw r.error;
 const questions=Array.from({length:clientCount+2},(_,k)=>({id:k+1,topic:'QA',question:`Question ${k+1}`,options:['Correct','Wrong'],correct_index:0,legal_act:'QA act',article:'art. 1',source_url:'https://example.invalid/qa',explanation:'Synthetic local integration question only.',verified:true}));
 r=await admin.from('blitz_questions').insert(questions);if(r.error)throw r.error;
 r=await admin.from('blitz_assignments').insert(students.map((u,k)=>({id:`20000000-0000-4000-8000-${String(k+1).padStart(12,'0')}`,game_id:gameId,user_id:u.id,question_id:k+1,stage_no:1,available_at:new Date(Date.now()-60000).toISOString()})));if(r.error)throw r.error;

 const sessions=await inBatches(students,10,login);

 const opened=await Promise.all(sessions.map(s=>s.client.rpc('blitz_open',{p_game:gameId})));
 for(const [i,x] of opened.entries()){if(x.error)throw new Error(`open ${i+1}: ${x.error.message}`);assert(x.data?.id,'RPC did not return assignment')}
 const answered=await Promise.all(sessions.map((s,i)=>s.client.rpc('blitz_answer',{p_id:opened[i].data.id,p_choice:0})));
 for(const [i,x] of answered.entries()){if(x.error)throw new Error(`answer ${i+1}: ${x.error.message}`);assert.equal(x.data.is_correct,true);assert.equal(x.data.chosen_index,0)}

 const owned=await Promise.all(sessions.map(s=>s.client.from('blitz_assignments').select('id,is_correct,answered_at').eq('user_id',s.id)));
 for(const [i,x] of owned.entries()){if(x.error)throw x.error;assert.equal(x.data.length,1,`owner row count ${i+1}`);assert.equal(x.data[0].is_correct,true)}
 const cross=await sessions[1].client.from('blitz_assignments').select('id').eq('user_id',sessions[0].id);
 if(cross.error)throw cross.error;assert.equal(cross.data.length,0,'RLS exposed another student assignment');
 const forbidden=await sessions[1].client.rpc('blitz_answer',{p_id:opened[0].data.id,p_choice:0});
 assert(forbidden.error,'Cross-user answer unexpectedly succeeded');

 const first=sessions[0];
 r=await admin.from('blitz_assignments').insert([
  {id:'30000000-0000-4000-8000-000000000001',game_id:gameId,user_id:first.id,question_id:clientCount+1,stage_no:2,available_at:new Date(Date.now()-60000).toISOString()},
  {id:'30000000-0000-4000-8000-000000000002',game_id:gameId,user_id:first.id,question_id:clientCount+2,stage_no:2,available_at:new Date(Date.now()-30000).toISOString()}
 ]);if(r.error)throw r.error;
 const same=await Promise.all(Array.from({length:5},()=>first.client.rpc('blitz_open',{p_game:gameId})));
 same.forEach(x=>{if(x.error)throw x.error});
 assert.equal(new Set(same.map(x=>x.data.id)).size,1,'Concurrent opens returned different assignments');
 // Complete the existing extra attempt now. Otherwise its 20-second timer would
 // expire before the deliberate second wave 12 minutes later.
 const consumed=await first.client.rpc('blitz_answer',{p_id:same[0].data.id,p_choice:0});
 if(consumed.error||consumed.data?.is_correct!==true)throw new Error('Fixture preflight attempt not completed');


 // Sustained, wall-clock 20-minute authenticated run against disposable local Supabase.
 // One bounded request per visible session each minute. No production URL is allowed.
 const latency=[],audit={reads:0,bytes:0,reconnects:0,failures:0,skipped:0,receivedProbes:0};
 const probeId='qa-'+gameId+'-'+clientCount;
 const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 async function subscribe(s){
  const channel=s.client.channel('gos-qa-load-rooms',{config:{broadcast:{self:true}}});
  s.receivedProbeCount=0;
  channel.on('broadcast',{event:'qa_probe'},message=>{
   if(message.payload?.id===probeId){s.receivedProbeCount++;audit.receivedProbes++}
  });
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('Realtime subscription timeout for session '+s.i)),20000);
   channel.subscribe(status=>{
    if(status==='SUBSCRIBED'){clearTimeout(timer);resolve()}
    if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'){clearTimeout(timer);reject(new Error('Realtime '+status+' for session '+s.i))}
   });
  });
  s.channel=channel;
 }
 const sessionsWithConnection=sessions;
 await Promise.all(sessionsWithConnection.map(subscribe));
 // Verify delivery to EVERY independent WebSocket, not merely SUBSCRIBED.
 // The message contains no game answers, names, JWTs or other private data.
 async function verifyBroadcastFanout(targetSessions){
  targetSessions.forEach(s=>{s.receivedProbeCount=0});
  const sent=await sessionsWithConnection[0].channel.send({
   type:'broadcast',event:'qa_probe',payload:{id:probeId}
  });
  assert.equal(sent,'ok','Local Realtime must confirm one broadcast');
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){
   if(targetSessions.every(s=>s.receivedProbeCount>0))return;
   await sleep(100);
  }
  const missing=targetSessions.filter(s=>!s.receivedProbeCount).length;
  throw new Error('Local Realtime broadcast did not reach '+missing+' of '+targetSessions.length+' authenticated channels');
 }
 await verifyBroadcastFanout(sessionsWithConnection);
 console.log('PASS: '+clientCount+' local authenticated WebSockets received one Broadcast');
 const since=performance.now();
 // Every authenticated client has a genuine WebSocket subscription.
 console.log('PASS: '+clientCount+' real local authenticated Realtime subscriptions established');
 for(let minute=0;minute<20;minute++){
  const desired=since+minute*60000;
  await sleep(Math.max(0,desired-performance.now()));
  const disconnectedWindow=minute>=8&&minute<10;
  const active=disconnectedWindow?sessionsWithConnection.slice(0,clientCount/2):sessionsWithConnection;
  audit.skipped+=sessionsWithConnection.length-active.length;
  if(minute===8){
   const removed=await Promise.all(sessionsWithConnection.slice(clientCount/2).map(s=>s.client.removeChannel(s.channel)));
   if(removed.some(status=>status!=='ok'))throw new Error('Realtime disconnect failed');
  }
  if(minute===12){
   // Second round leaves the original completed answers intact.
   const second=students.slice(1).map(u=>({
    id:'40000000-0000-4000-8000-'+String(u.i).padStart(12,'0'),
    game_id:gameId,user_id:u.id,question_id:u.i,stage_no:2,
    available_at:new Date(Date.now()-60_000).toISOString()
   }));
   const assigned=await admin.from('blitz_assignments').insert(second);
   if(assigned.error)throw assigned.error;
   const openedAgain=await Promise.all(sessionsWithConnection.map(s=>s.client.rpc('blitz_open',{p_game:gameId})));
   openedAgain.forEach((x,i)=>{if(x.error||!x.data?.id)throw new Error('Round 2 open failed: '+i)});
   const submittedAgain=await Promise.all(sessionsWithConnection.map((s,i)=>s.client.rpc('blitz_answer',{p_id:openedAgain[i].data.id,p_choice:0})));
   submittedAgain.forEach((x,i)=>{if(x.error||x.data?.is_correct!==true)throw new Error('Round 2 lost confirmed action: '+i)});
   const retry=await Promise.all(Array.from({length:4},()=>sessionsWithConnection[0].client.rpc('blitz_answer',{p_id:openedAgain[0].data.id,p_choice:0})));
   retry.forEach(x=>{if(x.error||x.data?.is_correct!==true)throw new Error('Idempotent answer retry failed')});
   audit.gameplayWrites=clientCount;
  }
  if(minute===10){
   // Restore authentication and Realtime for the disconnected half.
   const resumed=await Promise.all(sessionsWithConnection.slice(clientCount/2).map(async s=>{
    const response=await s.client.auth.signInWithPassword({email:s.email,password});
    if(response.error||!response.data.session)throw new Error('Auth reconnection failed');
    await s.client.realtime.setAuth(response.data.session.access_token);
    await subscribe(s);
    return true;
   }));
   audit.reconnects+=resumed.length;
   await verifyBroadcastFanout(sessionsWithConnection);
  }
  const responses=await Promise.all(active.map(async s=>{
   const begun=performance.now();
   const data=await s.client.from('blitz_assignments').select('id,is_correct,answered_at').eq('user_id',s.id).eq('stage_no',1).limit(2);
   const ms=performance.now()-begun;
   latency.push(ms);
   if(data.error||data.data?.length!==1||data.data[0].is_correct!==true){
    audit.failures++;
    throw new Error('Lost/cross-tenant result for session '+s.i);
   }
   audit.reads++;
   audit.bytes+=Buffer.byteLength(JSON.stringify(data.data));
   return true;
  }));
  assert.equal(responses.length,active.length);
  if((minute+1)%5===0)console.log('Local '+clientCount+'-session check: '+(minute+1)+'/20 minutes; validated reads '+audit.reads);
 }
 await sleep(Math.max(0,since+duration*1000-performance.now()));
 const elapsedMs=performance.now()-since;
 assert(elapsedMs>=1200000,'Sustained test must run at least 20 real minutes');
 assert.equal(audit.failures,0,'No failed or lost authenticated reads allowed');
 assert.equal(audit.reconnects,clientCount/2,'All temporarily offline users must reauthenticate');
 assert.equal(audit.gameplayWrites,clientCount,'Second concurrent Blitz round completed');
 assert(audit.reads<=clientCount*20,'Request budget: no more than one sustained REST read per session per minute');
 const p95=latency.sort((a,b)=>a-b)[Math.max(0,Math.ceil(latency.length*.95)-1)];
 const p50=latency[Math.max(0,Math.ceil(latency.length*.50)-1)];
 const p99=latency[Math.max(0,Math.ceil(latency.length*.99)-1)];
 // Verify confirmed answer was not altered by repeated queries or reconnections.
 const verified=await Promise.all(sessionsWithConnection.map(s=>s.client.from('blitz_assignments').select('id,chosen_index,is_correct').eq('user_id',s.id).eq('stage_no',1)));
 for(const result of verified){
  if(result.error)throw result.error;
  assert.equal(result.data?.length,1);
  assert.equal(result.data[0].chosen_index,0);
  assert.equal(result.data[0].is_correct,true);
 }
 await Promise.all(sessionsWithConnection.map(s=>s.client.removeChannel(s.channel)));
 console.log('PASS: 20 REAL minutes, '+clientCount+' distinct authenticated local clients; '+clientCount+' Realtime subscriptions, '+audit.reconnects+' auth renewals and channel resubscriptions, '+audit.reads+' bounded REST reads; zero lost results');
 console.log(JSON.stringify({environment:'isolated local Supabase',scope:'Blitz-only',latency_scope:'Blitz assignment REST reads',latency_samples:latency.length,realtime_scope:'100 public local Realtime channels with one initial and one post-reconnect Broadcast delivery check; no private-channel RLS or full application Presence test',duration_seconds:Math.round(elapsedMs/1000),clients:clientCount,subscriptions:clientCount,reconnects:audit.reconnects,reads:audit.reads,second_round_writes:audit.gameplayWrites,skipped_inactive_reads:audit.skipped,response_bytes:audit.bytes,received_broadcasts:audit.receivedProbes,p50_ms:Math.round(p50),p95_ms:Math.round(p95),p99_ms:Math.round(p99),failures:audit.failures}));

 console.log('PASS: '+clientCount+' independent local Supabase Auth sessions, persisted Blitz answers, RLS isolation and serialized repeated opens');
}
main().catch(e=>{console.error(e);process.exit(1)});
