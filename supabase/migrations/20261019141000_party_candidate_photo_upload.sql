-- ГОС.ID · Этап 6: загрузка фотографий кандидата действующими членами выдвинувшей партии.
-- Права на закрытую анкету, программу, решения ЦИК и чужие партии не расширяются.
-- Загрузка прочих документов уже регулируется can_upload_presidential_candidate_document.

DROP POLICY IF EXISTS gos_party_candidate_photo_upload ON storage.objects;
CREATE POLICY gos_party_candidate_photo_upload ON storage.objects
 FOR INSERT TO authenticated
 WITH CHECK (
  bucket_id='game-assets'
  AND split_part(name,'/',2)='presidential'
  AND split_part(name,'/',4) ~ '^photo-[0-9a-fA-F-]{36}\\.(jpg|jpeg|png|webp)$'
  AND EXISTS (
   SELECT 1 FROM public.presidential_candidates c
   WHERE c.id::text=split_part(name,'/',3)
     AND c.game_id::text=split_part(name,'/',1)
     AND c.archived_at IS NULL
     AND c.registration_status<>'registered'
     AND private.can_upload_presidential_candidate_document(c.id,auth.uid())
  )
 );

CREATE OR REPLACE FUNCTION public.set_presidential_candidate_photo(
 p_candidate_id uuid,p_storage_path text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO public,private,storage,pg_temp AS $photo$
DECLARE
 c public.presidential_candidates%rowtype;
 v_uid uuid:=auth.uid();
 v_prefix text;
BEGIN
 SELECT * INTO c FROM public.presidential_candidates
  WHERE id=p_candidate_id AND archived_at IS NULL FOR UPDATE;
 IF c.id IS NULL THEN RAISE EXCEPTION 'Candidate not found' USING ERRCODE='P0002'; END IF;
 IF NOT private.can_upload_presidential_candidate_document(c.id,v_uid) THEN
  RAISE EXCEPTION 'Нет полномочий загружать фотографию этого кандидата' USING ERRCODE='42501';
 END IF;
 IF c.registration_status='registered' THEN
  RAISE EXCEPTION 'Досье зарегистрированного кандидата закрыто для изменений' USING ERRCODE='42501';
 END IF;
 v_prefix:=c.game_id::text||'/presidential/'||c.id::text||'/';
 IF p_storage_path IS NULL OR left(p_storage_path,length(v_prefix))<>v_prefix
    OR substring(p_storage_path FROM length(v_prefix)+1)
        !~ '^photo-[0-9a-fA-F-]{36}\\.(jpg|jpeg|png|webp)$' THEN
  RAISE EXCEPTION 'Некорректный путь фотографии кандидата' USING ERRCODE='22023';
 END IF;
 IF NOT EXISTS(
  SELECT 1 FROM storage.objects
   WHERE bucket_id='game-assets' AND name=p_storage_path
 ) THEN
  RAISE EXCEPTION 'Фотография не найдена в хранилище' USING ERRCODE='P0002';
 END IF;
 UPDATE public.presidential_candidates
  SET photo_path=p_storage_path,updated_at=now()
  WHERE id=c.id;
END;
$photo$;
REVOKE ALL ON FUNCTION public.set_presidential_candidate_photo(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_presidential_candidate_photo(uuid,text) TO authenticated;
