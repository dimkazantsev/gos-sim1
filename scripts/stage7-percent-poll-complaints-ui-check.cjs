const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const stage=fs.readFileSync('components/game/PresidentialElectionStage7.tsx','utf8');
const complaint=fs.readFileSync('components/game/PresidentialCecComplaints.tsx','utf8');
const calculator=fs.readFileSync('components/game/PresidentialRulesCalculator.tsx','utf8');
const css=fs.readFileSync('app/stage7-election.css','utf8');
const sql=fs.readFileSync('supabase/migrations/20261020041000_presidential_manual_rating_pct_and_poll_stage6.sql','utf8');
assert(stage.includes("const pollApproved=decision?.status==='closed'&&decision.result===true"));
assert(stage.includes("pollApproved&&<button"));
assert(stage.includes("pollApproved?'03':'02'"));
assert(stage.includes("pollApproved={pollApproved}"));
assert(stage.includes("pollApproved&&row.poll!=null"));
assert(complaint.includes("useSavedGameState(gameId,me?.user_id"));
assert(complaint.includes("const selectedCandidateId=registered.some"));
assert(complaint.includes("p_candidate_id:selectedCandidateId"));
assert(!complaint.includes("setCandidateId('');setMessage"));
assert(calculator.includes("set_presidential_rules_percentage"));
assert(calculator.includes("x.game_pct??0"));
assert(calculator.includes("max=\"100\" step=\"0.01\" value={drafts[x.candidate_id]?.gamePercent"));
assert(calculator.includes("pollApproved&&<label"));
assert(!calculator.includes("p_game_points:Number"));
assert(css.includes(".stage7Election .campaignForm .campaignSubmit button{display:flex;justify-content:center;align-items:center;width:100%"));
assert(css.includes(".stage7Election .campaignForm .campaignSubmit{display:grid"));
assert(sql.includes("game_rating_manual_pct"));
assert(sql.includes("coalesce(c.manual_pct"));
assert(sql.includes("v_poll_enabled"));
assert(sql.includes("s.poll_enabled','v_poll_enabled"));
assert(sql.includes("Не удалось сформировать защищённую формулу рейтинга"));
const uid=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0');
(async()=>{
 const db=new PGlite();
 try{
  await db.exec(`
   CREATE SCHEMA auth; CREATE SCHEMA private;
   CREATE TABLE game_members(game_id uuid,user_id uuid,kind text,roster_archived_at timestamptz);
   CREATE TABLE presidential_candidates(id uuid PRIMARY KEY,game_id uuid,archived_at timestamptz,registration_status text);
   CREATE TABLE presidential_election_settings(game_id uuid PRIMARY KEY,status text);
   CREATE TABLE presidential_poll_decision(game_id uuid PRIMARY KEY,status text,result boolean);
   CREATE TABLE presidential_scorecards(
    game_id uuid,candidate_id uuid,round_no integer,game_rating_manual_pct numeric,
    game_rating_points numeric,poll_pct numeric,updated_by uuid,
    computed_pct numeric,unrounded_pct numeric,updated_at timestamptz DEFAULT now(),
    UNIQUE(candidate_id,round_no)
   );
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
   SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $f$;
   CREATE FUNCTION private.is_game_teacher(g uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$
   SELECT EXISTS(SELECT 1 FROM game_members m WHERE m.game_id=g AND m.user_id=auth.uid() AND m.kind='teacher' AND m.roster_archived_at IS NULL) $f$;
   CREATE FUNCTION private.require_active_presidential_teacher(g uuid) RETURNS void LANGUAGE plpgsql AS $f$
   BEGIN IF NOT private.is_game_teacher(g) THEN RAISE EXCEPTION 'Нет полномочий ЦИК';END IF;END $f$;
  `);
  const game=uid(1),candidate=uid(2),teacher=uid(3);
  await db.query("INSERT INTO presidential_candidates VALUES ($1,$2,NULL,'registered')",[candidate,game]);
  await db.query("INSERT INTO presidential_election_settings VALUES ($1,'setup')",[game]);
  await db.query("INSERT INTO presidential_poll_decision VALUES($1,'closed',false)",[game]);
  await db.query("INSERT INTO game_members VALUES ($1,$2,'teacher',NULL)",[game,teacher]);
  await db.query("INSERT INTO presidential_scorecards(game_id,candidate_id,round_no,game_rating_points) VALUES($1,$2,1,60)",[game,candidate]);
  const rpc=sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.set_presidential_rules_percentage('),sql.indexOf('REVOKE ALL ON FUNCTION public.set_presidential_rules_percentage'));
  assert(rpc.includes('CREATE OR REPLACE FUNCTION'));
  await db.exec(rpc);
  const auth=async id=>{await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[id]);};
  const save=async(game_pct,poll_pct)=>db.query('SELECT public.set_presidential_rules_percentage($1,$2,$3)',[candidate,game_pct,poll_pct]);
  await auth(teacher);
  await save(0,null);
  let row=(await db.query("SELECT game_rating_manual_pct,game_rating_points,poll_pct FROM presidential_scorecards WHERE candidate_id=$1",[candidate])).rows[0];
  assert.equal(Number(row.game_rating_manual_pct),0);assert.equal(Number(row.game_rating_points),60);assert.equal(row.poll_pct,null);
  await assert.rejects(()=>save(101,null),/0 до 100/);
  await assert.rejects(()=>save(-1,null),/0 до 100/);
  await assert.rejects(()=>save(55,40),/не утверждён/);
  await db.query("UPDATE presidential_poll_decision SET result=true WHERE game_id=$1",[game]);
  await save(87.5,60);
  row=(await db.query("SELECT game_rating_manual_pct,game_rating_points,poll_pct FROM presidential_scorecards WHERE candidate_id=$1",[candidate])).rows[0];
  assert.equal(Number(row.game_rating_manual_pct),87.5);
  assert.equal(Number(row.game_rating_points),60);
  assert.equal(Number(row.poll_pct),60);
  for(let i=0;i<40;i++){
   const student=uid(100+i);
   await db.query("INSERT INTO game_members VALUES($1,$2,'student',NULL)",[game,student]);
   await auth(student);
   await assert.rejects(()=>save(99,null),/Нет полномочий ЦИК/);
  }
  await auth(teacher);
  await db.query("UPDATE presidential_election_settings SET status='finished' WHERE game_id=$1",[game]);
  await assert.rejects(()=>save(90,10),/Первый тур закрыт/);
  console.log('PASS: кнопка внизу на всю ширину, выбор кандидата, решение об опросе, проценты 0–100, исторические баллы, 40 запрещённых записей, замороженные итоги.');
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
