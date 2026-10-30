'use strict';
/* #491. Disposable local Supabase: 100 Auth JWTs, production public
   get_public_stage_scores RPC, simplified local assessment RLS.
   No scoring mutations, no real players, no production connection. */
const assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const {createClient}=require('@supabase/supabase-js');
const GAME='e4c10000-0000-4000-8000-000000000100';
const OTHER='e4c10000-0000-4000-8000-000000000200';
const PASS='Score-QA-100-Local-Only!';
const group=async(items,fn)=>{const output=[];for(let i=0;i<items.length;i+=10)output.push(...await Promise.all(items.slice(i,i+10).map(fn)));return output;};
const make=(url,key)=>createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const percentiles=(arr)=>{const a=[...arr].sort((x,y)=>x-y);return {p50_ms:Math.round(a[Math.ceil(a.length*.5)-1]),p95_ms:Math.round(a[Math.ceil(a.length*.95)-1]),p99_ms:Math.round(a[Math.ceil(a.length*.99)-1])};};
async function main(){
  assert.equal(process.env.GITHUB_ACTIONS,'true');
  assert.equal(process.env.GOS_SCORES_QA,'LOCAL-100');
  const u=new URL(process.env.SUPABASE_URL||'');
  assert(['localhost','127.0.0.1','[::1]'].includes(u.hostname)&&
    ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&
    !u.search&&!u.hash&&u.pathname==='/', 'Local loopback API only');
  const anon=process.env.SUPABASE_ANON_KEY,service=process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert(anon&&service);
  const admin=make(u.origin,service);
  const marker=await admin.from('qa_scores_guard').select('marker').maybeSingle();
  assert(!marker.error&&marker.data?.marker==='gos-id-disposable-scores-100-v1');
  const users=await admin.auth.admin.listUsers({page:1,perPage:1});
  assert(!users.error&&users.data.users.length===0,'Empty Auth database required');
  const existing=await admin.from('games').select('id').limit(1);
  assert(!existing.error&&existing.data.length===0,'Empty game database required');
  async function person(kind,i){
    const email='scores-'+kind+'-'+i+'@example.invalid';
    const a=await admin.auth.admin.createUser({email,password:PASS,email_confirm:true});
    assert(!a.error,a.error?.message);
    const db=make(u.origin,anon),b=await db.auth.signInWithPassword({email,password:PASS});
    assert(!b.error&&b.data.session?.access_token&&b.data.user.id===a.data.user.id);
    return{user_id:a.data.user.id,kind,email,db};
  }
  const teacher=await person('teacher',0),guest=await person('guest',0),outsider=await person('outsider',0);
  const students=await group(Array.from({length:100},(_,i)=>i),i=>person('student',i));
  assert.equal(new Set(students.map(s=>s.user_id)).size,100);
  function ok(r,label){assert(!r.error,label+': '+r.error?.message);}
  ok(await admin.from('games').insert([
    {id:GAME,title:'Scores isolated QA',game_code:'SQA100',owner_id:teacher.user_id,status:'running'},
    {id:OTHER,title:'Other isolated QA',game_code:'SQA200',owner_id:outsider.user_id,status:'running'}
  ]),'Games');
  ok(await admin.from('game_members').insert([
    {game_id:GAME,user_id:teacher.user_id,full_name:'Teacher QA',kind:'teacher'},
    {game_id:GAME,user_id:guest.user_id,full_name:'Guest QA',kind:'guest'},
    {game_id:OTHER,user_id:outsider.user_id,full_name:'Outsider QA',kind:'student'},
    ...students.map((s,i)=>({game_id:GAME,user_id:s.user_id,full_name:'Student QA '+i,kind:'student'}))
  ]),'Members');
  const assessments=students.flatMap((s,i)=>Array.from({length:16},(_,j)=>({
    game_id:GAME,user_id:s.user_id,stage_no:j+1,auto_score:(i+j)%4,
    final_score:j%2===0?null:(i+j)%3,
    status:j%2===0?'draft':'final',
    evidence_summary:{private:'QA ONLY'},rationale:'Teacher-private QA rationale'
  })));
  for(let i=0;i<assessments.length;i+=250)ok(await admin.from('stage_assessments').insert(assessments.slice(i,i+250)),'Assessments');
  ok(await admin.from('stage_assessments').insert({
    game_id:OTHER,user_id:outsider.user_id,stage_no:1,auto_score:99,final_score:99,
    status:'final',evidence_summary:{private:'OTHER GAME'}
  }),'Foreign game assessment');
  const fetch=async(p,g=GAME)=>{
    const start=performance.now();
    const r=await p.db.rpc('get_public_stage_scores',{p_game_id:g});
    return{...r,ms:performance.now()-start,bytes:Buffer.byteLength(JSON.stringify(r.data??[]))};
  };
  const denied=await Promise.all([
    fetch(outsider),fetch(teacher,OTHER),make(u.origin,anon).rpc('get_public_stage_scores',{p_game_id:GAME})
  ]);
  assert(denied.every(r=>r.error),'Nonmember, wrong game and anonymous must fail');
  const [teacherRead,guestRead]=await Promise.all([fetch(teacher),fetch(guest)]);
  assert(!teacherRead.error&&!guestRead.error);
  assert.equal(teacherRead.data.length,1600);
  assert.equal(guestRead.data.length,1600,'Public scores are game-visible, not teacher-only');
  const first=await Promise.all(students.map(s=>fetch(s)));
  assert(first.every(r=>!r.error&&r.data.length===1600),
    'All 100 concurrent JWT projections must succeed and contain 16 scores per player');
  for(const r of first)assert(r.data.every(a=>a.stage_no>=1&&a.stage_no<=16&&
     !('evidence_summary' in a)&&!('rationale' in a)&&!('game_id' in a)), 'Private scoring fields must not leak');
  const privateReads=await Promise.all([
    students[0].db.from('stage_assessments').select('user_id,stage_no,evidence_summary,rationale'),
    guest.db.from('stage_assessments').select('user_id,stage_no,evidence_summary,rationale'),
    outsider.db.from('stage_assessments').select('*').eq('game_id',GAME)
  ]);
  assert(!privateReads[0].error&&privateReads[0].data.length===16&&
    privateReads[0].data.every(r=>r.user_id===students[0].user_id),'Student sees own evidence only under fixture');
  assert(!privateReads[1].error&&privateReads[1].data.length===0,'Guest sees no private assessments');
  assert(!privateReads[2].error&&privateReads[2].data.length===0,'Foreign user sees no private assessments');
  // Teacher final mark supersedes automatic score; never sum both.
  const compute=(rows,id)=>rows.filter(x=>x.user_id===id).reduce((sum,x)=>sum+Number(x.status==='final'?(x.final_score??x.auto_score):x.auto_score),0);
  const s=students[0],before=compute(first[0].data,s.user_id);
  ok(await admin.from('stage_assessments').update({final_score:0,status:'final'}).eq('game_id',GAME).eq('user_id',s.user_id).eq('stage_no',1),'Teacher-style final mark fixture');
  const expected=before-assessments[0].auto_score;
  for(const p of students.slice(0,50)){
    ok(await p.db.auth.signOut(),'Sign out');
    const logged=await p.db.auth.signInWithPassword({email:p.email,password:PASS});
    assert(!logged.error&&logged.data.session?.access_token,'Reauthentication');
  }
  const second=await Promise.all(students.map(p=>fetch(p)));
  assert(second.every(r=>!r.error&&r.data.length===1600),'Second wave must return 100 consistent snapshots');
  assert(second.every(r=>compute(r.data,s.user_id)===expected),'All 100 saw teacher final score supersede draft');
  assert(second.every(r=>r.data.some(x=>x.user_id===s.user_id&&x.stage_no===1&&x.final_score===0&&x.status==='final')));
  assert(second.every(r=>r.data.every(a=>!('evidence_summary' in a)&&!('rationale' in a))));
  const both=[...first,...second];
  console.log(JSON.stringify({status:'PASS',
    scope:'Disposable local Supabase Auth/JWT/PostgREST and unchanged production public grades RPC; simplified local member/assessment RLS',
    students:100,stages:16,rowsPerPublicProjection:1600,initialReads:100,refreshedReads:100,reauthenticated:50,
    teacherFinalOverridesDraft:true,privateAssessmentRowsExposedToOtherStudent:0,
    guestPrivateRows:0,outsiderPrivateRows:0,forbiddenRPCsDenied:3,
    requestErrors:0,rpcLatencyMs:percentiles(both.map(x=>x.ms)),
    returnedJsonBytes:both.reduce((v,x)=>v+x.bytes,0),productionRequests:0,
    limitations:'Synthetic clients, simplified fixture; not 100 live humans or full stage transition/playback, full production RLS or network egress'}));
}
main().catch(e=>{console.error('FAIL 100 scores: '+(e.stack||e));process.exitCode=1});
