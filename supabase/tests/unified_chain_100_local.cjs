'use strict';
// #491: ONE disposable game + 100 real independently authenticated JWTs
// passing all 16 stage checkpoints. Calls unchanged production RPC functions
// for votes, grade reads, formal/impact projections and stage-document gate.
// IMPORTANT: stage-specific legal mechanics, scores creation and actual stage
// coordinator are represented by a SMALL TEST FIXTURE, not the complete game.
// This is an integrated smoke/load test, not live 100-human E2E acceptance.
const assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const {createClient}=require('@supabase/supabase-js');
const GAME='a7d10000-0000-4000-8000-000000000100';
const FOREIGN='a7d10000-0000-4000-8000-000000000200';
const uuid=n=>'a7d10000-0000-4000-9000-'+String(n).padStart(12,'0');
const PASSWORD='Unified-16-Stage-100-JWT-Isolated!';
const stages=Array.from({length:16},(_,i)=>i+1);
const required={
  2:[['minutes','ksrf','other',{}]],
  3:[['minutes','ksrf','other',{}]],
  4:[['gd_chair_resolution','gd','gd_resolution',{document_kind:'stage4_office_result',source_result_key:'gd_chair'}],
     ['gd_deputies_resolution','gd','gd_resolution',{document_kind:'stage4_office_result',source_result_key:'gd_deputies'}],
     ['gd_committees_resolution','gd','gd_resolution',{document_kind:'stage4_office_result',source_result_key:'gd_committees'}],
     ['minutes','gd','other',{}]],
  5:[['gd_resolution','gd','gd_resolution',{}],['minutes','gd','other',{}]],
  7:[['sf_resolution','sf','sf_resolution',{}]],
  8:[['president_decree','president','president_decree',{}],['gd_resolution','gd','gd_resolution',{}]],
  9:[['president_decree','president','president_decree',{}],['gd_resolution','gd','gd_resolution',{}]],
  10:[['state_program','government','state_program',{}],['financial_economic','government','other',{template_key:'financial_economic'}]],
  11:[['minutes','government','other',{}]],
  14:[['municipal_act','municipality','municipal_act',{}]],
  15:[['crisis_act','general','president_decree',{}]]
};
const make=(url,key)=>createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const batches=async(values,size,fn)=>{const out=[];for(let i=0;i<values.length;i+=size)out.push(...await Promise.all(values.slice(i,i+size).map(fn)));return out};
const pt=(a,p)=>{const x=[...a].sort((a,b)=>a-b);return Math.round(x[Math.ceil(x.length*p)-1])};
const stats=a=>({p50_ms:pt(a,.5),p95_ms:pt(a,.95),p99_ms:pt(a,.99)});
function ok(r,label){assert(!r.error,label+': '+(r.error?.message||''));return r.data}
const jsonBytes=x=>Buffer.byteLength(JSON.stringify(x??[]));
async function main(){
 assert.equal(process.env.GITHUB_ACTIONS,'true');
 assert.equal(process.env.GOS_UNIFIED_QA,'LOCAL-100-16');
 const u=new URL(process.env.SUPABASE_URL||'');
 assert(['localhost','127.0.0.1','[::1]'].includes(u.hostname)&&
 ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!u.hash&&!u.search&&u.pathname==='/');
 const anon=process.env.SUPABASE_ANON_KEY,service=process.env.SUPABASE_SERVICE_ROLE_KEY;
 assert(anon&&service,'Local Supabase keys required');
 const admin=make(u.origin,service);
 const marker=ok(await admin.from('qa_unified_chain_guard').select('marker').single(),'Disposable marker');
 assert.equal(marker.marker,'gos-id-disposable-100x16-jwt-chain-20261030');
 const [authEmpty,gamesEmpty]=await Promise.all([
  admin.auth.admin.listUsers({page:1,perPage:1}),
  admin.from('games').select('id').limit(1)
 ]);
 assert(!authEmpty.error&&authEmpty.data.users.length===0&&
   !gamesEmpty.error&&gamesEmpty.data.length===0,'Refuse nonempty database');
 let requests=0,rpcBytes=0;
 async function who(role,i){
  const email='unified-'+role+'-'+i+'@example.invalid';
  const a=await admin.auth.admin.createUser({email,password:PASSWORD,email_confirm:true});
  ok(a,'Auth create '+role);
  const client=make(u.origin,anon),login=await client.auth.signInWithPassword({email,password:PASSWORD});
  ok(login,'Auth login '+role);
  assert(login.data.session?.access_token&&login.data.user?.id===a.data.user.id);
  return {id:a.data.user.id,email,client,role};
 }
 const teacher=await who('teacher',0),guest=await who('guest',0),outsider=await who('outsider',0);
 const people=await batches(Array.from({length:100},(_,i)=>i),10,i=>who('student',i));
 assert.equal(new Set(people.map(p=>p.id)).size,100);
 ok(await admin.from('games').insert([
  {id:GAME,title:'Disposable 100×16 chain QA',game_code:'CQA100',owner_id:teacher.id},
  {id:FOREIGN,title:'Foreign disposable game',game_code:'CQA200',owner_id:outsider.id}
 ]),'Games');
 // The teacher owns the pre-existing test game (its creation is a fixture).
 // Students and the observer join with the ORIGINAL production join_game_as_role
 // function, using individual Auth/JWT sessions and hashed local invites.
 ok(await admin.from('game_members').insert([
  {game_id:GAME,user_id:teacher.id,kind:'teacher',role_title:'Преподаватель',full_name:'Local QA Teacher'},
  {game_id:FOREIGN,user_id:outsider.id,kind:'student',role_title:'Student',full_name:'Foreign only'}
 ]),'Teacher and foreign fixture membership');
 ok(await admin.from('teacher_profiles').insert({user_id:teacher.id}),'Teacher profile fixture');
 ok(await admin.rpc('qa_unified_seed_invitations',{p_game_id:GAME}),'Disposable invitation seed');
 const joinedMs=[];
 const join=async(p,kind,code,group)=>{
  const start=performance.now();
  const r=await p.client.rpc('join_game_as_role',{
   p_game_code:'CQA100',p_invite_code:code,
   p_full_name:'Local QA '+p.role+' '+p.id.slice(0,8),
   p_group_name:group,p_expected_kind:kind
  });
  joinedMs.push(performance.now()-start);
  assert(!r.error&&r.data===GAME,'Original production role-join must return game ID: '+r.error?.message);
  return r.data;
 };
 const enrollments=await batches(people,10,p=>join(p,'student','STD-LOCAL-100','ГМУ-100'));
 assert.equal(enrollments.length,100,'100 student joins completed');
 await join(guest,'observer','GST-LOCAL-100',null);
 const [wrongStudentCode,crossRole,teacherToStudent,guestToStudent,anonymousJoin]=await Promise.all([
  people[1].client.rpc('join_game_as_role',{p_game_code:'CQA100',
   p_invite_code:'TCH-LOCAL-100',p_full_name:'Local QA Student',
   p_group_name:'ГМУ-100',p_expected_kind:'student'}),
  people[0].client.rpc('join_game_as_role',{p_game_code:'CQA100',
   p_invite_code:'TCH-LOCAL-100',p_full_name:'Local QA Student',
   p_group_name:null,p_expected_kind:'teacher'}),
  teacher.client.rpc('join_game_as_role',{p_game_code:'CQA100',
   p_invite_code:'STD-LOCAL-100',p_full_name:'Local QA Teacher',
   p_group_name:'ГМУ-100',p_expected_kind:'student'}),
  guest.client.rpc('join_game_as_role',{p_game_code:'CQA100',
   p_invite_code:'STD-LOCAL-100',p_full_name:'Local QA Observer',
   p_group_name:'ГМУ-100',p_expected_kind:'student'}),
  make(u.origin,anon).rpc('join_game_as_role',{p_game_code:'CQA100',
   p_invite_code:'STD-LOCAL-100',p_full_name:'Unauthenticated QA',
   p_group_name:'ГМУ-100',p_expected_kind:'student'})
 ]);
 assert([wrongStudentCode,crossRole,teacherToStudent,guestToStudent,anonymousJoin]
  .every(x=>!!x.error),'Wrong invitation, role crossover and unauthenticated entry must be rejected');
 const joined=ok(await admin.from('game_members').select('user_id,kind,group_name')
  .eq('game_id',GAME),'Verify memberships after rejected crossovers');
 assert.equal(joined.length,102,'Exactly 100 students, one teacher and one observer');
 assert.equal(joined.filter(m=>m.kind==='student').length,100);
 assert.equal(joined.filter(m=>m.kind==='teacher').length,1);
 assert.equal(joined.filter(m=>m.kind==='observer').length,1);
 assert(joined.filter(m=>m.kind==='student').every(m=>m.group_name==='ГМУ-100'));
 const audits=await admin.from('audit_log').select('id',{count:'exact',head:true}).eq('game_id',GAME).eq('action','member_joined');
 ok(audits,'Audit enrollment count');
 assert.equal(audits.count,101,'Only successful join RPCs must create audit entries');
 ok(await admin.from('game_stages').insert(stages.map(stage_no=>({game_id:GAME,stage_no,status:'open'}))),'16 stages');
 ok(await admin.from('state_metrics').insert({game_id:GAME,metric_key:'economy',value:20,min_value:0,max_value:100}),'Start economy');
 ok(await admin.from('impact_rules').insert(stages.map(s=>({
  id:uuid(s),game_id:GAME,rule_key:'stage-qa-'+s,label:'Isolated verification stage '+s,
  event_type:'stage',priority:s,effects:{metrics:{economy:1}},conditions:{stage_no:s}
 }))),'16 defined effect rules');
 const memberships=people.flatMap(p=>stages.map(stage_no=>({game_id:GAME,user_id:p.id,stage_no,institution_key:'gd'})));
 for(let i=0;i<memberships.length;i+=200)
  ok(await admin.from('institution_session_registrations').insert(memberships.slice(i,i+200)),'Electorate registrations');
 const weights=Object.fromEntries(people.map(p=>[p.id,1]));
 const forbidden=await Promise.all([
  outsider.client.rpc('get_public_stage_scores',{p_game_id:GAME}),
  guest.client.rpc('qa_apply_effect',{p_game:GAME,p_stage:1}),
  guest.client.from('game_stages').update({status:'completed'}).eq('game_id',GAME).eq('stage_no',1).select('stage_no'),
  make(u.origin,anon).rpc('get_formal_registry_projection',{p_game_id:GAME,p_document_ids:null}),
  people[0].client.from('game_ballots').select('vote_id').limit(1)
 ]);
 assert(forbidden[0].error&&forbidden[1].error&&
  !forbidden[2].error&&forbidden[2].data.length===0&&
  forbidden[3].error&&forbidden[4].error,'Server must deny outsider, guest, anon and direct ballot read');
 const memberStage=await people[0].client.from('game_stages').select('status').eq('game_id',GAME).eq('stage_no',1).single();
 assert(!memberStage.error&&memberStage.data.status==='open','Forbidden update did not alter stage');
 // #491: 100 distinct student JWTs must not acquire teacher write rights
 // under concurrent requests, nor read a second game's stage rows.
 // The local table has a deliberately simplified RLS policy; this verifies
 // that policy, not all production permissions.
 const deniedWriteMs=[],foreignReadMs=[];
 const rejected=await Promise.all(people.map(async p=>{
  const started=performance.now();
  const update=await p.client.from('game_stages').update({status:'completed'})
   .eq('game_id',GAME).eq('stage_no',1).select('stage_no,status');
  deniedWriteMs.push(performance.now()-started);
  const next=performance.now();
  const foreign=await p.client.from('game_stages').select('stage_no,status')
   .eq('game_id',FOREIGN);
  foreignReadMs.push(performance.now()-next);
  return {update,foreign};
 }));
 assert.equal(rejected.length,100);
 assert(rejected.every(x=>!x.update.error&&Array.isArray(x.update.data)&&x.update.data.length===0),
  '100 student JWTs must modify zero stage rows without server errors');
 assert(rejected.every(x=>!x.foreign.error&&Array.isArray(x.foreign.data)&&x.foreign.data.length===0),
  '100 student JWTs must see zero stages from a foreign game without server errors');
 const afterDenied=ok(await teacher.client.from('game_stages').select('stage_no,status')
  .eq('game_id',GAME),'Check stage integrity after 100 denied writes');
 assert.equal(afterDenied.length,16);
 assert(afterDenied.every(s=>s.status==='open'),
  'All 16 stage states must remain intact after simultaneous unauthorized writes');
 const durations=[],duplicates=[],stageReads=[],blocked=[],totals=[];
 for(const stage of stages){
  const initial=performance.now();
  const stageDocs=required[stage]||[];
  if(stageDocs.length){
   const attempt=await teacher.client.from('game_stages').update({status:'completed'})
     .eq('game_id',GAME).eq('stage_no',stage).select('status');
   assert(attempt.error,'Production document gate must reject unprepared stage '+stage);
   blocked.push(stage);
  }
  // Fixture only: publish the official paperwork required by production policy.
  const entries=(stageDocs.length?stageDocs:[['general','general','other',{}]]).map(([key,subject,kind,extra],j)=>{
   const meta={...extra,...(key==='minutes'?{template_key:'minutes'}:{}),
      ...(key==='financial_economic'?{template_key:'financial_economic'}:{})};
   return {id:uuid(stage*100+j+1000),game_id:GAME,stage_no:stage,
    registry_no:'QA-'+stage+'-'+j,title:key==='minutes'?'Протокол заседания QA':('QA '+key),
    doc_type:kind,subject_key:subject,author_id:teacher.id,body_text:'Only isolated synthetic documents',
    metadata:meta,status_code:stage===10?'draft':'published'};
  });
  ok(await admin.from('formal_documents').insert(entries),'Official documents stage '+stage);
  ok(await admin.from('formal_document_history').insert(entries.map(d=>({
   document_id:d.id,game_id:GAME,actor_id:teacher.id,action:'created',note:'Local 100x16 stage',
   created_at:'2026-10-30T00:'+String(stage).padStart(2,'0')+':00Z'
  }))),'Document history stage '+stage);
  const vid=uuid(2000+stage);
  ok(await admin.from('game_votes').insert({
   id:vid,game_id:GAME,status:'open',procedure_key:'ordinary',
   voting_mode:'individual',allow_abstain:true,institution_key:'gd',stage_no:stage,
   quorum_kind:'none',quorum_value:0,majority_kind:'simple',majority_value:0,
   tie_breaker_chair:false,electorate_snapshot:{attendance_required:true,weights}
  }),'Live vote stage '+stage);
  const cast=async(p)=>{const t=performance.now();const reply=await p.client.rpc('cast_vote_allocation',
   {p_vote_id:vid,p_yes:1,p_no:0,p_abstain:0});requests++;rpcBytes+=jsonBytes(reply.data);
   return {...reply,ms:performance.now()-t};};
  // Same JWT submits duplicates before the remaining 99 ballots finish.
  if(stage===4||stage===16){
   const re=await Promise.all(Array.from({length:25},()=>cast(people[0])));
   assert(re.every(x=>!x.error),'Concurrent duplicate retries must be harmless at stage '+stage);
   duplicates.push(stage);
  }
  const ballots=await Promise.all(people.map(p=>cast(p)));
  assert(ballots.every(x=>!x.error),'100 JWT votes, stage '+stage+': '+
    JSON.stringify(ballots.filter(x=>x.error).slice(0,2).map(x=>x.error.message)));
  durations.push(...ballots.map(x=>x.ms));
  const [vote,stored]=await Promise.all([
   admin.from('game_votes').select('status,result_yes,result_cast').eq('id',vid).single(),
   admin.from('game_ballots').select('voter_id').eq('vote_id',vid)
  ]);
  ok(vote,'Vote tally '+stage);ok(stored,'Vote storage '+stage);
  assert.equal(vote.data.status,'closed','All voters auto-close stage '+stage);
  assert.equal(Number(vote.data.result_yes),100);
  assert.equal(Number(vote.data.result_cast),100);
  assert.equal(stored.data.length,100);
  assert.equal(new Set(stored.data.map(v=>v.voter_id)).size,100);
  const complete=await teacher.client.from('game_stages').update({status:'completed'})
   .eq('game_id',GAME).eq('stage_no',stage).select('stage_no,status');
  ok(complete,'Teacher JWT stage '+stage);
  assert.equal(complete.data.length,1);
  assert.equal(complete.data[0].status,'completed');
  const applied=await teacher.client.rpc('qa_apply_effect',{p_game:GAME,p_stage:stage});
  ok(applied,'Original automatic impact code '+stage);
  assert.equal(applied.data,true,'One initial effect '+stage);
  if(stage===4||stage===16){
   const repeat=await Promise.all(Array.from({length:25},()=>teacher.client.rpc('qa_apply_effect',
      {p_game:GAME,p_stage:stage})));
   assert(repeat.every(x=>!x.error&&x.data===false),'No reapplication at stage '+stage);
  }
  const scores=people.map((p,i)=>({
   game_id:GAME,user_id:p.id,stage_no:stage,
   auto_score:(i+stage)%4,final_score:(i+stage)%3,status:'final',
   evidence_summary:{restricted:'QA'},rationale:'Teacher synthetic fixture'
  }));
  ok(await admin.from('stage_assessments').insert(scores),'100 synthetic score records stage '+stage);
  const s=await people[stage%100].client.from('game_stages').select('status')
    .eq('game_id',GAME).eq('stage_no',stage).single();
  ok(s,'Stage synced '+stage);
  assert.equal(s.data.status,'completed');
  stageReads.push(performance.now()-initial);
  totals.push({stage,ballots:stored.data.length,documents:entries.length,elapsed_ms:Math.round(performance.now()-initial)});
 }
 // One restricted fixture document, to exercise role isolation after 16 stages.
 ok(await admin.from('formal_documents').insert({
  id:uuid(9999),game_id:GAME,stage_no:12,registry_no:'QA-PRIVATE',
  title:'Private QA',doc_type:'justice_response',subject_key:'justice',
  author_id:people[0].id,body_text:'Private synthetic record',status_code:'draft'
 }),'Restricted document fixture');
 const read=async p=>{
  const start=performance.now();
  // 100 users remain active; cap each user's simultaneous read fan-out at 1.
  // The unrestricted 5×100 burst exhausted disposable local PostgREST
  // connections in CI; do NOT hide that finding or reduce the user count.
  const g0=await p.client.rpc('get_public_stage_scores',{p_game_id:GAME}).range(0,999);
  const g1=await p.client.rpc('get_public_stage_scores',{p_game_id:GAME}).range(1000,1999);
  const docs=await p.client.rpc('get_formal_registry_projection',{p_game_id:GAME,p_document_ids:null});
  const impact=await p.client.rpc('get_impact_engine_projection',{p_game_id:GAME});
  const st=await p.client.from('game_stages').select('stage_no,status').eq('game_id',GAME);
  requests+=5;
  const data=[g0,g1,docs,impact,st];
  assert(data.every(x=>!x.error),'All five real authenticated reads for '+p.id+': '+
   JSON.stringify(data.filter(x=>x.error).map(x=>x.error.message)));
  rpcBytes+=data.reduce((n,x)=>n+jsonBytes(x.data),0);
  assert.equal(g0.data.length+g1.data.length,1600,'All 100×16 scores visible');
  const perStudent=new Map();
  for(const record of [...g0.data,...g1.data]){
   assert.equal(record.status,'final','Score row must be final');
   const numbers=perStudent.get(record.user_id)||new Set();
   assert(!numbers.has(record.stage_no),'Duplicate stage score for '+record.user_id);
   numbers.add(record.stage_no);
   perStudent.set(record.user_id,numbers);
  }
  assert.equal(perStudent.size,100,'Final stage results must cover 100 distinct participants');
  assert(people.every(student=>perStudent.get(student.id)?.size===16),
   'Each registered participant must have exactly 16 final stage results');
  assert.equal(impact.data.rules.length,16);
  assert.equal(impact.data.ledger.length,16);
  assert.equal(st.data.length,16);
  assert(st.data.every(x=>x.status==='completed'),'All 16 teacher confirmations persist');
  assert(docs.data.documents.some(x=>x.stage_no===16));
  assert(docs.data.history.length>=16);
  assert(!g0.data.some(x=>'evidence_summary' in x||'rationale' in x));
  assert(docs.data.documents.every(x=>x.game_id===GAME));
  assert.equal(docs.data.documents.some(x=>x.doc_type==='justice_response'),p.id===people[0].id);
  return {ms:performance.now()-start,latest:impact.data.ledger.length,docCount:docs.data.documents.length};
 };
 const first=await Promise.all(people.map(read));
 for(const p of people.slice(0,50)){
  ok(await p.client.auth.signOut(),'Disconnect');
  const l=await p.client.auth.signInWithPassword({email:p.email,password:PASSWORD});
  ok(l,'Reconnect JWT');
 }
 const second=await Promise.all(people.map(read));
 const cross=await Promise.all([
  outsider.client.rpc('get_impact_engine_projection',{p_game_id:GAME}),
  outsider.client.rpc('get_formal_registry_projection',{p_game_id:GAME,p_document_ids:null}),
  outsider.client.rpc('get_public_stage_scores',{p_game_id:GAME}),
  people[0].client.rpc('qa_apply_effect',{p_game:GAME,p_stage:16}),
  guest.client.from('stage_assessments').select('rationale').limit(1)
 ]);
 assert(cross.slice(0,4).every(x=>x.error));
 assert(!cross[4].error&&cross[4].data.length===0);
 const metric=ok(await admin.from('state_metrics').select('value').eq('game_id',GAME)
   .eq('metric_key','economy').single(),'Economy final');
 assert.equal(Number(metric.value),36,'Exactly 16 effects applied from 20 baseline');
 const ledger=ok(await admin.from('impact_ledger').select('rule_key').eq('game_id',GAME),'Impact ledger');
 assert.equal(ledger.length,16);
 // Exact count avoids PostgREST's 1000-row response cap; each stage was
 // independently checked for 100 unique voters before its transition.
 const ballotTotal=await admin.from('game_ballots').select('vote_id',{count:'exact',head:true});
 ok(ballotTotal,'Count all ballots without transferring 1600 rows');
 assert.equal(ballotTotal.count,1600,'16 × 100 unique votes, no losses');
 console.log(JSON.stringify({
  status:'PASS',
  scope:'ONE disposable local Supabase game; real Auth/JWT, PostgREST, production vote/close and grade/formal/impact read RPCs, stage doc guard and automatic-effect function bodies; simplified fixtures for stage-specific mechanics, document creation, grading and other readiness checks. Not full-game E2E.',
  independentJWTs:100,stages:16,ballots:1600,duplicatesRetried:50,
  joinedViaOriginalProductionRoleRpc:100,observerJoinedViaOriginalProductionRoleRpc:1,
  negativeJoinAttemptsDenied:5,enrollmentLatencyMs:stats(joinedMs),
  teacherGameCreation:'fixture only, not original owner creation RPC',
  studentIdentityProvisioning:'admin-created confirmed accounts, not browser anonymous sign-in',
  teacherStageTransitions:16,officialDocuments:totals.reduce((n,x)=>n+x.documents,0),
  gradeRows:1600,impactRows:16,finalEconomy:36,
  parallelFinalReads:200,reauthenticated:50,crossGameOrRoleDenials:5,
  concurrentStudentStageWriteDenials:100,foreignGameStageReadDenials:100,
  denialLatencyMs:stats(deniedWriteMs),foreignGameReadLatencyMs:stats(foreignReadMs),
  latencyVotesMs:stats(durations),latencyStageChainsMs:stats(stageReads),
  latencyFinalReadMs:stats([...first,...second].map(x=>x.ms)),
  measuredJsonBytes:rpcBytes,httpRpcCalls:requests,maxPerUserConcurrentFinalReads:1,
  errors:0,productionRequests:0,
  limitations:'100 synthetic Auth/JWT clients, not real people. Original production join_game_as_role is exercised, but accounts and game owner are seeded by admin fixtures; role/RLS schema is reduced. Stage coordinator, document creation, grade contents and non-document conditions remain fixtures. No full browser UX, live egress, or 16 actual legal stage workflows'
 }));
}
main().catch(e=>{console.error('FAIL unified 100×16: '+(e.stack||e));process.exitCode=1});
