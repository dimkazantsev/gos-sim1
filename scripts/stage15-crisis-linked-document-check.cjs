const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync('supabase/migrations/20261018180000_stage15_reviewed_crisis_linked_act.sql','utf8');
const uid=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0');
const game=uid(1),teacher=uid(2),minister=uid(3),unqualified=uid(4);
(async()=>{
 const db=new PGlite();
 try{
 await db.exec([
 'CREATE SCHEMA private;CREATE SCHEMA auth;CREATE ROLE anon;CREATE ROLE authenticated;',
 "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $q$ SELECT '"+teacher+"'::uuid $q$;",
 "CREATE FUNCTION private.can_create_formal_subject(uuid,uuid,text) RETURNS boolean LANGUAGE sql STABLE AS $q$ SELECT $2='"+minister+"'::uuid AND $3='ministry' $q$;",
 "CREATE FUNCTION private.formal_workflow(text) RETURNS jsonb LANGUAGE sql AS $q$ SELECT '[{\"code\":\"draft\",\"owner\":\"author\"},{\"code\":\"meeting\",\"owner\":\"ministry\"},{\"code\":\"adopted\",\"owner\":\"ministry\"},{\"code\":\"published\",\"owner\":\"system\"}]'::jsonb $q$;",
 'CREATE SEQUENCE formal_registry_seq;',
 'CREATE TABLE game_crises(id uuid primary key,game_id uuid,stage_no integer,crisis_type text,description text,status text);',
 'CREATE TABLE crisis_responses(id uuid primary key,crisis_id uuid,game_id uuid,user_id uuid,status text,reviewed_by uuid,action_plan text,legal_basis text,resources text,public_message text);',
 'CREATE TABLE formal_documents(id uuid primary key default gen_random_uuid(),game_id uuid,stage_no integer,registry_no text,title text,doc_type text,subject_key text,subject_label text,author_id uuid,body_text text,workflow_key text,workflow_steps jsonb,current_step integer,status_code text,status_label text,current_owner_key text,metadata jsonb);',
 'CREATE TABLE formal_document_history(id uuid primary key default gen_random_uuid(),document_id uuid,game_id uuid,actor_id uuid,action text,to_status text,to_owner text,note text);'
 ].join('\n'));
 await db.exec(sql);
 const crisis=uid(10),competentResponse=uid(20),wrongResponse=uid(21);
 await db.query("insert into game_crises values($1,$2,15,'Экономический кризис','Кризис требует законного реагирования','active')",[crisis,game]);
 await db.query("insert into crisis_responses values($1,$2,$3,$4,'submitted',null,$5,$6,$7,$8)",[competentResponse,crisis,game,minister,'Обеспечить устойчивые поставки и доступность товаров на территориях','Полномочия министерства','Ведомственный бюджет','Информировать население']);
 await db.query("insert into crisis_responses values($1,$2,$3,$4,'submitted',null,$5,$6,$7,$8)",[wrongResponse,crisis,game,unqualified,'Предложить решение без полномочий','Недостаточно компетенции','Нет','']);
 assert.equal(Number((await db.query('select count(*) n from formal_documents')).rows[0].n),0);
 await db.query("update crisis_responses set status='reviewed',reviewed_by=$1 where id=$2",[teacher,wrongResponse]);
 assert.equal(Number((await db.query('select count(*) n from formal_documents')).rows[0].n),0,'Incompetent responder cannot produce an official act');
 await db.query("update crisis_responses set status='reviewed',reviewed_by=$1 where id=$2",[teacher,competentResponse]);
 let acts=(await db.query('select * from formal_documents')).rows;
 assert.equal(acts.length,1,'Reviewed minister response creates an act');
 assert.equal(acts[0].doc_type,'ministry_order');
 assert.equal(acts[0].author_id,minister);
 assert.equal(acts[0].status_code,'draft','Review never fakes legal approval');
 assert.equal(acts[0].metadata.source_crisis_response_id,competentResponse);
 assert(acts[0].body_text.includes('Обеспечить устойчивые поставки'));
 assert(!acts[0].body_text.includes('замечание преподавателя'));
 const oldDoc=acts[0].id;
 await db.query("update crisis_responses set status='reviewed',reviewed_by=$1 where id=$2",[teacher,competentResponse]);
 await db.exec("CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $q$ SELECT null::uuid $q$;");
 await Promise.all(Array.from({length:40},()=>db.query('select private.sync_reviewed_crisis_legal_act($1)',[competentResponse])));
 assert.equal(Number((await db.query('select count(*) n from formal_documents')).rows[0].n),1,'40 concurrent replays must not duplicate an act');
 await db.exec("CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $q$ SELECT '"+teacher+"'::uuid $q$;");
 await assert.rejects(db.query("insert into formal_documents(game_id,metadata) values($1,jsonb_build_object('document_kind','crisis_response_act'))",[game]),/только из проверенного ответа/,'A client may not forge a generated crisis act');
 await assert.rejects(db.query("update formal_documents set metadata=metadata||jsonb_build_object('source_crisis_response_id','forged') where id=$1",[oldDoc]),/Нельзя подменить/);
 await db.query("update formal_documents set status_code='published',current_step=3,current_owner_key='system' where id=$1",[oldDoc]);
 assert.equal((await db.query('select status_code from formal_documents where id=$1',[oldDoc])).rows[0].status_code,'published','Publication is a separate workflow action');
 assert.equal(Number((await db.query('select count(*) n from formal_document_history')).rows[0].n),1,'Creation provenance is logged once');
 console.log('PASS: competent reviewed crisis becomes only a draft, no unauthorized act, 40 idempotent retries, immutable provenance, separate publication.');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});