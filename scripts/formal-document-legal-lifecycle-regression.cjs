const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync('supabase/migrations/20261019011000_formal_legal_routes_and_presidential_amendment.sql','utf8');
const directGuard=fs.readFileSync('supabase/migrations/20261019011200_guard_direct_formal_document_legal_route.sql','utf8');
const page=fs.readFileSync('components/game/DocumentsView.tsx','utf8');
const paper=fs.readFileSync('components/game/DocumentPaper.tsx','utf8');
const election=fs.readFileSync('components/game/PresidentialSystemDecisionPanel.tsx','utf8');
const uid=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0');
const game=uid(1),user=uid(101),accepted=uid(201),rejected=uid(202);
assert(sql.includes("status_label='Одобрен Государственной Думой. Ожидает рассмотрения Советом Федерации'"));
assert(sql.includes("d.metadata->>'purpose'='presidential_electoral_system'"),'Historical correction scoped to presidential amendment');
assert(sql.includes("p_workflow_key IS DISTINCT FROM"),'Server enforces document type routes');
assert(sql.includes("current_step=8"),'Accepted amendment must not appear fully published');
assert(sql.includes("d.doc_type NOT IN ('fz_bill','fkz_bill','bill','federal_budget')"),'GD signature cannot be substituted for federal law');
assert(page.includes('isTerminal')&&page.includes('Процедура прекращена')&&page.includes('waitingForParliament'));
assert(paper.includes("Документ отклонён. Подписание и дальнейшее рассмотрение не предусмотрены."));
assert(election.includes('ВЫБРАННАЯ МОДЕЛЬ')&&election.includes('ещё не означает вступления федерального закона в силу'));
assert(election.includes("!rows.some(proposal=>proposal.status==='adopted')"),'No competing proposal button after one model is adopted');
(async()=>{
 const db=new PGlite();
 try{
  await db.exec([
   'CREATE SCHEMA private; CREATE SCHEMA auth; CREATE ROLE authenticated; CREATE ROLE anon;',
   "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $f$SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid$f$;",
   "CREATE TABLE formal_documents (id uuid PRIMARY KEY,game_id uuid,stage_no int,doc_type text,workflow_key text,subject_key text,metadata jsonb DEFAULT '{}'::jsonb,current_step int,workflow_steps jsonb,status_code text,status_label text,current_owner_key text,author_id uuid,updated_at timestamptz,registry_no text,title text,subject_label text,body_text text,source_file_path text,source_file_name text,source_mime_type text);",
   'CREATE TABLE presidential_system_proposals(id uuid PRIMARY KEY,game_id uuid,bill_document_id uuid,status text,vote_id uuid,system_type text,threshold_pct numeric,agenda_item_id uuid,session_id uuid,updated_at timestamptz);',
   'CREATE TABLE formal_document_signatures(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),document_id uuid,signer_id uuid,history_id bigint,signed_at timestamptz DEFAULT now());',
   'CREATE TABLE formal_document_history(document_id uuid,game_id uuid,actor_id uuid,action text,to_status text,to_owner text,note text);',
   "CREATE TABLE game_votes(id uuid,game_id uuid,status text,formal_document_id uuid,formal_step_code text,decision_note text,procedure_key text,result_code text);",
   'CREATE TABLE game_profiles(game_id uuid,user_id uuid,signature_path text);',
   'CREATE TABLE game_office_assignments(game_id uuid,user_id uuid,status text,role_title text,created_at timestamptz DEFAULT now());',
   'CREATE TABLE game_members(game_id uuid,user_id uuid,kind text,roster_archived_at timestamptz);',
   "CREATE FUNCTION private.is_game_member(uuid) RETURNS boolean LANGUAGE sql AS $f$SELECT true$f$;",
   "CREATE FUNCTION private.can_create_formal_subject(uuid,uuid,text) RETURNS boolean LANGUAGE sql AS $f$SELECT true$f$;",
   "CREATE FUNCTION private.matches_formal_owner(uuid,uuid,text,uuid) RETURNS boolean LANGUAGE sql AS $f$SELECT true$f$;",
   "CREATE FUNCTION private.is_game_teacher(uuid) RETURNS boolean LANGUAGE sql AS $f$SELECT false$f$;",
   "CREATE FUNCTION private.formal_vote_required(formal_documents) RETURNS boolean LANGUAGE sql AS $f$SELECT false$f$;",
   "CREATE FUNCTION private.gd_presiding_officer(uuid,int) RETURNS uuid LANGUAGE sql AS $f$SELECT '10000000-0000-0000-0000-000000000101'::uuid$f$;",
   "CREATE FUNCTION private.role_is_available(uuid,uuid) RETURNS boolean LANGUAGE sql AS $f$SELECT true$f$;",
   "CREATE FUNCTION private.formal_workflow(text) RETURNS jsonb LANGUAGE sql AS $f$SELECT '[{\"code\":\"draft\",\"owner\":\"author\",\"action\":\"Внести\"},{\"code\":\"published\",\"owner\":\"system\",\"action\":null}]'::jsonb$f$;",
   'CREATE SEQUENCE formal_registry_seq;',
   "CREATE TABLE duma_agenda_items(id uuid,game_id uuid,status text,completed_at timestamptz,result_note text);",
   "CREATE TABLE duma_sessions(id uuid,game_id uuid,status text,closed_at timestamptz);",
   "CREATE TABLE presidential_election_settings(game_id uuid PRIMARY KEY,system_type text,threshold_pct numeric,poll_enabled boolean,status text,updated_by uuid,result jsonb,updated_at timestamptz);"
  ].join('\n'));
  const original=[{code:'draft',owner:'author',label:'Черновик',action:'Внести в Государственную Думу'},
   {code:'registered',owner:'gd_staff'}, {code:'committee',owner:'committee'},
   {code:'council',owner:'gd_council'}, {code:'reading1',owner:'gd'},
   {code:'amendments',owner:'committee'}, {code:'reading2',owner:'gd'},
   {code:'reading3',owner:'gd'}, {code:'sf',owner:'sf'},
   {code:'president',owner:'president',action:'Подписать'},
   {code:'published',owner:'system',action:null}];
  for(const [id,status,step,pstatus] of [[accepted,'published',10,'adopted'],[rejected,'rejected',0,'rejected']]){
   await db.query(
    "INSERT INTO formal_documents(id,game_id,stage_no,doc_type,workflow_key,subject_key,metadata,current_step,workflow_steps,status_code,status_label,current_owner_key,author_id,registry_no) VALUES($1,$2,6,'bill','bill','gd',$3,$4,$5,$6,$7,'system',$8,$9)",
    [id,game,JSON.stringify({purpose:'presidential_electoral_system'}),step,JSON.stringify(original),status,status==='published'?'Принят и опубликован':'Отклонён ГД',user,'ГОС.ID-НПА-'+(id===accepted?'201':'202')]);
   await db.query('INSERT INTO presidential_system_proposals(id,game_id,bill_document_id,status) VALUES($1,$2,$3,$4)',[uid(id===accepted?301:302),game,id,pstatus]);
  }
  await db.exec(sql);
  const docs=(await db.query('SELECT id,doc_type,status_code,current_step,current_owner_key,registry_no FROM formal_documents ORDER BY id')).rows;
  assert.equal(docs.length,2);
  assert.deepEqual(docs.map(d=>({type:d.doc_type,status:d.status_code,step:d.current_step,owner:d.current_owner_key})),[
   {type:'fz_bill',status:'sf',step:8,owner:'sf'},
   {type:'fz_bill',status:'rejected',step:0,owner:'system'}
  ],'No unsigned bill is published and rejected bill stays terminal');
  assert.equal(docs[0].registry_no,'ГОС.ID-НПА-201','Existing number unchanged');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user]);
  await assert.rejects(()=>db.query("SELECT public.advance_formal_document($1,'advance',null)",[rejected]),/Документ отклонён/,'Rejected bill cannot advance');
  const access=(await db.query('SELECT public.get_formal_document_tools($1) as state',[rejected])).rows[0].state;
  assert.equal(access.can_manage,false,'Rejected document cannot be managed');
  assert.equal(access.can_sign,false,'Rejected document cannot be signed');
  assert.equal(access.next_action,null,'No misleading next action');
  const createDoc=async(t,w)=>db.query(
   'SELECT public.create_formal_document($1,6,$2,$3,$4,$5,$6,null,null,null,$7,$8) id',
   [game,'Контрольная регистрация '+t,t,'gd','Государственная Дума','Обоснование',w,'{}']);
  for(const [kind,workflow] of [['fz_bill','bill'],['fkz_bill','bill'],['federal_budget','budget'],['gd_resolution','gd_resolution'],['sf_resolution','sf_resolution'],['government_resolution','government_act'],['government_order','government_act'],['state_program','government_act'],['ministry_order','ministry_act'],['municipal_act','municipal_act'],['president_decree','president_act'],['other','generic']]){
   await createDoc(kind,workflow);
  }
  for(const [kind,workflow] of [['gd_resolution','bill'],['government_resolution','bill'],['fz_bill','gd_resolution'],['fkz_bill','government_act'],['other','bill'],['bill','bill'],['federal_budget','bill']]){
   await assert.rejects(()=>createDoc(kind,workflow),/Вид документа не соответствует/);
  }
  await db.query("UPDATE formal_documents SET status_code='published' WHERE id=$1",[accepted]);
  const signers=(await db.query('SELECT count(*)::int AS n FROM private.institution_document_signers($1)',[accepted])).rows[0].n;
  assert.equal(signers,0,'GD Chair must not be offered federal law signature');
  // Legacy late transition must not resurrect the rejected version.
  await db.query("SELECT private.apply_formal_vote_transition($1,'advance',$2,$3,null)",[rejected,user,uid(901)]);
  assert.equal((await db.query('SELECT status_code FROM formal_documents WHERE id=$1',[rejected])).rows[0].status_code,'rejected');
  const counts=(await db.query("SELECT doc_type,workflow_key,count(*)::int n FROM formal_documents WHERE id NOT IN ($1,$2) GROUP BY 1,2 ORDER BY 1",[accepted,rejected])).rows;
  assert.equal(counts.reduce((n,x)=>n+x.n,0),12,'All 12 approved client document types retain their dedicated routes');
  await db.exec(directGuard);
  await assert.rejects(
    ()=>db.query("INSERT INTO formal_documents(id,game_id,doc_type,workflow_key,metadata,status_code) VALUES($1,$2,'gd_resolution','bill','{}','draft')",[uid(1100),game]),
    /не соответствует/,'Direct SQL cannot give a GD resolution the federal-law procedure');
  await assert.rejects(
    ()=>db.query("INSERT INTO formal_documents(id,game_id,doc_type,workflow_key,metadata,status_code) VALUES($1,$2,'bill','bill','{}','draft')",[uid(1101),game]),
    /только для ФЗ и ФКЗ/,'Technical bill type cannot be used to create legal acts');
  await assert.rejects(
    ()=>db.query("UPDATE formal_documents SET current_step=1,current_owner_key='author',status_code='draft' WHERE id=$1",[rejected]),
    /Отклонённый документ окончателен/,'Direct SQL cannot reactivate a rejected bill');
  await db.query("INSERT INTO formal_documents(id,game_id,doc_type,workflow_key,metadata,status_code) VALUES($1,$2,'government_resolution','government_act','{}','draft')",[uid(1102),game]);
  assert.equal((await db.query("SELECT workflow_key FROM formal_documents WHERE id=$1",[uid(1102)])).rows[0].workflow_key,'government_act');
  console.log('PASS: historical 2 amendments, authentic SF wait, 7 invalid route combinations rejected, 12 valid kinds, terminal and direct SQL enforcement, lawful government acts, signed-law role isolation.');
 }finally{await db.close()}
})().catch(err=>{console.error(err);process.exitCode=1});
