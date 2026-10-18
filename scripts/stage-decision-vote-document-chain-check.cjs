const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const sql4=fs.readFileSync('supabase/migrations/20261018150000_stage4_verified_election_resolutions.sql','utf8');
const sql12=fs.readFileSync('supabase/migrations/20261018151000_bill_ballots_only_during_active_duma_agenda.sql','utf8');
const sqlPolicy=fs.readFileSync('supabase/migrations/20261018152000_three_distinct_gd_resolutions_and_publication_rights.sql','utf8');
const uid=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0');
const game=uid(1),creator=uid(2),winner=uid(3);
(async()=>{
 const db=new PGlite();
 try{
  await db.exec([
   'CREATE SCHEMA private;',
   'CREATE SCHEMA auth;',
   'CREATE ROLE anon;',
   'CREATE ROLE authenticated;',
   "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $q$ SELECT '"+creator+"'::uuid $q$;",
   "CREATE FUNCTION private.formal_workflow(text) RETURNS jsonb LANGUAGE sql AS $q$ SELECT '[{\"code\":\"draft\",\"owner\":\"author\"},{\"code\":\"agenda\",\"owner\":\"gd\"},{\"code\":\"adopted\",\"owner\":\"gd_staff\"},{\"code\":\"published\",\"owner\":\"system\"}]'::jsonb $q$;",
   'CREATE SEQUENCE formal_registry_seq;',
   'CREATE TABLE game_members(game_id uuid,user_id uuid,full_name text);',
   'CREATE TABLE office_elections(id uuid primary key,game_id uuid,stage_no integer,office_key text,office_title text,status text,winner_candidate_id uuid,created_by uuid,closed_at timestamptz);',
   'CREATE TABLE office_candidates(id uuid primary key,election_id uuid,game_id uuid,user_id uuid);',
   'CREATE TABLE institution_units(id uuid primary key,game_id uuid,unit_kind text,title text,head_user_id uuid);',
   'CREATE TABLE formal_documents(id uuid primary key default gen_random_uuid(),game_id uuid,stage_no integer,registry_no text,title text,doc_type text,subject_key text,subject_label text,author_id uuid,body_text text,workflow_key text,workflow_steps jsonb,current_step integer,status_code text,status_label text,current_owner_key text,metadata jsonb);',
   'CREATE TABLE formal_document_history(id uuid primary key default gen_random_uuid(),document_id uuid,game_id uuid,actor_id uuid,action text,to_status text,to_owner text,note text);',
   'CREATE TABLE duma_sessions(id uuid primary key,game_id uuid,stage_no integer,status text,chair_user_id uuid,created_by uuid);',
   'CREATE TABLE duma_agenda_items(id uuid primary key,game_id uuid,session_id uuid,formal_document_id uuid,status text);',
   'CREATE TABLE game_ballots(vote_id uuid, voter_id uuid);',
   "CREATE TABLE game_votes(id uuid primary key default gen_random_uuid(),game_id uuid,stage_no integer,title text,body text,voting_mode text,status text DEFAULT 'open',created_by uuid,formal_document_id uuid,formal_step_code text,institution_key text,procedure_key text,quorum_kind text,quorum_value numeric,majority_kind text,majority_value numeric,allow_abstain boolean,tie_breaker_chair boolean,pass_transition text,fail_transition text);"
  ].join('\n'));
  await db.exec(sql4);
  await db.exec(sql12);
  await db.query('insert into game_members values($1,$2,$3)',[game,winner,'Иванов Иван Иванович']);
  await db.query('insert into game_members values($1,$2,$3)',[game,creator,'Петров Пётр Петрович']);
  let num=20;
  async function addElection(key,title,chosen=winner){
   const election=uid(num++),candidate=uid(num++);
   await db.query("insert into office_elections values($1,$2,4,$3,$4,'nomination',null,$5,null)",[election,game,key,title,creator]);
   await db.query('insert into office_candidates values($1,$2,$3,$4)',[candidate,election,game,chosen]);
   return {election,candidate};
  }
  async function finish(record){
   await db.query("update office_elections set status='finished',winner_candidate_id=$1,closed_at=now() where id=$2",[record.candidate,record.election]);
  }
  const countDocs=async()=>Number((await db.query("select count(*) n from formal_documents where metadata->>'document_kind'='stage4_office_result'")).rows[0].n);
  const chair=await addElection('gd_chair','Председатель ГД');
  await finish(chair);
  assert.equal(await countDocs(),1,'Chair document appears immediately after election');
  const dep1=await addElection('gd_deputy_1','Заместитель 1'), dep2=await addElection('gd_deputy_2','Заместитель 2');
  await finish(dep1);
  assert.equal(await countDocs(),1,'Incomplete deputy slate does not create a resolution');
  await finish(dep2);
  assert.equal(await countDocs(),2,'Second deputy triggers one collective resolution');
  for(let i=0;i<5;i++){
   const committee=uid(num++);
   const election=await addElection('committee:'+committee,'Комитет № '+(i+1));
   await db.query('insert into institution_units values($1,$2,$3,$4,$5)',[committee,game,'committee','Комитет № '+(i+1),winner]);
   await finish(election);
   assert.equal(await countDocs(),i===4?3:2,'Committee resolution requires five verified chair results');
  }
  await Promise.all(Array.from({length:40},()=>db.query('select private.sync_stage4_election_acts($1)',[game])));
  assert.equal(await countDocs(),3,'Repeated synchronisation never duplicates 3 resolutions');
  const acts=(await db.query("select title,body_text,status_code,metadata from formal_documents where metadata->>'document_kind'='stage4_office_result' order by title")).rows;
  assert(acts.every(x=>x.body_text.includes('Иванов Иван Иванович')),'Only actual saved winner names');
  assert(acts.every(x=>x.status_code==='adopted'&&x.metadata.auto_generated),'Adopted election decisions are not auto-published or signed');
  assert.equal(Number((await db.query('select count(*) n from formal_document_history')).rows[0].n),3,'Provenance history on creation');
  await db.exec([
   "ALTER TABLE game_members ADD COLUMN kind text NOT NULL DEFAULT 'student';",
   'ALTER TABLE game_members ADD COLUMN roster_archived_at timestamptz;',
   "CREATE TABLE game_stages(game_id uuid,stage_no integer,status text,deadline timestamptz);",
   "INSERT INTO game_stages VALUES('"+game+"',4,'completed',null);",
   "CREATE TABLE stage_final_document_obligations(game_id uuid,stage_no integer,template_key text,user_id uuid);",
   "CREATE FUNCTION private.is_game_teacher(uuid) RETURNS boolean LANGUAGE sql AS $q$ SELECT false $q$;",
   "CREATE FUNCTION private.has_prior_stage_document_hold(uuid,uuid,integer) RETURNS boolean LANGUAGE sql AS $q$ SELECT true $q$;",
   "CREATE FUNCTION private.matches_formal_owner(uuid,uuid,text,uuid) RETURNS boolean LANGUAGE sql AS $q$ SELECT $3='gd_staff' $q$;",
   "CREATE FUNCTION private.can_remediate_stage_final_document(uuid,integer,uuid,text,text,jsonb) RETURNS boolean LANGUAGE sql AS $q$ SELECT false $q$;",
   "CREATE FUNCTION private.capture_stage_document_obligations(uuid,integer) RETURNS void LANGUAGE plpgsql AS $q$ BEGIN INSERT INTO stage_final_document_obligations SELECT $1,$2,'gd_chair_resolution',user_id FROM game_members WHERE game_id=$1; END $q$;"
  ].join('\n'));
  await db.exec(sqlPolicy);
  await db.exec("CREATE TRIGGER guard_formal_documents_stage BEFORE INSERT OR UPDATE OR DELETE ON formal_documents FOR EACH ROW EXECUTE FUNCTION private.guard_stage_submission();");
  await db.exec("CREATE TRIGGER stage_document_member_progress_guard BEFORE INSERT OR UPDATE ON formal_documents FOR EACH ROW EXECUTE FUNCTION private.guard_stage_document_hold_write();");
  await assert.rejects(db.query(
   "insert into formal_documents(game_id,stage_no,metadata) values($1,4,jsonb_build_object('document_kind','stage4_office_result'))",[game]
  ),/создаётся только из подтверждённого результата/,'Direct forged automatic act must be refused');
  const obligations=(await db.query('select private.stage_required_final_documents($1,4) rows',[game])).rows[0].rows;
  assert.equal(obligations.length,4,'Three election acts plus minutes required');
  assert.equal(obligations.filter(x=>x.fulfilled).length,0,'Unpublished acts never satisfy stage completion');
  await db.query("update formal_documents set status_code='published',current_step=3,current_owner_key='system' where metadata->>'source_result_key'='gd_chair'");
  const afterFirst=(await db.query('select private.stage_required_final_documents($1,4) rows',[game])).rows[0].rows;
  assert.equal(afterFirst.filter(x=>x.fulfilled).length,1,'First resolution cannot close other obligations');
  await db.query("update formal_documents set status_code='published',current_step=3,current_owner_key='system' where metadata->>'source_result_key'='gd_deputies'");
  await db.query("update formal_documents set status_code='published',current_step=3,current_owner_key='system' where metadata->>'source_result_key'='gd_committees'");
  const afterAll=(await db.query('select private.stage_required_final_documents($1,4) rows',[game])).rows[0].rows;
  assert.equal(afterAll.filter(x=>x.fulfilled).length,3,'All three separate official acts published');
  await assert.rejects(db.query("update formal_documents set metadata=jsonb_set(metadata,'{source_result_key}','\"tampered\"') where metadata->>'source_result_key'='gd_chair'"),/Нельзя изменить источник/,'Provenance immutable');
  

  const ordinary=uid(500),constitutional=uid(501),session=uid(502),item=uid(503);
  await db.query("insert into formal_documents(id,game_id,stage_no,title,doc_type,workflow_key,status_code) values($1,$2,12,$3,'fz_bill','bill','reading1')",[ordinary,game,'Проект федерального закона']);
  await db.query("insert into formal_documents(id,game_id,stage_no,title,doc_type,workflow_key,status_code) values($1,$2,12,$3,'fkz_bill','bill','reading1')",[constitutional,game,'Проект федерального конституционного закона']);
  await db.query("insert into duma_sessions values($1,$2,12,'draft',$3,$3)",[session,game,creator]);
  await db.query("insert into duma_agenda_items values($1,$2,$3,$4,'pending')",[item,game,session,ordinary]);
  const premature=()=>db.query("insert into game_votes(game_id,stage_no,formal_document_id,formal_step_code,institution_key,procedure_key,status) values($1,12,$2,'reading1','gd','bill_reading1','open')",[game,ordinary]);
  await assert.rejects(premature(),/до начала рассмотрения|закрыто/,'No bill ballot before hearing');
  await db.query("update duma_sessions set status='open' where id=$1",[session]);
  await assert.rejects(premature(),/до начала рассмотрения|закрыто/,'Open session alone is not enough');
  await db.query("update duma_agenda_items set status='in_progress' where id=$1",[item]);
  let votes=(await db.query("select * from game_votes where formal_document_id=$1",[ordinary])).rows;
  assert.equal(votes.length,1,'Active agenda automatically creates live ballot');
  assert.equal(votes[0].procedure_key,'bill_reading1');
  await db.query('insert into game_ballots values($1,$2)',[votes[0].id,creator]);
  await db.query("update duma_sessions set status='closed' where id=$1",[session]);
  await assert.rejects(db.query('insert into game_ballots values($1,$2)',[votes[0].id,winner]),/вне рассмотрения/,'Closed Duma session cannot accept late ballots');
  await db.query("update duma_sessions set status='open' where id=$1",[session]);
  await db.query('insert into game_ballots values($1,$2)',[votes[0].id,winner]);
  await db.query("update duma_agenda_items set status='in_progress' where id=$1",[item]);
  assert.equal(Number((await db.query("select count(*) n from game_votes where formal_document_id=$1",[ordinary])).rows[0].n),1,'Idempotent reopened agenda');
  const secondItem=uid(504);
  await db.query("insert into duma_agenda_items values($1,$2,$3,$4,'pending')",[secondItem,game,session,constitutional]);
  await db.query("update duma_agenda_items set status='in_progress' where id=$1",[secondItem]);
  const fkz=(await db.query('select * from game_votes where formal_document_id=$1',[constitutional])).rows[0];
  assert.equal(fkz.majority_kind,'eligible_fraction');
  assert(Math.abs(Number(fkz.majority_value)-2/3)<.0001,'Constitutional law keeps its two-thirds threshold');
  console.log('PASS: 3 evidenced adopted act records, five committees, 40 repeat syncs, no forged publications, delayed Duma ballot, agenda activation, FKZ threshold.');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});