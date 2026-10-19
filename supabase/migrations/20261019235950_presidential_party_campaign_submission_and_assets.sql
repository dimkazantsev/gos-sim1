-- ГОС.ID. Кампания Президента: общепартийная подача при строгом разделении кандидатов.
-- Используем действующую проверку членства, уже применённую к документам ЦИК.
CREATE OR REPLACE FUNCTION private.can_submit_presidential_campaign_material(p_candidate uuid,p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $fn$
 SELECT p_user IS NOT NULL AND p_user=auth.uid()
   AND EXISTS(
     SELECT 1 FROM public.presidential_candidates c
     WHERE c.id=p_candidate AND c.archived_at IS NULL
       AND c.registration_status='registered'
       AND private.can_upload_presidential_candidate_document(c.id,p_user)
   );
$fn$;
REVOKE ALL ON FUNCTION private.can_submit_presidential_campaign_material(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.can_submit_presidential_campaign_material(uuid,uuid) TO authenticated;

DO $migration$
DECLARE func text;
BEGIN
 func:=pg_get_functiondef('public.submit_presidential_campaign_material(uuid,text,text,text,integer,text,date,text,text,jsonb)'::regprocedure);
 IF strpos(func,'if not private.can_manage_presidential_candidate(c.id,v_uid) then')=0
    OR strpos(func,'insert into public.presidential_campaign_materials(')=0 THEN
  RAISE EXCEPTION 'Функция подачи агитационных материалов изменилась: требуется сверить миграцию';
 END IF;
 func:=replace(func,
   'if not private.can_manage_presidential_candidate(c.id,v_uid) then',
   'if not private.can_submit_presidential_campaign_material(c.id,v_uid) then');
 func:=replace(func,
   'insert into public.presidential_campaign_materials(',
   $validation$
   -- Не позволяем привязать чужой файл, файл иной кандидатуры или отсутствующий объект.
   IF jsonb_typeof(coalesce(p_files,'[]'::jsonb))<>'array'
      OR jsonb_array_length(coalesce(p_files,'[]'::jsonb))>12 THEN
     RAISE EXCEPTION 'Допускается не более 12 файлов кампании' USING ERRCODE='23514';
   END IF;
   IF EXISTS(
     SELECT 1 FROM jsonb_array_elements(coalesce(p_files,'[]'::jsonb)) AS f(item)
     WHERE coalesce(f.item->>'storage_path','') NOT LIKE
       c.game_id::text||'/presidential/'||c.id::text||'/campaign/%'
       OR NOT EXISTS(
         SELECT 1 FROM storage.objects o
         WHERE o.bucket_id='game-assets' AND o.name=f.item->>'storage_path'
           AND o.owner_id=v_uid::text
       )
   ) THEN
     RAISE EXCEPTION 'Файл должен быть загружен участником для данного кандидата' USING ERRCODE='42501';
   END IF;
   insert into public.presidential_campaign_materials(
   $validation$);
 EXECUTE func;
END $migration$;

-- Отображаем ещё не рассмотренные материалы всем действующим сопартийцам.
-- Публично опубликованные материалы продолжают работать по прежней политике.
DROP POLICY IF EXISTS presidential_campaign_party_pending_read ON public.presidential_campaign_materials;
CREATE POLICY presidential_campaign_party_pending_read ON public.presidential_campaign_materials
 FOR SELECT TO authenticated
 USING (
   private.is_game_member(game_id)
   AND private.can_submit_presidential_campaign_material(candidate_id,auth.uid())
 );

-- Отдельное право загрузки агитационного файла. Не меняет доступ к фото/паспорту/НПА.
DROP POLICY IF EXISTS gos_presidential_campaign_party_upload ON storage.objects;
CREATE POLICY gos_presidential_campaign_party_upload ON storage.objects
 FOR INSERT TO authenticated
 WITH CHECK (
   bucket_id='game-assets'
   AND name ~ '^[0-9a-fA-F-]{36}/presidential/[0-9a-fA-F-]{36}/campaign/[0-9a-fA-F-]{36}[.][A-Za-z0-9]{1,12}$'
   AND EXISTS(
     SELECT 1 FROM public.presidential_candidates c
     WHERE c.id::text=split_part(name,'/',3)
       AND c.game_id::text=split_part(name,'/',1)
       AND private.can_submit_presidential_campaign_material(c.id,auth.uid())
   )
 );

-- Удаление только собственных неотправленных вложений (откат ошибочной загрузки).
DROP POLICY IF EXISTS gos_presidential_campaign_own_unused_cleanup ON storage.objects;
CREATE POLICY gos_presidential_campaign_own_unused_cleanup ON storage.objects
 FOR DELETE TO authenticated USING(
   bucket_id='game-assets'
   AND name ~ '^[0-9a-fA-F-]{36}/presidential/[0-9a-fA-F-]{36}/campaign/[0-9a-fA-F-]{36}[.][A-Za-z0-9]{1,12}$'
   AND owner_id=auth.uid()::text
   AND EXISTS(
     SELECT 1 FROM public.presidential_candidates c
     WHERE c.id::text=split_part(name,'/',3)
       AND c.game_id::text=split_part(name,'/',1)
       AND private.can_submit_presidential_campaign_material(c.id,auth.uid())
   )
   AND NOT EXISTS(
     SELECT 1 FROM public.presidential_campaign_materials m
     WHERE m.game_id::text=split_part(name,'/',1)
       AND m.files @> jsonb_build_array(jsonb_build_object('storage_path',name))
   )
 );
