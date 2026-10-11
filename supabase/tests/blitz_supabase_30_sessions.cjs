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
 const students=await Promise.all(Array.from({length:30},(_,k)=>createUser(k+1)));
 let r=await admin.from('games').insert({id:gameId,title:'Blitz local QA',game_code:'BLITZQA',owner_id:teacher.id});
 if(r.error)throw r.error;
 r=await admin.from('game_members').insert([
  {game_id:gameId,user_id:teacher.id,full_name:'QA Teacher',kind:'teacher'},
  ...students.map(u=>({game_id:gameId,user_id:u.id,full_name:`QA Student ${u.i}`,kind:'student'}))
 ]);
 if(r.error)throw r.error;
 const questions=Array.from({length:32},(_,k)=>({id:k+1,topic:'QA',question:`Question ${k+1}`,options:['Correct','Wrong'],correct_index:0,legal_act:'QA act',article:'art. 1',source_url:'https://example.invalid/qa',explanation:'Synthetic local integration question only.',verified:true}));
 r=await admin.from('blitz_questions').insert(questions);if(r.error)throw r.error;
 r=await admin.from('blitz_assignments').insert(students.map((u,k)=>({id:`20000000-0000-4000-8000-${String(k+1).padStart(12,'0')}`,game_id:gameId,user_id:u.id,question_id:k+1,stage_no:1,available_at:new Date(Date.now()-60000).toISOString()})));if(r.error)throw r.error;

 const sessions=await Promise.all(students.map(login));
 const realtimeSeen=new Set();
 const adminSeen=new Set();
 await admin.realtime.setAuth(service);
 const adminChannel=admin.channel('qa-admin').on('postgres_changes',{event:'UPDATE',schema:'public',table:'blitz_assignments'},payload=>{if(payload.new?.answered_at)adminSeen.add(payload.new.user_id)});
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('Admin Realtime subscription timeout')),15000);adminChannel.subscribe((status,err)=>{if(status==='SUBSCRIBED'){clearTimeout(t);resolve()}else if(status==='CHANNEL_ERROR'){clearTimeout(t);reject(err||new Error('Admin Realtime channel error'))}})});
 const channels=sessions.map(s=>s.client.channel('qa-'+s.i).on('postgres_changes',{event:'UPDATE',schema:'public',table:'blitz_assignments'},payload=>{if(payload.new?.user_id===s.id&&payload.new?.answered_at)realtimeSeen.add(s.id)}));
 await Promise.all(channels.map(ch=>new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('Realtime subscription timeout')),15000);ch.subscribe(status=>{if(status==='SUBSCRIBED'){clearTimeout(t);resolve()}else if(status==='CHANNEL_ERROR'){clearTimeout(t);reject(new Error('Realtime channel error'))}})})));

 const opened=await Promise.all(sessions.map(s=>s.client.rpc('blitz_open',{p_game:gameId})));
 for(const [i,x] of opened.entries()){if(x.error)throw new Error(`open ${i+1}: ${x.error.message}`);assert(x.data?.id,'RPC did not return assignment')}
 const answered=await Promise.all(sessions.map((s,i)=>s.client.rpc('blitz_answer',{p_id:opened[i].data.id,p_choice:0})));
 for(const [i,x] of answered.entries()){if(x.error)throw new Error(`answer ${i+1}: ${x.error.message}`);assert.equal(x.data.is_correct,true);assert.equal(x.data.chosen_index,0)}
 for(let tries=0;tries<60&&(realtimeSeen.size<30||adminSeen.size<30);tries++)await new Promise(r=>setTimeout(r,250));
 assert.equal(adminSeen.size,30,'Realtime publication pipeline did not deliver all 30 updates to service role');
 assert.equal(realtimeSeen.size,30,'Realtime RLS did not deliver all 30 owner-visible answer updates');

 const owned=await Promise.all(sessions.map(s=>s.client.from('blitz_assignments').select('id,is_correct,answered_at').eq('user_id',s.id)));
 for(const [i,x] of owned.entries()){if(x.error)throw x.error;assert.equal(x.data.length,1,`owner row count ${i+1}`);assert.equal(x.data[0].is_correct,true)}
 const cross=await sessions[1].client.from('blitz_assignments').select('id').eq('user_id',sessions[0].id);
 if(cross.error)throw cross.error;assert.equal(cross.data.length,0,'RLS exposed another student assignment');
 const forbidden=await sessions[1].client.rpc('blitz_answer',{p_id:opened[0].data.id,p_choice:0});
 assert(forbidden.error,'Cross-user answer unexpectedly succeeded');

 const first=sessions[0];
 r=await admin.from('blitz_assignments').insert([
  {id:'30000000-0000-4000-8000-000000000001',game_id:gameId,user_id:first.id,question_id:31,stage_no:2,available_at:new Date(Date.now()-60000).toISOString()},
  {id:'30000000-0000-4000-8000-000000000002',game_id:gameId,user_id:first.id,question_id:32,stage_no:2,available_at:new Date(Date.now()-30000).toISOString()}
 ]);if(r.error)throw r.error;
 const same=await Promise.all(Array.from({length:5},()=>first.client.rpc('blitz_open',{p_game:gameId})));
 same.forEach(x=>{if(x.error)throw x.error});
 assert.equal(new Set(same.map(x=>x.data.id)).size,1,'Concurrent opens returned different assignments');

 await Promise.all([...channels.map(ch=>ch.unsubscribe()),adminChannel.unsubscribe()]);
 console.log('PASS: 30 Supabase Auth sessions + RPC + RLS/REST + Realtime + same-user open serialization');
}
main().catch(e=>{console.error(e);process.exit(1)});
