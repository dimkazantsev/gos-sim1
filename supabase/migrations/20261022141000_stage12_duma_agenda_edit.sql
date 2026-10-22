-- Stage 12 Duma agenda: manual editorial adjustments preserve the canonical
-- auto-generated bill list, signatures, and approved-state guards.
ALTER TABLE public.duma_sessions
 ADD COLUMN IF NOT EXISTS agenda_notes text NOT NULL DEFAULT '';
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
 if length(btrim(s.agenda_notes))>0 then
  v_body:=v_body||E'\n\nРЕГЛАМЕНТ И УТОЧНЕНИЯ ПОВЕСТКИ\n'||btrim(s.agenda_notes);
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
end;$function$

CREATE OR REPLACE FUNCTION public.update_stage12_duma_agenda(
 p_session_id uuid,
 p_notes text,
 p_order uuid[] DEFAULT NULL,
 p_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public','private','pg_temp'
AS $agenda_edit$
DECLARE v_session public.duma_sessions%ROWTYPE;
        v_uid uuid:=auth.uid();
        v_notes text:=coalesce(p_notes,'');
        v_reason text:=btrim(coalesce(p_reason,''));
        v_total integer;
        v_shift integer;
        v_i integer;
        v_changed boolean:=false;
BEGIN
 SELECT * INTO v_session FROM public.duma_sessions
 WHERE id=p_session_id FOR UPDATE;
 IF v_session.id IS NULL OR v_session.stage_no<>12 OR v_session.status NOT IN ('draft','open') THEN
  RAISE EXCEPTION 'Корректировка недоступна: заседание не найдено или завершено' USING ERRCODE='23514';
 END IF;
 IF v_uid IS NULL OR NOT private.can_manage_duma_session(v_session.game_id,v_uid) THEN
  RAISE EXCEPTION 'Нет полномочий на корректировку повестки' USING ERRCODE='42501';
 END IF;
 PERFORM private.require_duma_stage_open(v_session.game_id,12);
 -- Before first approval, the chair cannot register for the meeting yet.
 -- Meeting attendance is required only once the session has opened.
 IF v_session.status='open' AND NOT private.is_game_teacher(v_session.game_id) THEN
  PERFORM private.require_game_meeting_registration(v_session.game_id,v_uid,12,'gd');
 END IF;
 IF char_length(v_notes)>2000 THEN
  RAISE EXCEPTION 'Текст уточнений не должен превышать 2000 символов' USING ERRCODE='22023';
 END IF;
 IF v_session.status='open' THEN
  IF p_order IS NOT NULL THEN
   RAISE EXCEPTION 'После открытия заседания менять порядок вопросов нельзя' USING ERRCODE='23514';
  END IF;
  IF char_length(v_reason)<10 OR char_length(v_reason)>500 THEN
   RAISE EXCEPTION 'Укажите основание корректировки: от 10 до 500 символов' USING ERRCODE='22023';
  END IF;
 END IF;
 IF p_order IS NOT NULL THEN
  SELECT COUNT(*) INTO v_total FROM public.duma_agenda_items WHERE session_id=p_session_id;
  IF cardinality(p_order)<>v_total OR
    (SELECT COUNT(DISTINCT x) FROM unnest(p_order) AS x)<>v_total OR
    (SELECT COUNT(*) FROM public.duma_agenda_items a WHERE a.session_id=p_session_id
      AND a.id=ANY(p_order))<>v_total THEN
   RAISE EXCEPTION 'Список вопросов изменился. Обновите повестку и повторите корректировку' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM public.duma_agenda_items
    WHERE session_id=p_session_id AND status<>'pending') THEN
   RAISE EXCEPTION 'Порядок рассмотрения нельзя менять после начала рассмотрения вопросов' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(p_order) WITH ORDINALITY AS desired(id,position)
      JOIN public.duma_agenda_items a ON a.id=desired.id
      WHERE a.agenda_no<>desired.position::integer) THEN
   SELECT COALESCE(MAX(agenda_no),0)+v_total+100 INTO v_shift
    FROM public.duma_agenda_items WHERE session_id=p_session_id;
   UPDATE public.duma_agenda_items SET agenda_no=agenda_no+v_shift
    WHERE session_id=p_session_id;
   FOR v_i IN 1..v_total LOOP
    UPDATE public.duma_agenda_items SET agenda_no=v_i
     WHERE id=p_order[v_i] AND session_id=p_session_id;
   END LOOP;
   v_changed:=true;
  END IF;
 END IF;
 IF v_session.agenda_notes IS DISTINCT FROM v_notes THEN
  UPDATE public.duma_sessions SET agenda_notes=v_notes WHERE id=p_session_id;
  v_changed:=true;
 END IF;
 IF NOT v_changed THEN RETURN; END IF;
 PERFORM private.sync_duma_session_agenda_document(p_session_id);
 INSERT INTO public.formal_document_history(document_id,game_id,actor_id,
  action,to_status,to_owner,note)
 SELECT s.agenda_document_id,s.game_id,v_uid,
  CASE WHEN s.status='draft' THEN 'Скорректирован проект повестки'
       ELSE 'Корректировка повестки открытого заседания' END,
  CASE WHEN s.status='draft' THEN 'draft' ELSE 'published' END,
  CASE WHEN s.status='draft' THEN 'gd' ELSE 'system' END,
  CASE WHEN s.status='draft' THEN 'Изменены порядок рассмотрения или регламент'
       ELSE 'Основание: '||v_reason END
 FROM public.duma_sessions s WHERE s.id=p_session_id AND s.agenda_document_id IS NOT NULL;
 IF v_session.status='open' THEN
  INSERT INTO public.game_events(game_id,round_no,category,severity,title,body,created_by)
  VALUES(v_session.game_id,12,'Заседание ГД','notice',
   'Повестка Государственной Думы скорректирована',
   'Заседание № '||v_session.session_no||'. Основание: '||v_reason,v_uid);
 END IF;
END;
$agenda_edit$;
REVOKE ALL ON FUNCTION public.update_stage12_duma_agenda(uuid,text,uuid[],text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_stage12_duma_agenda(uuid,text,uuid[],text) TO authenticated;
