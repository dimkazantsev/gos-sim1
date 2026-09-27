-- Formal registry permissions and workflow RPCs.
create or replace function private.matches_formal_owner(p_game uuid,p_user uuid,p_owner text,p_author uuid)
returns boolean language sql stable security definer
set search_path=public,private,pg_temp as $$
select case
 when private.is_game_teacher(p_game) then true
 when p_owner='author' then p_user=p_author
 when p_owner='system' then false
 when p_owner='president' then exists(select 1 from public.game_members gm where gm.game_id=p_game and gm.user_id=p_user and coalesce(gm.role_title,'') ilike '%президент%')
 when p_owner='gd_staff' then exists(select 1 from public.game_members gm where gm.game_id=p_game and gm.user_id=p_user and coalesce(gm.role_title,'') ilike '%председател%дум%')
 when p_owner='gd_council' then exists(select 1 from public.game_members gm where gm.game_id=p_game and gm.user_id=p_user and (coalesce(gm.role_title,'') ilike '%совет%дум%' or coalesce(gm.role_title,'') ilike '%председател%дум%'))
 when p_owner='committee' then exists(select 1 from public.game_members gm where gm.game_id=p_game and gm.user_id=p_user and (coalesce(gm.role_title,'') ilike '%комитет%' or coalesce(gm.role_title,'') ilike '%депутат%'))
 when p_owner='gd' then exists(select 1 from public.game_members gm where gm.game_id=p_game and gm.user_id=p_user and (coalesce(gm.role_title,'') ilike '%депутат%' or coalesce(gm.role_title,'') ilike '%государственн%дум%'))
 when p_owner='sf' then exists(select 1 from public.game_members gm where gm.game_id=p_game and gm.user_id=p_user and (coalesce(gm.role_title,'') ilike '%совет%федерац%' or coalesce(gm.role_title,'') ilike '%сенатор%'))
 when p_owner='government' then exists(select 1 from public.game_members gm where gm.game_id=p_game and gm.user_id=p_user and (coalesce(gm.role_title,'') ilike '%правительств%' or coalesce(gm.role_title,'') ilike '%министр%'))
 when p_owner='ministry' then exists(select 1 from public.game_members gm where gm.game_id=p_game and gm.user_id=p_user and (coalesce(gm.role_title,'') ilike '%министр%' or coalesce(gm.role_title,'') ilike '%министерств%'))
 when p_owner='municipality' then exists(select 1 from public.game_members gm where gm.game_id=p_game and gm.user_id=p_user and (coalesce(gm.role_title,'') ilike '%муницип%' or coalesce(gm.role_title,'') ilike '%глава города%' or coalesce(gm.role_title,'') ilike '%администрац%'))
 else false end;
$$;

create or replace function private.can_create_formal_subject(p_game uuid,p_user uuid,p_subject text)
returns boolean language sql stable security definer
set search_path=public,private,pg_temp as $$
select case
 when private.is_game_teacher(p_game) then true
 when p_subject='president' then exists(select 1 from public.game_members gm where gm.game_id=p_game and gm.user_id=p_user and coalesce(gm.role_title,'') ilike '%президент%')
 when p_subject='gd_deputy' then exists(select 1 from public.game_members gm where gm.game_id=p_game and gm.user_id=p_user and coalesce(gm.role_title,'') ilike '%депутат%')
 when p_subject='gd' then exists(select 1 from public.game_members gm where gm.game_id=p_game and gm.user_id=p_user and (coalesce(gm.role_title,'') ilike '%председател%дум%' or coalesce(gm.role_title,'') ilike '%совет%дум%'))
 when p_subject='sf' then exists(select 1 from public.game_members gm where gm.game_id=p_game and gm.user_id=p_user and coalesce(gm.role_title,'') ilike '%совет%федерац%')
 when p_subject='sf_member' then exists(select 1 from public.game_members gm where gm.game_id=p_game and gm.user_id=p_user and coalesce(gm.role_title,'') ilike '%сенатор%')
 when p_subject='government' then exists(select 1 from public.game_members gm where gm.game_id=p_game and gm.user_id=p_user and (coalesce(gm.role_title,'') ilike '%правительств%' or coalesce(gm.role_title,'') ilike '%министр%'))
 when p_subject='region' then exists(select 1 from public.game_members gm where gm.game_id=p_game and gm.user_id=p_user and (coalesce(gm.role_title,'') ilike '%регион%' or coalesce(gm.role_title,'') ilike '%субъект%' or coalesce(gm.role_title,'') ilike '%законодательн%'))
 when p_subject='ks' then exists(select 1 from public.game_members gm where gm.game_id=p_game and gm.user_id=p_user and coalesce(gm.role_title,'') ilike '%конституционн%суд%')
 when p_subject='vs' then exists(select 1 from public.game_members gm where gm.game_id=p_game and gm.user_id=p_user and coalesce(gm.role_title,'') ilike '%верховн%суд%')
 when p_subject='ministry' then exists(select 1 from public.game_members gm where gm.game_id=p_game and gm.user_id=p_user and (coalesce(gm.role_title,'') ilike '%министр%' or coalesce(gm.role_title,'') ilike '%министерств%'))
 when p_subject='municipality' then exists(select 1 from public.game_members gm where gm.game_id=p_game and gm.user_id=p_user and (coalesce(gm.role_title,'') ilike '%муницип%' or coalesce(gm.role_title,'') ilike '%глава города%' or coalesce(gm.role_title,'') ilike '%администрац%'))
 else false end;
$$;

create or replace function public.create_formal_document(
 p_game_id uuid,p_stage_no integer,p_title text,p_doc_type text,p_subject_key text,p_subject_label text,
 p_body_text text,p_file_path text,p_file_name text,p_mime text,p_workflow_key text,p_metadata jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer
set search_path=public,private,pg_temp as $$
declare v_id uuid:=gen_random_uuid(); v_uid uuid:=(select auth.uid()); v_steps jsonb; v_prefix text; v_no bigint; v_registry text;
begin
 if v_uid is null or not private.is_game_member(p_game_id) then raise exception 'Game access required'; end if;
 if not private.can_create_formal_subject(p_game_id,v_uid,p_subject_key) then raise exception 'Your game role cannot create a document for this subject'; end if;
 if length(trim(coalesce(p_title,'')))<3 then raise exception 'Document title is required'; end if;
 v_steps:=private.formal_workflow(p_workflow_key);
 v_prefix:=case p_doc_type when 'fz_bill' then 'ЗП-ФЗ' when 'fkz_bill' then 'ЗП-ФКЗ' when 'president_decree' then 'УК'
 when 'president_order' then 'РП' when 'government_resolution' then 'ПП' when 'government_order' then 'РПР'
 when 'gd_resolution' then 'ПГД' when 'sf_resolution' then 'ПСФ' when 'ministry_order' then 'ПР'
 when 'state_program' then 'ГП' when 'municipal_act' then 'МСУ' else 'НПА' end;
 v_no:=nextval('public.formal_registry_seq'); v_registry:='ИГРА-'||v_prefix||'-'||lpad(v_no::text,4,'0');
 insert into public.formal_documents(id,game_id,stage_no,registry_no,title,doc_type,subject_key,subject_label,author_id,body_text,source_file_path,source_file_name,source_mime_type,workflow_key,workflow_steps,current_step,status_code,status_label,current_owner_key,metadata)
 values(v_id,p_game_id,p_stage_no,v_registry,trim(p_title),p_doc_type,p_subject_key,p_subject_label,v_uid,nullif(p_body_text,''),p_file_path,p_file_name,p_mime,p_workflow_key,v_steps,0,v_steps->0->>'code',v_steps->0->>'label',v_steps->0->>'owner',coalesce(p_metadata,'{}'::jsonb));
 insert into public.formal_document_history(document_id,game_id,actor_id,action,to_status,to_owner,note)
 values(v_id,p_game_id,v_uid,'Создан документ',v_steps->0->>'code',v_steps->0->>'owner','Черновик создан в системе');
 return v_id;
end;
$$;
revoke all on function public.create_formal_document(uuid,integer,text,text,text,text,text,text,text,text,text,jsonb) from public,anon;
grant execute on function public.create_formal_document(uuid,integer,text,text,text,text,text,text,text,text,text,jsonb) to authenticated;

create or replace function public.advance_formal_document(p_document_id uuid,p_action text default 'advance',p_note text default null)
returns void language plpgsql security definer
set search_path=public,private,pg_temp as $$
declare d public.formal_documents%rowtype; v_uid uuid:=(select auth.uid()); v_next integer; v_step jsonb; v_from_status text; v_from_owner text;
begin
 select * into d from public.formal_documents where id=p_document_id for update;
 if d.id is null then raise exception 'Document not found'; end if;
 if v_uid is null or not private.is_game_member(d.game_id) then raise exception 'Game access required'; end if;
 if not private.matches_formal_owner(d.game_id,v_uid,d.current_owner_key,d.author_id) then raise exception 'Current stage belongs to another institution'; end if;
 v_from_status:=d.status_code;v_from_owner:=d.current_owner_key;
 if p_action='return' then
  v_next:=0;v_step:=d.workflow_steps->v_next;
  update public.formal_documents set current_step=v_next,status_code='revision',status_label='Возвращён на доработку',current_owner_key='author',updated_at=now() where id=d.id;
  insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note) values(d.id,d.game_id,v_uid,'Возвращён на доработку',v_from_status,'revision',v_from_owner,'author',p_note);
 elsif p_action='reject' then
  update public.formal_documents set status_code='rejected',status_label='Отклонён',current_owner_key='system',updated_at=now() where id=d.id;
  insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note) values(d.id,d.game_id,v_uid,'Отклонён',v_from_status,'rejected',v_from_owner,'system',p_note);
 else
  v_next:=d.current_step+1;
  if v_next>=jsonb_array_length(d.workflow_steps) then raise exception 'Workflow already completed'; end if;
  v_step:=d.workflow_steps->v_next;
  update public.formal_documents set current_step=v_next,status_code=v_step->>'code',status_label=v_step->>'label',current_owner_key=v_step->>'owner',updated_at=now() where id=d.id;
  insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note) values(d.id,d.game_id,v_uid,coalesce(d.workflow_steps->d.current_step->>'action','Передан далее'),v_from_status,v_step->>'code',v_from_owner,v_step->>'owner',p_note);
 end if;
end;
$$;
revoke all on function public.advance_formal_document(uuid,text,text) from public,anon;
grant execute on function public.advance_formal_document(uuid,text,text) to authenticated;

create or replace function public.update_formal_draft(p_document_id uuid,p_title text,p_body_text text,p_metadata jsonb default null)
returns void language plpgsql security definer
set search_path=public,private,pg_temp as $$
declare d public.formal_documents%rowtype; v_uid uuid:=(select auth.uid());
begin
 select * into d from public.formal_documents where id=p_document_id for update;
 if d.id is null then raise exception 'Document not found'; end if;
 if not (private.is_game_teacher(d.game_id) or (d.author_id=v_uid and d.current_owner_key='author')) then raise exception 'Draft may only be edited by its author'; end if;
 update public.formal_documents set title=coalesce(nullif(trim(p_title),''),title),body_text=p_body_text,metadata=coalesce(p_metadata,metadata),updated_at=now() where id=d.id;
 insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note) values(d.id,d.game_id,v_uid,'Изменён текст документа',d.status_code,d.status_code,d.current_owner_key,d.current_owner_key,null);
end;
$$;
revoke all on function public.update_formal_draft(uuid,text,text,jsonb) from public,anon;
grant execute on function public.update_formal_draft(uuid,text,text,jsonb) to authenticated;
