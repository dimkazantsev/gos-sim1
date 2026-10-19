-- ГОС.ID. Исправление только возвращённых ЦИК документов кандидата.
-- Не удаляет и не изменяет уже принятые файлы, оценки и решения.
DO $migration$
DECLARE
  source_sql text;
  old_text text;
  new_text text;
BEGIN
  source_sql := pg_get_functiondef('public.add_presidential_candidate_document(uuid,text,text,text,text,text,bigint)'::regprocedure);
  old_text := ' insert into public.presidential_candidate_documents(game_id,candidate_id,doc_kind,title,storage_path,file_name,mime_type,file_size,uploaded_by,status,note,reviewed_by,is_submitted,submitted_at,extracted_text,extraction_status,auto_check,archived_at)';
  new_text := $guard$
 -- После первой подачи исправлять разрешено только документы,
 -- возвращённые ЦИК, и ещё не отправленные исправленные версии.
 if c.cec_submitted_at is not null and not exists (
  select 1 from public.presidential_candidate_documents d
  where d.candidate_id=c.id and d.doc_kind=p_doc_kind
    and d.archived_at is null
    and (d.status='revision' or (d.status='submitted' and not d.is_submitted))
 ) then
  raise exception 'Можно заменить только документ, возвращённый ЦИК на доработку'
   using errcode='42501';
 end if;
$guard$ || old_text;
  IF strpos(source_sql,old_text)=0 THEN
    RAISE EXCEPTION 'Функция загрузки документа изменена: необходимо проверить миграцию';
  END IF;
  EXECUTE replace(source_sql,old_text,new_text);

  source_sql := pg_get_functiondef('public.submit_presidential_candidate_to_cec(uuid)'::regprocedure);
  old_text := 'if not private.can_manage_presidential_candidate(c.id,v_uid) or private.is_game_teacher(c.game_id) and c.created_by<>v_uid then';
  new_text := $guard$if not (
   private.can_manage_presidential_candidate(c.id,v_uid)
   or (c.cec_submitted_at is not null
       and private.can_upload_presidential_candidate_document(c.id,v_uid)
       and exists(
        select 1 from public.presidential_candidate_documents d
        where d.candidate_id=c.id and d.archived_at is null
         and d.status='submitted' and not d.is_submitted
       ))
  ) or private.is_game_teacher(c.game_id) and c.created_by<>v_uid then$guard$;
  IF strpos(source_sql,old_text)=0 THEN
    RAISE EXCEPTION 'Проверка полномочий ЦИК изменена: необходимо проверить миграцию';
  END IF;
  source_sql := replace(source_sql,old_text,new_text);

  old_text := 'v_was_submitted:=c.cec_submitted_at is not null;';
  new_text := $guard$v_was_submitted:=c.cec_submitted_at is not null;
 if v_was_submitted
    and c.registration_status <> 'revision'
    and not exists(
      select 1 from public.presidential_candidate_documents d
      where d.candidate_id=c.id and d.archived_at is null
        and d.status='submitted' and not d.is_submitted
    ) then
   raise exception 'Нет исправленных документов для повторной подачи';
 end if;$guard$;
  IF strpos(source_sql,old_text)=0 THEN
    RAISE EXCEPTION 'Условие повторной подачи изменено: необходимо проверить миграцию';
  END IF;
  source_sql := replace(source_sql,old_text,new_text);

  old_text := 'where candidate_id=c.id and archived_at is null;';
  new_text := $guard$where candidate_id=c.id and archived_at is null
  and (not v_was_submitted or (status='submitted' and not is_submitted));$guard$;
  IF strpos(source_sql,old_text)=0 THEN
    RAISE EXCEPTION 'Обновление документов ЦИК изменено: необходимо проверить миграцию';
  END IF;
  source_sql := replace(source_sql,old_text,new_text);
  EXECUTE source_sql;
END
$migration$;
