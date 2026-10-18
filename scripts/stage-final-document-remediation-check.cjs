const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync('supabase/migrations/20261018090000_completed_stage_final_document_remediation_refund.sql','utf8');
const fn=(name,delimiter)=>{
 const escaped=delimiter.replace(/\\/g,'\\\\');
 const rx=new RegExp('CREATE OR REPLACE FUNCTION private\\.'+name+'\\([\\s\\S]*?\\$'+escaped+'\\$;');
 const match=sql.match(rx);
 assert(match,name+' is defined in the migration');
 return match[0];
};
const game='10000000-0000-0000-0000-000000000001';
const official='10000000-0000-0000-0000-000000000101';
const other='10000000-0000-0000-0000-000000000102';
(async()=>{
 const db=new PGlite();
 try{
 await db.exec(`
 create schema private;create schema auth;create role anon;create role authenticated;
 create table identity(id uuid,teacher boolean);
 insert into identity values('${official}',false);
 create function auth.uid() returns uuid language sql stable as $b$select id from identity limit 1$b$;
 create function private.is_game_teacher(uuid) returns boolean language sql stable as $b$select teacher from identity limit 1$b$;
 create function private.is_game_member(uuid) returns boolean language sql stable as $b$select true$b$;
 create function private.can_create_formal_subject(uuid,uuid,text) returns boolean language sql stable as $b$
 select $2='${official}'::uuid and $3 in ('gd','ksrf')$b$;
 create table game_stages(game_id uuid,stage_no integer,status text,deadline timestamptz);
 insert into game_stages values('${game}',2,'completed',null),('${game}',4,'completed',null),('${game}',5,'open',null);
 create table game_members(game_id uuid,user_id uuid,kind text,roster_archived_at timestamptz);
 insert into game_members values('${game}','${official}','student',null),('${game}','${other}','student',null);
 create table formal_documents(id uuid primary key default gen_random_uuid(),game_id uuid,
   stage_no integer,doc_type text,subject_key text,metadata jsonb,status_code text);
 create table stage_final_document_obligations(game_id uuid,stage_no integer,template_key text,user_id uuid);
 insert into stage_final_document_obligations values
 ('${game}',2,'minutes','${official}'),
 ('${game}',4,'gd_resolution','${official}'),
 ('${game}',4,'minutes','${official}');
 create table stage_assessments(game_id uuid,stage_no integer,user_id uuid,status text,
    auto_score numeric,evidence_summary jsonb);
 insert into stage_assessments values
 ('${game}',4,'${official}','draft',2,'{"final_document_penalty_points":1}'),
 ('${game}',4,'${other}','final',3,'{"final_document_penalty_points":1}');
 create function private.stage_required_final_documents(uuid,integer) returns jsonb language sql stable as $b$
 select coalesce(jsonb_agg(jsonb_build_object('template_key',r.template,
 'subject_key',r.subject,'fulfilled',exists(select 1 from formal_documents d
 where d.game_id=$1 and d.stage_no=$2 and d.status_code='published'
 and d.metadata->>'template_key'=r.template and d.subject_key=r.subject))), '[]'::jsonb)
 from (values(2,'minutes','ksrf'),(4,'gd_resolution','gd'),(4,'minutes','gd'))
 r(st,template,subject) where r.st=$2
 $b$;
 create function private.stage_document_penalty_points(uuid,uuid,integer) returns numeric language sql stable as $b$
 select case when exists(select 1 from stage_final_document_obligations o
 cross join lateral jsonb_array_elements(private.stage_required_final_documents($1,$3)) d
 where o.game_id=$1 and o.user_id=$2 and o.stage_no=$3
 and o.template_key=d->>'template_key' and not (d->>'fulfilled')::boolean)
 then 1 else 0 end::numeric$b$;
 create function private.has_prior_stage_document_hold(uuid,uuid,integer) returns boolean language sql stable as $b$
 select exists(select 1 from game_stages st where st.game_id=$1 and st.stage_no<$3
 and st.status='completed' and private.stage_document_penalty_points($1,$2,st.stage_no)>0)$b$;
 create function private.compute_vsn_assessment(uuid,uuid,integer,text) returns uuid language plpgsql as $b$
 begin
 update stage_assessments a set auto_score=3-private.stage_document_penalty_points($1,$2,$3),
 evidence_summary=jsonb_build_object('final_document_penalty_points',
 private.stage_document_penalty_points($1,$2,$3))
 where game_id=$1 and user_id=$2 and stage_no=$3 and status='draft';
 return gen_random_uuid();
 end;$b$;
 `);
 for(const [name,tag] of [
 ['can_remediate_stage_final_document','remediation'],
 ['guard_stage_submission','function'],
 ['guard_stage_document_hold_write','function'],
 ['refresh_grade_after_final_document','refresh']])await db.exec(fn(name,tag));
 await db.exec(`
 create trigger guard_formal_documents_stage before insert or update on formal_documents
 for each row execute function private.guard_stage_submission();
 create trigger stage_document_member_progress_guard before insert or update on formal_documents
 for each row execute function private.guard_stage_document_hold_write();
 create trigger refresh_grade_after_final_document after insert or update of status_code on formal_documents
 for each row execute function private.refresh_grade_after_final_document();
 `);
 const add=(stage,key,type,subject='gd')=>db.query(
 'insert into formal_documents(game_id,stage_no,doc_type,subject_key,metadata,status_code) values ($1,$2,$3,$4,$5,\'draft\') returning id',
 [game,stage,type,subject,JSON.stringify({template_key:key})]);
 await assert.rejects(add(4,'other','other'),/Этап завершён/);
 await assert.rejects(add(4,'gd_resolution','other'),/Этап завершён/);
 const first=await add(4,'gd_resolution','gd_resolution');
 const minutes=await add(4,'minutes','other');
 assert.equal((await db.query('select auto_score from stage_assessments where user_id=$1',[official])).rows[0].auto_score,'2');
 const refused=await Promise.allSettled(Array.from({length:40},()=>add(5,'gd_resolution','gd_resolution')));
 assert.equal(refused.filter(x=>x.status==='rejected').length,40,'40 subsequent-stage actions refused');
 await db.query('update formal_documents set status_code=\'published\' where id=$1',[first.rows[0].id]);
 assert.equal((await db.query('select auto_score from stage_assessments where user_id=$1',[official])).rows[0].auto_score,'2','not restored until every obligation fulfilled');
 await db.query('update formal_documents set status_code=\'published\' where id=$1',[minutes.rows[0].id]);
 assert.equal((await db.query('select auto_score from stage_assessments where user_id=$1',[official])).rows[0].auto_score,'3','restores draft score after last publication');
 assert.equal((await db.query('select auto_score from stage_assessments where user_id=$1',[other])).rows[0].auto_score,'3','teacher-final grade untouched');
 await assert.rejects(add(5,'gd_resolution','gd_resolution'),/Следующий этап недоступен/,'stage 2 debt must still hold stage 5');
 const ksrf=await add(2,'minutes','other','ksrf');
 await db.query('update formal_documents set status_code=\'published\' where id=$1',[ksrf.rows[0].id]);
 await add(5,'gd_resolution','gd_resolution');
 await db.query('update identity set id=$1',[other]);
 await assert.rejects(add(4,'gd_resolution','gd_resolution'),/Этап завершён/,'outsider cannot reopen completed stage');
 console.log('PASS: completed-stage scoped writing, 40 future-stage denials, prior-debt precedence, two-document refund, final grade protection, outsider denied');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
