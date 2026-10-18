const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync('supabase/migrations/20261019085000_presidential_stage6_personal_vote_three_day_schedule.sql','utf8');
const cec=fs.readFileSync('supabase/migrations/20261019090000_presidential_cec_protocol_office_and_time.sql','utf8');
const stage=fs.readFileSync('components/game/GovernanceStageWorkspace.tsx','utf8');
const stage6=fs.readFileSync('components/game/PresidentialStage6CivicVote.tsx','utf8');
const stage7=fs.readFileSync('components/game/PresidentialElectionStage7.tsx','utf8');
const calc=fs.readFileSync('components/game/PresidentialRulesCalculator.tsx','utf8');
const lab=fs.readFileSync('components/game/PresidentialElectionLab.tsx','utf8');
const preview=fs.readFileSync('components/game/PresidentialCecPublicationPanel.tsx','utf8');
const uid=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0');
const fn=(text,name)=>{
 const re=new RegExp('CREATE OR REPLACE FUNCTION public\\.'+name+'\\([\\s\\S]*?\\$fn\\$;');
 const m=text.match(re);assert(m,'Missing SQL function '+name);return m[0];
};
assert(stage.includes('stage.stage_no===6&&<PresidentialStage6CivicVote')&&!stage.includes('stageNo={6} onOpenVotes'),'Stage 6 moves from parliamentary amendment to personal vote');
assert(stage.includes('stage.stage_no===7&&<><PresidentialElectionLab'),'CEC and candidates moved to Stage 7');
assert(lab.includes('systemDecisionComplete')&&lab.includes('currentStage?.stage_no===7'),'Only approved student decision opens CEC stage 7');
assert(stage7.includes('РЕШЕНИЕ ШЕСТОГО ЭТАПА')&&!stage7.includes('<button className="primary stage7MainAction" disabled={busy} onClick={()=>void openPollDecision()}'),'Decision not re-opened in Stage 7');
assert(stage6.includes('Один студент — один голос'),'Individual vote, not an institutional vote');
assert(migration.includes('first_day+2')&&migration.includes('20:00')&&migration.includes('2,5 суток'),'Three days and 2.5-day campaigning');
assert(cec.includes('Asia/Barnaul')&&cec.includes("interval '20 hours'"),'Local election clock enforced');
assert(cec.includes('private.sync_current_game_office')&&cec.includes('source_key'),'Grant elected President powers and publish once');
assert(preview.includes('publish_presidential_cec_protocol')&&preview.includes('preview_presidential_cec_protocol'),'CEC preview and publication');
assert(calc.includes('set_presidential_teacher_ballot')&&calc.includes('set_presidential_jury_size'),'Reuse editable teacher ballots');
(async()=>{
 const db=new PGlite();const game=uid(1),teacher=uid(2),outsider=uid(3);
 try{
  await db.exec([
   'CREATE SCHEMA private; CREATE SCHEMA auth;',
   "CREATE TABLE games(id uuid primary key);",
   "CREATE TABLE game_stages(game_id uuid,stage_no int,status text);",
   "CREATE TABLE game_members(game_id uuid,user_id uuid,kind text,roster_archived_at timestamptz);",
   "CREATE TABLE presidential_student_system_votes(game_id uuid,user_id uuid,system_type text,threshold_pct numeric,created_at timestamptz default now(),updated_at timestamptz default now(),primary key(game_id,user_id));",
   "CREATE TABLE presidential_student_system_result(game_id uuid primary key,system_type text,threshold_pct numeric,votes_total int,tally jsonb,finalized_at timestamptz default now(),finalized_by uuid);",
   "CREATE TABLE presidential_election_schedule(game_id uuid primary key,first_day date,voting_day date,appointment_document_id uuid,updated_by uuid);",
   "CREATE TABLE presidential_poll_decision(game_id uuid primary key,status text,result bool);",
   "CREATE TABLE presidential_election_settings(game_id uuid primary key,system_type text,threshold_pct numeric,poll_enabled bool,status text,updated_by uuid,updated_at timestamptz default now());",
   "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $f$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $f$;",
   "CREATE FUNCTION private.require_active_presidential_teacher(uuid) RETURNS void LANGUAGE plpgsql AS $f$ BEGIN IF NOT EXISTS(SELECT 1 FROM game_members WHERE game_id=$1 AND user_id=auth.uid() AND kind='teacher' AND roster_archived_at IS NULL) THEN RAISE EXCEPTION 'Teacher access required';END IF;END;$f$;",
   "CREATE FUNCTION private.is_game_teacher(uuid) RETURNS boolean LANGUAGE sql AS $f$ SELECT EXISTS(SELECT 1 FROM game_members WHERE game_id=$1 AND user_id=auth.uid() AND kind='teacher' AND roster_archived_at IS NULL)$f$;",
   "CREATE FUNCTION private.is_game_member(uuid) RETURNS boolean LANGUAGE sql AS $f$ SELECT EXISTS(SELECT 1 FROM game_members WHERE game_id=$1 AND user_id=auth.uid() AND roster_archived_at IS NULL)$f$;"
  ].join('\n'));
  for(const name of ['cast_presidential_student_system_vote','get_presidential_student_system_vote','finalize_presidential_student_system_vote'])await db.exec(fn(migration,name));
  await db.query('INSERT INTO games VALUES ($1)',[game]);
  await db.query("INSERT INTO game_stages VALUES ($1,6,'open')",[game]);
  await db.query("INSERT INTO game_members(game_id,user_id,kind) VALUES ($1,$2,'teacher')",[game,teacher]);
  await db.query("INSERT INTO presidential_election_schedule(game_id,first_day,updated_by) VALUES($1,'2026-10-20',$2)",[game,teacher]);
  await db.query("INSERT INTO presidential_poll_decision VALUES($1,'closed',false)",[game]);
  const cast=async(user,system,threshold=null)=>{
   await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user]);
   return db.query('SELECT public.cast_presidential_student_system_vote($1,$2,$3)',[game,system,threshold]);
  };
  for(let i=0;i<40;i++){
   const u=uid(100+i);
   await db.query("INSERT INTO game_members(game_id,user_id,kind) VALUES($1,$2,'student')",[game,u]);
   await cast(u,i<29?'absolute':i<36?'relative':'qualified',i>=36?65:null);
  }
  await cast(uid(139),'absolute');
  const snapshot=(await db.query('SELECT count(*)::int n FROM presidential_student_system_votes')).rows[0];
  assert.equal(snapshot.n,40,'One vote per student across 40 students');
  await assert.rejects(()=>cast(outsider,'absolute'),/Голосовать вправе только/,'Outsiders forbidden');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[teacher]);
  const result=(await db.query('SELECT public.finalize_presidential_student_system_vote($1) result',[game])).rows[0].result;
  assert.equal(result.system_type,'absolute');
  assert.equal(result.poll_enabled,false);
  assert.equal(result.votes_total,40);
  assert.equal(result.tally.absolute,30,'Edited ballot replaces a previous vote; no duplicate user entry');
  assert.equal((await db.query('SELECT system_type FROM presidential_election_settings WHERE game_id=$1',[game])).rows[0].system_type,'absolute');
  await assert.rejects(()=>cast(uid(102),'relative'),/Решение студентов уже утверждено|Голосование закрыто/,'Cannot change results after closure');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[teacher]);
  await assert.rejects(()=>db.query('SELECT public.finalize_presidential_student_system_vote($1)',[game]),/уже утверждены/,'No double finalization');
  console.log('PASS: Stage 6 personal vote across 40 distinct students, permission isolation, one vote per user, private teacher finalization, stable election settings, CEC-only Stage 7 and full component formula.');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
