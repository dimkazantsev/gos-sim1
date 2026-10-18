const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const source=fs.readFileSync('supabase/migrations/20261018160000_verified_results_stage2_3_5_14.sql','utf8');
const uid=i=>'10000000-0000-0000-0000-'+String(i).padStart(12,'0');
const game=uid(1),official=uid(2);
(async()=>{
const db=new PGlite();
try{
await db.exec([
 'CREATE SCHEMA private;CREATE SCHEMA auth;CREATE ROLE anon;CREATE ROLE authenticated;',
 "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $x$ SELECT '"+official+"'::uuid $x$;",
 "CREATE FUNCTION private.formal_workflow(text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $x$ SELECT '[{\"code\":\"draft\",\"owner\":\"author\"},{\"code\":\"agenda\",\"owner\":\"gd_council\"},{\"code\":\"adopted\",\"owner\":\"gd_staff\"},{\"code\":\"published\",\"owner\":\"system\"}]'::jsonb $x$;",
 'CREATE SEQUENCE formal_registry_seq;',
 'CREATE TABLE game_votes(id uuid PRIMARY KEY,game_id uuid,stage_no integer,procedure_key text,institution_key text,status text,result_code text,title text,body text,created_by uuid,formal_document_id uuid,result_yes numeric,result_no numeric,result_abstain numeric);',
 'CREATE TABLE parliamentary_election_rules(id uuid,game_id uuid,vote_id uuid,status text);',
 'CREATE TABLE regional_election_rules(id uuid,game_id uuid,vote_id uuid,status text);',
 'CREATE TABLE ghost_voting_policies(id uuid,game_id uuid,vote_id uuid,status text);',
 'CREATE TABLE municipal_projects(id uuid,game_id uuid,vote_id uuid,status text,created_by uuid,problem_title text,location_text text,legal_competence text,proposed_solution text,estimated_cost numeric,expected_effect text);',
 'CREATE TABLE formal_documents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),game_id uuid,stage_no integer,registry_no text,title text,doc_type text,subject_key text,subject_label text,author_id uuid,body_text text,workflow_key text,workflow_steps jsonb,current_step integer,status_code text,status_label text,current_owner_key text,metadata jsonb);',
 'CREATE TABLE formal_document_history(id uuid DEFAULT gen_random_uuid(),document_id uuid,game_id uuid,actor_id uuid,action text,to_status text,to_owner text,note text);'
].join('\n'));
await db.exec(source);
const specs=[
  {stage:2,key:'electoral_system',organ:'ksrf',table:'parliamentary_election_rules'},
  {stage:3,key:'regional_system',organ:'ksrf',table:'regional_election_rules'},
  {stage:5,key:'ghost_policy',organ:'gd',table:'ghost_voting_policies'},
  {stage:14,key:'municipal_project',organ:'municipality',table:'municipal_projects'}
];
const votes=[];
for(let i=0;i<specs.length;i++){
 const z=specs[i],vote=uid(200+i),decision=uid(300+i);
 await db.query("insert into game_votes(id,game_id,stage_no,procedure_key,institution_key,status,title,body,created_by,result_yes,result_no,result_abstain) values($1,$2,$3,$4,$5,'open',$6,$7,$8,4,0,0)",[vote,game,z.stage,z.key,z.organ,'Решение №'+z.stage,'Текст принятого предложения',official]);
 if(z.stage!==14)await db.query('insert into '+z.table+'(id,game_id,vote_id,status) values($1,$2,$3,$4)',[decision,game,vote,'adopted']);
 else await db.query("insert into municipal_projects(id,game_id,vote_id,status,created_by,problem_title,location_text,legal_competence,proposed_solution,estimated_cost,expected_effect) values($1,$2,$3,'adopted',$4,$5,$6,$7,$8,100,$9)",[decision,game,vote,official,'Благоустройство','Район','Решение компетентного органа','Обустроить территорию','Улучшение среды']);
 await db.query("update game_votes set status='closed',result_code='passed' where id=$1",[vote]);
 votes.push(vote);
}
let acts=(await db.query('select * from formal_documents order by stage_no')).rows;
assert.equal(acts.length,4);
assert.deepEqual(acts.map(x=>x.stage_no),[2,3,5,14]);
assert.deepEqual(acts.map(x=>x.status_code),['draft','draft','adopted','adopted']);
assert(acts.every(x=>x.metadata.auto_generated===true&&x.metadata.source_vote_id));
assert(acts.every(x=>!['published','signed'].includes(x.status_code)));
const rejected=uid(501);
await db.query("insert into game_votes(id,game_id,stage_no,procedure_key,institution_key,status,title,created_by) values($1,$2,5,'ghost_policy','gd','open','Отклонённый режим',$3)",[rejected,game,official]);
await db.query("update game_votes set status='closed',result_code='rejected' where id=$1",[rejected]);
assert.equal(Number((await db.query('select count(*) n from formal_documents')).rows[0].n),4,'Rejected vote cannot create act');
await Promise.all(Array.from({length:40},()=>db.query('select private.sync_verified_vote_decision_act($1)',[votes[0]])));
assert.equal(Number((await db.query('select count(*) n from formal_documents')).rows[0].n),4,'Forty duplicate calls create no duplicates');
await assert.rejects(db.query("insert into formal_documents(game_id,metadata) values($1,jsonb_build_object('document_kind','verified_vote_decision_act'))",[game]),/только по подтверждённому/);
await assert.rejects(db.query("update formal_documents set metadata=metadata||jsonb_build_object('source_vote_id','overwritten') where stage_no=2"),/подменить подтверждённый источник/);
console.log('PASS: 4 source-verified decision acts, immutable references, 40 retries, no forged publication.');
}finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});