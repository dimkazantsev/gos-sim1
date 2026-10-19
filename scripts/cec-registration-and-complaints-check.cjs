const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync('supabase/migrations/20261019235000_cec_manual_document_decisions.sql','utf8');
const complaints=fs.readFileSync('supabase/migrations/20261019235500_stage7_candidate_cec_complaints.sql','utf8');
const ui=fs.readFileSync('components/game/PresidentialElectionLab.tsx','utf8');
const stage7=fs.readFileSync('components/game/PresidentialElectionStage7.tsx','utf8');
const form=fs.readFileSync('components/game/PresidentialCecComplaints.tsx','utf8');
const css=fs.readFileSync('app/stage6-cec-workspace-polish.css','utf8')+fs.readFileSync('app/stage7-election.css','utf8');
for(const s of ["doc.status==='accepted'","doc.status==='revision'","Для регистрации сначала вручную примите каждый обязательный документ","function fillSuggestedDecision", "cecIssueDecision","Основание отказа"])assert(ui.includes(s),s);
assert(!ui.includes('<option value="withdrawn">Снять</option>'),'Stage 6 cannot withdraw candidate');
for(const s of ["Жалобы в ЦИК","<PresidentialCecComplaints","'complaints'"])assert(stage7.includes(s),s);
for(const s of ["Направить жалобу в ЦИК","Принять решение по жалобе","Верховный Суд","registered","referred_court"])assert(form.includes(s),s);
for(const s of ["#stage6-cec .cecIssueDecision",".stage7CecComplaints",".stage7Election .stage7Tabs{grid-template-columns:repeat(4"])assert(css.includes(s),s);
const uid=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0');
(async()=>{
 const db=new PGlite();
 try{
  await db.exec([
   "CREATE SCHEMA private;CREATE SCHEMA auth;",
   "CREATE ROLE authenticated;CREATE ROLE anon;",
   "CREATE TABLE auth.users(id uuid PRIMARY KEY);",
   "CREATE TABLE public.games(id uuid PRIMARY KEY);",
   "CREATE TABLE public.game_members(game_id uuid,user_id uuid,kind text,roster_archived_at timestamptz);",
   "CREATE TABLE public.game_stages(game_id uuid,stage_no integer,status text);",
   "CREATE TABLE public.presidential_candidates(id uuid PRIMARY KEY,game_id uuid,user_id uuid,created_by uuid,display_name text,nomination_type text,registration_status text,archived_at timestamptz,cec_submitted_at timestamptz,registration_number text,registration_decision_no text,registration_decision_at timestamptz,registration_public_summary text,legal_error_count integer,rating_penalty numeric,updated_at timestamptz);",
   "CREATE TABLE public.presidential_candidate_documents(id uuid DEFAULT gen_random_uuid(),candidate_id uuid,doc_kind text,status text,is_submitted boolean,archived_at timestamptz,auto_check jsonb,note text,reviewed_by uuid,updated_at timestamptz);",
   "CREATE TABLE public.presidential_cec_decisions(id uuid DEFAULT gen_random_uuid(),game_id uuid,candidate_id uuid,decision_type text,decision_number text,public_summary text,created_by uuid,reasoning jsonb);",
   "CREATE TABLE public.presidential_cec_private_notes(decision_id uuid,game_id uuid,candidate_id uuid,private_summary text,created_by uuid);",
   "CREATE SEQUENCE public.presidential_cec_decision_seq;",
   "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $f$;",
   "CREATE FUNCTION private.is_game_teacher(g uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT EXISTS(SELECT 1 FROM game_members WHERE game_id=g AND user_id=auth.uid() AND kind='teacher') $f$;",
   "CREATE FUNCTION private.is_game_member(g uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT EXISTS(SELECT 1 FROM game_members WHERE game_id=g AND user_id=auth.uid()) $f$;",
   "CREATE FUNCTION private.presidential_submission_review_json(p_candidate uuid) RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT '{\"items\":[]}'::jsonb $f$;",
   "CREATE FUNCTION public.record_presidential_cec_decision(p_candidate_id uuid,p_status text,p_legal_errors integer,p_rating_penalty numeric,p_public_summary text,p_private_summary text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $f$",
   "declare c public.presidential_candidates%rowtype;v_uid uuid:=(select auth.uid());v_id uuid;v_seq bigint;v_decision_no text;v_registration_no text;v_public text;v_reasoning jsonb;begin",
   "select * into c from public.presidential_candidates where id=p_candidate_id for update;",
   "if c.id is null then raise exception 'Candidate not found';end if;",
   "if not private.is_game_teacher(c.game_id) then raise exception 'Teacher required';end if;",
   "if p_status not in ('registered','revision','rejected','withdrawn') then raise exception 'Unsupported';end if;",
   "v_reasoning:=private.presidential_submission_review_json(c.id);",
   "return gen_random_uuid();end;$f$;"
  ].join('\n'));
  await db.exec(sql);
  await db.exec(complaints);
  const game=uid(1),cand=uid(2),teacher=uid(3),student=uid(4),outsider=uid(5);
  for(const id of [teacher,student,outsider])await db.query('INSERT INTO auth.users(id) VALUES($1)',[id]);
  await db.query('INSERT INTO games(id) VALUES($1)',[game]);
  await db.query("INSERT INTO game_members(game_id,user_id,kind) VALUES($1,$2,'teacher'),($1,$3,'student')",[game,teacher,student]);
  await db.query("INSERT INTO game_stages(game_id,stage_no,status) VALUES($1,7,'open')",[game]);
  await db.query("INSERT INTO presidential_candidates(id,game_id,user_id,created_by,display_name,nomination_type,registration_status,cec_submitted_at) VALUES($1,$2,$3,$3,'Иванов Иван','party','submitted',now())",[cand,game,student]);
  const enter=id=>db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[id]);
  await enter(teacher);
  await assert.rejects(()=>db.query("SELECT public.record_presidential_cec_decision($1,'registered',0,0,'','')",[cand]),/Для регистрации/);
  const kinds=['party_decision','party_egrul','consent','passport','income','real_estate','expenses'];
  for(const k of kinds)await db.query("INSERT INTO presidential_candidate_documents(candidate_id,doc_kind,status,is_submitted) VALUES($1,$2,'accepted',true)",[cand,k]);
  await db.query("SELECT public.record_presidential_cec_decision($1,'registered',0,0,'','')",[cand]);
  await db.query("UPDATE presidential_candidates SET registration_status='registered' WHERE id=$1",[cand]);
  await assert.rejects(()=>db.query("SELECT public.record_presidential_cec_decision($1,'withdrawn',0,0,'','')",[cand]),/Unsupported|Окончательное/);
  await enter(student);
  const filed=await db.query("SELECT public.submit_presidential_cec_complaint($1,$2,$3,$4) AS id",[cand,'Нарушения агитации','Просим проверить конкретный материал и возможные нарушения правил предвыборной агитации.','ФЗ № 19-ФЗ']);
  const id=filed.rows[0].id;
  await enter(outsider);
  await assert.rejects(()=>db.query("SELECT public.submit_presidential_cec_complaint($1,$2,$3,NULL)",[cand,'Заголовок жалобы','Текст жалобы достаточной длины без права участия в конкретной игре']),/действующий участник/);
  await assert.rejects(()=>db.query("SELECT public.resolve_presidential_cec_complaint($1,'removed',$2)",[id,'Федеральный закон № 19-ФЗ, статья 84. Проверено ЦИК']),/только ЦИК/);
  await enter(teacher);
  await db.query("SELECT public.resolve_presidential_cec_complaint($1,'referred_court',$2)",[id,'Материалы по делу № 1 направлены на рассмотрение Верховного Суда Российской Федерации.']);
  const caseRows=(await db.query('SELECT case_number,case_status FROM presidential_cec_court_referrals WHERE complaint_id=$1',[id])).rows;
  assert.equal(caseRows.length,1,'Court referral must create a case record');
  assert.equal(caseRows[0].case_status,'awaiting_court','Referral awaits judicial review');
  assert.match(caseRows[0].case_number,/^ВС-/);
  const state=(await db.query('SELECT registration_status FROM presidential_candidates WHERE id=$1',[cand])).rows[0].registration_status;
  assert.equal(state,'registered','Referral must not remove candidate');
  await assert.rejects(()=>db.query("SELECT public.resolve_presidential_cec_complaint($1,'removed',$2)",[id,'Статья 84 ФЗ № 19-ФЗ: иное решение']),/уже принято/);
  console.log('PASS: manual acceptance gates registration; Stage6 cannot withdraw; Stage7 complaint submission, role separation, no double decision, court referral preserves registration; UI and mobile rules.');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});