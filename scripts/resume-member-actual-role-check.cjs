/* Real Postgres role-resume RPC in a disposable PGlite database. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync('supabase/migrations/20261027102500_resume_existing_member_actual_role.sql','utf8');
const start=migration.indexOf('CREATE OR REPLACE FUNCTION public.resume_member_game_as_role(');
if(start<0)throw Error('Missing role-resume function');
const clean=migration.slice(start);
const uuid=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
(async()=>{
 const db=new PGlite();
 try{
  await db.exec(`
   CREATE SCHEMA auth;
   CREATE ROLE anon; CREATE ROLE authenticated;
   CREATE TYPE public.member_kind AS ENUM ('student','teacher','observer');
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
    $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
   CREATE TABLE public.games(id uuid PRIMARY KEY,game_code text);
   CREATE TABLE public.game_members(game_id uuid,user_id uuid,kind public.member_kind,roster_archived_at timestamptz,PRIMARY KEY(game_id,user_id));
   CREATE TABLE public.platform_admins(user_id uuid PRIMARY KEY);
   CREATE TABLE public.teacher_profiles(user_id uuid PRIMARY KEY);
   CREATE TABLE public.game_member_access_blocks(game_id uuid,user_id uuid,PRIMARY KEY(game_id,user_id));
  `);
  await db.exec(`
   INSERT INTO public.games VALUES ('${uuid(101)}','TEST-ACCESS'),('${uuid(102)}','OTHER');
   INSERT INTO public.game_members VALUES
    ('${uuid(101)}','${uuid(1)}','student',null),
    ('${uuid(101)}','${uuid(2)}','observer',null),
    ('${uuid(101)}','${uuid(3)}','teacher',null),
    ('${uuid(101)}','${uuid(4)}','student',now()),
    ('${uuid(101)}','${uuid(5)}','student',null),
    ('${uuid(101)}','${uuid(6)}','student',null),
    ('${uuid(101)}','${uuid(7)}','student',null),
    ('${uuid(102)}','${uuid(8)}','student',null);
   INSERT INTO public.platform_admins VALUES ('${uuid(6)}');
   INSERT INTO public.teacher_profiles VALUES ('${uuid(7)}');
   INSERT INTO public.game_member_access_blocks VALUES ('${uuid(101)}','${uuid(5)}');
  `);
  await db.exec(clean);
  let passed=0;
  const login=async(user,expected,code='TEST-ACCESS',anonymous=false)=>{
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user?uuid(user):'']);
   await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({is_anonymous:anonymous})]);
   return (await db.query('SELECT public.resume_member_game_as_role($1,$2::public.member_kind) game',[code,expected])).rows[0].game;
  };
  for(const [user,selected,actual] of [
   [1,'student','student'],[1,'observer','student'],
   [2,'student','observer'],[2,'observer','observer']
  ]){
   assert.equal(await login(user,selected),uuid(101));
   const kind=(await db.query('SELECT kind::text FROM public.game_members WHERE game_id=$1 AND user_id=$2',[uuid(101),uuid(user)])).rows[0].kind;
   assert.equal(kind,actual,'Stored membership must never change');
   passed++;
  }
  for(const [label,user,role,game,anonymous] of [
   ['teacher cannot impersonate student',3,'student','TEST-ACCESS',false],
   ['archived member blocked',4,'student','TEST-ACCESS',false],
   ['excluded member blocked',5,'student','TEST-ACCESS',false],
   ['platform admin blocked',6,'student','TEST-ACCESS',false],
   ['teacher profile blocked',7,'student','TEST-ACCESS',false],
   ['other game membership blocked',8,'student','TEST-ACCESS',false],
   ['wrong game code blocked',1,'student','WRONG',false],
   ['teacher role not accepted',1,'teacher','TEST-ACCESS',false],
   ['anonymous account blocked',1,'student','TEST-ACCESS',true],
   ['unauthenticated blocked',null,'student','TEST-ACCESS',false]
  ]){
   await assert.rejects(login(user,role,game,anonymous),/42501|учётной записи|Войдите|Откройте|преподавателя/i,label);
   passed++;
  }
  const count=(await db.query('SELECT count(*)::int count FROM public.game_members')).rows[0].count;
  assert.equal(count,8,'Resume must not create, update or delete membership');
  console.log('PASS password resume: '+passed+' isolated role and negative tests; no membership mutations');
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
