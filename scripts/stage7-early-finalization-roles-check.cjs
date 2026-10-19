const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');

const sql=fs.readFileSync('supabase/migrations/20261020060000_presidential_early_teacher_finalization.sql','utf8');
const calc=fs.readFileSync('components/game/PresidentialRulesCalculator.tsx','utf8');
const modal=fs.readFileSync('components/game/PresidentialEarlyFinishDialog.tsx','utf8');
const css=fs.readFileSync('app/stage7-election.css','utf8');
assert(calc.includes("finalize_presidential_round_early"));
assert(calc.includes("setConfirmRound(round)"));
assert(calc.includes("dirty.current.size>0"));
assert(calc.includes("visibleGamePct(x)"));
assert(calc.includes("Не сохранено"));
assert(modal.includes('useDialog(true'));
assert(modal.includes('aria-modal="true"'));
assert(modal.includes('Вы уверены, что хотите закончить выборы ранее?'));
assert(modal.includes('Нет, вернуться'));
assert(modal.includes('Да, зафиксировать итог'));
assert(css.includes('.stage7Election .stage7Tabs{gap:12px'));
assert(css.includes('.cecEarlyBackdrop{position:fixed'));
assert(css.includes('.stage7CecComplaints .cecComplaintForm>.stage7Notice'));
const id=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0');
(async()=>{
 const db=new PGlite();
 try{
  await db.exec(`
   DO $roles$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
   END $roles$;
   CREATE SCHEMA auth; CREATE SCHEMA private;
   CREATE TABLE game_members(game_id uuid,user_id uuid,kind text,roster_archived_at timestamptz);
   CREATE TABLE presidential_student_system_result(game_id uuid);
   CREATE TABLE presidential_election_schedule(game_id uuid,voting_day date);
   CREATE TABLE presidential_election_settings(game_id uuid PRIMARY KEY,status text,result jsonb);
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
     SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $f$;
   CREATE FUNCTION private.is_game_teacher(g uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$
     SELECT EXISTS(SELECT 1 FROM game_members WHERE game_id=g AND user_id=auth.uid() AND kind='teacher' AND roster_archived_at IS NULL) $f$;
   CREATE FUNCTION private.require_active_presidential_teacher(g uuid) RETURNS void LANGUAGE plpgsql AS $f$
    BEGIN IF NOT private.is_game_teacher(g) THEN RAISE EXCEPTION 'Teacher access required'; END IF; END $f$;
   CREATE FUNCTION private.presidential_author_result(g uuid,round_no integer) RETURNS jsonb LANGUAGE sql STABLE AS $f$
     SELECT jsonb_build_object('ready',true,'rows','[]'::jsonb) $f$;
   CREATE OR REPLACE FUNCTION public.finalize_presidential_round(p_game_id uuid, p_round_no integer)
   RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,private,pg_temp
   AS $function$
   declare s presidential_election_settings%rowtype;r jsonb;
   begin
    if not exists(select 1 from public.presidential_student_system_result where game_id=p_game_id)
    then raise exception 'Этап 6 не завершён';end if;
    if not exists(select 1 from public.presidential_election_schedule where game_id=p_game_id
    and now() at time zone 'Asia/Barnaul' >= voting_day::timestamp+interval '20 hours')
    then raise exception 'Расчёт итогов возможен не ранее 20:00 третьего дня выборов';end if;
    perform private.require_active_presidential_teacher(p_game_id);
    if auth.uid() is null or not private.is_game_teacher(p_game_id) then raise exception 'Teacher access required';end if;
    select * into s from presidential_election_settings where game_id=p_game_id for update;
    if s.game_id is null then raise exception 'Система выборов не утверждена';end if;
    if s.status='finished' then return s.result;end if;
    if (p_round_no=1 and s.status not in ('setup','round1')) or (p_round_no=2 and s.status<>'runoff') or p_round_no is null or p_round_no not in (1,2) then raise exception 'Неверное состояние тура';end if;
    r:=private.presidential_author_result(p_game_id,p_round_no);
    if not coalesce((r->>'ready')::boolean,false) then raise exception 'Недостаточно данных';end if;
    update public.presidential_election_settings set status='finished',result=jsonb_build_object('round',p_round_no,'status','finished','rules_version',2)
    where game_id=p_game_id;
    return (select result from public.presidential_election_settings where game_id=p_game_id);
   end;$function$;
  `);
  await db.exec(sql);
  const teacher=id(1),game=id(2),game2=id(3);
  await db.query("INSERT INTO game_members VALUES ($1,$2,'teacher',NULL)",[game,teacher]);
  await db.query("INSERT INTO game_members VALUES ($1,$2,'teacher',NULL)",[game2,teacher]);
  await db.query('INSERT INTO presidential_student_system_result VALUES($1),($2)',[game,game2]);
  await db.query("INSERT INTO presidential_election_schedule VALUES($1,current_date+interval '14 days'),($2,current_date+interval '14 days')",[game,game2]);
  await db.query("INSERT INTO presidential_election_settings VALUES($1,'round1','{}'),($2,'runoff','{}')",[game,game2]);
  const as=async who=>db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[who]);
  await as(teacher);
  await assert.rejects(()=>db.query('SELECT public.finalize_presidential_round($1,1)',[game]),/не ранее 20:00/);
  let result=(await db.query('SELECT public.finalize_presidential_round_early($1,1) AS value',[game])).rows[0].value;
  assert.equal(result.status,'finished');
  result=(await db.query('SELECT public.finalize_presidential_round_early($1,1) AS value',[game])).rows[0].value;
  assert.equal(result.status,'finished','повторный вызов не меняет итог');
  await assert.rejects(()=>db.query('SELECT public.finalize_presidential_round($1,2)',[game2]),/не ранее 20:00/);
  result=(await db.query('SELECT public.finalize_presidential_round_early($1,2) AS value',[game2])).rows[0].value;
  assert.equal(result.round,2);
  for(let i=0;i<40;i++){
   const student=id(100+i);
   await db.query("INSERT INTO game_members VALUES($1,$2,'student',NULL)",[game,student]);
   await as(student);
   await assert.rejects(()=>db.query('SELECT public.finalize_presidential_round_early($1,1)',[game]),/Teacher access required/);
  }
  await as(teacher);
  await db.query("UPDATE game_members SET roster_archived_at=now() WHERE game_id=$1 AND user_id=$2",[game2,teacher]);
  await assert.rejects(()=>db.query('SELECT public.finalize_presidential_round_early($1,2)',[game2]),/Teacher access required/);
  console.log('PASS: стандартный срок, оба досрочных тура, повтор без изменений, права 40 студентов, архивный преподаватель, интерфейс и модалка.');
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
