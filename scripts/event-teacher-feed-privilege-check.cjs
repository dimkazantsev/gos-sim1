'use strict';
/* Isolated, local PG security regression: no production connection. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync(path.join(__dirname,'..','supabase/migrations/20261120180557_restore_teacher_event_feed_without_exposing_case_answers.sql'),'utf8');
const feed=fs.readFileSync(path.join(__dirname,'../components/game/EventWorkspace.tsx'),'utf8');
assert(sql.includes("private.is_game_member(p_game_id)"),'Game membership required');
assert(sql.includes('v_teacher:=private.is_game_teacher(p_game_id)'), 'Teacher still sees all cases');
assert(sql.includes('o.case_id=ANY(p_case_ids)'), 'Student is limited to requested cases');
assert(sql.includes('a.recipient_id=v_actor')&&sql.includes('i.recipient_id=v_actor'),'Require own assignment or invitation');
assert(sql.includes("o.winner ~ '^option_[1-9][0-9]*$'"),'Only selected winning options can disclose effects');
assert(sql.includes('SECURITY DEFINER')&&sql.includes('REVOKE ALL ON FUNCTION private.event_winning_outcomes_visible'),'Helper is private and guarded');
assert(sql.includes('private.event_winning_outcomes_visible(p_game_id,v_cases)'),'Original invoker projection calls the guard once');
assert(!sql.includes('GRANT SELECT ON public.event_cases'),'Never grant access to hidden answer keys');
assert(!/CREATE (TABLE|TRIGGER)|CREATE SUBSCRIPTION/i.test(sql),'No added tables or subscriptions');
assert(feed.includes("supabase.rpc('get_event_workspace_feed_bootstrap'"),'No extra browser RPC');
const helperStart=sql.indexOf('CREATE OR REPLACE FUNCTION private.event_winning_outcomes_visible');
const projectStart=sql.indexOf('CREATE OR REPLACE FUNCTION public.get_event_workspace_projection');
assert(helperStart>=0&&projectStart>helperStart);
const helper=sql.slice(helperStart,projectStart);
const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
(async()=>{
 const db=new PGlite();
 try {
  await db.exec(`
  CREATE ROLE authenticated; CREATE ROLE anon;
  CREATE SCHEMA auth;CREATE SCHEMA private;
  CREATE TABLE public.game_members(game_id uuid,user_id uuid,kind text,roster_archived_at timestamptz);
  CREATE TABLE public.event_assignments(game_id uuid,case_id uuid,recipient_id uuid);
  CREATE TABLE public.event_collaboration_invites(game_id uuid,case_id uuid,recipient_id uuid);
  CREATE TABLE public.event_cases(id uuid PRIMARY KEY,game_id uuid,effect_plan jsonb);
  CREATE TABLE public.event_case_outcomes(game_id uuid,case_id uuid,winner text);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
    AS $f$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $f$;
  CREATE FUNCTION private.is_game_member(g uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
    AS $f$ SELECT EXISTS(SELECT 1 FROM public.game_members m WHERE m.game_id=g AND m.user_id=auth.uid() AND m.roster_archived_at IS NULL) $f$;
  CREATE FUNCTION private.is_game_teacher(g uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
    AS $f$ SELECT EXISTS(SELECT 1 FROM public.game_members m WHERE m.game_id=g AND m.user_id=auth.uid() AND m.kind='teacher' AND m.roster_archived_at IS NULL) $f$;
  ALTER TABLE public.event_cases ENABLE ROW LEVEL SECURITY;
  CREATE POLICY event_member ON public.event_cases FOR SELECT TO authenticated USING(private.is_game_member(game_id));
  GRANT USAGE ON SCHEMA public,auth,private TO authenticated;
  GRANT EXECUTE ON FUNCTION auth.uid(),private.is_game_member(uuid),private.is_game_teacher(uuid) TO authenticated;
  GRANT SELECT(id,game_id) ON public.event_cases TO authenticated;
  `);
  const game=id(101),foreign=id(102),teacher=id(1),student=id(2),another=id(3),observer=id(4),outsider=id(5);
  const one=id(201),two=id(202),foreignCase=id(203);
  await db.query("INSERT INTO public.game_members VALUES ($1,$2,'teacher',NULL),($1,$3,'student',NULL),($1,$4,'student',NULL),($1,$5,'observer',NULL),($6,$7,'student',NULL)",[game,teacher,student,another,observer,foreign,outsider]);
  await db.query("INSERT INTO public.event_assignments VALUES ($1,$2,$3),($1,$4,$5),($6,$7,$8)",[game,one,student,two,another,foreign,foreignCase,outsider]);
  await db.query("INSERT INTO public.event_cases VALUES($1,$2,$3::jsonb),($4,$2,$5::jsonb),($6,$7,$8::jsonb)",[
   one,game,JSON.stringify({options:[{description:'SECRET_FIRST_OPTION',fiscal_effect:{activity:999}},{description:'WIN_ONE',fiscal_effect:{activity:2}}]}),
   two,JSON.stringify({options:[{description:'WIN_TWO',fiscal_effect:{cost:1}},{description:'SECRET_SECOND_OPTION'}]}),
   foreignCase,foreign,JSON.stringify({options:[{description:'FOREIGN_WIN'}]})
  ]);
  await db.query("INSERT INTO public.event_case_outcomes VALUES ($1,$2,'option_2'),($1,$3,'option_1'),($4,$5,'option_1')",[game,one,two,foreign,foreignCase]);
  await db.exec(helper);
  const auth=async who=>{await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[who]);await db.exec('SET ROLE authenticated')};
  const read=async (cases=[]) => (await db.query('SELECT private.event_winning_outcomes_visible($1,$2::uuid[]) AS result',[game,cases])).rows[0].result;
  await auth(teacher);
  const full=await read();
  assert.equal(Object.keys(full).length,2,'Teacher sees all two completed game cases');
  assert.equal(full[one].winning_description,'WIN_ONE');
  assert.equal(full[two].winning_description,'WIN_TWO');
  assert(!JSON.stringify(full).includes('SECRET_'),'Nonwinning options are never returned');
  assert(!JSON.stringify(full).includes('FOREIGN_WIN'),'Results are isolated per game');
  assert.equal((await db.query("SELECT has_column_privilege('authenticated','public.event_cases','effect_plan','SELECT') allowed")).rows[0].allowed,false);
  await auth(student);
  const mine=await read([one,two]);
  assert.deepEqual(Object.keys(mine),[one],'Student cannot elevate access by requesting someone else\'s case');
  assert.equal(mine[one].winning_fiscal_effect.activity,2);
  await auth(another);
  const theirs=await read([one,two]); assert.deepEqual(Object.keys(theirs),[two]);
  await auth(observer);
  assert.equal(Object.keys(await read()).length,2,'Read-only observer gets already decided outcomes');
  await auth(outsider);
  await assert.rejects(()=>read([one]),/Нет доступа|42501|permission denied/,'Other-game user is denied');
  console.log('PASS: teacher 2/2, student 1/2, other student 1/2, observer result-only, foreign game excluded, secret answers closed, no extra browser read');
 }finally {await db.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
