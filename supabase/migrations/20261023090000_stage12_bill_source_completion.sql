-- Этап 12. Автор вправе дополнить существующий черновик основным текстом законопроекта.
-- Прикрепление приложений не заменяет основной текст или файл проекта.
-- Новая запись истории/ревизии создаётся без изменения утверждённых документов и голосований.
CREATE OR REPLACE FUNCTION public.attach_stage12_bill_source(
 p_document_id uuid,p_storage_path text,p_file_name text,p_mime_type text,p_file_size bigint
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public','private','storage','pg_temp'
AS $stage12_source$
DECLARE d public.formal_documents%rowtype;
 v_uid uuid:=auth.uid();v_old_revision integer;
BEGIN
 SELECT * INTO d FROM public.formal_documents WHERE id=p_document_id FOR UPDATE;
 IF d.id IS NULL OR d.stage_no<>12 OR d.workflow_key<>'bill'
  OR d.doc_type NOT IN ('fz_bill','fkz_bill')
  OR d.status_code NOT IN ('draft','revision') OR d.current_owner_key<>'author'
  OR v_uid IS NULL OR d.author_id IS DISTINCT FROM v_uid
  OR NOT EXISTS(SELECT 1 FROM public.game_members m WHERE m.game_id=d.game_id
     AND m.user_id=v_uid AND m.kind IN ('student','teacher') AND m.roster_archived_at IS NULL)
 THEN RAISE EXCEPTION 'Изменение основного файла доступно только автору черновика законопроекта'
  USING ERRCODE='42501'; END IF;
 PERFORM private.require_duma_stage_open(d.game_id,12);
 IF p_storage_path IS NULL OR
  p_storage_path NOT LIKE (d.game_id::text||'/formal/'||v_uid::text||'/%')
  OR p_storage_path !~* '\\.(pdf|doc|docx|odt|txt|rtf)$'
  OR length(p_storage_path)>400
  OR p_file_name IS NULL OR length(trim(p_file_name))<3 OR length(p_file_name)>220
  OR coalesce(p_file_size,0)<1 OR p_file_size>10485760
  OR NOT EXISTS(
   SELECT 1 FROM storage.objects o WHERE o.bucket_id='game-assets' AND o.name=p_storage_path
    AND o.owner_id=v_uid::text
    AND coalesce((o.metadata->>'size')::bigint,0) BETWEEN 1 AND 10485760)
 THEN RAISE EXCEPTION 'Исходный файл не найден, не принадлежит автору или имеет недопустимый формат/размер'
  USING ERRCODE='23514'; END IF;
 v_old_revision:=coalesce((d.metadata->>'revision')::integer,1);
 INSERT INTO public.formal_document_revisions(game_id,document_id,revision,title,body_text,metadata,editor_id)
 VALUES(d.game_id,d.id,v_old_revision,d.title,d.body_text,d.metadata,v_uid);
 UPDATE public.formal_documents SET
  source_file_path=p_storage_path,source_file_name=trim(p_file_name),
  source_mime_type=left(coalesce(p_mime_type,'application/octet-stream'),120),
  metadata=d.metadata||jsonb_build_object('revision',v_old_revision+1,'revision_changed_at',clock_timestamp(),
   'revision_changed_by',v_uid),
  updated_at=clock_timestamp()
 WHERE id=d.id;
 INSERT INTO public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
 VALUES(d.id,d.game_id,v_uid,'Добавлен основной файл законопроекта',d.status_code,d.status_code,
  'author','author',left(trim(p_file_name),220));
END;
$stage12_source$;
REVOKE ALL ON FUNCTION public.attach_stage12_bill_source(uuid,text,text,text,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.attach_stage12_bill_source(uuid,text,text,text,bigint) TO authenticated;
