const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');

const agendaSQL=fs.readFileSync('supabase/migrations/20261018164000_duma_agenda_actual_session_stage.sql','utf8');
const ballotSQL=fs.readFileSync('supabase/migrations/20261018164500_presidential_stage6_bill_ballot_scope.sql','utf8');
const hardeningSQL=fs.readFileSync('supabase/migrations/20261018165200_stage6_proposal_concurrency_and_vote_scope.sql','utf8');
const stage=fs.readFileSync('components/game/GovernanceStageWorkspace.tsx','utf8');
const election=fs.readFileSync('components/game/PresidentialSystemDecisionPanel.tsx','utf8');
const uid=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0');
assert(agendaSQL.includes("values(v_doc,s.game_id,s.stage_no,'ГОС.ID-ПОВ-ГД-"),'Session agenda must inherit stage number from its session');
assert(!agendaSQL.includes("values(v_doc,s.game_id,12,'ГОС.ID-ПОВ-ГД-"),'Never insert a stage 12 agenda for a stage 6 session');
assert(ballotSQL.includes("NEW.procedure_key='presidential_system'"),'Stage 6 has a narrowly scoped vote path');
assert(hardeningSQL.includes('pg_advisory_xact_lock'),'40 participants must serialize same-session agenda numbering');
assert(hardeningSQL.includes('app.gos_presidential_vote_scope'),'Special ballots must originate inside authorized RPC transaction');
assert(!hardeningSQL.includes('в учебной модели'),'No educational-mode language in official Presidential amendment');
assert(ballotSQL.includes("v_doc.metadata->>'purpose'<>'presidential_electoral_system'"),'Presidential pathway checks document purpose');
assert(ballotSQL.includes("NEW.formal_step_code NOT IN ('reading1','reading2','reading3')"),'Ordinary bill reading guard stays intact');
for(let no=1;no<=16;no++)assert(stage.includes('stage.stage_no==='+no),'Stage '+no+' retains its established module');
assert(election.includes("supabase.rpc('propose_presidential_system'"),'Student proposal must call protected RPC');
assert(election.includes('await g.refresh()')&&election.includes('await load()'),'Live UI must refresh linked proposals, documents and votes');
assert(election.includes('Проект НПА → регистрация → обсуждение → голосование'),'UI depicts genuine proposal-first route');
assert(election.indexOf('<small>ПРОЕКТ НПА</small>')<election.indexOf('<small>ПРИСУТСТВИЕ</small>'),'Document precedes registration in stage 6');
assert(election.includes('stage6-proposal-form')&&election.includes('scrollIntoView'),'First route card opens the actual existing proposal form');

(async()=>{
 const db=new PGlite();
 try{
  await db.exec([
   'CREATE SCHEMA private;',
   'CREATE SEQUENCE public.formal_registry_seq;',
   'CREATE TABLE game_stages(game_id uuid,stage_no integer,status text);',
   'CREATE TABLE duma_sessions(id uuid PRIMARY KEY,game_id uuid,stage_no integer,session_no integer,title text,status text,scheduled_start timestamptz,scheduled_end timestamptz,created_by uuid,agenda_document_id uuid);',
   "CREATE TABLE formal_documents(id uuid PRIMARY KEY,game_id uuid,stage_no integer,registry_no text,title text,doc_type text,subject_key text,subject_label text,author_id uuid,body_text text,workflow_key text,workflow_steps jsonb,current_step integer,status_code text,status_label text,current_owner_key text,metadata jsonb DEFAULT '{}'::jsonb,updated_at timestamptz DEFAULT now());",
   'CREATE TABLE formal_document_history(document_id uuid,game_id uuid,actor_id uuid,action text,to_status text,to_owner text,note text);',
   'CREATE TABLE duma_agenda_items(session_id uuid,game_id uuid,formal_document_id uuid,agenda_no integer,status text);',
   'CREATE TABLE game_votes(game_id uuid,stage_no integer,institution_key text,procedure_key text,formal_step_code text,formal_document_id uuid,status text,created_by uuid);',
   "CREATE FUNCTION private.formal_workflow(text) RETURNS jsonb LANGUAGE sql AS $f$ SELECT '[]'::jsonb $f$;",
   "CREATE FUNCTION private.verify_open_stage() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN IF NOT EXISTS(SELECT 1 FROM game_stages WHERE game_id=NEW.game_id AND stage_no=NEW.stage_no AND status='open') THEN RAISE EXCEPTION 'Stage locked';END IF;RETURN NEW;END $f$;",
   'CREATE TRIGGER stage_guard BEFORE INSERT ON formal_documents FOR EACH ROW EXECUTE FUNCTION private.verify_open_stage()'
  ].join('\n'));
  await db.exec(agendaSQL);
  await db.exec(ballotSQL);
  await db.exec(hardeningSQL.slice(hardeningSQL.indexOf('CREATE OR REPLACE FUNCTION private.guard_bill_session_ballot'),hardeningSQL.indexOf('CREATE OR REPLACE FUNCTION public.propose_presidential_system')));
  await db.exec('CREATE TRIGGER ballot_guard BEFORE INSERT ON game_votes FOR EACH ROW EXECUTE FUNCTION private.guard_bill_session_ballot()');
  const game=uid(1), author=uid(100);
  await db.query("INSERT INTO game_stages VALUES($1,6,'open'),($1,12,'open'),($1,7,'locked')",[game]);
  for(const no of [6,12]){
   const session=uid(200+no);
   await db.query("INSERT INTO duma_sessions(id,game_id,stage_no,session_no,title,status,created_by) VALUES($1,$2,$3,$4,'Заседание Государственной Думы','open',$5)",[session,game,no,no,author]);
   await db.query('SELECT private.sync_duma_session_agenda_document($1)',[session]);
   const rows=(await db.query('SELECT d.stage_no,d.subject_key,d.doc_type FROM formal_documents d JOIN duma_sessions s ON s.agenda_document_id=d.id WHERE s.id=$1',[session])).rows;
   assert.equal(rows.length,1);
   assert.equal(rows[0].stage_no,no,'Agenda inherits stage '+no);
   assert.equal(rows[0].subject_key,'gd');
  }
  assert.equal((await db.query('SELECT count(*)::int n FROM formal_documents')).rows[0].n,2);
  await db.query("INSERT INTO duma_sessions(id,game_id,stage_no,session_no,title,status,created_by) VALUES($1,$2,7,7,'Закрытое заседание','open',$3)",[uid(207),game,author]);
  await assert.rejects(()=>db.query('SELECT private.sync_duma_session_agenda_document($1)',[uid(207)]),/Stage locked/,'Locked stage cannot be used via a generated agenda');

  const saveVote=async(p)=>{
   if(p.scope!==false)await db.query("SELECT set_config('app.gos_presidential_vote_scope',$1,false)",[p.scopeValue??p.document]);
   try{return await db.query(
    'INSERT INTO game_votes(game_id,stage_no,institution_key,procedure_key,formal_step_code,formal_document_id,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [p.game||game,p.stage??6,p.institution??'gd',p.procedure??'presidential_system',p.step??null,p.document,p.status??'open',p.createdBy||author]);
   }finally{await db.query("SELECT set_config('app.gos_presidential_vote_scope','',false)")}
  };
  for(let i=0;i<40;i++){
   const doc=uid(400+i),session=uid(500+i);
   await db.query("INSERT INTO formal_documents(id,game_id,stage_no,title,status_code,workflow_key,metadata,author_id) VALUES($1,$2,6,'Проект о выборах Президента','draft','bill',$3,$4)",[doc,game,JSON.stringify({purpose:'presidential_electoral_system'}),author]);
   await db.query("INSERT INTO duma_sessions(id,game_id,stage_no,session_no,title,status,created_by) VALUES($1,$2,6,$3,'Заседание','open',$4)",[session,game,i+100,author]);
   await db.query("INSERT INTO duma_agenda_items VALUES($1,$2,$3,1,'in_progress')",[session,game,doc]);
   await saveVote({document:doc});
  }
  assert.equal((await db.query("SELECT count(*)::int n FROM game_votes WHERE procedure_key='presidential_system'")).rows[0].n,40,'40 stage 6 proposals can create linked votes');
  const first=uid(400);
  await assert.rejects(()=>saveVote({document:first,scope:false}),/поправка|Поправка/,'Direct ballot insert without RPC scope is denied');
  await assert.rejects(()=>saveVote({document:first,scopeValue:uid(999)}),/поправка|Поправка/,'Forged RPC scope cannot be used');
  await assert.rejects(()=>saveVote({document:first,createdBy:uid(888)}),/поправка|Поправка/,'Vote author must match document author');
  await assert.rejects(()=>saveVote({document:first,stage:7}),/поправка|Поправка/,'Closed stage substitution is forbidden');
  await assert.rejects(()=>saveVote({document:first,institution:'sf'}),/поправка|Поправка/,'Foreign institution is forbidden');
  await assert.rejects(()=>saveVote({document:first,game:uid(9)}),/поправка|Поправка/,'Cross-game link is forbidden');
  await assert.rejects(()=>saveVote({document:first,step:'reading1'}),/поправка|Поправка/,'Stage 6 vote cannot impersonate a bill reading');
  const other=uid(800);
  await db.query("INSERT INTO formal_documents(id,game_id,stage_no,title,status_code,workflow_key,metadata) VALUES($1,$2,6,'Чужой законопроект','draft','bill','{}')",[other,game]);
  await assert.rejects(()=>saveVote({document:other}),/поправка|Поправка/,'Only the presidential model can use the special route');
  const bill=uid(900),readingSession=uid(901);
  await db.query("INSERT INTO formal_documents(id,game_id,stage_no,title,status_code,workflow_key) VALUES($1,$2,12,'Законопроект','reading1','bill')",[bill,game]);
  await db.query("INSERT INTO duma_sessions(id,game_id,stage_no,session_no,title,status,created_by) VALUES($1,$2,12,999,'Заседание','open',$3)",[readingSession,game,author]);
  await db.query("INSERT INTO duma_agenda_items VALUES($1,$2,$3,1,'in_progress')",[readingSession,game,bill]);
  await saveVote({document:bill,stage:12,procedure:'bill_reading1',step:'reading1'});
  await assert.rejects(()=>saveVote({document:bill,stage:12,procedure:'bill_reading2',step:'reading1'}),/Голосование должно соответствовать/,'Standard reading vote still guarded');
  assert.equal((await db.query('SELECT count(*)::int n FROM game_votes')).rows[0].n,41);
  console.log('PASS: routes 1–16; GD session agenda stage 6/12; stage 7 locked; 40 presidential bill ballots linked; fake routes denied; ordinary bill reading guard preserved.');
 } finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
