'use strict';
// #491: 100 distinct Supabase Auth/JWT clients execute the *unchanged*
// production get_impact_engine_projection RPC using disposable local PostgREST.
// This tests the established 500-entry visibility limit, not complete archival
// playback or 100 human players. Never connect to production.
const assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const {createClient}=require('@supabase/supabase-js');
const GAME='e4c20000-0000-4000-8000-000000000100';
const FOREIGN='e4c20000-0000-4000-8000-000000000200';
const PASS='ImpactProjection-100-QA-Only!';
const make=(url,key)=>createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const batches=async(items,n,fn)=>{const all=[];for(let i=0;i<items.length;i+=n)all.push(...await Promise.all(items.slice(i,i+n).map(fn)));return all;};
const quantiles=(values)=>{const a=[...values].sort((x,y)=>x-y);return{p50_ms:Math.round(a[Math.ceil(.5*a.length)-1]),p95_ms:Math.round(a[Math.ceil(.95*a.length)-1]),p99_ms:Math.round(a[Math.ceil(.99*a.length)-1])};};
const id=i=>'e4c20000-0000-4000-8000-'+String(i).padStart(12,'0');
async function main(){
 assert.equal(process.env.GITHUB_ACTIONS,'true','CI only');
 assert.equal(process.env.GOS_IMPACT_PROJECTION_QA,'LOCAL-100','Explicit opt-in');
 const url=new URL(process.env.SUPABASE_URL||'');
 assert(['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&
   ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&
   !url.search&&!url.hash&&url.pathname==='/', 'Only disposable loopback Supabase');
 const anon=process.env.SUPABASE_ANON_KEY,service=process.env.SUPABASE_SERVICE_ROLE_KEY;
 assert(anon&&service);
 const admin=make(url.origin,service);
 const mark=await admin.from('qa_impact_projection_guard').select('marker').single();
 assert(!mark.error&&mark.data.marker==='gos-id-disposable-impact-projection-100-v1');
 const users=await admin.auth.admin.listUsers({page:1,perPage:1});
 assert(!users.error&&users.data.users.length===0,'Auth database must be empty');
 const games=await admin.from('games').select('id').limit(1);
 assert(!games.error&&games.data.length===0,'Games must be empty');
 function ok(value,context){assert(!value.error,context+': '+value.error?.message);}
 async function createPerson(kind,index){
  const email='impact-'+kind+'-'+index+'@example.invalid';
  const a=await admin.auth.admin.createUser({email,password:PASS,email_confirm:true});
  ok(a,'Create Auth user');
  const client=make(url.origin,anon);
  const login=await client.auth.signInWithPassword({email,password:PASS});
  ok(login,'Auth sign-in');
  assert(login.data.session?.access_token&&login.data.user.id===a.data.user.id);
  return {id:a.data.user.id,kind,email,client};
 }
 const teacher=await createPerson('teacher',0);
 const guest=await createPerson('guest',0);
 const foreign=await createPerson('foreign',0);
 const students=await batches(Array.from({length:100},(_,i)=>i),10,i=>createPerson('student',i));
 assert.equal(new Set(students.map(s=>s.id)).size,100,'100 independent JWT subjects');
 ok(await admin.from('games').insert([
  {id:GAME,title:'Disposable impact QA',game_code:'IQ100',owner_id:teacher.id,status:'running'},
  {id:FOREIGN,title:'Other disposable game',game_code:'IQ200',owner_id:foreign.id,status:'running'}
 ]),'Games');
 ok(await admin.from('game_members').insert([
  {game_id:GAME,user_id:teacher.id,full_name:'Teacher QA',kind:'teacher'},
  {game_id:GAME,user_id:guest.id,full_name:'Guest QA',kind:'guest'},
  {game_id:FOREIGN,user_id:foreign.id,full_name:'Foreign QA',kind:'student'},
  ...students.map((s,i)=>({game_id:GAME,user_id:s.id,full_name:'Student QA '+i,kind:'student'}))
 ]),'Members');
 const rules=Array.from({length:16},(_,i)=>({
   id:id(i+1),game_id:GAME,rule_key:'stage-'+String(i+1).padStart(2,'0'),
   label:'Stage '+(i+1),event_type:'stage',priority:i+1,
   enabled:i%5!==0,auto_apply:true,
   conditions:{stage:i+1},effects:{metrics:{example:i+1}}
 }));
 ok(await admin.from('impact_rules').insert([...rules,{
  id:id(1000),game_id:FOREIGN,rule_key:'foreign-secret',label:'Foreign QA',
  event_type:'stage',effects:{foreign:'not for this game'}
 }]),'Rules');
 const firstTime=Date.parse('2026-10-30T00:00:00.000Z');
 const ledger=students.flatMap((s,i)=>Array.from({length:16},(_,stage)=>({
  game_id:GAME,rule_id:rules[stage].id,rule_key:rules[stage].rule_key,
  source_type:'stage',source_id:'student-'+i+'-stage-'+(stage+1),
  actor_id:s.id,status:'applied',
  created_at:new Date(firstTime+(i*16+stage)*1000).toISOString(),
  effects:{metrics:{example:stage+1}},note:'Local QA record'
 })));
 assert.equal(ledger.length,1600);
 for(let i=0;i<ledger.length;i+=200)ok(await admin.from('impact_ledger').insert(ledger.slice(i,i+200)),'Ledger '+i);
 ok(await admin.from('impact_ledger').insert({
  game_id:FOREIGN,rule_id:id(1000),rule_key:'foreign-secret',
  source_type:'stage',source_id:'secret',actor_id:foreign.id,
  effects:{foreign:'not for this game'},created_at:new Date(firstTime+5000).toISOString()
 }),'Foreign ledger');
 const read=async(person,gameId=GAME)=>{
  const started=performance.now();
  const r=await person.client.rpc('get_impact_engine_projection',{p_game_id:gameId});
  return{...r,elapsed:performance.now()-started,bytes:Buffer.byteLength(JSON.stringify(r.data||{}))};
 };
 const rejected=await Promise.all([
  read(foreign),
  read(teacher,FOREIGN),
  make(url.origin,anon).rpc('get_impact_engine_projection',{p_game_id:GAME})
 ]);
 assert(rejected.every(r=>r.error),'Nonmember, unauthorized foreign-game and anonymous RPC denied');
 const permitted=await Promise.all([read(teacher),read(guest)]);
 for(const r of permitted)assert(!r.error&&r.data.rules.length===16&&r.data.ledger.length===500);
 const before=await Promise.all(students.map(s=>read(s)));
 assert(before.every(r=>!r.error),'All 100 JWT projections succeed');
 for(const [i,r] of before.entries()){
  const data=r.data;
  assert.equal(data.rules.length,16,'All stages available');
  assert.equal(data.ledger.length,500,'Existing bounded projection must remain capped at 500');
  assert.deepEqual(data.rules.map(x=>x.priority),Array.from({length:16},(_,j)=>j+1));
  assert(data.rules.some(x=>x.enabled===false),'Preserve approved rule toggles');
  assert(data.ledger.every(x=>x.game_id===GAME&&!('foreign' in x.effects)),'Game isolation');
  assert.equal(data.ledger[0].source_id,'student-99-stage-16','Newest row must be returned first');
  assert.equal(data.ledger[499].source_id,'student-68-stage-13','Oldest of latest 500');
  if(i%20===0)assert.equal(data.rules[0].conditions.stage,1);
 }
 const [directForeign,studentForeign,guestMember]=await Promise.all([
  foreign.client.from('impact_ledger').select('source_id').eq('game_id',GAME).limit(5),
  students[0].client.from('impact_rules').select('rule_key').eq('game_id',FOREIGN),
  guest.client.from('impact_rules').select('rule_key').eq('game_id',GAME)
 ]);
 assert(!directForeign.error&&directForeign.data.length===0,'Foreign user cannot select another game ledger');
 assert(!studentForeign.error&&studentForeign.data.length===0,'Member cannot select another game rules');
 assert(!guestMember.error&&guestMember.data.length===16,'Guest retains existing read-only member access');
 ok(await admin.from('impact_ledger').insert({
  game_id:GAME,rule_id:rules[0].id,rule_key:rules[0].rule_key,
  source_type:'stage',source_id:'reconnect-confirmed-stage-16',
  actor_id:students[0].id,created_at:'2026-10-30T02:00:00.000Z',
  effects:{metrics:{example:1}},status:'applied'
 }),'Confirmed ledger update');
 for(const p of students.slice(0,50)){
  ok(await p.client.auth.signOut(),'Sign out');
  const l=await p.client.auth.signInWithPassword({email:p.email,password:PASS});
  ok(l,'Sign in after interrupted connection');
 }
 const after=await Promise.all(students.map(s=>read(s)));
 assert(after.every(r=>!r.error&&r.data.ledger.length===500),'Refresh with 100 JWT succeeds');
 assert(after.every(r=>r.data.ledger[0].source_id==='reconnect-confirmed-stage-16'),
   'All 100 clients observe confirmed post-reconnect entry');
 const metrics=[...before,...after];
 console.log(JSON.stringify({
  status:'PASS',
  scope:'Disposable local Supabase Auth/JWT/PostgREST and unchanged production invoker RPC with simplified local membership/RLS',
  students:100,stages:16,preexistingLedgerRows:1600,projectionLedgerLimit:500,
  concurrentReadsFirstWave:100,concurrentReadsAfterWrite:100,reauthenticated:50,
  confirmedPostReconnectVisible:100,crossGameDenied:3,rlsForeignRows:0,
  errors:0,latencyMs:quantiles(metrics.map(m=>m.elapsed)),
  returnedJsonBytes:metrics.reduce((n,m)=>n+m.bytes,0),
  productionRequests:0,
  limitations:'Synthetic JWT clients and local fixture; not 100 human browsers, full lifecycle or live egress. The documented 500 newest ledger limit is preserved.'
 }));
}
main().catch(err=>{console.error('FAIL impact projection 100: '+(err.stack||err));process.exitCode=1;});
