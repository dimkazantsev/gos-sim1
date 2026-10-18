const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync('supabase/migrations/20261019101000_exclusive_presidential_decision_party_candidate_upload.sql','utf8');
const ui=fs.readFileSync('components/game/PresidentialElectionLab.tsx','utf8');
const stage=fs.readFileSync('components/game/PresidentialSystemDecisionPanel.tsx','utf8');
const uid=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0');
const func=(n)=>{const m=sql.match(new RegExp('CREATE OR REPLACE FUNCTION '+n.replace(/\./g,'\\.')+'\\([\\s\\S]*?\\$fn\\$;'));assert(m,'Function '+n);return m[0]};
(async()=>{
 const db=new PGlite(),game=uid(1),party=uid(2),otherParty=uid(3),candidate=uid(4),author=uid(101),member=uid(102),outsider=uid(201),archived=uid(202);
 try{
  await db.exec([
   'CREATE SCHEMA private;CREATE SCHEMA auth;CREATE ROLE authenticated;CREATE ROLE anon;',
   "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $f$SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid$f$;",
   'CREATE TABLE game_parties(id uuid,game_id uuid,name text,leader_user_id uuid,registration_status text);',
   'CREATE TABLE game_members(game_id uuid,user_id uuid,kind text,team text,roster_archived_at timestamptz);',
   'CREATE TABLE presidential_candidates(id uuid,game_id uuid,user_id uuid,created_by uuid,party_id uuid,nomination_type text);',
   'CREATE TABLE presidential_system_proposals(id uuid PRIMARY KEY,game_id uuid,status text,vote_id uuid,bill_document_id uuid,updated_at timestamptz);',
   'CREATE TABLE formal_documents(id uuid PRIMARY KEY,status_code text,status_label text,current_owner_key text,updated_at timestamptz);',
   'CREATE TABLE game_votes(id uuid PRIMARY KEY,game_id uuid,status text,procedure_key text,result_code text,result_label text,closed_at timestamptz);',
   "CREATE FUNCTION private.can_manage_presidential_candidate(p_candidate uuid,p_user uuid) RETURNS boolean LANGUAGE sql AS $f$ SELECT EXISTS(SELECT 1 FROM presidential_candidates WHERE id=p_candidate AND (user_id=p_user OR created_by=p_user))$f$;"
  ].join('\n'));
  for(const name of ['private.can_upload_presidential_candidate_document','private.finalize_alternative_presidential_proposals','private.guard_new_presidential_system_proposal','private.guard_exclusive_presidential_system_decision','private.on_presidential_proposal_adopted'])
   await db.exec(func(name));
  for(const [start,fn] of [
   ['presidential_single_new_proposal','guard_new_presidential_system_proposal'],
   ['a_guard_exclusive_presidential_system_decision','guard_exclusive_presidential_system_decision'],
   ['presidential_single_adopted_proposal','on_presidential_proposal_adopted']]){
   const re=new RegExp('DROP TRIGGER IF EXISTS '+start+'[\\s\\S]*?EXECUTE FUNCTION private\\.'+fn+'\\(\\);');
   const tr=sql.match(re);assert(tr,'Trigger '+start);await db.exec(tr[0]);
  }
  await db.query("INSERT INTO game_parties VALUES ($1,$2,'Партия Альфа',$3,'registered'),($4,$2,'Партия Бета',$5,'registered')",[party,game,author,otherParty,outsider]);
  for(const [u,t,deleted] of [[author,'Партия Альфа',false],[member,'Партия Альфа',false],[outsider,'Партия Бета',false],[archived,'Партия Альфа',true]])
   await db.query("INSERT INTO game_members VALUES($1,$2,'student',$3,$4)",[game,u,t,deleted?new Date():null]);
  await db.query("INSERT INTO presidential_candidates VALUES($1,$2,$3,$3,$4,'party')",[candidate,game,author,party]);
  const access=async user=>{await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user]);return (await db.query('SELECT private.can_upload_presidential_candidate_document($1,$2) AS can',[candidate,user])).rows[0].can};
  assert.equal(await access(author),true,'Candidate can upload');
  assert.equal(await access(member),true,'Party member can upload');
  assert.equal(await access(outsider),false,'Other party denied');
  assert.equal(await access(archived),false,'Archived party member denied');
  await db.query("UPDATE game_parties SET registration_status='rejected' WHERE id=$1",[party]);
  assert.equal(await access(member),false,'Unregistered party denied');
  await db.query("UPDATE game_parties SET registration_status='registered' WHERE id=$1",[party]);
  await db.query("UPDATE presidential_candidates SET nomination_type='self' WHERE id=$1",[candidate]);
  assert.equal(await access(member),false,'Self-nominated candidate not granted party access');
  for(let i=0;i<40;i++){
   const p=uid(500+i),v=uid(600+i),d=uid(700+i);
   await db.query("INSERT INTO game_votes(id,game_id,status,procedure_key) VALUES ($1,$2,'open','presidential_system')",[v,game]);
   await db.query("INSERT INTO formal_documents(id,status_code) VALUES ($1,'draft')",[d]);
   await db.query("INSERT INTO presidential_system_proposals(id,game_id,status,vote_id,bill_document_id) VALUES ($1,$2,'vote_open',$3,$4)",[p,game,v,d]);
  }
  await db.exec("CREATE FUNCTION private.simulated_vote_completion() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN IF NEW.status='closed' AND OLD.status IS DISTINCT FROM NEW.status AND NEW.procedure_key='presidential_system' THEN UPDATE presidential_system_proposals SET status=CASE WHEN NEW.result_code='passed' THEN 'adopted' ELSE 'rejected' END WHERE vote_id=NEW.id; END IF;RETURN NEW;END;$f$;");
  await db.exec('CREATE TRIGGER zzz_simulated_result AFTER UPDATE OF status ON game_votes FOR EACH ROW EXECUTE FUNCTION private.simulated_vote_completion();');
  await db.query("UPDATE game_votes SET status='closed',result_code='passed',result_label='Принято' WHERE id=$1",[uid(600)]);
  const tally=(await db.query("SELECT status,count(*)::int n FROM presidential_system_proposals GROUP BY status ORDER BY status")).rows;
  assert.deepEqual(tally,[{status:'adopted',n:1},{status:'rejected',n:39}],'39 alternatives rejected');
  assert.equal((await db.query("SELECT count(*)::int n FROM game_votes WHERE status='open'")).rows[0].n,0,'No vote remains open');
  assert.equal((await db.query("SELECT count(*)::int n FROM formal_documents WHERE status_code='draft'")).rows[0].n,1,'One adopted bill kept');
  await assert.rejects(()=>db.query("INSERT INTO presidential_system_proposals(id,game_id,status) VALUES($1,$2,'draft')",[uid(999),game]),/уже утверждена/);
  await db.query("UPDATE game_votes SET result_code='passed' WHERE id=$1",[uid(601)]);
  assert.equal((await db.query("SELECT result_code FROM game_votes WHERE id=$1",[uid(601)])).rows[0].result_code,'rejected','Cannot override winner');
  assert.equal((await db.query("SELECT id FROM presidential_system_proposals WHERE status='adopted'")).rows[0].id,uid(500));
  assert(ui.includes('canUploadForCandidate')&&ui.includes('canUploadDocuments')&&ui.includes('{canManage&&<section className="candidatePrivateProfile">'),'Private profile protected');
  assert(sql.includes("split_part(name,'/',4)='docs'"),'Storage scope restricted to documents');
  assert(stage.includes('</b> {bill.status_label}</p>')&&stage.includes('</b> {resolution.status_label}</p>'),'Status labels have no dot');
  console.log('PASS: one adopted, 39 rejected, 40 votes closed; party member authorized; outsider and archived denied; private profile protected.');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
