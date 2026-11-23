-- Align auto-generated agenda document items with official agenda numbering,
-- including rows inserted in one SQL statement with the same created_at.
-- Avoid duplicate guillemets when a program's title already contains them.
CREATE OR REPLACE FUNCTION private.refresh_government_agenda_document(p_session uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare s public.government_sessions%rowtype; v_doc uuid;v_registry text;v_steps jsonb;v_body text;v_rows text;v_actor uuid;
begin
 perform set_config('app.gos_government_agenda_session',p_session::text,true);
 select * into s from public.government_sessions where id=p_session;
 if s.id is null then return null; end if;
 v_actor:=coalesce((select auth.uid()),s.created_by);
 select string_agg(format('%s. %s%s%s', q.rn, q.title,
    case when q.description='' then '' else E'\n   '||q.description end,
    E'\n   Доклад: '||q.minutes||' мин.'), E'\n\n' order by q.rn) into v_rows
 from (
   select row_number() over(order by src.sort_at,src.agenda_order,src.sort_id) as rn,src.title,src.description,src.minutes
   from (
      select q.created_at as sort_at,0::integer as agenda_order,q.id as sort_id,q.title,q.description,q.duration_minutes as minutes
      from public.government_session_questions q where q.session_id=s.id
      union all
      select a.created_at,a.agenda_no,a.id,'Рассмотрение государственной программы '||case when left(btrim(p.title),1)='«' and right(btrim(p.title),1)='»' then btrim(p.title) else '«'||p.title||'»' end,
             'Ответственный исполнитель: '||p.responsible_ministry,a.report_minutes
      from public.government_program_agenda a
      join public.state_programs p on p.id=a.program_id
      where a.session_id=s.id and not exists(select 1 from public.government_session_questions q where q.program_agenda_id=a.id)
   ) src
 ) q;
 v_body:='ПОВЕСТКА ЗАСЕДАНИЯ ПРАВИТЕЛЬСТВА РОССИЙСКОЙ ФЕДЕРАЦИИ'
      ||E'\n\n'||s.title||E'\nЗаседание № '||s.session_no
      ||E'\nОбщий регламент: '||s.time_limit_minutes||' мин.'
      ||E'\nСтатус: '||case when s.status='draft' and s.agenda_approved_at is null then 'Проект' when s.status='closed' then 'Заседание завершено' else 'Утверждена' end
      ||E'\n\nВОПРОСЫ ПОВЕСТКИ\n\n'||coalesce(v_rows,'Вопросы повестки пока не внесены.');
 v_doc:=s.agenda_document_id;
 if v_doc is null then
   v_doc:=gen_random_uuid();
   v_registry:='ГОС.ID-ПОВ-'||lpad(nextval('public.formal_registry_seq')::text,4,'0');
   v_steps:=private.formal_workflow('government_act');
   insert into public.formal_documents(
     id,game_id,stage_no,registry_no,title,doc_type,subject_key,subject_label,author_id,
     body_text,workflow_key,workflow_steps,current_step,status_code,status_label,current_owner_key,metadata
   ) values(
     v_doc,s.game_id,11,v_registry,'Повестка заседания Правительства № '||s.session_no,
     'meeting_agenda','government','Правительство Российской Федерации',s.created_by,
     v_body,'government_act',v_steps,0,'draft','Проект повестки','government',
     jsonb_build_object('document_kind','government_session_agenda','government_session_id',s.id,'auto_generated',true)
   );
   update public.government_sessions set agenda_document_id=v_doc where id=s.id;
   insert into public.formal_document_history(document_id,game_id,actor_id,action,to_status,to_owner,note)
     values(v_doc,s.game_id,v_actor,'Создан проект повестки','draft','government','Связан с заседанием Правительства № '||s.session_no);
 else
   update public.formal_documents set body_text=v_body,updated_at=now(),
     status_code=case when s.status='draft' and s.agenda_approved_at is null then 'draft' else 'published' end,
     status_label=case when s.status='draft' and s.agenda_approved_at is null then 'Проект повестки' when s.status='closed' then 'Заседание завершено' else 'Утверждена Председателем Правительства' end,
     current_owner_key=case when s.status='draft' and s.agenda_approved_at is null then 'government' else 'system' end
   where id=v_doc and (body_text is distinct from v_body or status_label is distinct from
      case when s.status='draft' and s.agenda_approved_at is null then 'Проект повестки' when s.status='closed' then 'Заседание завершено' else 'Утверждена Председателем Правительства' end);
 end if;
 perform set_config('app.gos_government_agenda_session','',true);
 return v_doc;
end;$function$


-- Refresh only unpublished drafts. Never rewrite approved or signed agendas.
DO $repair$
DECLARE v record;
BEGIN
 FOR v IN SELECT s.id FROM public.government_sessions s
   WHERE s.stage_no=11 AND s.status='draft' AND s.agenda_approved_at IS NULL
     AND EXISTS(SELECT 1 FROM public.government_program_agenda a WHERE a.session_id=s.id)
 LOOP
   PERFORM private.refresh_government_agenda_document(v.id);
 END LOOP;
END;
$repair$;
