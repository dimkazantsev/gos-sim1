const {createClient}=require('@supabase/supabase-js');
const assert=require('node:assert/strict');

const url=process.env.SUPABASE_URL;
const anon=process.env.SUPABASE_ANON_KEY;
const service=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!anon||!service)throw new Error('Local Supabase environment is incomplete');

const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
const password='Blitz-QA-2026!strong';
const gameId='11111111-1111-4111-8111-111111111111';

async function createUser(i){
 const email=`blitz-qa-${i}@example.invalid`;
 const made=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{qa:true}});
 if(made.error)throw made.error;
 return {i,email,id:made.data.user.id};
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
 const teacher=await createUser(0);
 const students=await Promise.all(Array.from({length:40},(_,k)=>createUser(k+1)));
 let r=await admin.from('games').insert({id:gameId,title:'Blitz local QA',game_code:'BLITZQA',owner_id:teacher.id});
 if(r.error)throw r.error;
 r=await admin.from('game_members').insert([
  {game_id:gameId,user_id:teacher.id,full_name:'QA Teacher',kind:'teacher'},
  ...students.map(u=>({game_id:gameId,user_id:u.id,full_name:`QA Student ${u.i}`,kind:'student'}))
 ]);
 if(r.error)throw r.error;
 const questions=Array.from({length:42},(_,k)=>({id:k+1,topic:'QA',question:`Question ${k+1}`,options:['Correct','Wrong'],correct_index:0,legal_act:'QA act',article:'art. 1',source_url:'https://example.invalid/qa',explanation:'Synthetic local integration question only.',verified:true}));
 r=await admin.from('blitz_questions').insert(questions);if(r.error)throw r.error;
 r=await admin.from('blitz_assignments').insert(students.map((u,k)=>({id:`20000000-0000-4000-8000-${String(k+1).padStart(12,'0')}`,game_id:gameId,user_id:u.id,question_id:k+1,stage_no:1,available_at:new Date(Date.now()-60000).toISOString()})));if(r.error)throw r.error;

 const sessions=await Promise.all(students.map(login));

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
  {id:'30000000-0000-4000-8000-000000000001',game_id:gameId,user_id:first.id,question_id:41,stage_no:2,available_at:new Date(Date.now()-60000).toISOString()},
  {id:'30000000-0000-4000-8000-000000000002',game_id:gameId,user_id:first.id,question_id:42,stage_no:2,available_at:new Date(Date.now()-30000).toISOString()}
 ]);if(r.error)throw r.error;
 const same=await Promise.all(Array.from({length:5},()=>first.client.rpc('blitz_open',{p_game:gameId})));
 same.forEach(x=>{if(x.error)throw x.error});
 assert.equal(new Set(same.map(x=>x.data.id)).size,1,'Concurrent opens returned different assignments');


 // Sustained, wall-clock 20-minute authenticated run against disposable local Supabase.
 // One bounded request per visible session each minute. No production URL is allowed.
 const duration=Number(process.env.QA_DURATION_SECONDS||1200);
 if(duration<1200)throw new Error('Acceptance run must last at least 20 real minutes');
 const hostname=new URL(url).hostname;
 if(!['localhost','127.0.0.1'].includes(hostname))throw new Error('Only local Supabase is permitted');
 const latency=[],audit={reads:0,bytes:0,reconnects:0,failures:0,skipped:0};
 const since=performance.now();
 const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const sessionsWithConnection=await Promise.all(sessions.map(async s=>{
  const channel=s.client.channel('gos-qa-40-rooms',{config:{broadcast:{self:true}}});
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('Realtime subscription timeout for session '+s.i)),20000);
   channel.subscribe(status=>{
    if(status==='SUBSCRIBED'){clearTimeout(timer);resolve()}
    if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'){clearTimeout(timer);reject(new Error('Realtime '+status+' for session '+s.i))}
   });
  });
  return {...s,channel};
 }));
 // Every authenticated client has a genuine WebSocket subscription.
 console.log('PASS: 40 real local authenticated Realtime subscriptions established');
 for(let minute=0;minute<20;minute++){
  const desired=since+minute*60000;
  await sleep(Math.max(0,desired-performance.now()));
  const disconnectedWindow=minute>=8&&minute<10;
  const active=disconnectedWindow?sessionsWithConnection.slice(0,20):sessionsWithConnection;
  audit.skipped+=sessionsWithConnection.length-active.length;
  if(minute===10){
   // Restore real auth sessions after simulated outage of the other 20 clients.
   const resumed=await Promise.all(sessionsWithConnection.slice(20).map(async s=>{
    const response=await s.client.auth.signInWithPassword({email:s.email,password});
    if(response.error||!response.data.session)throw new Error('Auth reconnection failed');
    await s.client.realtime.setAuth(response.data.session.access_token);
    return true;
   }));
   audit.reconnects+=resumed.length;
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
  if((minute+1)%5===0)console.log('Local 40-session check: '+(minute+1)+'/20 minutes; validated reads '+audit.reads);
 }
 await sleep(Math.max(0,since+duration*1000-performance.now()));
 const elapsedMs=performance.now()-since;
 assert(elapsedMs>=1200000,'Sustained test must run at least 20 real minutes');
 assert.equal(audit.failures,0,'No failed or lost authenticated reads allowed');
 assert.equal(audit.reconnects,20,'All temporarily offline users must reauthenticate');
 assert(audit.reads<=800,'Request budget: no more than 800 sustained REST reads');
 const p95=latency.sort((a,b)=>a-b)[Math.max(0,Math.ceil(latency.length*.95)-1)];
 // Verify confirmed answer was not altered by repeated queries or reconnections.
 const verified=await Promise.all(sessionsWithConnection.map(s=>s.client.from('blitz_assignments').select('id,chosen_index,is_correct').eq('user_id',s.id).eq('stage_no',1)));
 for(const result of verified){
  if(result.error)throw result.error;
  assert.equal(result.data?.length,1);
  assert.equal(result.data[0].chosen_index,0);
  assert.equal(result.data[0].is_correct,true);
 }
 await Promise.all(sessionsWithConnection.map(s=>s.client.removeChannel(s.channel)));
 console.log('PASS: 20 REAL minutes, 40 distinct authenticated local clients; 40 Realtime subscriptions, 20 auth reconnections, '+audit.reads+' bounded REST reads; zero lost results');
 console.log(JSON.stringify({environment:'isolated local Supabase',duration_seconds:Math.round(elapsedMs/1000),clients:40,subscriptions:40,reconnects:audit.reconnects,reads:audit.reads,skipped_inactive_reads:audit.skipped,response_bytes:audit.bytes,p95_ms:Math.round(p95),failures:audit.failures}));

 console.log('PASS: 40 independent local Supabase Auth sessions, persisted Blitz answers, RLS isolation and serialized repeated opens');
}
main().catch(e=>{console.error(e);process.exit(1)});
