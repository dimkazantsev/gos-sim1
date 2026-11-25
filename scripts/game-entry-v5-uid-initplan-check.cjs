'use strict';
// Actual RPC SQL with disposable PGlite schema. No production requests.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const file=fs.readFileSync('docs/performance/game-entry-v5-uid-initplan-candidate.sql','utf8');
const candidate=file.slice(file.indexOf('CREATE OR REPLACE FUNCTION public.get_game_entry_v5('));
const changed='where m.game_id=p_game_id and m.user_id=(select auth.uid())';
assert.equal(candidate.split(changed).length,2);
const reference=candidate.replace(changed,'where m.game_id=p_game_id and m.user_id=auth.uid()').replace('public.get_game_entry_v5(','public.get_game_entry_v5_reference(');
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const q=s=>"'"+s+"'";
const g=uuid(1),foreignGame=uuid(2),student=uuid(3),teacher=uuid(4),observer=uuid(5),foreign=uuid(6),stranger=uuid(7),archived=uuid(8);
const G=q(g),F=q(foreignGame);
const setup=`
create schema private;create schema auth;create role anon;create role authenticated;
grant usage on schema auth,private,public to authenticated;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table public.games(id uuid primary key,title text);
create table public.game_members(game_id uuid,user_id uuid,full_name text,group_name text,kind text,role_title text,team text,score numeric,joined_at timestamptz,party_joined_at timestamptz,roster_archived_at timestamptz,private_note text,primary key(game_id,user_id));
create index game_members_user_idx on public.game_members(user_id);
create function private.is_game_member(p uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.game_members where game_id=p and user_id=auth.uid() and roster_archived_at is null)$$;
create function public.has_seen_my_intro() returns boolean language sql stable as $$select auth.uid() is not null$$;
create table public.state_metrics(game_id uuid,label text,value numeric);
create table public.chat_channels(game_id uuid,name text,teacher_only boolean);
create table public.game_stages(game_id uuid,stage_no int);
create table public.game_votes(game_id uuid,opened_at timestamptz,title text);
create table public.game_crises(game_id uuid,created_at timestamptz,title text);
create table public.game_profiles(game_id uuid,user_id uuid,avatar_path text,updated_at timestamptz,signature_path text,gender text,onboarding_completed_at timestamptz,intro_seen_at timestamptz,profile_setup_prompt_seen_at timestamptz,bio text);
create table public.formal_documents(id uuid,game_id uuid,stage_no int,registry_no text,title text,doc_type text,subject_key text,subject_label text,author_id uuid,source_file_path text,source_file_name text,source_mime_type text,workflow_key text,workflow_steps jsonb,current_step text,status_code text,status_label text,current_owner_key text,created_at timestamptz,updated_at timestamptz,body_text text,metadata jsonb);
create table public.game_parties(id uuid,game_id uuid,created_by uuid,name text,support numeric,mandates int,regions jsonb,budget numeric,leader_user_id uuid,color text,logo_path text,ghost_loss_current numeric,ghost_active boolean,ghost_started_at timestamptz,representation_penalty numeric,regional_seat_penalty numeric,ghost_risk_weight numeric,presidential_rating_modifier numeric,registration_status text,registration_submitted_at timestamptz,registration_reviewed_at timestamptz,registration_reviewed_by uuid,mandate_allocation_mode text,regional_seats_awarded int,created_at timestamptz,rating numeric);
insert into games values (${G},'Class'),(${F},'Foreign');
insert into game_members(game_id,user_id,full_name,kind,private_note,score,roster_archived_at) values
 (${G},${q(student)},'Student','student','own student',10,null),
 (${G},${q(teacher)},'Teacher','teacher','own teacher',0,null),
 (${G},${q(observer)},'Observer','observer','own observer',0,null),
 (${G},${q(archived)},'Archived','student','archive',0,now()),
 (${F},${q(foreign)},'Foreign','student','foreign',0,null);
insert into game_members(game_id,user_id,full_name,kind,private_note,score) select ${G},('00000000-0000-4000-8000-'||lpad((n+100)::text,12,'0'))::uuid,'Student '||n,'student','not in roster projection',n from generate_series(1,98)n;
insert into state_metrics values(${G},'Metric',1),(${F},'Foreign metric',2);
insert into chat_channels values(${G},'Public',false),(${G},'Teacher room',true),(${F},'Foreign',false);
insert into game_stages select ${G},n from generate_series(1,16)n;
insert into game_votes values(${G},now(),'Vote'),(${F},now(),'Foreign vote');
insert into game_crises values(${G},now(),'Crisis');
insert into game_profiles(game_id,user_id,bio,avatar_path) values(${G},${q(student)},'hidden bio','avatar'),(${F},${q(foreign)},'foreign bio','foreign');
insert into formal_documents(id,game_id,title,body_text,metadata,updated_at) values(${q(uuid(9))},${G},'Document','hidden body','{"private":true}',now()),(${q(uuid(10))},${F},'Foreign document','foreign','{}',now());
insert into game_parties(id,game_id,name,support,created_at) values(${q(uuid(11))},${G},'Party',10,now()),(${q(uuid(12))},${F},'Foreign party',100,now());
alter table public.games enable row level security;
create policy games_read on public.games for select to authenticated using(private.is_game_member(id));
grant select on public.games to authenticated;
`;
(async()=>{
 const db=new PGlite();await db.waitReady;
 try{
  await db.exec(setup);
  for(const table of ['game_members','state_metrics','chat_channels','game_stages','game_votes','game_crises','game_profiles','formal_documents','game_parties']){
   await db.exec('alter table public.'+table+' enable row level security;grant select on public.'+table+' to authenticated;create policy game_read on public.'+table+' for select to authenticated using(private.is_game_member(game_id)'+(table==='chat_channels'?' and (not teacher_only or auth.uid()='+q(teacher)+')':'')+');');
  }
  await db.exec(reference);
  // Establish the baseline grant state, then replace the same function.
  await db.exec(reference.replace('public.get_game_entry_v5_reference(','public.get_game_entry_v5('));
  await db.exec("revoke execute on function public.get_game_entry_v5(uuid) from public,anon;grant execute on function public.get_game_entry_v5(uuid) to authenticated;");
  async function val(sql){return (await db.query(sql)).rows[0].value}
  const meta="select jsonb_build_object('owner',proowner,'acl',proacl,'security',prosecdef,'volatility',provolatile,'config',proconfig) as value from pg_proc where oid='public.get_game_entry_v5(uuid)'::regprocedure";
  const before=await val(meta);
  await db.exec(candidate);assert.deepEqual(await val(meta),before);
  async function as(uid,sql){
   await db.exec("select set_config('request.jwt.claim.sub',"+q(uid)+",false);set role authenticated;");
   try{return await val(sql)}finally{await db.exec('reset role')}
  }
  const call=(fn,id)=>'select public.'+fn+'('+q(id)+') as value';
  for(const uid of [student,teacher,observer]){
   const expected=await as(uid,call('get_game_entry_v5_reference',g)),actual=await as(uid,call('get_game_entry_v5',g));
   assert.deepEqual(actual,expected,'Complete RPC payload matches for role');
   assert.equal(actual.member.user_id,uid);assert.equal(actual.roster.length,102);
   assert(actual.roster.every(row=>!Object.hasOwn(row,'private_note')));
   assert(actual.profiles.every(row=>row.bio===null));
   assert(actual.formal_documents.every(row=>row.body_text===null&&Object.keys(row.metadata).length===0));
   assert.equal(actual.channels.length,uid===teacher?2:1);
   assert.equal(actual.stages.length,16);
  }
  for(const uid of [foreign,stranger,archived]){
   for(const fn of ['get_game_entry_v5_reference','get_game_entry_v5'])await assert.rejects(()=>as(uid,call(fn,g)),e=>e.code==='42501');
  }
  await assert.rejects(()=>as(student,call('get_game_entry_v5',foreignGame)),e=>e.code==='42501');
  assert.equal(await val("select has_function_privilege('anon','public.get_game_entry_v5(uuid)','execute') as value"),false);
  console.log(JSON.stringify({status:'PASS',fullJsonRoles:3,rosterRows:102,deniedRoles:3,crossGameDenied:true,aclUnchanged:true,productionRequests:0,scope:'PGlite fixture RLS; not full production schema'}));
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
