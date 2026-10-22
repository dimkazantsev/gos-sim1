-- A single editable agenda text, without reordering legislative packages.
ALTER TABLE public.duma_sessions ADD COLUMN IF NOT EXISTS agenda_text_override text;
CREATE OR REPLACE FUNCTION private.sync_duma_session_agenda_document(p_session_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare s public.duma_sessions%rowtype; v_doc uuid; v_lines text; v_body text; v_steps jsonb; v_missing text;
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
 if length(btrim(s.agenda_notes))>0 then
  v_body:=v_body||E'\n\nРЕГЛАМЕНТ И УТОЧНЕНИЯ ПОВЕСТКИ\n'||btrim(s.agenda_notes);
 end if;
 -- The chair edits the AGENDA TEXT, never the legislative package collection.
 -- New bills are appended if their grounded registry numbers are absent from
 -- the edited text; their original NPA and vote associations stay untouched.
 if s.stage_no=12 and nullif(btrim(s.agenda_text_override),'') is not null then
  v_body:=s.agenda_text_override;
  select string_agg(format('%s. %s · %s%s',a.agenda_no,d.title,d.registry_no,
       E'\n   Текущая стадия НПА: '||d.status_label),
       E'\n\n' order by a.agenda_no)
    into v_missing
    from public.duma_agenda_items a
    join public.formal_documents d on d.id=a.formal_document_id
   where a.session_id=s.id
     and position(lower(d.registry_no) in lower(v_body))=0;
  if v_missing is not null then
   v_body:=rtrim(v_body)||E'\n\nДОПОЛНИТЕЛЬНЫЕ ВОПРОСЫ ПОВЕСТКИ\n\n'||v_missing;
  end if;
 end if;
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
 if s.stage_no=12 then
  -- One canonical State Duma agenda. The registration panel reuses its
  -- document id and text; never create an independent agenda for Stage 12.
  insert into public.institution_meeting_records(
    game_id,stage_no,institution_key,agenda_document_id,agenda_body,agenda_prepared_by,updated_at
  ) values(
    s.game_id,12,'gd',v_doc,v_body,s.created_by,now()
  )
  on conflict (game_id,stage_no,institution_key) do update
   set agenda_document_id=excluded.agenda_document_id,
       agenda_body=excluded.agenda_body,
       agenda_prepared_by=coalesce(public.institution_meeting_records.agenda_prepared_by,excluded.agenda_prepared_by),
       agenda_approved_at=case
         when s.status='draft' and public.institution_meeting_records.agenda_body is distinct from excluded.agenda_body
         then null else public.institution_meeting_records.agenda_approved_at end,
       agenda_approved_by=case
         when s.status='draft' and public.institution_meeting_records.agenda_body is distinct from excluded.agenda_body
         then null else public.institution_meeting_records.agenda_approved_by end,
       updated_at=case
         when public.institution_meeting_records.agenda_body is distinct from excluded.agenda_body
           or public.institution_meeting_records.agenda_document_id is distinct from excluded.agenda_document_id
         then now() else public.institution_meeting_records.updated_at end;
 end if;
 return v_doc;
end;$function$;


CREATE OR REPLACE FUNCTION public.edit_stage12_duma_agenda_text(
 p_session_id uuid,
 p_body text,
 p_expected_body text,
 p_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public','private','pg_temp'
AS $agenda_text$
DECLARE
 v_session public.duma_sessions%ROWTYPE;
 v_uid uuid:=auth.uid();
 v_body text:=btrim(coalesce(p_body,''));
 v_current text;
 v_reason text:=btrim(coalesce(p_reason,''));
BEGIN
 SELECT * INTO v_session FROM public.duma_sessions
 WHERE id=p_session_id FOR UPDATE;
 IF v_session.id IS NULL OR v_session.stage_no<>12
    OR v_session.status NOT IN ('draft','open') THEN
  RAISE EXCEPTION 'Редактирование повестки недоступно для этого заседания' USING ERRCODE='23514';
 END IF;
 IF v_uid IS NULL OR NOT private.can_manage_duma_session(v_session.game_id,v_uid) THEN
  RAISE EXCEPTION 'Нет полномочий на корректировку текста повестки' USING ERRCODE='42501';
 END IF;
 PERFORM private.require_duma_stage_open(v_session.game_id,12);
 IF v_session.status='open' AND NOT private.is_game_teacher(v_session.game_id) THEN
  PERFORM private.require_game_meeting_registration(v_session.game_id,v_uid,12,'gd');
 END IF;
 IF char_length(v_body)<80 OR char_length(v_body)>20000 THEN
  RAISE EXCEPTION 'Текст повестки должен содержать от 80 до 20000 символов' USING ERRCODE='22023';
 END IF;
 IF v_session.status='open' AND
    (char_length(v_reason)<10 OR char_length(v_reason)>500) THEN
  RAISE EXCEPTION 'После открытия заседания укажите основание корректировки (10–500 символов)' USING ERRCODE='22023';
 END IF;
 SELECT d.body_text INTO v_current FROM public.formal_documents d
 WHERE d.id=v_session.agenda_document_id AND d.game_id=v_session.game_id FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Документ повестки не найден' USING ERRCODE='23514';
 END IF;
 IF v_current IS DISTINCT FROM p_expected_body THEN
  RAISE EXCEPTION 'Повестка обновилась. Откройте актуальную редакцию перед сохранением' USING ERRCODE='40001';
 END IF;
 -- A text correction cannot silently remove the registered bill references.
 -- New documents and proceedings continue to derive from the unchanged rows.
 IF EXISTS(
  SELECT 1 FROM public.duma_agenda_items a
  JOIN public.formal_documents d ON d.id=a.formal_document_id
  WHERE a.session_id=v_session.id
    AND position(lower(d.registry_no) in lower(v_body))=0
 ) THEN
  RAISE EXCEPTION 'Сохраните реестровые номера всех законопроектов. Состав повестки формируется автоматически' USING ERRCODE='23514';
 END IF;
 IF v_current=v_body THEN RETURN; END IF;
 UPDATE public.duma_sessions SET agenda_text_override=v_body WHERE id=v_session.id;
 PERFORM private.sync_duma_session_agenda_document(v_session.id);
 INSERT INTO public.formal_document_history(document_id,game_id,actor_id,action,to_status,to_owner,note)
 VALUES(v_session.agenda_document_id,v_session.game_id,v_uid,
        CASE WHEN v_session.status='draft' THEN 'Отредактирован текст проекта повестки'
             ELSE 'Отредактирован текст повестки открытого заседания' END,
        CASE WHEN v_session.status='draft' THEN 'draft' ELSE 'published' END,
        CASE WHEN v_session.status='draft' THEN 'gd' ELSE 'system' END,
        CASE WHEN v_session.status='draft' THEN 'Изменён текст документа; законопроекты и голосования сохранены'
             ELSE 'Основание: '||v_reason END);
 IF v_session.status='open' THEN
  INSERT INTO public.game_events(game_id,round_no,category,severity,title,body,created_by)
  VALUES(v_session.game_id,12,'Заседание ГД','notice','Изменён текст повестки Государственной Думы',
         'Заседание № '||v_session.session_no||'. Основание: '||v_reason,v_uid);
 END IF;
END;
$agenda_text$;
REVOKE ALL ON FUNCTION public.edit_stage12_duma_agenda_text(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.edit_stage12_duma_agenda_text(uuid,text,text,text) TO authenticated;
-- Disable the obsolete API that rearranges the bill docket rather than text.
REVOKE ALL ON FUNCTION public.update_stage12_duma_agenda(uuid,text,uuid[],text) FROM PUBLIC,anon,authenticated;
