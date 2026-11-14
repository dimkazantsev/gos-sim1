/* Focused, isolated checks: no production reads/writes and no network. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const {PGlite}=require('@electric-sql/pglite');
const src=fs.readFileSync('components/game/stageAnalysisWindow.ts','utf8');
const js=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const moduleStub={exports:{}};
new Function('module','exports','require',js)(moduleStub,moduleStub.exports,require);
const {stageAnalysisPhase}=moduleStub.exports;
const now=Date.parse('2026-11-02T10:00:00Z');
const stage=(status,completed_at)=>({status,completed_at});
assert.equal(stageAnalysisPhase(stage('open',new Date(now+1800000).toISOString()),now),'early');
assert.equal(stageAnalysisPhase(stage('completed',new Date(now+1).toISOString()),now),'early');
assert.equal(stageAnalysisPhase(stage('completed',new Date(now).toISOString()),now),'active');
assert.equal(stageAnalysisPhase(stage('completed',new Date(now-3599999).toISOString()),now),'active');
assert.equal(stageAnalysisPhase(stage('completed',new Date(now-3600000).toISOString()),now),'expired');
assert.equal(stageAnalysisPhase(stage('locked',null),now),'unavailable');
assert.equal(stageAnalysisPhase(stage('completed',null),now),'unavailable');
const sql=fs.readFileSync('supabase/migrations/20261114094500_stage_debrief_after_completion.sql','utf8');
const oldSql=fs.readFileSync('supabase/migrations/20261102130000_stage_analysis_final_hour.sql','utf8');
const countsSql=oldSql.slice(oldSql.indexOf('-- Compact 16-row teacher-only projection.'));
assert(countsSql.startsWith('-- Compact 16-row teacher-only projection.'));
assert.match(sql,/for share/i);
assert.match(sql,/v_now:=clock_timestamp\(\)/i);
assert.match(sql,/v_now>=v_completed_at\+interval '1 hour'/i);
assert.match(sql,/v_stage_status is distinct from 'completed'/i);
assert.match(sql,/v_assessment_status is distinct from 'final'/i);
const client=fs.readFileSync('components/GameClient.tsx','utf8');
const panel=fs.readFileSync('components/game/MandatoryStageAnalysis.tsx','utf8');
assert.match(client,/MandatoryStageAnalysis gameId=/);
assert.match(client,/!teacher&&!previewMode&&me.kind==='student'/);
assert.match(panel,/stageAnalysisPhase\(current,Date.now\(\)\)/);
assert(!panel.includes('document.body.style.overflow'),'Analysis must never block the next stage');
assert(!panel.includes('aria-modal'),'Analysis should be in the page, not a modal');
assert(!panel.includes('setInterval(()=>.*supabase'),'Timer cannot poll the database');
(async()=>{
 const db=new PGlite();
 try{
  await db.exec(`
   CREATE ROLE anon;CREATE ROLE authenticated;
   CREATE SCHEMA auth;CREATE SCHEMA private;
   CREATE TABLE public.game_members(game_id uuid,user_id uuid,kind text,roster_archived_at timestamptz);
   CREATE TABLE public.game_stages(game_id uuid,stage_no integer,status text,deadline timestamptz,completed_at timestamptz);
   CREATE TABLE public.stage_assessments(game_id uuid,stage_no integer,user_id uuid,status text);
   CREATE TABLE public.stage_debriefs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),game_id uuid,stage_no integer,user_id uuid,body text,updated_at timestamptz default now(),unique(game_id,stage_no,user_id));
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.test_uid',true),'')::uuid $$;
   CREATE FUNCTION private.is_game_teacher(g uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT current_setting('app.teacher',true)='on' $$;
   CREATE FUNCTION private.compute_vsn_assessment(g uuid,u uuid,s integer,t text) RETURNS uuid LANGUAGE sql AS $$ SELECT '00000000-0000-0000-0000-000000000009'::uuid $$;
  `);
  await db.exec(sql+'\n'+countsSql);
  const game='10000000-0000-0000-0000-000000000001',student='10000000-0000-0000-0000-000000000002',teacher='10000000-0000-0000-0000-000000000003';
  await db.query("insert into game_members values($1,$2,'student',null),($1,$3,'teacher',null)",[game,student,teacher]);
  await db.exec("select set_config('app.test_uid','"+student+"',false)");
  const set=async(status,completedInterval,deadlineInterval='2 hours')=>{
   await db.exec("delete from game_stages");
   await db.query("insert into game_stages values($1,1,$2,clock_timestamp()+$3::interval,clock_timestamp()+$4::interval)",
    [game,status,deadlineInterval,completedInterval]);
  };
  const submit=()=>db.query("select public.submit_stage_debrief($1,1,$2)",[game,"Причины, интересы и последствия решений: анализ этапа полностью составлен и подтверждён"]);
  await set('open','-1 minute');
  await assert.rejects(submit(),/после завершения/);
  await set('completed','-1 hour');
  await assert.rejects(submit(),/Час на анализ/);
  await set('completed','-30 minutes');
  await submit();
  assert.equal((await db.query("select count(*)::int n from stage_debriefs")).rows[0].n,1);
  // Another stage may already be open. It must not prevent a previous debrief.
  await db.query("insert into game_stages values($1,2,'open',clock_timestamp()+interval '30 minutes',null)",[game]);
  await submit();
  assert.equal((await db.query("select count(*)::int n from stage_debriefs")).rows[0].n,1);
  await db.query("update game_stages set completed_at=clock_timestamp()-interval '2 hours' where stage_no=1");
  await assert.rejects(submit(),/Час на анализ/);
  await db.exec("select set_config('app.test_uid','"+teacher+"',false)");
  await assert.rejects(db.query("select public.submit_stage_debrief($1,1,$2)",[game,'bad']),/Student access required/);
  await assert.rejects(db.query("select * from public.get_stage_debrief_counts($1)",[game]),/Teacher access required/);
  await db.exec("select set_config('app.teacher','on',false)");
  const counts=await db.query("select * from public.get_stage_debrief_counts($1)",[game]);
  assert.equal(counts.rows.length,1);
  assert.equal(counts.rows[0].submitted,1);
  console.log('PASS: completion-based 60-minute boundaries, next stage open, one saved analysis, teacher roles and aggregates');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
