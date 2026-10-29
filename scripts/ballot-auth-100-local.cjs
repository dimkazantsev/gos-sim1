'use strict';
// Issue #491: actual 100 separate local Auth/JWT -> PostgREST -> production ballot RPC.
// Schema/eligibility intentionally simplified. Never call a production Supabase.
const assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const {createClient}=require('@supabase/supabase-js');
const {bootstrap,gameId,voteId,retryId,raceId}=require('./ballot-concurrency-postgres-check.cjs');
const MARKER='gos-id-ballot-auth-disposable-v1';
const PASS='Gos-100-Auth-Ballot-Only-2026!';
const BATCH=10;
function schema(){
  assert.equal(process.env.GOS_BALLOT_AUTH_QA,'LOCAL-100');
  const original=bootstrap(100);
  const seed=original.indexOf('insert into public.game_members(');
  assert(seed>0,'Missing isolated fixture seed boundary');
  let sql=original.slice(0,seed);
  const oldSchema='create schema auth; create schema private;';
  const oldUid="create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;";
  assert(sql.includes(oldSchema)&&sql.includes(oldUid),'Unexpected ballot fixture contract');
  sql=sql.replace(oldSchema,'create schema if not exists private;').replace(oldUid,'');
  return [
    "do $$ begin if exists(select 1 from auth.users limit 1) then raise exception 'Local Auth must be empty'; end if; end $$;",
    sql,
    'create table public.qa_ballot_auth_guard(marker text primary key);',
    "insert into public.qa_ballot_auth_guard values('"+MARKER+"');",
    'revoke all on public.qa_ballot_auth_guard from public,anon,authenticated;',
    'grant select on public.qa_ballot_auth_guard to service_role;',
    'alter table public.game_votes enable row level security;',
    'alter table public.game_ballots enable row level security;',
    'alter table public.game_members enable row level security;',
    'alter table public.institution_session_registrations enable row level security;',
    'revoke all on public.game_votes,public.game_ballots,public.game_members,public.institution_session_registrations from public,anon,authenticated;',
    'revoke all on function public.cast_vote_allocation(uuid,numeric,numeric,numeric) from public,anon;',
    'grant execute on function public.cast_vote_allocation(uuid,numeric,numeric,numeric) to authenticated;',
    "notify pgrst, 'reload schema';"
  ].join('\n');
}
if(process.argv.includes('--schema')){
  process.stdout.write(schema()+'\n');
}else{
  main().catch(e=>{console.error('FAIL ballot-auth-100: '+(e.stack||e));process.exitCode=1});
}
function localOrigin(raw){
  const u=new URL(raw);
  assert(['localhost','127.0.0.1','[::1]'].includes(u.hostname),'Only loopback Supabase is permitted');
  assert(['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/','Bare loopback origin required');
  return u.origin;
}
function client(origin,key){
  return createClient(origin,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
}
async function batch(xs,fn){
  const result=[];
  for(let n=0;n<xs.length;n+=BATCH) result.push(...await Promise.all(xs.slice(n,n+BATCH).map(fn)));
  return result;
}
function pcts(ns){
  assert(ns.length&&ns.every(n=>Number.isFinite(n)&&n>=0));
  const s=ns.slice().sort((a,b)=>a-b),at=q=>Math.round(s[Math.ceil(q*s.length)-1]);
  return {n:s.length,p50_ms:at(.5),p95_ms:at(.95),p99_ms:at(.99)};
}
async function main(){
  assert.equal(process.env.GITHUB_ACTIONS,'true','CI-only');
  assert.equal(process.env.GOS_BALLOT_AUTH_QA,'LOCAL-100','QA guard required');
  const url=localOrigin(process.env.SUPABASE_URL);
  assert(process.env.SUPABASE_ANON_KEY&&process.env.SUPABASE_SERVICE_ROLE_KEY,'Local keys required');
  const service=client(url,process.env.SUPABASE_SERVICE_ROLE_KEY);
  const mark=await service.from('qa_ballot_auth_guard').select('marker').maybeSingle();
  assert(!mark.error&&mark.data?.marker===MARKER,'Disposable database marker missing');
  const userCheck=await service.auth.admin.listUsers({page:1,perPage:1});
  assert(!userCheck.error&&userCheck.data.users.length===0,'Disposable Auth must be empty');
  const existing=await service.from('game_votes').select('id').limit(1);
  assert(!existing.error&&existing.data.length===0,'Fixture voting data must be empty');
  async function createPerson(i,role){
    const email='ballot-auth-'+role+'-'+i+'@example.invalid';
    const created=await service.auth.admin.createUser({email,password:PASS,email_confirm:true});
    if(created.error)throw Error('Create local '+role+': '+created.error.message);
    const authClient=client(url,process.env.SUPABASE_ANON_KEY);
    const signed=await authClient.auth.signInWithPassword({email,password:PASS});
    assert(!signed.error&&signed.data.user?.id===created.data.user.id,'Independent local Auth/JWT '+role);
    return {id:created.data.user.id,role,client:authClient};
  }
  const students=await batch(Array.from({length:100},(_,i)=>i+1),i=>createPerson(i,'student'));
  const [teacher,guest,outsider]=await batch(['teacher','guest','outsider'],r=>createPerson(0,r));
  assert.equal(new Set(students.map(s=>s.id)).size,100,'Independent user IDs');
  const members=[...students.map(s=>({game_id:gameId,user_id:s.id,kind:'student',role_title:'Участник'})),{game_id:gameId,user_id:teacher.id,kind:'teacher',role_title:'Преподаватель'},{game_id:gameId,user_id:guest.id,kind:'guest',role_title:'Гость'}];
  let result=await service.from('game_members').insert(members);
  assert(!result.error,'Members: '+result.error?.message);
  result=await service.from('institution_session_registrations').insert(students.map(s=>({game_id:gameId,user_id:s.id,stage_no:1,institution_key:'gd'})));
  assert(!result.error,'Registered electorate: '+result.error?.message);
  const weights=Object.fromEntries(students.map(s=>[s.id,1]));
  const base={game_id:gameId,status:'open',procedure_key:'ordinary',voting_mode:'individual',allow_abstain:true,electorate_snapshot:{attendance_required:true,weights},institution_key:'gd',stage_no:1,quorum_kind:'none',quorum_value:0,majority_kind:'simple',majority_value:0,tie_breaker_chair:false};
  result=await service.from('game_votes').insert([voteId,retryId,raceId].map(id=>({id,...base})));
  assert(!result.error,'Votes: '+result.error?.message);
  async function cast(person,id){
    const start=performance.now();
    const reply=await person.client.rpc('cast_vote_allocation',{p_vote_id:id,p_yes:1,p_no:0,p_abstain:0});
    return {ok:!reply.error,error:reply.error?.message,ms:performance.now()-start};
  }
  const [foreign,visitor,anonymous,studentClose]=await Promise.all([
    cast(outsider,voteId),cast(guest,voteId),
    client(url,process.env.SUPABASE_ANON_KEY).rpc('cast_vote_allocation',{p_vote_id:voteId,p_yes:1,p_no:0,p_abstain:0}),
    students[0].client.rpc('close_procedural_vote',{p_vote_id:voteId,p_note:null})
  ]);
  assert(!foreign.ok&&!visitor.ok&&anonymous.error&&studentClose.error,'Outsider/guest/anon/student-close are denied on server');
  const direct=await students[0].client.from('game_ballots').select('vote_id').limit(1);
  assert(direct.error,'Direct ballot-table reads must remain inaccessible');
  async function state(id){
    const [v,b]=await Promise.all([service.from('game_votes').select('status,result_yes,result_cast').eq('id',id).single(),service.from('game_ballots').select('voter_id').eq('vote_id',id)]);
    assert(!v.error&&!b.error,'Read final server-side state');
    return {status:v.data.status,yes:Number(v.data.result_yes),cast:Number(v.data.result_cast),count:b.data.length,distinct:new Set(b.data.map(a=>a.voter_id)).size};
  }
  const all=await Promise.all(students.map(s=>cast(s,voteId)));
  assert(all.every(r=>r.ok),'100 concurrent independent authenticated votes: '+JSON.stringify(all.filter(r=>!r.ok).slice(0,8)));
  assert.deepEqual(await state(voteId),{status:'closed',yes:100,cast:100,count:100,distinct:100},'100 distinct votes: no losses or duplicates');
  const afterClose=await cast(students[0],voteId);
  assert(!afterClose.ok&&/Голосование завершено/.test(afterClose.error||''),'Closed vote must refuse late repeat');
  const repeats=await Promise.all(Array.from({length:30},()=>cast(students[0],retryId)));
  assert(repeats.every(r=>r.ok),'All same-student retries must be accepted before final close');
  assert.deepEqual(await state(retryId),{status:'open',yes:0,cast:0,count:1,distinct:1},'30 simultaneous retries preserve one ballot');
  const rest=await Promise.all(students.slice(1).map(s=>cast(s,retryId)));
  assert(rest.every(r=>r.ok),'Remaining 99 ballot users must succeed');
  assert.deepEqual(await state(retryId),{status:'closed',yes:100,cast:100,count:100,distinct:100},'Retries + 99 votes close once');
  const competing=await Promise.all([...students.map(s=>cast(s,raceId)),teacher.client.rpc('close_procedural_vote',{p_vote_id:raceId,p_note:null})]);
  const close=competing.pop(),accepted=competing.filter(x=>x.ok),failed=competing.filter(x=>!x.ok);
  assert(failed.every(x=>/Голосование завершено/.test(x.error||'')),'Only closure may reject competing ballots');
  if(close.error)assert(/ещё не все зарегистрированные|закрыто|завершено/i.test(close.error.message),'Early manual closure must be rejected safely: '+close.error.message);
  const final=await state(raceId);
  assert.equal(final.status,'closed','Race must have a final closed result');
  assert.equal(final.count,accepted.length,'No lost confirmed vote in close race');
  assert.equal(final.distinct,final.count,'No duplicate voting');
  assert.equal(final.yes,final.count,'Result must match accepted ballots');
  assert.equal(final.cast,final.count,'Tally must match accepted ballots');
  console.log(JSON.stringify({status:'PASS',scope:'Disposable local Supabase real Auth/JWT, PostgREST and production voting/close function bodies; simplified membership and electorate fixture; NOT full production RLS or 100 real browsers',students:100,teacher:1,guest:1,outsider:1,independentJWTs:100,waves:{distinct:{accepted:all.length,latency:pcts(all.map(x=>x.ms))},sameVoterRetries:{attempts:repeats.length,stored:1},afterRetries:{accepted:rest.length,finalCount:100},closeRace:{attempts:100,accepted:accepted.length,closedRejected:failed.length,manualCloseError:close.error?.message||null}},foreignDenied:true,guestDenied:true,anonymousDenied:true,studentCloseDenied:true,directTableReadDenied:true,readErrors:0,liveProductionRequests:0}));
}
