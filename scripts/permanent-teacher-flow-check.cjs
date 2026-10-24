'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const read=file=>fs.readFileSync(file,'utf8');
const migration=read('supabase/migrations/20261024160000_permanent_teacher_profile.sql');
const regional=read('supabase/migrations/20261024161000_regional_agreement_from_published.sql');
const portal=read('app/teacher/page.tsx');
const home=read('app/page.tsx');
const stage=read('components/game/GovernanceStageWorkspace.tsx');
const guide=read('components/game/StageMeetingProcedureFlow.tsx');
const lab=read('components/game/ElectoralArchitectureLab.tsx');
const sessions=read('components/game/TeacherGameSessions.tsx');
const profile=read('components/game/ProfileView.tsx');
const agenda=read('components/game/InstitutionRegistrationPanel.tsx');
assert(portal.includes('openGame(selected.id)')&&portal.includes('if(value.games.length)'),'Existing game resumes without a lobby');
assert(portal.includes('teacherEmptyShell')&&portal.includes('Все 16 этапов')&&portal.includes('STAGE_OPERATIONS'),'No-game teacher sees genuine empty game shell and stage navigation');
assert(portal.includes('TeacherGameSessions')&&portal.includes('teacherEmptyProfileFields'),'No-game teacher keeps editable permanent profile and creation controls');
assert(profile.includes('<TeacherGameSessions displayName={me.full_name}/>'),'Active teacher manages sessions in profile');
assert(sessions.includes("rpc('create_game_session'")&&sessions.includes("rpc('ensure_my_game_access'"),'Create and open through existing authorized RPCs');
assert(sessions.includes('archive_my_teacher_game'),'Archive games without deleting documents');
assert(!agenda.includes('className="civicMeetingSteps"'),'Agenda does not repeat established five-step route');
assert(home.includes("from('teacher_profiles')"),'Existing teacher session bypasses login form');
assert(stage.includes('StageMeetingProcedureFlow'),'All active meeting stages share the same guide');
for(const k of ['Повестка','Регистрация','Рассмотрение','Решения и голосования','Итоговые документы'])assert(guide.includes(k),k);
assert(lab.includes('prepare_regional_agreement_from_calculation'),'Explicit agreement import');
assert(migration.includes('BEFORE DELETE ON public.games'),'Permanent assets guarded');
const u='00000000-0000-0000-0000-0000000000a1';
const g='00000000-0000-0000-0000-0000000000b1';
const g2='00000000-0000-0000-0000-0000000000b2';
const party1='00000000-0000-0000-0000-0000000000c1',party2='00000000-0000-0000-0000-0000000000c2';
const rule='00000000-0000-0000-0000-0000000000d1',calc='00000000-0000-0000-0000-0000000000e1';
const query=async(db,sql,args=[]) =>(await db.query(sql,args)).rows;
(async()=>{
 const db=new PGlite();
 try{
  await db.exec([
   'CREATE ROLE anon','CREATE ROLE authenticated','CREATE SCHEMA auth','CREATE SCHEMA private',
   "CREATE TYPE public.member_kind AS ENUM ('teacher','student','observer')",
   'CREATE TABLE auth.users(id uuid PRIMARY KEY)',
   "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$",
   "CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT '{\"is_anonymous\":false}'::jsonb$$",
   'CREATE FUNCTION private.is_platform_admin() RETURNS boolean LANGUAGE sql AS $$SELECT false$$',
   'CREATE TABLE public.games(id uuid PRIMARY KEY,owner_id uuid REFERENCES auth.users(id),title text,game_code text,status text,turn_open boolean,turn_ends_at timestamptz,created_at timestamptz DEFAULT now())',
   'CREATE TABLE public.game_members(game_id uuid REFERENCES public.games(id) ON DELETE CASCADE,user_id uuid REFERENCES auth.users(id),full_name text,kind public.member_kind,role_title text,roster_archived_at timestamptz,joined_at timestamptz DEFAULT now(),PRIMARY KEY(game_id,user_id))',
   'CREATE TABLE public.game_profiles(game_id uuid REFERENCES public.games(id) ON DELETE CASCADE,user_id uuid REFERENCES auth.users(id),bio text,gender text,avatar_path text,signature_path text,updated_at timestamptz DEFAULT now(),PRIMARY KEY(game_id,user_id))',
   'CREATE TABLE public.platform_admins(user_id uuid)'
  ].join(';')+';');
  await query(db,'INSERT INTO auth.users VALUES ($1)',[u]);
  await query(db,"INSERT INTO public.games(id,owner_id,title,status) VALUES($1,$2,'Историческая игра','active')",[g,u]);
  await query(db,"INSERT INTO public.game_members(game_id,user_id,full_name,kind) VALUES($1,$2,'Постоянный Преподаватель Тестовый','teacher')",[g,u]);
  await query(db,"INSERT INTO public.game_profiles(game_id,user_id,bio,gender,avatar_path,signature_path) VALUES($1,$2,'Биография навсегда','male',$3,$4)",[g,u,g+'/profiles/'+u+'/avatar-old.webp',g+'/profiles/'+u+'/signature-old.png']);
  await db.exec("SET request.jwt.claim.sub='"+u+"';");
  await db.exec(migration);
  const old=(await query(db,'SELECT * FROM public.teacher_profiles WHERE user_id=$1',[u]))[0];
  assert.equal(old.bio,'Биография навсегда');
  await query(db,'SELECT public.archive_my_teacher_game($1)',[g]);
  assert.equal((await query(db,'SELECT status FROM public.games WHERE id=$1',[g]))[0].status,'archived');
  assert.equal((await query(db,'SELECT count(*)::int n FROM public.game_profiles WHERE game_id=$1',[g]))[0].n,1);
  await assert.rejects(()=>query(db,'DELETE FROM public.games WHERE id=$1',[g]),/Архивируйте игру/i);
  await query(db,"INSERT INTO public.games(id,owner_id,title,status) VALUES($1,$2,'Новая игра','active')",[g2,u]);
  await query(db,"INSERT INTO public.game_members(game_id,user_id,full_name,kind) VALUES($1,$2,'Другое Имя Преподавателя','teacher')",[g2,u]);
  assert.equal((await query(db,'SELECT full_name FROM public.game_members WHERE game_id=$1',[g2]))[0].full_name,'Постоянный Преподаватель Тестовый');
  assert.equal((await query(db,'SELECT bio FROM public.game_profiles WHERE game_id=$1',[g2]))[0].bio,old.bio);
  await query(db,"UPDATE public.game_profiles SET bio='Изменённая биография' WHERE game_id=$1",[g2]);
  assert.equal((await query(db,'SELECT bio FROM public.teacher_profiles WHERE user_id=$1',[u]))[0].bio,'Изменённая биография');
  const list=(await query(db,'SELECT public.list_my_teacher_games() AS payload'))[0].payload;
  assert.equal(list.games.length,2);
  await db.exec([
   'CREATE TABLE public.regional_election_rules(id uuid PRIMARY KEY,game_id uuid,method text,status text)',
   'CREATE TABLE public.regional_calculator_results(id uuid PRIMARY KEY,game_id uuid,method text,published boolean,result jsonb)',
   'CREATE TABLE public.game_parties(id uuid PRIMARY KEY,game_id uuid)',
   'CREATE TABLE public.regional_allocations(rule_id uuid,game_id uuid,party_id uuid,regions integer,source text,updated_at timestamptz DEFAULT now(),PRIMARY KEY(rule_id,party_id))',
   'CREATE FUNCTION private.is_game_teacher(p_game uuid) RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT 1 FROM public.games WHERE id=p_game AND owner_id=auth.uid())$$',
   'CREATE FUNCTION private.valid_party_numbers(uuid,jsonb,integer,boolean) RETURNS boolean LANGUAGE sql AS $$SELECT (SELECT sum(value::integer) FROM jsonb_each_text($2))=$3 AND (SELECT count(*) FROM public.game_parties WHERE game_id=$1)=(SELECT count(*) FROM jsonb_each_text($2))$$'
  ].join(';')+';');
  await query(db,'INSERT INTO public.game_parties VALUES ($1,$3),($2,$3)',[party1,party2,g2]);
  await query(db,"INSERT INTO public.regional_election_rules VALUES($1,$2,'agreement','adopted')",[rule,g2]);
  const result={};result[party1]=50;result[party2]=39;
  await query(db,"INSERT INTO public.regional_calculator_results VALUES($1,$2,'agreement',true,$3)",[calc,g2,JSON.stringify(result)]);
  await db.exec(regional);
  await query(db,'SELECT public.prepare_regional_agreement_from_calculation($1,$2)',[rule,calc]);
  const total=(await query(db,'SELECT sum(regions)::int n FROM public.regional_allocations WHERE rule_id=$1',[rule]))[0].n;
  assert.equal(total,89);
  await assert.rejects(()=>query(db,'SELECT public.prepare_regional_agreement_from_calculation($1,$2)',[rule,calc]),/уже введены/i);
  assert.equal((await query(db,'SELECT status FROM public.regional_election_rules WHERE id=$1',[rule]))[0].status,'adopted');
  console.log('PASS permanent teacher profile, archive, protected avatar, next-game restoration, 89 subject agreement and meeting guide');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
