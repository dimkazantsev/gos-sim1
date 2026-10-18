const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync('supabase/migrations/20261018194000_restore_teacher_approved_gd_minutes.sql','utf8');
const id=n=>'20000000-0000-0000-0000-'+String(n).padStart(12,'0');
const game=id(1),teacher=id(2),chair=id(3),student=id(4),author=id(5);
const existing=[
 {no:167,id:id(167),historyActor:teacher},
 {no:175,id:id(175),historyActor:teacher},
 {no:199,id:id(199),historyActor:chair}
];
const workflow=[{code:'draft',label:'Черновик',owner:'author',action:'Передать на рассмотрение'},
 {code:'review',label:'На рассмотрении',owner:'gd_staff',action:'Принять'},
 {code:'published',label:'Принят',owner:'system',action:null}];
const realMatch="CREATE OR REPLACE FUNCTION private.matches_formal_owner(p_game uuid, p_user uuid, p_owner text, p_author uuid)\n RETURNS boolean\n LANGUAGE sql\n STABLE SECURITY DEFINER\n SET search_path TO 'public', 'private', 'pg_temp'\nAS $function$\n select case\n when p_user is null or p_user is distinct from auth.uid() then false\n when p_owner='author' then p_user=p_author and exists(\n   select 1 from public.game_members gm where gm.game_id=p_game\n    and gm.user_id=p_user and gm.kind in ('student','teacher')\n    and gm.roster_archived_at is null)\n when p_owner in ('system','teacher') then false\n when not exists(\n   select 1 from public.game_members gm where gm.game_id=p_game\n    and gm.user_id=p_user and gm.kind='student'\n    and gm.roster_archived_at is null) then false\n when not private.role_is_available(p_game,p_user) then false\n else exists(select 1 from private.formal_user_roles(p_game,p_user) r where case p_owner\n when 'ksrf' then r like '%ксрф%'\n when 'ks' then r like '%конституционн%суд%'\n when 'vs' then r like '%верховн%суд%'\n when 'region' then r like '%законодательн%' or r like '%регион%'\n when 'president' then r like '%президент%'\n when 'gd_staff' then r like '%председател%' and r like '%дум%'\n when 'gd_council' then (r like '%совет%' or r like '%председател%') and r like '%дум%'\n when 'committee' then r like '%комитет%' or r like '%депутат%'\n when 'gd' then r like '%депутат%' or (r like '%государственн%' and r like '%дум%')\n when 'sf' then r like '%сенатор%' or r like '%совет федерац%'\n when 'government' then r like '%правительств%' or r like '%министр%'\n when 'ministry' then r like '%министр%' or r like '%министерств%'\n when 'municipality' then r like '%муницип%' or r like '%глава города%' or r like '%администрац%'\n else false end) end\n$function$;";
const realAdvance="CREATE OR REPLACE FUNCTION public.advance_formal_document(p_document_id uuid, p_action text DEFAULT 'advance'::text, p_note text DEFAULT NULL::text)\n RETURNS void\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'public', 'private', 'pg_temp'\nAS $function$\ndeclare\n d public.formal_documents%rowtype;\n v_uid uuid:=(select auth.uid());\n v_next integer;\n v_step jsonb;\n v_from_status text;\n v_from_owner text;\n v_ready jsonb;\nbegin\n if p_action not in ('advance','return','reject') then raise exception 'Неизвестное действие';end if;\n select * into d from public.formal_documents where id=p_document_id for update;\n if d.id is null then raise exception 'Document not found'; end if;\n if v_uid is null or not private.is_game_member(d.game_id) then raise exception 'Game access required'; end if;\n if not private.matches_formal_owner(d.game_id,v_uid,d.current_owner_key,d.author_id) then raise exception 'Current stage belongs to another institution'; end if;\n\n v_from_status:=d.status_code; v_from_owner:=d.current_owner_key;\n\n if p_action='return' then\n  if d.workflow_key='budget' and d.status_code in ('budget_committee','budget_council') then\n   v_next:=1;\n   update public.formal_documents\n   set current_step=v_next,status_code='revision',\n       status_label='Возвращён Правительству на доработку',\n       current_owner_key='government',updated_at=now()\n   where id=d.id;\n   insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)\n   values(d.id,d.game_id,v_uid,'Проект бюджета возвращён Правительству на доработку',v_from_status,'revision',v_from_owner,'government',p_note);\n  else\n   v_next:=0;v_step:=d.workflow_steps->v_next;\n   update public.formal_documents set current_step=v_next,status_code='revision',status_label='Возвращён на доработку',current_owner_key='author',updated_at=now() where id=d.id;\n   insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)\n   values(d.id,d.game_id,v_uid,'Возвращён на доработку',v_from_status,'revision',v_from_owner,'author',p_note);\n  end if;\n elsif p_action='reject' then\n  update public.formal_documents set status_code='rejected',status_label='Отклонён',current_owner_key='system',updated_at=now() where id=d.id;\n  insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)\n  values(d.id,d.game_id,v_uid,'Отклонён',v_from_status,'rejected',v_from_owner,'system',p_note);\n else\n  if private.formal_vote_required(d) then raise exception 'Эта стадия завершается результатом голосования';end if;\n  if exists(select 1 from public.game_votes where formal_document_id=d.id and status='open') then raise exception 'Сначала завершите открытое голосование';end if;\n  if d.workflow_key='bill' and d.status_code in ('draft','revision') then\n   v_ready:=private.bill_dossier_readiness_json(d.id);\n   if not coalesce((v_ready->>'submission_ready')::boolean,false)\n   then raise exception 'Bill submission package is incomplete: %',array_to_string(array(select jsonb_array_elements_text(v_ready->'issues')),'; '); end if;\n  end if;\n  if d.workflow_key='bill' and d.status_code='committee' then\n   v_ready:=private.bill_dossier_readiness_json(d.id);\n   if not coalesce((v_ready->>'committee_ready')::boolean,false)\n   then raise exception 'Committee review is incomplete: %',array_to_string(array(select jsonb_array_elements_text(v_ready->'review_issues')),'; '); end if;\n  end if;\n  if d.workflow_key='budget' and d.status_code='budget_committee'\n     and not private.budget_preliminary_ready(d.id)\n  then raise exception 'Complete the Budget Committee preliminary review before sending the project to the State Duma Council'; end if;\n\n  v_next:=d.current_step+1;\n  if v_next>=jsonb_array_length(d.workflow_steps) then raise exception 'Workflow already completed'; end if;\n  v_step:=d.workflow_steps->v_next;\n  update public.formal_documents\n  set current_step=v_next,status_code=v_step->>'code',status_label=v_step->>'label',\n      current_owner_key=v_step->>'owner',updated_at=now()\n  where id=d.id;\n  insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)\n  values(d.id,d.game_id,v_uid,coalesce(d.workflow_steps->d.current_step->>'action','Передан далее'),v_from_status,v_step->>'code',v_from_owner,v_step->>'owner',p_note);\n end if;\nend;$function$;";
(async()=>{
const db=new PGlite();
try{
 await db.exec([
 'CREATE SCHEMA private; CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated;',
 'CREATE TABLE auth.session(user_id uuid);',
 'CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT user_id FROM auth.session LIMIT 1 $f$;',
 'CREATE TABLE game_members(game_id uuid,user_id uuid,kind text,roster_archived_at timestamptz,role_title text);',
 'CREATE TABLE game_office_assignments(game_id uuid,user_id uuid,status text,role_title text);',
 'CREATE TABLE formal_documents(id uuid PRIMARY KEY,game_id uuid,stage_no integer,registry_no text,title text,doc_type text,subject_key text,subject_label text,author_id uuid,body_text text,workflow_key text,workflow_steps jsonb,current_step integer,status_code text,status_label text,current_owner_key text,metadata jsonb,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());',
 'CREATE TABLE formal_document_history(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,document_id uuid,game_id uuid,actor_id uuid,action text,from_status text,to_status text,from_owner text,to_owner text,note text,created_at timestamptz DEFAULT now());',
 'CREATE TABLE game_stages(game_id uuid,stage_no integer,status text,deadline timestamptz);',
 'CREATE TABLE game_votes(formal_document_id uuid,status text);',
 "CREATE FUNCTION private.is_game_member(uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT EXISTS(SELECT 1 FROM game_members WHERE game_id=$1 AND user_id=auth.uid()) $f$;",
 "CREATE FUNCTION private.is_game_teacher(uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT EXISTS(SELECT 1 FROM game_members WHERE game_id=$1 AND user_id=auth.uid() AND kind='teacher') $f$;",
 'CREATE FUNCTION private.role_is_available(uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT true $f$;',
 "CREATE FUNCTION private.formal_user_roles(uuid,uuid) RETURNS SETOF text LANGUAGE sql STABLE AS $f$ SELECT lower(role_title) FROM game_members WHERE game_id=$1 AND user_id=$2 UNION SELECT lower(role_title) FROM game_office_assignments WHERE game_id=$1 AND user_id=$2 AND status='active' $f$;",
 "CREATE FUNCTION private.can_remediate_stage_final_document(uuid,integer,uuid,text,text,jsonb) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT false $f$;",
 "CREATE FUNCTION private.stage4_legal_act_can_finalize(formal_documents,formal_documents,uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT false $f$;",
 "CREATE FUNCTION private.has_prior_stage_document_hold(uuid,uuid,integer) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT true $f$;",
 'CREATE FUNCTION private.guard_stage_submission() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW;END;$f$;',
 'CREATE FUNCTION private.guard_stage_document_hold_write() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW;END;$f$;',
 'CREATE FUNCTION private.formal_vote_required(formal_documents) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT false $f$;',
 "CREATE FUNCTION private.bill_dossier_readiness_json(uuid) RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT '{\"submission_ready\":true,\"committee_ready\":true}'::jsonb $f$;",
 'CREATE FUNCTION private.budget_preliminary_ready(uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT true $f$;'
 ].join('\n'));
 await db.exec(realMatch);
 await db.exec(realAdvance);
 await db.exec('CREATE TRIGGER guard_formal_documents_stage BEFORE UPDATE ON formal_documents FOR EACH ROW EXECUTE FUNCTION private.guard_stage_submission();');
 await db.exec('CREATE TRIGGER stage_document_member_progress_guard BEFORE UPDATE ON formal_documents FOR EACH ROW EXECUTE FUNCTION private.guard_stage_document_hold_write();');
 await db.query("insert into game_stages values($1,4,'completed',null)",[game]);
 for(const [who,kind,role] of [[teacher,'teacher','Преподаватель'],[chair,'student','Депутат Государственной Думы'],[student,'student','Депутат Государственной Думы'],[author,'student','Депутат Государственной Думы']]){
  await db.query("insert into game_members values($1,$2,$3,null,$4)",[game,who,kind,role]);
 }
 await db.query("insert into game_office_assignments values($1,$2,'active','Председатель Государственной Думы')",[game,chair]);
 for(const x of existing){
  await db.query("insert into formal_documents(id,game_id,stage_no,registry_no,title,doc_type,subject_key,subject_label,author_id,body_text,workflow_key,workflow_steps,current_step,status_code,status_label,current_owner_key,metadata) values($1,$2,4,$3,'Протокол заседания Государственной Думы','other','gd','Государственная Дума Федерального Собрания РФ',$4,'Исходный текст протокола','generic',$5,2,'published','Принят','system',$6)",[x.id,game,'ИГРА-НПА-'+x.no,author,JSON.stringify(workflow),JSON.stringify({template_key:'minutes'})]);
  await db.query("insert into formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner) values($1,$2,$3,'Принять','review','published','teacher','system')",[x.id,game,x.historyActor]);
 }
 const before=(await db.query('select count(*) n from formal_document_history')).rows[0].n;
 await db.exec(migration);
 assert.equal(Number(before),3);
 let docs=(await db.query("select registry_no,status_code,current_step,current_owner_key,body_text from formal_documents order by registry_no")).rows;
 assert.deepEqual(docs.map(x=>x.status_code),['review','review','published']);
 assert(docs.slice(0,2).every(x=>x.current_owner_key==='gd_staff'&&x.current_step===1));
 assert(docs.every(x=>x.body_text==='Исходный текст протокола'));
 let log=(await db.query("select document_id,actor_id,action,from_status,to_status from formal_document_history order by id")).rows;
 assert.equal(log.length,5,'Old history retained and exactly 2 correction entries added');
 assert.equal(log.filter(h=>h.action==='Отменено ошибочное принятие преподавателем').length,2);
 assert(log.slice(-2).every(h=>h.actor_id===null&&h.to_status==='review'));
 await db.query('insert into auth.session values($1)',[teacher]);
 assert.equal((await db.query('select private.matches_formal_owner($1,$2,$3,$4) allowed',[game,teacher,'gd_staff',author])).rows[0].allowed,false);
 const attempts=await Promise.allSettled(Array.from({length:40},()=>db.query("select public.advance_formal_document($1,'advance',null)",[existing[0].id])));
 assert.equal(attempts.filter(x=>x.status==='rejected').length,40,'40 teacher attempts must fail');
 await assert.rejects(
  db.query("update formal_documents set status_code='published',current_step=2,status_label='Принят',current_owner_key='system' where id=$1",[existing[0].id]),
  /повторно принимает только уполномоченное/,'Teacher cannot bypass RPC with direct table update');

 await db.query('update auth.session set user_id=$1',[student]);
 await assert.rejects(db.query("select public.advance_formal_document($1,'advance',null)",[existing[1].id]),/another institution/);
 await db.query('update auth.session set user_id=$1',[chair]);
 for(const x of existing.slice(0,2)){
  await db.query("select public.advance_formal_document($1,'advance','Утверждено уполномоченным лицом')",[x.id]);
 }
 docs=(await db.query('select registry_no,status_code from formal_documents order by registry_no')).rows;
 assert.deepEqual(docs.map(x=>x.status_code),['published','published','published'],'Both returned documents can be accepted on a CLOSED stage');
 log=(await db.query('select action,from_status,to_status from formal_document_history order by id')).rows;
 assert.equal(log.length,7,'2 old acceptances, 2 corrections and 2 proper acceptances, plus third untouched');
 assert.equal(log.filter(x=>x.action==='Отменено ошибочное принятие преподавателем').length,2);
 console.log('PASS: Exactly two teacher-approved GD protocols reopened with untouched text/old history; 40 teacher attempts denied; both chair approvals succeed despite closed stage and obligations.');
}finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});