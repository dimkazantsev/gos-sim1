'use strict';
/* Real local-only Auth / private Realtime integration. Never connect to production.
 * 100 independently authenticated student JWTs plus teacher, guest, outsider.
 * Production Broadcast/Presence policies and trigger are loaded by workflow.
 * The membership helper is a deliberately simplified disposable SQL fixture.
 */
const assert=require('node:assert/strict');
const {createClient}=require('@supabase/supabase-js');
const api=process.env.SUPABASE_URL||'';
function localOnly(value){
 const url=new URL(value);
 assert(['localhost','127.0.0.1','[::1]'].includes(url.hostname),'Private Realtime QA requires local Supabase only');
 assert(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/','Only a bare local Supabase origin is allowed');
 return url.origin;
}
const url=localOnly(api);
const anon=process.env.SUPABASE_ANON_KEY,service=process.env.SUPABASE_SERVICE_ROLE_KEY;
assert(anon&&service&&process.env.GOS_PRIVATE_QA==='LOCAL-100','Local ephemeral credentials and explicit QA guard required');
const password='Gos-Private-QA-only-2026!';
const gameId='a7b00000-0000-4000-8000-000000000100';
const otherGameId='a7b00000-0000-4000-8000-000000000200';
const topic='gos-id-live:'+gameId;
const sleep=ms=>new Promise(ok=>setTimeout(ok,ms));
const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
let studentClients=[],allClients=[];
const percentiles=values=>{
 const s=[...values].sort((a,b)=>a-b);
 const pct=p=>Math.round(s[Math.max(0,Math.ceil(s.length*p)-1)]);
 return{p50_ms:pct(.50),p95_ms:pct(.95),p99_ms:pct(.99)};
};
async function batch(items,n,fn){
 const output=[];
 for(let i=0;i<items.length;i+=n)output.push(...await Promise.all(items.slice(i,i+n).map(fn)));
 return output;
}
async function preflight(){
 const mark=await admin.from('qa_blitz_disposable_guard').select('marker').eq('marker','gos-id-disposable-blitz-v1').maybeSingle();
 assert(!mark.error&&mark.data?.marker==='gos-id-disposable-blitz-v1','Disposable QA guard missing');
 const users=await admin.auth.admin.listUsers({page:1,perPage:1});
 assert(!users.error&&users.data.users.length===0,'QA Auth database must be empty');
 const games=await admin.from('games').select('id').limit(1);
 assert(!games.error&&games.data?.length===0,'QA game database must be empty');
}
async function createPerson(i,kind){
 const email='gos-private-'+kind+'-'+i+'@example.invalid';
 const r=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{local_qa:true}});
 if(r.error)throw Error('QA create '+kind+'/'+i+': '+r.error.message);
 return {email,kind,id:r.data.user.id};
}
async function login(person){
 const client=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
 const s=await client.auth.signInWithPassword({email:person.email,password});
 if(s.error||s.data.user.id!==person.id||!s.data.session?.access_token)throw Error('QA JWT login failed for '+person.kind);
 await client.realtime.setAuth(s.data.session.access_token);
 const item={person,client,channel:null,received:0};
 allClients.push(item);
 return item;
}
async function subscribe(item,target=topic,shouldAllow=true){
 const start=performance.now();
 const channel=item.client.channel(target,{config:{private:true,presence:{key:item.person.id},broadcast:{ack:true}}});
 const expected=target===topic;
 channel.on('broadcast',{event:'party_documents_changed'},msg=>{
  if(expected&&msg?.payload?.table==='party_documents')item.received++;
 });
 item.channel=channel;
 const result=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Subscription timeout for '+item.person.kind)),18000);
  channel.subscribe((status,error)=>{
   if(status==='SUBSCRIBED'||status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED'){
    clearTimeout(timer);resolve({status,error});
   }
  });
 });
 if(shouldAllow)assert.equal(result.status,'SUBSCRIBED','Authorised '+item.person.kind+' must join private game channel: '+String(result.error?.message||result.status));
 else assert.notEqual(result.status,'SUBSCRIBED','Foreign or anonymous account joined private game channel');
 return{status:result.status,latency:performance.now()-start};
}
async function waitForAll(items,count){
 const deadline=Date.now()+14000;
 while(Date.now()<deadline){
  if(items.every(c=>c.received>=count))return;
  await sleep(100);
 }
 const missing=items.filter(c=>c.received<count).length;
 throw Error('Production party-documents Broadcast missing on '+missing+'/'+items.length+' authorised private channels');
}
async function main(){
 await preflight();
 const students=await batch(Array.from({length:100},(_,i)=>i+1),10,i=>createPerson(i,'student'));
 const [teacher,guest,outsider]=await batch(['teacher','guest','outsider'],3,kind=>createPerson(0,kind));
 let r=await admin.from('games').insert([
  {id:gameId,title:'LOCAL QA · private game 100',game_code:'QA100PRIVATE',owner_id:teacher.id},
  {id:otherGameId,title:'LOCAL QA · other game',game_code:'QA100OTHER',owner_id:outsider.id}
 ]);
 if(r.error)throw r.error;
 r=await admin.from('game_members').insert([
  ...students.map((p,i)=>({game_id:gameId,user_id:p.id,full_name:'QA Student '+(i+1),kind:'student'})),
  {game_id:gameId,user_id:teacher.id,full_name:'QA Teacher',kind:'teacher'},
  {game_id:gameId,user_id:guest.id,full_name:'QA Guest',kind:'guest'},
  {game_id:otherGameId,user_id:outsider.id,full_name:'QA Outsider',kind:'student'}
 ]);
 if(r.error)throw r.error;
 const people=[...students,teacher,guest,outsider];
 const logged=await batch(people,10,login);
 studentClients=logged.slice(0,100);
 const authorised=logged.slice(0,102),foreign=logged[102];
 const joins=await batch(authorised,10,item=>subscribe(item));
 assert(joins.length===102);
 const rejected=await subscribe(foreign,topic,false);
 const anonClient=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
 const unauth={person:{id:'anonymous',kind:'anonymous'},client:anonClient,channel:null,received:0};
 allClients.push(unauth);
 const anonDenied=await subscribe(unauth,topic,false);
 const tracks=await batch(authorised,10,item=>item.channel.track({connected:true}));
 assert(tracks.every(status=>status==='ok'),'All 100 players, teacher and guest must track private Presence');
 // Original production trigger emits only a minimal, table-scoped payload.
 r=await admin.from('party_documents').insert({game_id:gameId,status:'submitted'});
 if(r.error)throw Error('Authorised local document notification failed: '+r.error.message);
 await waitForAll(authorised,1);
 assert.equal(foreign.received,0);
 // Request an explicit server ACK; otherwise the client may optimistically
 // report "ok" without checking the INSERT policy.
 const deniedBroadcast=await studentClients[0].channel.send({
  type:'broadcast',event:'qa_client_not_authorised',payload:{table:'none'}
 });
 assert.notEqual(deniedBroadcast,'ok','A student must not gain server-only Broadcast publishing rights');
 console.log(JSON.stringify({
  status:'PASS',environment:'disposable local Supabase with real Auth and Realtime',
  students:100,teacher:1,guest:1,foreign_denied:rejected.status,
  anonymous_denied:anonDenied.status,authorized_subscriptions:joins.length,
  tracked_presence:tracks.length,private_document_broadcast_receipts:authorised.reduce((n,x)=>n+x.received,0),
  student_client_broadcast_denied:deniedBroadcast,subscription_latency:percentiles(joins.map(x=>x.latency)),
  scope:'Original private Broadcast/Presence RLS policies and document trigger with simplified local membership function; not a full-game production load test'
 }));
}
main().catch(err=>{console.error('FAIL private local Realtime: '+(err?.stack||err));process.exitCode=1}).finally(async()=>{
 const results=await Promise.allSettled(allClients.map(async s=>{
  if(s.channel)await s.client.removeAllChannels();
  if(s.person.id!=='anonymous')await s.client.auth.signOut({scope:'local'});
 }));
 const failures=results.filter(x=>x.status==='rejected');
 if(failures.length){console.error('WARN cleanup failed on '+failures.length+' local clients');process.exitCode=1}
});
