'use strict';
/* Synthetic RLS/Realtime contract; never use an existing or forwarded Supabase. */
const assert=require('node:assert/strict');
function localOrigin(value){
 const url=new URL(value);
 assert(['127.0.0.1','localhost'].includes(url.hostname),'Disposable local origin required');
 assert(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/','Use a bare local origin');
 return url.origin;
}
function assertDisposable(env){
 assert(env.GITHUB_ACTIONS==='true'&&env.GOS_NEWS_DISPOSABLE==='YES','Disposable GitHub Actions environment required');
 return localOrigin(env.SUPABASE_URL||'');
}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(test,label){const until=Date.now()+20000;while(Date.now()<until){if(test())return;await delay(50)}throw Error('Timed out waiting for '+label)}
async function main(){
 const url=assertDisposable(process.env),anon=process.env.SUPABASE_ANON_KEY,service=process.env.SUPABASE_SERVICE_ROLE_KEY;
 assert(anon&&service,'Ephemeral local keys are required');
 const {createClient}=require('@supabase/supabase-js');
 const opts={auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.any([...(init?.signal?[init.signal]:[]),AbortSignal.timeout(15000)])})}};
 const admin=createClient(url,service,opts),sessions=[];
 const marker=await admin.from('qa_news_disposable_guard').select('marker').eq('marker','gos-id-disposable-news-v1').maybeSingle();
 assert(!marker.error&&marker.data,'Disposable fixture marker missing');
 const existing=await admin.auth.admin.listUsers({page:1,perPage:1});
 assert(!existing.error&&existing.data.users.length===0,'Disposable Auth must be empty');
 const game='11111111-1111-4111-8111-111111111111',otherGame='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333';
 const password='Disposable-news-QA-2026!';
 let failed=false;
 try{
  for(const role of ['author','teacher','other','outside']){
   const email=`news-qa-${role}@example.invalid`;
   const user=await admin.auth.admin.createUser({email,password,email_confirm:true});if(user.error)throw user.error;
   const client=createClient(url,anon,opts),session={role,userId:user.data.user.id,client,events:[]};sessions.push(session);
   const auth=await client.auth.signInWithPassword({email,password});if(auth.error)throw auth.error;
   assert.equal(auth.data.user.id,session.userId);await client.realtime.setAuth(auth.data.session.access_token);
  }
  const members=sessions.map(s=>({game_id:s.role==='outside'?otherGame:game,user_id:s.userId,kind:s.role==='teacher'?'teacher':'student'}));
  const seed=await admin.from('qa_news_members').insert(members);if(seed.error)throw seed.error;
  async function subscribe(session){
   const channel=session.client.channel('news-qa-'+session.role+'-'+Date.now()).on('postgres_changes',{event:'*',schema:'public',table:'media_news_proposals',filter:'game_id=eq.'+game},payload=>session.events.push(payload.eventType));
   session.channel=channel;
   await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Subscription timeout')),20000);channel.subscribe(status=>{if(status==='SUBSCRIBED'){clearTimeout(timer);resolve()}else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'){clearTimeout(timer);reject(Error('Realtime '+status))}})});
  }
  for(const session of sessions)await subscribe(session);
  const [author,teacher,other,outside]=sessions;
  async function write(patch){const result=await admin.from('media_news_proposals').update(patch).eq('id',id);if(result.error)throw result.error}
  async function verifyDelivery(expected){
   await waitFor(()=>author.events.length>=expected&&teacher.events.length>=expected,'authorized events');
   await delay(2000);
   assert.equal(author.events.length,expected);assert.equal(teacher.events.length,expected);
   assert.equal(other.events.length,0,'Another member received a private proposal');assert.equal(outside.events.length,0,'A member of another game received a private proposal');
  }
  const created=await admin.from('media_news_proposals').insert({id,game_id:game,author_id:author.userId,status:'pending',title:'Synthetic QA'});if(created.error)throw created.error;
  await verifyDelivery(1);assert.deepEqual(author.events,['INSERT']);assert.deepEqual(teacher.events,['INSERT']);
  await write({status:'rejected'});await verifyDelivery(2);assert.equal(author.events[1],'UPDATE');assert.equal(teacher.events[1],'UPDATE');
  assert.equal(await author.client.removeChannel(author.channel),'ok','Author subscription did not close');author.channel=null;
  await author.client.realtime.disconnect();
  await write({status:'pending'});await waitFor(()=>teacher.events.length===3,'teacher update while author disconnected');await delay(2000);assert.equal(author.events.length,2,'Disconnected subscription still received an event');
  author.client.realtime.connect();await subscribe(author);
  const snapshot=await author.client.from('media_news_proposals').select('status').eq('id',id).single();if(snapshot.error)throw snapshot.error;assert.equal(snapshot.data.status,'pending','Reconnected author must reconcile missed update');
  await write({status:'approved'});await waitFor(()=>author.events.length===3&&teacher.events.length===4,'delivery after reconnect');await delay(2000);assert.equal(other.events.length,0);assert.equal(outside.events.length,0);
  console.log('PASS: four local Auth sessions with synthetic membership/RLS helpers received INSERT/UPDATE at the author and teacher. No unauthorized event observed during the two-second window after each expected delivery. A missed update was recovered by a read. Not a load test or application reconnect test.');
 }catch(error){failed=true;throw error}finally{
  const cleanup=await Promise.allSettled(sessions.map(async s=>{const statuses=await s.client.removeAllChannels();await s.client.auth.signOut({scope:'local'});assert(statuses.every(status=>status==='ok'),'Realtime cleanup failed')}));
  if(cleanup.some(result=>result.status==='rejected')){if(!failed)throw Error('Disposable-session cleanup did not fully succeed');console.error('Disposable-session cleanup did not fully succeed')}
 }
}
module.exports={localOrigin,assertDisposable};
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1});
