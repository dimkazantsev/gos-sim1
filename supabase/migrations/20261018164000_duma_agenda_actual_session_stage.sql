-- ГОС.ID: Повестка любого заседания Государственной Думы относится к самому заседанию.
-- Этап 6 не должен создавать НПА в закрытом этапе 12; этап 12 сохраняет прежний маршрут.
-- Действующие записи не изменяются. Проверки этапа и полномочий остаются в силе.
CREATE OR REPLACE FUNCTION private.sync_duma_session_agenda_document(p_session_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare s public.duma_sessions%rowtype; v_doc uuid; v_lines text; v_body text; v_steps jsonb;
begin
 select * into s from public.duma_sessions where id=p_session_id;
 if s.id is null then return null; end if;
 select string_agg(format('%s. %s · %s%s',
      x.agenda_no,d.title,d.registry_no,
      E'\n   Текущая стадия НПА: '||d.status_label),
      E'\n\n' order by x.agenda_no)
  into v_lines
  from public.duma_agenda_items x join public.formal_documents d on d.id=x.formal_document_id
  where x.session_id=s.id;
 v_body:='ПОВЕСТКА ЗАСЕДАНИЯ ГОСУДАРСТВЕННОЙ ДУМЫ'
   ||E'\n\nЗаседание № '||s.session_no||E'\n'||s.title
   ||E'\nВремя начала: '||coalesce(to_char(s.scheduled_start at time zone 'Asia/Barnaul','DD.MM.YYYY HH24:MI'),'Не указано')
   ||E'\nВремя окончания: '||coalesce(to_char(s.scheduled_end at time zone 'Asia/Barnaul','DD.MM.YYYY HH24:MI'),'Не указано')
   ||E'\nСтатус заседания: '||case s.status when 'draft' then 'Подготовка' when 'open' then 'Открыто' else 'Завершено' end
   ||E'\n\nВОПРОСЫ ПОВЕСТКИ\n\n'||coalesce(v_lines,'Документы ещё не включены в повестку.');
 if s.agenda_document_id is null then
  v_doc:=gen_random_uuid();
  v_steps:=private.formal_workflow('gd_resolution');
  insert into public.formal_documents(id,game_id,stage_no,registry_no,title,doc_type,subject_key,subject_label,author_id,
    body_text,workflow_key,workflow_steps,current_step,status_code,status_label,current_owner_key,metadata)
  values(v_doc,s.game_id,s.stage_no,'ГОС.ID-ПОВ-ГД-'||lpad(nextval('public.formal_registry_seq')::text,5,'0'),
    'Повестка заседания Государственной Думы № '||s.session_no,
    'meeting_agenda','gd','Государственная Дума Федерального Собрания РФ',s.created_by,
    v_body,'gd_resolution',v_steps,0,'draft','Проект повестки','gd',
    jsonb_build_object('document_kind','duma_session_agenda','duma_session_id',s.id,'auto_generated',true));
  update public.duma_sessions set agenda_document_id=v_doc where id=s.id;
  insert into public.formal_document_history(document_id,game_id,actor_id,action,to_status,to_owner,note)
  values(v_doc,s.game_id,s.created_by,'Создана повестка заседания','draft','gd','Служебный документ заседания № '||s.session_no);
 else
  v_doc:=s.agenda_document_id;
  update public.formal_documents set body_text=v_body,
   status_code=case when s.status='draft' then 'draft' else 'published' end,
   status_label=case s.status when 'draft' then 'Проект повестки' when 'open' then 'Утверждённая повестка' else 'Повестка завершённого заседания' end,
   current_owner_key=case when s.status='draft' then 'gd' else 'system' end,
   updated_at=now()
  where id=v_doc and (body_text is distinct from v_body or status_label is distinct from
   case s.status when 'draft' then 'Проект повестки' when 'open' then 'Утверждённая повестка' else 'Повестка завершённого заседания' end);
 end if;
 return v_doc;
end;$function$;
