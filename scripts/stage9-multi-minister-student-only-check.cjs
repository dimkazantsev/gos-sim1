/* Isolated PGlite regression: 2 students can hold 5 distinct ministry offices.
 * No production database, auth user or game result is modified. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const code=fs.readFileSync('supabase/migrations/20261021170000_multi_ministry_student_only.sql','utf8');
const ui=fs.readFileSync('components/game/GovernmentFormationWorkspace.tsx','utf8');
assert(code.includes('DROP INDEX IF EXISTS public.government_nominations_one_ministry_candidate_idx'));
assert(code.includes('DROP INDEX IF EXISTS public.institution_assignments_single_ministry_per_student'));
assert((code.match(/on conflict\(unit_id,user_id\)/g)||[]).length>=3);
assert(code.includes('Minister must be a registered active student'));
assert(code.includes('Candidate name must match the selected registered student'));
assert(ui.includes('registeredOnly')&&ui.includes('!selected[slot]'));
assert(!ui.includes('Нет активных участников — используйте Ф.И.О.'));
const game='10000000-0000-4000-8000-000000000001',
 p='30000000-0000-4000-8000-000000000001',
 a='30000000-0000-4000-8000-000000000001',
 b='30000000-0000-4000-8000-000000000002';
(async()=>{
 const db=new PGlite();
 try{
  await db.exec([
   'CREATE SCHEMA IF NOT EXISTS auth; CREATE SCHEMA IF NOT EXISTS private;',
   "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.test_uid',true),'')::uuid $$;",
   "CREATE TABLE public.games(id uuid PRIMARY KEY)",
   "CREATE TABLE public.game_members(game_id uuid,user_id uuid,kind text,full_name text,role_title text,roster_archived_at timestamptz)",
   "CREATE TABLE public.game_parties(id uuid,leader_user_id uuid)",
   "CREATE TABLE public.party_member_mandates(game_id uuid,user_id uuid,base_mandates int)",
   "CREATE TABLE public.government_structures(game_id uuid,status text,social_title text,economic_title text,defence_title text,foreign_title text,internal_title text)",
   "CREATE TABLE public.government_nominations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),game_id uuid,stage_no int,office_key text,office_title text,office_kind text,route text,candidate_user_id uuid,candidate_name text,attempt_no int,status text,nominated_by uuid,formal_document_id uuid,vote_id uuid,appointment_document_id uuid,appointed_at timestamptz,decided_at timestamptz,updated_at timestamptz,note text)",
   "CREATE UNIQUE INDEX government_nominations_one_ministry_candidate_idx ON public.government_nominations(game_id,candidate_user_id) WHERE candidate_user_id IS NOT NULL AND office_kind IN ('deputy_pm','duma_minister','security_minister') AND status NOT IN ('rejected','withdrawn')",
   "CREATE TABLE public.institution_units(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),game_id uuid,unit_kind text,unit_key text,title text,description text,capacity_min int,capacity_max int,head_user_id uuid)",
   "CREATE UNIQUE INDEX institution_units_game_id_unit_kind_unit_key_key ON public.institution_units(game_id,unit_kind,unit_key)",
   "CREATE TABLE public.institution_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),game_id uuid,unit_id uuid,unit_kind text,user_id uuid,party_id uuid,assignment_role text DEFAULT 'member',created_by uuid,created_at timestamptz DEFAULT now(), UNIQUE(unit_id,user_id))",
   "CREATE UNIQUE INDEX institution_assignments_single_ministry_per_student ON public.institution_assignments(game_id,user_id) WHERE unit_kind='ministry'",
   "CREATE FUNCTION private.is_game_member(g uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM public.game_members WHERE game_id=g AND user_id=auth.uid() AND roster_archived_at IS NULL) $$",
   "CREATE FUNCTION private.is_game_observer(g uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$",
   "CREATE FUNCTION private.is_game_teacher(g uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$",
   "CREATE FUNCTION private.is_appointed_pm(g uuid, actor uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT actor=auth.uid() $$",
   "CREATE FUNCTION private.game_role(g uuid,actor uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT lower(coalesce((select role_title from public.game_members where game_id=g and user_id=actor limit 1),'')) $$",
   "CREATE FUNCTION private.stage8_create_formal_document(g uuid,title text,typ text,subj text,issuer text,body text,route text,step int,meta jsonb) RETURNS uuid LANGUAGE sql AS $$ SELECT gen_random_uuid() $$",
   "CREATE FUNCTION private.ensure_government_nomination_vote(n uuid) RETURNS void LANGUAGE sql AS $ SELECT NULL::void $",
   "CREATE FUNCTION private.member_party_id(g uuid,u uuid) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT null::uuid $$",
   "CREATE FUNCTION private.stage8_create_appointment_decree(n uuid) RETURNS uuid LANGUAGE sql AS $$ SELECT gen_random_uuid() $$"
  ].join(';\n')+';');
  await db.exec(code);
  await db.query('INSERT INTO public.games(id) VALUES($1)',[game]);
  await db.query('INSERT INTO public.game_members VALUES($1,$2,$3,$4,$5,NULL),($1,$6,$3,$7,$8,NULL)',
    [game,a,'student','Иванов Иван Иванович','Председатель Правительства',b,'Тестов Тест Тестович','Президент Российской Федерации']);
  await db.query("INSERT INTO public.government_nominations(game_id,stage_no,office_key,office_title,office_kind,route,candidate_user_id,candidate_name,attempt_no,status,nominated_by) VALUES($1,8,'prime_minister','Председатель Правительства','prime_minister','president_to_duma',$2,'Председатель Правительства',1,'appointed',$2)",[game,p]);
  await db.query("INSERT INTO public.government_structures(game_id,status,social_title,economic_title,foreign_title,defence_title,internal_title) VALUES($1,'approved','Социальное','Экономическое','Внешнее','Обороны','Внутреннее')",[game]);
  await db.query("SELECT set_config('app.test_uid',$1,false)",[p]);
  const nominate=(slot,uid,name,kind)=>db.query(
   "SELECT public.submit_government_nomination($1,$2,$3,$4,$5,$6) id",
   [game,'ministry_'+slot,'Министерство '+slot,kind||'duma_minister',uid,name]);
  await assert.rejects(()=>nominate('social',null,'Произвольный персонаж'),/registered active student/);
  await assert.rejects(()=>nominate('social',a,'Ошибочный Иванов'),/name must match/);
  await assert.rejects(()=>nominate('social','30000000-0000-4000-8000-000000000099','Участник другой игры'),/game participant/);
  const one=(await nominate('social',a,'Иванов Иван Иванович')).rows[0].id;
  const two=(await nominate('economic',a,'Иванов Иван Иванович')).rows[0].id;
  const three=(await nominate('foreign',a,'Иванов Иван Иванович')).rows[0].id;
  await db.query("SELECT set_config('app.test_uid',$1,false)",[b]);
  const four=(await nominate('defence',b,'Тестов Тест Тестович','security_minister')).rows[0].id;
  const five=(await nominate('internal',b,'Тестов Тест Тестович','security_minister')).rows[0].id;
  assert.equal(new Set([one,two,three,four,five]).size,5,'Five distinct minister nominations');
  await db.query("SELECT set_config('app.test_uid',$1,false)",[a]);
  await assert.rejects(()=>nominate('social',b,'Тестов Тест Тестович'),/already has an active nomination/);
  await db.query("UPDATE public.government_nominations SET status='appointed' WHERE stage_no=9");
  for(const [unit,head] of [['social',a],['economic',a],['foreign',a],['defence',b],['internal',b]]){
   const q=await db.query("INSERT INTO public.institution_units(game_id,unit_kind,unit_key,title) VALUES($1,'ministry',$2,$2) RETURNING id",[game,unit]);
   await db.query("INSERT INTO public.institution_assignments(game_id,unit_id,unit_kind,user_id,created_by,assignment_role) VALUES($1,$2,'ministry',$3,$4,'head') ON CONFLICT(unit_id,user_id) DO UPDATE SET assignment_role='head'",[game,q.rows[0].id,head,p]);
  }
  const assignments=(await db.query("SELECT user_id,count(*)::int cnt FROM public.institution_assignments WHERE unit_kind='ministry' GROUP BY user_id ORDER BY cnt DESC")).rows;
  assert.deepEqual(assignments.map(x=>x.cnt),[3,2]);
  const unit=(await db.query("SELECT id FROM public.institution_units WHERE unit_key='social'")).rows[0].id;
  await db.query("INSERT INTO public.institution_assignments(game_id,unit_id,unit_kind,user_id,created_by) VALUES($1,$2,'ministry',$3,$4) ON CONFLICT(unit_id,user_id) DO UPDATE SET created_by=EXCLUDED.created_by",[game,unit,b,p]);
  const counts=(await db.query("SELECT unit_key,count(a.id)::int n FROM public.institution_units u JOIN public.institution_assignments a ON a.unit_id=u.id GROUP BY unit_key ORDER BY unit_key")).rows;
  assert.equal(counts.length,5);
  assert.equal(counts.find(x=>x.unit_key==='social').n,2);
  console.log('PASS: 2 registered students, 5 ministries, repeated appointments, single record per ministry, no unregistered/spoofed names, independent staffing');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});