// Isolated PostgreSQL contract: no requests to the live Supabase project.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const permissionSql=fs.readFileSync('supabase/migrations/20261123020000_state_program_coedit_until_government.sql','utf8');
const migration=fs.readFileSync('supabase/migrations/20261123031500_pm_program_revision_cycle.sql','utf8');
const id=n=>'40000000-0000-0000-0000-'+String(n).padStart(12,'0');
const lab=fs.readFileSync('components/game/StateProgramLab.tsx','utf8');
const editor=fs.readFileSync('components/game/StateProgramEditor.tsx','utf8');
const styles=fs.readFileSync('components/game/StageForms.module.css','utf8');
const meeting=fs.readFileSync('components/game/GovernmentProgramSessionLab.tsx','utf8');
assert(lab.includes("run('request_state_program_revision'"),'Only an explicit PM request may return a programme');
assert(lab.includes('Причина возврата на доработку')&&lab.includes('pmRevisionReason.trim().length<10'),'A reason is mandatory in the existing UI');
assert(lab.includes('Замечания Председателя Правительства'),'Return notes must be visible to authors');
assert(editor.includes('Повторно направить Председателю Правительства'),'PM-returned document must have a distinct send action');
assert(styles.includes('.programWorkspace .programRevisionForm'),'Reuses the approved Stage 10 visual system');
assert(meeting.includes('create_government_session_from_programmes')&&meeting.includes('sync_government_session_programmes')&&meeting.includes('open_program_vote_from_agenda'),'Government agenda and vote remain the existing procedures');


(async()=>{
 const db=new PGlite();
 try{
  await db.exec(`
  CREATE ROLE anon;
  CREATE ROLE authenticated;
  CREATE SCHEMA auth; CREATE SCHEMA private;
  CREATE TABLE public.game_members(game_id uuid,user_id uuid,kind text,role_title text,roster_archived_at timestamptz);
  CREATE TABLE public.state_programs(id uuid PRIMARY KEY,game_id uuid,status text,signed_at timestamptz,created_by uuid,responsible_minister_id uuid,updated_at timestamptz DEFAULT now());
  CREATE TABLE public.institution_units(id uuid PRIMARY KEY,game_id uuid,unit_kind text,head_user_id uuid);
  CREATE TABLE public.institution_assignments(unit_id uuid,game_id uuid,unit_kind text,user_id uuid);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$
    SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $fn$;
  CREATE FUNCTION private.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE AS $fn$ SELECT false $fn$;
  CREATE FUNCTION private.is_game_member(g uuid) RETURNS boolean LANGUAGE sql STABLE AS $fn$
    SELECT EXISTS(SELECT 1 FROM public.game_members WHERE game_id=g AND user_id=auth.uid()) $fn$;
  CREATE FUNCTION private.is_game_teacher(g uuid) RETURNS boolean LANGUAGE sql STABLE AS $fn$
    SELECT EXISTS(SELECT 1 FROM public.game_members WHERE game_id=g AND user_id=auth.uid() AND kind='teacher' AND roster_archived_at IS NULL) $fn$;
  CREATE FUNCTION private.is_game_observer(g uuid) RETURNS boolean LANGUAGE sql STABLE AS $fn$
    SELECT EXISTS(SELECT 1 FROM public.game_members WHERE game_id=g AND user_id=auth.uid() AND kind='observer') $fn$;
  CREATE FUNCTION private.role_is_available(g uuid,u uuid) RETURNS boolean LANGUAGE sql STABLE AS $fn$
    SELECT EXISTS(SELECT 1 FROM public.game_members WHERE game_id=g AND user_id=u AND roster_archived_at IS NULL) $fn$;
  CREATE FUNCTION private.formal_user_roles(g uuid,u uuid) RETURNS SETOF text LANGUAGE sql STABLE AS $fn$
    SELECT role_title FROM public.game_members WHERE game_id=g AND user_id=u AND role_title IS NOT NULL $fn$;
  CREATE FUNCTION private.lock_active_program_actor(g uuid) RETURNS void LANGUAGE plpgsql AS $fn$
    BEGIN RETURN; END $fn$;
  CREATE FUNCTION private.state_program_readiness_json(p_program_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $fn$
    SELECT '{"ready":true,"issues":[]}'::jsonb $fn$;
  `);
  await db.exec(permissionSql);
  await db.exec(migration);
  const game=id(1),program=id(10),second=id(11),pm=id(20),minister=id(21),staff=id(22),outsider=id(23),teacher=id(24),observer=id(25);
  for(const [uid,kind,title] of [
   [pm,'student','Председатель Правительства Российской Федерации'],
   [minister,'student','Министр'],
   [staff,'student','Сотрудник министерства'],
   [outsider,'student','Депутат'],
   [teacher,'teacher','Преподаватель'],
   [observer,'observer','Гость']
  ])await db.query('INSERT INTO public.game_members VALUES($1,$2,$3,$4,NULL)',[game,uid,kind,title]);
  await db.query('INSERT INTO public.institution_units VALUES($1,$2,$3,$4)',[id(30),game,'ministry',minister]);
  await db.query('INSERT INTO public.institution_assignments VALUES($1,$2,$3,$4)',[id(30),game,'ministry',staff]);
  await db.query("INSERT INTO public.state_programs(id,game_id,status,signed_at,created_by,responsible_minister_id) VALUES($1,$2,'minister_review',NULL,$3,$3)",[program,game,minister]);
  await db.query("INSERT INTO public.state_programs(id,game_id,status,signed_at,created_by,responsible_minister_id) VALUES($1,$2,'revision',NULL,$3,$3)",[second,game,minister]);
  const as=async uid=>{await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);};
  const status=async (p=program)=>(await db.query('SELECT status,pm_revision_reason FROM public.state_programs WHERE id=$1',[p])).rows[0];
  await as(minister);
  await db.query("SELECT public.advance_state_program($1,'minister_approve')",[program]);
  assert.equal((await status()).status,'pm_review');
  await assert.rejects(db.query('SELECT public.request_state_program_revision($1,$2)',[program,'Проверьте расходы и показатели'] ),/Только Председатель Правительства/);
  await as(observer);
  await assert.rejects(db.query('SELECT public.request_state_program_revision($1,$2)',[program,'Необходимо доработать расчёт расходов']),/Нет доступа/);
  await as(pm);
  await assert.rejects(db.query('SELECT public.request_state_program_revision($1,$2)',[program,'Мало']),/от 10 до 1500/);
  await assert.rejects(db.query("SELECT public.advance_state_program($1,'pm_revision')",[program]),/Укажите причину/);
  const reason='Уточните показатели и расходы программы перед вынесением на заседание';
  await db.query('SELECT public.request_state_program_revision($1,$2)',[program,reason]);
  assert.deepEqual(await status(),{status:'revision',pm_revision_reason:reason});
  await as(staff);
  assert.equal((await db.query('SELECT private.can_edit_state_program($1,$2) AS allowed',[program,staff])).rows[0].allowed,true);
  await db.query("SELECT public.advance_state_program($1,'submit_minister')",[program]);
  assert.equal((await status()).status,'pm_review','PM-returned programme must bypass another minister review');
  await as(outsider);
  await assert.rejects(db.query('SELECT public.request_state_program_revision($1,$2)',[program,'Верните документ для переработки']),/Только Председатель Правительства/);
  await as(pm);
  await db.query('SELECT public.request_state_program_revision($1,$2)',[program,'Повторно уточните целевые показатели и их измерение']);
  assert.equal((await status()).status,'revision','PM can request a second correction cycle');
  await as(staff);
  await db.query("SELECT public.advance_state_program($1,'submit_minister')",[program]);
  assert.equal((await status()).status,'pm_review');
  await as(pm);
  await db.query("SELECT public.advance_state_program($1,'pm_ready')",[program]);
  assert.equal((await status()).status,'ready','Only PM approval moves programme toward draft agenda');
  await assert.rejects(db.query('SELECT public.request_state_program_revision($1,$2)',[program,reason]),/Возврат доступен только/);
  await as(staff);
  await db.query("SELECT public.advance_state_program($1,'submit_minister')",[second]);
  assert.equal((await status(second)).status,'minister_review','Ordinary revisions still go to minister');
  await db.query("UPDATE public.state_programs SET status='pm_review',signed_at=now() WHERE id=$1",[program]);
  await as(pm);
  await assert.rejects(db.query('SELECT public.request_state_program_revision($1,$2)',[program,reason]),/Возврат доступен только/);
  const grants=await db.query("SELECT has_function_privilege('anon','public.request_state_program_revision(uuid,text)','EXECUTE') AS anonymous,has_function_privilege('authenticated','public.request_state_program_revision(uuid,text)','EXECUTE') AS signed_in");
  assert.equal(grants.rows[0].anonymous,false);
  assert.equal(grants.rows[0].signed_in,true);
  console.log('PASS PM reason required, team edits, repeated return/resubmission, minister route, signed lock, foreign/observer exclusion and RPC grants');
 }finally{await db.close();}
})().catch(err=>{console.error(err);process.exitCode=1});
