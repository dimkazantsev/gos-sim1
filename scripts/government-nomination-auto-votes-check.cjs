const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync('supabase/migrations/20261020094000_government_nomination_auto_duma_vote.sql','utf8');
const ui=fs.readFileSync('components/game/GovernmentFormationWorkspace.tsx','utf8');
const css=fs.readFileSync('app/stage-operations.css','utf8');
const ast=ts.createSourceFile('GovernmentFormationWorkspace.tsx',ui,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX);
assert.equal(ast.parseDiagnostics.length,0,'Government workspace TSX parses');
assert(ui.includes("supabase.rpc('submit_government_nomination'"),'Presidential/PM authorized submissions retained');
assert(!ui.includes("supabase.rpc('open_government_nomination_vote'"),'Teacher no longer starts voting manually');
assert(ui.includes("n.status==='vote_open'||vote?.status==='open'"),'Student link works even before vote cache refreshes');
assert(ui.includes("dumaRows.find(n=>n.status==='vote_open'&&n.vote_id)?.vote_id"),'Stage 8/9 step opens vote from stored nomination');
assert(!ui.includes("teacher&&n.status==='submitted'"),'No teacher-only opening control');
assert(ui.includes("className=\"gov8AgendaControls\""),'Delete belongs in action toolbar');
assert(ui.includes('aria-label={\'Снять кандидатуру \'+n.candidate_name}'),'Delete remains accessible');
assert(!ui.includes('<div className="gov8AgendaNameRow"><b>{n.candidate_name}</b>{teacher'),'Delete must not overlap candidate name');
assert(css.includes('.stageOperations .gov8AgendaControls>.gov8RemoveNomination'),'Destructive action styled separately');
assert(css.includes('@media(max-width:540px)'),'Phone layout remains accessible');
assert(sql.includes('private.ensure_government_nomination_vote(v_id)'),'Authorized submission creates linked vote in its transaction');
assert(sql.includes("n.route NOT IN ('president_to_duma','pm_to_duma')"),'No SF-consultation auto vote');
assert(sql.includes("s.status='open'"),'Locked stages cannot auto-create a vote');
assert(sql.includes('FOR UPDATE'),'Duplicate concurrent creation serialized');
assert(sql.includes('REVOKE ALL ON FUNCTION private.ensure_government_nomination_vote(uuid) FROM PUBLIC,anon,authenticated'),'Internal helper not directly callable by student');
assert(sql.includes("n.status='submitted' AND n.vote_id IS NULL"),'Only pending legacy nominations backfilled');
const uuid=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0');
(async()=>{
 const db=new PGlite();
 try{
  await db.exec(`
 CREATE SCHEMA private; CREATE ROLE anon; CREATE ROLE authenticated;
 CREATE TABLE public.game_stages(game_id uuid,stage_no integer,status text,deadline timestamptz);
 CREATE TABLE public.government_nominations(
  id uuid PRIMARY KEY,game_id uuid,stage_no integer,office_title text,candidate_name text,
  route text,status text,nominated_by uuid,formal_document_id uuid,vote_id uuid,
  updated_at timestamptz DEFAULT now()
 );
 CREATE TABLE public.game_votes(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),game_id uuid,stage_no integer,
  title text,body text,voting_mode text,status text,created_by uuid,institution_key text,procedure_key text,
  quorum_kind text,quorum_value numeric,majority_kind text,majority_value numeric,
  allow_abstain boolean,tie_breaker_chair boolean,pass_transition text,fail_transition text,
  formal_document_id uuid,formal_step_code text
 );
 `);
 const code=sql.slice(0,sql.indexOf('REVOKE ALL ON FUNCTION private.ensure_government_nomination_vote'));
 assert(code.includes('CREATE OR REPLACE FUNCTION private.ensure_government_nomination_vote'));
 await db.exec(code);
 const g=uuid(1),secondGame=uuid(2),president=uuid(30),pm=uuid(31);
 await db.query("INSERT INTO game_stages VALUES($1,8,'open',null),($1,9,'locked',null),($2,8,'open',null)",[g,secondGame]);
 const nominations=[
  [uuid(10),g,8,'Председатель Правительства','Иванов Иван','president_to_duma','submitted',president],
  [uuid(11),g,8,'Председатель Банка России','Петров Пётр','president_to_duma','submitted',president],
  [uuid(12),g,9,'Министр финансов','Сидорова','pm_to_duma','submitted',pm],
  [uuid(13),g,9,'Министр обороны','Фёдоров','president_after_sf','consultation_pending',president],
  [uuid(14),secondGame,8,'Председатель Правительства','Егоров','president_to_duma','submitted',president]
 ];
 for(const n of nominations)await db.query('INSERT INTO government_nominations(id,game_id,stage_no,office_title,candidate_name,route,status,nominated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',n);
 const create=async id=uuid(10)=>(await db.query('SELECT private.ensure_government_nomination_vote($1) id',[id])).rows[0].id;
 const first=await create(),again=await create();
 assert.equal(first,again,'Repeated opening does not create another vote');
 const next=await create(uuid(11));
 assert.notEqual(first,next,'Each new nomination receives its own vote');
 const voteRows=(await db.query('select game_id,stage_no,status,institution_key,procedure_key,quorum_kind,quorum_value,majority_kind,majority_value,formal_step_code from game_votes order by stage_no')).rows;
 assert.equal(voteRows.length,2,'One vote for each nomination of stage 8');
 for(const v of voteRows){assert.equal(v.stage_no,8);assert.equal(v.status,'open');assert.equal(v.institution_key,'gd');assert.equal(v.procedure_key,'government_nomination');assert.equal(v.quorum_kind,'fraction');assert.equal(Number(v.quorum_value),0.5);assert.equal(v.majority_kind,'eligible_majority');assert.equal(Number(v.majority_value),0.5);assert.equal(v.formal_step_code,'agenda');}
 await assert.rejects(()=>create(uuid(12)),/Этап внесения кандидатуры не открыт/);
 await assert.rejects(()=>create(uuid(13)),/Голосование допускается только/);
 assert.equal((await db.query('select count(*)::int n from game_votes')).rows[0].n,2);
 await db.query("update game_stages set status='open' where game_id=$1 and stage_no=9",[g]);
 await create(uuid(12));
 assert.equal((await db.query('select count(*)::int n from game_votes')).rows[0].n,3);
 await create(uuid(14));
 assert.equal((await db.query('select count(*)::int n from game_votes where game_id=$1',[g])).rows[0].n,3,'Second game is isolated');
 const statuses=(await db.query("select status,vote_id is not null has_vote from government_nominations where game_id=$1 and id<>$2",[g,uuid(13)])).rows;
 assert(statuses.every(x=>x.status==='vote_open'&&x.has_vote),'Linked nominations immediately reflect active voting');
 console.log('PASS: stage 8/9 auto-votes, 2 nominations, idempotency, locked stages, SF consultation isolation, mandate/quorum, multi-game isolation, UI and mobile style.');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
