'use strict';
// 100 ACTUALLY CONCURRENT local anonymous signups from one host IP.
// No production requests, secrets or users. No fake JWTs or mocked endpoints.
const assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const {createClient}=require('@supabase/supabase-js');
const crypto=require('node:crypto');
const N=100,EXPECTED='11111111-1111-4111-8111-111111111111';
function loopback(raw){
 const u=new URL(raw);
 assert(['127.0.0.1','localhost','[::1]'].includes(u.hostname),'Production URLs forbidden');
 assert(u.protocol==='http:'&&u.username===''&&u.password==='','Local HTTP only');
 return u.origin;
}
function api(origin,key){
 return createClient(origin,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
}
function percentile(ns,p){
 const xs=[...ns].sort((a,b)=>a-b);
 return Math.round(xs[Math.max(0,Math.ceil(xs.length*p)-1)]||0);
}
async function main(){
 assert(process.env.GITHUB_ACTIONS==='true'&&process.env.GOS_ANON_AUTH_QA==='DISPOSABLE-ONLY','Guarded CI only');
 const origin=loopback(process.env.SUPABASE_URL);
 const anon=process.env.SUPABASE_ANON_KEY,serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
 assert(anon&&serviceKey,'Missing LOCAL API credentials');
 const service=api(origin,serviceKey);
 const guard=await service.from('qa_auth_entry_guard').select('marker').single();
 assert(!guard.error&&guard.data?.marker==='DISPOSABLE-LOCAL-100-AUTH-BURST','Not the disposable fixture');
 const check=await service.auth.admin.listUsers({page:1,perPage:1});
 assert(!check.error&&check.data.users.length===0,'Not an empty disposable Auth project');
 const clients=Array.from({length:N},()=>api(origin,anon));
 const started=performance.now();
 const signups=await Promise.all(clients.map(async(client,index)=>{
  const at=performance.now();
  try{
   const r=await client.auth.signInAnonymously({options:{data:{full_name:'Student '+String(index+1)}}});
   return {index,ok:!r.error&&!!r.data.session?.access_token,userId:r.data.user?.id,
    error:r.error?String(r.error.status||r.error.code||r.error.message):'',ms:performance.now()-at,startedAt:at};
  }catch(e){return {index,ok:false,error:String(e.message||e),ms:performance.now()-at,startedAt:at}}
 }));
 const signupMetrics={requests:N,success:signups.filter(x=>x.ok).length,
  p50_ms:percentile(signups.map(x=>x.ms),.5),p95_ms:percentile(signups.map(x=>x.ms),.95),
  p99_ms:percentile(signups.map(x=>x.ms),.99),
  launchSpreadMs:Math.round(Math.max(...signups.map(x=>x.startedAt))-Math.min(...signups.map(x=>x.startedAt)))};
 console.log('AUTH_BURST '+JSON.stringify({...signupMetrics,errors:signups.filter(x=>!x.ok).map(x=>x.error).slice(0,8)}));
 assert.equal(signupMetrics.requests,100);
 assert(signupMetrics.launchSpreadMs<2000,'The requests must start together, not in batches');
 assert.equal(signupMetrics.success,N,'All 100 local Auth signups must succeed without retries');
 assert.equal(new Set(signups.map(x=>x.userId)).size,N,'Every student needs their own Supabase Auth identity');
 const joins=await Promise.all(clients.map(async(client,i)=>{
  const at=performance.now();
  const r=await client.rpc('join_game_as_role',{p_game_code:'CLASSROOM-100',
   p_invite_code:'qa-student-entrance',p_full_name:'Student '+(i+1),
   p_group_name:'Group 1',p_expected_kind:'student'});
  return {ok:!r.error&&r.data===EXPECTED,error:r.error?.message||'',ms:performance.now()-at};
 }));
 const joinMetrics={requests:N,success:joins.filter(x=>x.ok).length,
  p50_ms:percentile(joins.map(x=>x.ms),.5),p95_ms:percentile(joins.map(x=>x.ms),.95),p99_ms:percentile(joins.map(x=>x.ms),.99)};
 console.log('JOIN_BURST '+JSON.stringify({...joinMetrics,errors:joins.filter(x=>!x.ok).map(x=>x.error).slice(0,5)}));
 assert.equal(joinMetrics.success,N,'100 local student join RPC calls must succeed without duplicate accounts');
 const reads=await Promise.all(clients.map(async(client,i)=>{
  const at=performance.now();
  const [good,other]=await Promise.all([
   client.rpc('get_my_game_identity',{p_game:EXPECTED}),
   client.rpc('get_my_game_identity',{p_game:'22222222-2222-4222-8222-222222222222'})
  ]);
  return {ok:!good.error&&good.data?.member?.user_id===signups[i].userId
   &&good.data?.member?.kind==='student'&&!other.error&&other.data?.member===null,
   ms:performance.now()-at,error:good.error?.message||other.error?.message||''};
 }));
 const readMetrics={requests:N*2,success:reads.filter(x=>x.ok).length,
  p50_ms:percentile(reads.map(x=>x.ms),.5),p95_ms:percentile(reads.map(x=>x.ms),.95),p99_ms:percentile(reads.map(x=>x.ms),.99)};
 console.log('IDENTITY_AND_ISOLATION '+JSON.stringify(readMetrics));
 assert.equal(readMetrics.success,N,'All 100 local identities must be correct and isolated from another game');
 const count=await service.from('game_members').select('user_id',{count:'exact',head:true});
 assert(!count.error&&count.count===N,'Exactly 100 membership rows after 100 simultaneous joins');
 const guestTry=await clients[0].rpc('join_game_as_role',{p_game_code:'CLASSROOM-100',
  p_invite_code:'qa-guest-entrance',p_full_name:'Student 1',p_group_name:null,p_expected_kind:'observer'});
 assert(guestTry.error,'A student may not switch their current identity to guest');
 const teacherTry=await clients[0].rpc('join_game_as_role',{p_game_code:'CLASSROOM-100',
  p_invite_code:'qa-student-entrance',p_full_name:'Student 1',p_group_name:null,p_expected_kind:'teacher'});
 assert(teacherTry.error,'An anonymous student cannot become a teacher');
 console.log('PASS '+JSON.stringify({clients:N,mode:'real-local-GoTrue-and-PostgREST',sameIp:true,
  actualProductionLoadTest:false,totalMs:Math.round(performance.now()-started),
  auth:signupMetrics,join:joinMetrics,rls:readMetrics,
  noExtraMembers:true,teacherProtected:true,guestRoleProtected:true,productionRequests:0}));
}
main().catch(e=>{console.error('FAIL '+(e.stack||e));process.exitCode=1});
