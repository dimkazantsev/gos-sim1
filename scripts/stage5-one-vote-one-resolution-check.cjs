const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');

const migration=fs.readFileSync('supabase/migrations/20261110032600_stage5_one_ghost_vote_one_resolution.sql','utf8');
const types=fs.readFileSync('components/game/types.ts','utf8');
const view=fs.readFileSync('components/game/DocumentsView.tsx','utf8');
const votes=fs.readFileSync('components/game/VotesView.tsx','utf8');
const uuid=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0');

async function run(){
 const db=new PGlite();
 const game=uuid(1),original=uuid(2),repeat=uuid(3),doc=uuid(4),policy=uuid(5),chair=uuid(6);
 try{
  await db.exec([
   "CREATE SCHEMA private;CREATE ROLE anon;CREATE ROLE authenticated;",
   "CREATE FUNCTION private.impact_vote_close_trigger() RETURNS trigger LANGUAGE plpgsql AS $f$BEGIN RETURN NEW;END$f$;",
   "CREATE FUNCTION private.publish_process_update() RETURNS trigger LANGUAGE plpgsql AS $f$BEGIN RETURN NEW;END$f$;",
   "CREATE TABLE public.game_votes(id uuid PRIMARY KEY,game_id uuid,stage_no integer,created_by uuid,title text,body text,voting_mode text,status text,closed_at timestamptz,opened_at timestamptz DEFAULT now(),procedure_key text,formal_document_id uuid,formal_step_code text,institution_key text,quorum_kind text,quorum_value numeric,majority_kind text,majority_value numeric,allow_abstain boolean,tie_breaker_chair boolean,pass_transition text,fail_transition text,result_code text,result_label text,result_yes numeric,result_no numeric,result_abstain numeric,result_cast numeric,result_eligible numeric,result_present numeric,result_quorum_met boolean,decision_note text,electorate_snapshot jsonb DEFAULT '{}'::jsonb,CONSTRAINT game_votes_result_code_check CHECK(result_code IS NULL OR result_code IN ('passed','rejected','no_quorum')));",
   "CREATE TABLE public.ghost_voting_policies(id uuid PRIMARY KEY,game_id uuid,vote_id uuid,status text,policy_mode text);",
   "CREATE TABLE public.formal_documents(id uuid PRIMARY KEY,game_id uuid,stage_no integer,doc_type text,workflow_key text,subject_key text,status_code text,current_step integer,current_owner_key text,status_label text,metadata jsonb DEFAULT '{}'::jsonb,body_text text,updated_at timestamptz);",
   "CREATE TABLE public.game_ballots(vote_id uuid,voter_id uuid,weight numeric,yes_weight numeric,no_weight numeric,abstain_weight numeric);",
   "CREATE TABLE public.formal_document_history(document_id uuid,game_id uuid,actor_id uuid,action text,from_status text,to_status text,from_owner text,to_owner text,note text);"
  ].join('\n'));
  await db.query("INSERT INTO public.ghost_voting_policies VALUES($1,$2,$3,'adopted','prohibited')",[policy,game,original]);
  await db.query("INSERT INTO public.formal_documents VALUES($1,$2,5,'gd_resolution','gd_resolution','gd','agenda',1,'gd_council','В повестке ГД',$3,'Постановление: Ghost voting запрещено',now())",
   [doc,game,JSON.stringify({template_key:'gd_resolution',stage_form:true,act_number:'2-ГД',acting_office_title:'Председатель Государственной Думы'})]);
  const config={game,chair,mode:'mandate',institution:'gd'};
  await db.query(
   "INSERT INTO public.game_votes(id,game_id,stage_no,created_by,title,voting_mode,status,closed_at,procedure_key,institution_key,quorum_kind,quorum_value,majority_kind,majority_value,allow_abstain,tie_breaker_chair,pass_transition,fail_transition,result_code,result_label,result_yes,result_no,result_eligible) VALUES($1,$2,5,$3,'Goust Voting','mandate','closed',now(),'ghost_policy','gd','fraction',0.5,'yes_no_simple',0.5,true,false,'none','none','passed','Решение принято',198,0,450)",
   [original,config.game,config.chair]);
  await db.query(
   "INSERT INTO public.game_votes(id,game_id,stage_no,created_by,title,voting_mode,status,procedure_key,institution_key,formal_document_id,formal_step_code,quorum_kind,quorum_value,majority_kind,majority_value,allow_abstain,tie_breaker_chair,pass_transition,fail_transition,electorate_snapshot) VALUES($1,$2,5,$3,'Повторное голосование','mandate','open','gd_resolution','gd',$4,'agenda','fraction',0.5,'eligible_majority',0.5,true,false,'advance','reject','{\"eligible\":450}'::jsonb)",
   [repeat,config.game,config.chair,doc]);
  for(let i=0;i<6;i++)
   await db.query('INSERT INTO public.game_ballots VALUES($1,$2,44,44,0,0)',[repeat,uuid(100+i)]);

  await db.exec(migration);
  const row=(await db.query('SELECT status_code,current_step,current_owner_key,metadata FROM public.formal_documents WHERE id=$1',[doc])).rows[0];
  assert.equal(row.status_code,'adopted');
  assert.equal(row.current_step,2);
  assert.equal(row.current_owner_key,'gd_staff');
  assert.equal(row.metadata.act_number,'2-ГД','Keep the authored document number');
  assert.equal(row.metadata.source_vote_id,original,'Keep original verified result');
  assert.equal(row.metadata.source_type,'ghost_voting_policies');
  const originalRow=(await db.query('SELECT result_yes,status,formal_document_id FROM public.game_votes WHERE id=$1',[original])).rows[0];
  assert.equal(Number(originalRow.result_yes),198);
  assert.equal(originalRow.status,'closed');
  assert.equal(originalRow.formal_document_id,doc);
  const repeated=(await db.query('SELECT status,result_code,result_label,result_yes,result_cast,pass_transition FROM public.game_votes WHERE id=$1',[repeat])).rows[0];
  assert.equal(repeated.status,'closed');
  assert.equal(repeated.result_code,'superseded');
  assert.equal(Number(repeated.result_yes),264);
  assert.equal(Number(repeated.result_cast),264);
  assert.equal(repeated.pass_transition,'none','No duplicate legal transition');
  const ballotCount=async()=>Number((await db.query('SELECT count(*) n FROM public.game_ballots WHERE vote_id=$1',[repeat])).rows[0].n);
  assert.equal(await ballotCount(),6,'All existing ballots remain');

  await assert.rejects(()=>db.query(
   "INSERT INTO public.game_votes(id,game_id,stage_no,created_by,title,voting_mode,status,procedure_key,formal_document_id) VALUES($1,$2,5,$3,'Another repeat','mandate','open','gd_resolution',$4)",
   [uuid(200),game,chair,doc]),/уже утверждён/);
  await assert.rejects(()=>db.query(
   "UPDATE public.formal_documents SET metadata=jsonb_set(metadata,'{source_vote_id}',to_jsonb($1::text)) WHERE id=$2",
   [uuid(300),doc]),/Нельзя подменять источник/);
  await db.query('SELECT private.stage5_attach_verified_ghost_resolution($1)',[original]);
  const histories=(await db.query(
   "SELECT count(*) n FROM public.formal_document_history WHERE document_id=$1 AND action='Постановление связано с принятым решением этапа 05'",[doc])).rows[0].n;
  assert.equal(Number(histories),1,'Repeated sync does not duplicate history');

  // Future case: a prepared resolution is reused at the moment the original
  // Goust Voting decision is adopted. No fresh ballot and no second document.
  const otherGame=uuid(401),otherVote=uuid(402),otherPolicy=uuid(403),otherDoc=uuid(404);
  await db.query("INSERT INTO public.formal_documents VALUES($1,$2,5,'gd_resolution','gd_resolution','gd','draft',0,'author','Проект',$3,'Goust voting запрещено',now())",
   [otherDoc,otherGame,JSON.stringify({template_key:'gd_resolution',stage_form:true,act_number:'3-ГД'})]);
  await db.query("INSERT INTO public.ghost_voting_policies VALUES($1,$2,$3,'adopted','prohibited')",[otherPolicy,otherGame,otherVote]);
  await db.query(
   "INSERT INTO public.game_votes(id,game_id,stage_no,created_by,title,voting_mode,status,procedure_key,institution_key,result_code,result_yes,result_eligible) VALUES($1,$2,5,$3,'Режим Goust Voting','mandate','open','ghost_policy','gd',null,0,450)",
   [otherVote,otherGame,chair]);
  await db.query("UPDATE public.game_votes SET status='closed',result_code='passed',result_yes=230 WHERE id=$1",[otherVote]);
  const after=(await db.query('SELECT formal_document_id FROM public.game_votes WHERE id=$1',[otherVote])).rows[0];
  assert.equal(after.formal_document_id,otherDoc,'Future adopted vote links existing authored resolution');
  assert.equal((await db.query('SELECT status_code FROM public.formal_documents WHERE id=$1',[otherDoc])).rows[0].status_code,'adopted');
  assert.equal(Number((await db.query('SELECT count(*) n FROM public.formal_documents WHERE game_id=$1',[otherGame])).rows[0].n),1);

  assert(types.includes("'superseded'"),'Client schema knows archived duplicate votes');
  assert(votes.includes('АРХИВ · БЕЗ ПРАВОВЫХ ПОСЛЕДСТВИЙ'),'Archived vote is not presented as a second legal result');
  assert(view.includes('Повторное голосование не требуется'),'Document points to the original decision');

  console.log('PASS Stage 05: original vote preserved, one authored GD act, six historical ballots, duplicate sealed, protected provenance, no repeated action, future auto-link.');
 }finally{await db.close()}
}
run().catch(error=>{console.error(error);process.exitCode=1});
