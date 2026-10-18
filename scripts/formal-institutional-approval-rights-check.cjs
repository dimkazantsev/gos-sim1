const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync('supabase/migrations/20261018193000_formal_institutional_approval_owners.sql','utf8');
const id=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0');
const game=id(1),teacher=id(2),chair=id(3),member=id(4),deputy=id(5);
const route=[{code:'draft',label:'Черновик',owner:'author',action:'Передать на рассмотрение'},{code:'review',label:'На рассмотрении',owner:'teacher',action:'Принять'},{code:'published',label:'Принят',owner:'system',action:null}];
const rpc="CREATE OR REPLACE FUNCTION public.advance_formal_document(p_document_id uuid, p_action text DEFAULT 'advance'::text, p_note text DEFAULT NULL::text)\n RETURNS void\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'public', 'private', 'pg_temp'\nAS $function$\ndeclare\n d public.formal_documents%rowtype;\n v_uid uuid:=(select auth.uid());\n v_next integer;\n v_step jsonb;\n v_from_status text;\n v_from_owner text;\n v_ready jsonb;\nbegin\n if p_action not in ('advance','return','reject') then raise exception 'Неизвестное действие';end if;\n select * into d from public.formal_documents where id=p_document_id for update;\n if d.id is null then raise exception 'Document not found'; end if;\n if v_uid is null or not private.is_game_member(d.game_id) then raise exception 'Game access required'; end if;\n if not private.matches_formal_owner(d.game_id,v_uid,d.current_owner_key,d.author_id) then raise exception 'Current stage belongs to another institution'; end if;\n\n v_from_status:=d.status_code; v_from_owner:=d.current_owner_key;\n\n if p_action='return' then\n  if d.workflow_key='budget' and d.status_code in ('budget_committee','budget_council') then\n   v_next:=1;\n   update public.formal_documents\n   set current_step=v_next,status_code='revision',\n       status_label='Возвращён Правительству на доработку',\n       current_owner_key='government',updated_at=now()\n   where id=d.id;\n   insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)\n   values(d.id,d.game_id,v_uid,'Проект бюджета возвращён Правительству на доработку',v_from_status,'revision',v_from_owner,'government',p_note);\n  else\n   v_next:=0;v_step:=d.workflow_steps->v_next;\n   update public.formal_documents set current_step=v_next,status_code='revision',status_label='Возвращён на доработку',current_owner_key='author',updated_at=now() where id=d.id;\n   insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)\n   values(d.id,d.game_id,v_uid,'Возвращён на доработку',v_from_status,'revision',v_from_owner,'author',p_note);\n  end if;\n elsif p_action='reject' then\n  update public.formal_documents set status_code='rejected',status_label='Отклонён',current_owner_key='system',updated_at=now() where id=d.id;\n  insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)\n  values(d.id,d.game_id,v_uid,'Отклонён',v_from_status,'rejected',v_from_owner,'system',p_note);\n else\n  if private.formal_vote_required(d) then raise exception 'Эта стадия завершается результатом голосования';end if;\n  if exists(select 1 from public.game_votes where formal_document_id=d.id and status='open') then raise exception 'Сначала завершите открытое голосование';end if;\n  if d.workflow_key='bill' and d.status_code in ('draft','revision') then\n   v_ready:=private.bill_dossier_readiness_json(d.id);\n   if not coalesce((v_ready->>'submission_ready')::boolean,false)\n   then raise exception 'Bill submission package is incomplete: %',array_to_string(array(select jsonb_array_elements_text(v_ready->'issues')),'; '); end if;\n  end if;\n  if d.workflow_key='bill' and d.status_code='committee' then\n   v_ready:=private.bill_dossier_readiness_json(d.id);\n   if not coalesce((v_ready->>'committee_ready')::boolean,false)\n   then raise exception 'Committee review is incomplete: %',array_to_string(array(select jsonb_array_elements_text(v_ready->'review_issues')),'; '); end if;\n  end if;\n  if d.workflow_key='budget' and d.status_code='budget_committee'\n     and not private.budget_preliminary_ready(d.id)\n  then raise exception 'Complete the Budget Committee preliminary review before sending the project to the State Duma Council'; end if;\n\n  v_next:=d.current_step+1;\n  if v_next>=jsonb_array_length(d.workflow_steps) then raise exception 'Workflow already completed'; end if;\n  v_step:=d.workflow_steps->v_next;\n  update public.formal_documents\n  set current_step=v_next,status_code=v_step->>'code',status_label=v_step->>'label',\n      current_owner_key=v_step->>'owner',updated_at=now()\n  where id=d.id;\n  insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)\n  values(d.id,d.game_id,v_uid,coalesce(d.workflow_steps->d.current_step->>'action','Передан далее'),v_from_status,v_step->>'code',v_from_owner,v_step->>'owner',p_note);\n end if;\nend;$function$;";
(async()=>{
 const db=new PGlite();
 try{
 await db.exec([
 'CREATE SCHEMA private;CREATE SCHEMA auth;CREATE ROLE anon;CREATE ROLE authenticated;',
 'CREATE TABLE auth.session(user_id uuid);',
 'CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $x$ SELECT user_id FROM auth.session LIMIT 1 $x$;',
 'CREATE TABLE game_members(game_id uuid,user_id uuid,kind text,roster_archived_at timestamptz,role_title text);',
 'CREATE TABLE game_office_assignments(game_id uuid,user_id uuid,status text,role_title text);',
 'CREATE TABLE formal_documents(id uuid primary key,game_id uuid,stage_no integer,doc_type text,subject_key text,author_id uuid,workflow_key text,workflow_steps jsonb,current_step integer,status_code text,status_label text,current_owner_key text,metadata jsonb,updated_at timestamptz);',
 'CREATE TABLE formal_document_history(document_id uuid,game_id uuid,actor_id uuid,action text,from_status text,to_status text,from_owner text,to_owner text,note text);',
 'CREATE TABLE game_votes(formal_document_id uuid,status text);',
 "CREATE FUNCTION private.is_game_member(uuid) RETURNS boolean LANGUAGE sql STABLE AS $x$ SELECT EXISTS(SELECT 1 FROM game_members WHERE game_id=$1 AND user_id=auth.uid()) $x$;",
 "CREATE FUNCTION private.is_game_teacher(uuid) RETURNS boolean LANGUAGE sql STABLE AS $x$ SELECT EXISTS(SELECT 1 FROM game_members WHERE game_id=$1 AND user_id=auth.uid() AND kind='teacher') $x$;",
 "CREATE FUNCTION private.role_is_available(uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS $x$ SELECT true $x$;",
 "CREATE FUNCTION private.formal_user_roles(uuid,uuid) RETURNS SETOF text LANGUAGE sql STABLE AS $x$ SELECT lower(role_title) FROM game_members WHERE game_id=$1 AND user_id=$2 UNION SELECT lower(role_title) FROM game_office_assignments WHERE game_id=$1 AND user_id=$2 AND status='active' $x$;",
 'CREATE FUNCTION private.formal_vote_required(formal_documents) RETURNS boolean LANGUAGE sql STABLE AS $x$ SELECT false $x$;',
 "CREATE FUNCTION private.bill_dossier_readiness_json(uuid) RETURNS jsonb LANGUAGE sql STABLE AS $x$ SELECT '{\"submission_ready\":true,\"committee_ready\":true}'::jsonb $x$;",
 'CREATE FUNCTION private.budget_preliminary_ready(uuid) RETURNS boolean LANGUAGE sql STABLE AS $x$ SELECT true $x$;'
 ].join('\n'));
 for(const [uid,kind,role] of [[teacher,'teacher','Преподаватель'],[chair,'student','Председатель Государственной Думы'],[member,'student','Член КСРФ'],[deputy,'student','Депутат Государственной Думы']]){
  await db.query('insert into game_members values($1,$2,$3,null,$4)',[game,uid,kind,role]);
 }
 async function doc(n,stage,subject){
  await db.query("insert into formal_documents(id,game_id,stage_no,doc_type,subject_key,author_id,workflow_key,workflow_steps,current_step,status_code,status_label,current_owner_key,metadata) values($1,$2,$3,'other',$4,$5,'generic',$6,1,'review','На рассмотрении','teacher','{}'::jsonb)",[id(n),game,stage,subject,deputy,JSON.stringify(route)]);
 }
 await doc(20,4,'gd');
 await doc(21,2,'ksrf');
 await db.exec(migration);
 await db.exec(rpc);
 let g=(await db.query('select current_owner_key,workflow_steps from formal_documents where id=$1',[id(20)])).rows[0];
 let k=(await db.query('select current_owner_key,workflow_steps from formal_documents where id=$1',[id(21)])).rows[0];
 assert.equal(g.current_owner_key,'gd_staff');assert.equal(g.workflow_steps[1].owner,'gd_staff');
 assert.equal(k.current_owner_key,'ksrf');assert.equal(k.workflow_steps[1].owner,'ksrf');
 await db.query('insert into auth.session values($1)',[teacher]);
 assert.equal((await db.query('select private.matches_formal_owner($1,$2,$3,$4) permitted',[game,teacher,'gd_staff',deputy])).rows[0].permitted,false);
 const blocked=await Promise.allSettled(Array.from({length:40},()=>db.query("select public.advance_formal_document($1,'advance',null)",[id(20)])));
 assert.equal(blocked.filter(x=>x.status==='rejected').length,40);
 assert.equal((await db.query('select status_code from formal_documents where id=$1',[id(20)])).rows[0].status_code,'review');
 await db.query('update auth.session set user_id=$1',[deputy]);
 await assert.rejects(db.query("select public.advance_formal_document($1,'advance',null)",[id(20)]),/another institution/);
 await db.query('update auth.session set user_id=$1',[chair]);
 assert.equal((await db.query('select private.matches_formal_owner($1,$2,$3,$4) permitted',[game,chair,'gd_staff',deputy])).rows[0].permitted,true);
 await db.query("select public.advance_formal_document($1,'advance','Решение уполномоченного лица')",[id(20)]);
 assert.equal((await db.query('select status_code from formal_documents where id=$1',[id(20)])).rows[0].status_code,'published');
 await db.query('update auth.session set user_id=$1',[member]);
 await db.query("select public.advance_formal_document($1,'advance',null)",[id(21)]);
 assert.equal((await db.query('select status_code from formal_documents where id=$1',[id(21)])).rows[0].status_code,'published');
 await db.query('update auth.session set user_id=$1',[teacher]);
 await doc(22,4,'gd');
 g=(await db.query('select current_owner_key,workflow_steps from formal_documents where id=$1',[id(22)])).rows[0];
 assert.equal(g.current_owner_key,'gd_staff');assert.equal(g.workflow_steps[1].owner,'gd_staff');
 assert.equal(Number((await db.query('select count(*) n from formal_document_history')).rows[0].n),2);
 console.log('PASS: retroactive and new institutional routes, 40 teacher attempts denied, rightful Duma/KSRF adoption and separate histories.');
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1});