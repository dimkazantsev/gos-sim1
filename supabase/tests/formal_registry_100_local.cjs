'use strict';
// Issue #491: 100 independent Auth/JWT -> real local PostgREST -> production
// SECURITY INVOKER get_formal_registry_projection, with reduced RLS fixture.
// Never connect to production. This is not full 16-stage gameplay.
const assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const {createClient}=require('@supabase/supabase-js');
const GAME='e3c10000-0000-4000-8000-000000000100';
const OTHER='e3c10000-0000-4000-8000-000000000200';
const DOC=i=>'e3c10000-0000-4000-9000-'+String(i).padStart(12,'0');
const MARKER='gos-id-disposable-formal-registry-100-v1';
const PASSWORD='Local-Formal-JWT-100-Only-2026!';
const WIDTH=10;
const percentiles=values=>{
  const v=values.slice().sort((a,b)=>a-b),p=n=>Math.round(v[Math.max(0,Math.ceil(v.length*n)-1)]);
  return{p50_ms:p(.5),p95_ms:p(.95),p99_ms:p(.99)};
};
function localOnly(raw){
  const u=new URL(raw);
  assert(['localhost','127.0.0.1','[::1]'].includes(u.hostname),'This integration test accepts only loopback Supabase');
  assert(['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/','Unexpected API URL');
  return u.origin;
}
const client=(url,key)=>createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
async function batched(items,fn){
  const output=[];
  for(let i=0;i<items.length;i+=WIDTH)output.push(...await Promise.all(items.slice(i,i+WIDTH).map(fn)));
  return output;
}
async function main(){
  assert.equal(process.env.GITHUB_ACTIONS,'true','CI-only: never run outside disposable GitHub Actions');
  assert.equal(process.env.GOS_FORMAL_REGISTRY_QA,'LOCAL-100','Explicit QA guard is required');
  assert(process.env.SUPABASE_ANON_KEY&&process.env.SUPABASE_SERVICE_ROLE_KEY,'Only local temporary keys');
  const url=localOnly(process.env.SUPABASE_URL);
  const admin=client(url,process.env.SUPABASE_SERVICE_ROLE_KEY);
  const check=await admin.from('qa_formal_registry_guard').select('marker').maybeSingle();
  assert(!check.error&&check.data?.marker===MARKER,'Disposable schema marker is required');
  const users=await admin.auth.admin.listUsers({page:1,perPage:1});
  assert(!users.error&&users.data.users.length===0,'Auth must be empty');
  const games=await admin.from('games').select('id').limit(1);
  assert(!games.error&&games.data.length===0,'Games must be empty');
  async function person(id,kind){
    const email='formal-100-'+kind+'-'+id+'@example.invalid';
    const created=await admin.auth.admin.createUser({email,password:PASSWORD,email_confirm:true});
    assert(!created.error,'Create local '+kind+': '+created.error?.message);
    const session=client(url,process.env.SUPABASE_ANON_KEY);
    const logged=await session.auth.signInWithPassword({email,password:PASSWORD});
    assert(!logged.error&&logged.data.user.id===created.data.user.id&&logged.data.session?.access_token,
      'Independent authenticated JWT for '+kind+'/'+id);
    return{id:created.data.user.id,kind,email,client:session};
  }
  const teacher=await person(0,'teacher');
  const outsider=await person(0,'outsider');
  const guest=await person(0,'guest');
  const students=await batched(Array.from({length:100},(_,i)=>i+1),i=>person(i,'student'));
  assert.equal(new Set(students.map(x=>x.id)).size,100,'100 unique local Auth identities');
  function inserted(response,step){assert(!response.error,step+': '+(response.error?.message||''));}
  inserted(await admin.from('games').insert([
    {id:GAME,title:'Disposable formal registry 100 JWT',game_code:'FQA100',owner_id:teacher.id,status:'running'},
    {id:OTHER,title:'Disposable other game',game_code:'FQA200',owner_id:outsider.id,status:'running'}
  ]),'Two isolated games');
  inserted(await admin.from('game_members').insert([
    {game_id:GAME,user_id:teacher.id,full_name:'Local teacher',kind:'teacher'},
    {game_id:GAME,user_id:guest.id,full_name:'Local guest',kind:'guest'},
    {game_id:OTHER,user_id:outsider.id,full_name:'Other game member',kind:'student'},
    ...students.map((s,i)=>({game_id:GAME,user_id:s.id,full_name:'Local student '+i,kind:'student'}))
  ]),'Role-scoped game membership');
  const baseTime='2026-10-01T00:00:00.000Z';
  const docs=Array.from({length:16},(_,i)=>({
    id:DOC(i+1),game_id:GAME,stage_no:i+1,registry_no:'QA-'+(i+1),
    title:'QA document of stage '+(i+1),doc_type:'law',author_id:teacher.id,
    body_text:'Public test fixture without confidential answers',status_code:'published',
    created_at:baseTime,updated_at:new Date(Date.parse(baseTime)+i*60000).toISOString()
  }));
  docs.push({
    id:DOC(101),game_id:GAME,stage_no:12,registry_no:'QA-PRIVATE',title:'Private QA document',
    doc_type:'justice_response',author_id:students[0].id,body_text:'Private fixture',
    status_code:'draft',created_at:baseTime,updated_at:'2026-10-02T00:00:00.000Z'
  });
  docs.push({
    id:DOC(201),game_id:OTHER,stage_no:3,registry_no:'OTHER',title:'Foreign game document',
    doc_type:'law',author_id:outsider.id,body_text:'Other game fixture',
    status_code:'published',created_at:baseTime,updated_at:'2026-10-03T00:00:00.000Z'
  });
  inserted(await admin.from('formal_documents').insert(docs),'16-stage and private documents');
  inserted(await admin.from('formal_document_history').insert(docs.filter(d=>d.doc_type==='law').map(d=>({
    document_id:d.id,game_id:d.game_id,actor_id:d.author_id,action:'created',note:'Fixture',
    created_at:d.updated_at
  }))),'Version history');
  async function read(p,game=GAME,ids=null){
    const start=performance.now();
    const result=await p.client.rpc('get_formal_registry_projection',{p_game_id:game,p_document_ids:ids});
    const ms=performance.now()-start;
    return{...result,ms,bytes:Buffer.byteLength(JSON.stringify(result.data??{}))};
  }
  const forbidden=await Promise.all([
    read(outsider),read(teacher,OTHER), // teacher is not a member of OTHER
    client(url,process.env.SUPABASE_ANON_KEY).rpc('get_formal_registry_projection',{p_game_id:GAME,p_document_ids:null})
  ]);
  assert(forbidden.every(r=>r.error),'Nonmember, cross-game and anon are denied by server');
  const [teacherView,guestView,foreignView]=await Promise.all([
    read(teacher),read(guest),read(outsider,OTHER)
  ]);
  assert(!teacherView.error&&!guestView.error&&!foreignView.error,'Authorized role reads must succeed');
  assert.equal(teacherView.data.documents.length,17,'Teacher sees public and restricted in-game documents');
  assert.equal(teacherView.data.history.length,16,'Teacher sees in-game history');
  assert.equal(guestView.data.documents.length,16,'Guest sees only public documents');
  assert.equal(guestView.data.history.length,16,'Guest cannot access foreign game history');
  assert.deepEqual(foreignView.data.documents.map(d=>d.id),[DOC(201)],'Other game user sees only their own session');
  const wave=await Promise.all(students.map(s=>read(s)));
  assert(wave.every(r=>!r.error),'100 simultaneous authenticated RPCs must succeed: '+
    JSON.stringify(wave.filter(r=>r.error).slice(0,5).map(r=>r.error?.message)));
  for(let i=0;i<100;i++){
    const d=wave[i].data;
    assert.equal(d.documents.length,i===0?17:16,'Individual private document isolation '+i);
    assert.equal(d.history.length,16,'Complete in-game history '+i);
    assert(d.documents.every(row=>row.game_id===GAME),'No foreign document for student '+i);
    assert(d.documents.some(row=>row.stage_no===16),'Final-stage metadata available to student '+i);
    assert(!d.documents.some(row=>row.id===DOC(201)),'Foreign document excluded');
    assert(!d.documents.some(row=>row.id===DOC(101))||i===0,'Restricted document leak');
  }
  const targets=[DOC(16)];
  const focused=await Promise.all([read(students[1],GAME,targets),read(teacher,GAME,[]),
    read(guest,GAME,[DOC(101)])]);
  assert.deepEqual(focused[0].data.documents.map(d=>d.id),targets,'Filtered stage 16 projection');
  assert.deepEqual(focused[0].data.history.map(h=>h.document_id),targets,'Filtered stage 16 history');
  assert.equal(focused[1].data.documents.length,0,'Empty uuid[] does not return all documents');
  assert.equal(focused[1].data.history.length,0,'Empty uuid[] does not return all history');
  assert.equal(focused[2].data.documents.length,0,'Guest cannot bypass RLS through document ID');
  // Simulate a document history change then 50 clients sign out and back in,
  // ensuring JWT renewal and the second 100-client read agree on latest data.
  inserted(await admin.from('formal_document_history').insert({
    document_id:DOC(16),game_id:GAME,actor_id:teacher.id,action:'updated',
    note:'QA metadata refresh, no game decision modified',
    created_at:'2026-10-04T00:00:00.000Z'
  }),'New history record');
  const fifty=students.slice(0,50);
  await batched(fifty,async s=>{
    const signedOut=await s.client.auth.signOut();assert(!signedOut.error,'Local signOut');
    const relogin=await s.client.auth.signInWithPassword({email:s.email,password:PASSWORD});
    assert(!relogin.error&&relogin.data.user.id===s.id,'Local JWT sign-in recovery');
  });
  const refreshed=await Promise.all(students.map(s=>read(s)));
  assert(refreshed.every(r=>!r.error&&r.data.history.length===17&&r.data.documents.length>=16),
    '100 client snapshots must contain latest history, including 50 renewed JWTs');
  assert(refreshed.every(r=>r.data.documents.every(d=>d.game_id===GAME)),'No cross-session stale data');
  const measures=[...wave,...refreshed];
  console.log(JSON.stringify({
    status:'PASS',environment:'Disposable loopback Supabase, real Auth/JWT, PostgREST and unchanged production invoker RPC',
    participants:{students:100,teacher:1,guest:1,foreign:1},formalStageCoverage:16,
    metadataDocumentsInGame:17,historyBefore:16,historyAfter:17,
    simultaneousWaveReads:100,secondWaveReads:100,reauthenticatedJWTs:50,
    privateDocumentLeaks:0,foreignGameLeaks:0,readErrors:0,anonymousDenied:true,foreignMemberDenied:true,
    partialAndEmptyFiltering:true,rpcLatencyMs:percentiles(measures.map(r=>r.ms)),
    returnedJsonBytes:measures.reduce((sum,r)=>sum+r.bytes,0),productionRequests:0,
    limitations:'Simplified local membership/RLS and document fields; synthetic clients, not 100 humans, full 16-stage gameplay, real files/Storage, UI or full egress'
  }));
}
main().catch(e=>{console.error('FAIL: 100-JWT formal registry: '+(e.stack||e));process.exitCode=1});
