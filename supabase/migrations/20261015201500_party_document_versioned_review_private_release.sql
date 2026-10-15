-- ГОС.ID: immutable attempts and safe party registration dossier publication.
-- The first uploaded artifact is V1. Earlier attempts remain in party history.
ALTER TABLE public.party_documents
 ADD COLUMN IF NOT EXISTS version_no integer NOT NULL DEFAULT 1,
 ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
 ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Existing uploads are NOT removed or rewritten: only their ordinal is backfilled.
WITH numbered AS (
 SELECT id,row_number() OVER (PARTITION BY party_id,doc_kind ORDER BY created_at,id)::integer AS n
 FROM public.party_documents
)
UPDATE public.party_documents d SET version_no=n.n
FROM numbered n WHERE n.id=d.id AND d.version_no IS DISTINCT FROM n.n;

ALTER TABLE public.party_documents DROP CONSTRAINT IF EXISTS party_documents_version_positive;
ALTER TABLE public.party_documents ADD CONSTRAINT party_documents_version_positive CHECK (version_no>=1);
CREATE UNIQUE INDEX IF NOT EXISTS party_documents_party_kind_version_unique
 ON public.party_documents(party_id,doc_kind,version_no);
CREATE INDEX IF NOT EXISTS party_documents_latest_version_idx
 ON public.party_documents(party_id,doc_kind,version_no DESC);

CREATE OR REPLACE FUNCTION private.guard_party_document_attempt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $body$
DECLARE p public.game_parties%rowtype;
BEGIN
 IF TG_OP='DELETE' THEN
  -- Direct document deletion is RLS-restricted to teachers. Cascading deletion
  -- of a whole party (also permitted to its founder) must remain possible.
  RETURN OLD;
 END IF;
 SELECT * INTO p FROM public.game_parties WHERE id=NEW.party_id FOR UPDATE;
 IF NOT FOUND OR p.game_id<>NEW.game_id THEN
  RAISE EXCEPTION 'Документ должен относиться к действующей партии' USING errcode='23503';
 END IF;
 IF TG_OP='INSERT' THEN
  IF p.registration_status='registered' THEN
   RAISE EXCEPTION 'Партия уже зарегистрирована; регистрационный пакет закрыт' USING errcode='42501';
  END IF;
  -- Serialise concurrent uploads for the SAME party, no artificial limit on attempts.
  NEW.version_no:=coalesce((
   SELECT max(version_no)+1 FROM public.party_documents
   WHERE party_id=NEW.party_id AND doc_kind=NEW.doc_kind
  ),1);
  NEW.status:='submitted';
  NEW.note:=null;
  NEW.reviewed_at:=null;
  NEW.reviewed_by:=null;
  RETURN NEW;
 END IF;
 IF p.registration_status='registered' THEN
  RAISE EXCEPTION 'Регистрационный пакет утверждён и закрыт' USING errcode='42501';
 END IF;
 IF (NEW.id,NEW.game_id,NEW.party_id,NEW.doc_kind,NEW.version_no,NEW.storage_path,NEW.uploaded_by)
    IS DISTINCT FROM
    (OLD.id,OLD.game_id,OLD.party_id,OLD.doc_kind,OLD.version_no,OLD.storage_path,OLD.uploaded_by)
 THEN RAISE EXCEPTION 'Загруженную версию нельзя подменять' USING errcode='42501';
 END IF;
 IF OLD.version_no<>(SELECT max(version_no) FROM public.party_documents
                     WHERE party_id=OLD.party_id AND doc_kind=OLD.doc_kind) THEN
  RAISE EXCEPTION 'Рассматривать можно только последнюю версию документа' USING errcode='42501';
 END IF;
 IF NEW.status='revision' AND length(trim(coalesce(NEW.note,'')))<5 THEN
  RAISE EXCEPTION 'Для доработки укажите замечания (не менее 5 символов)' USING errcode='22023';
 END IF;
 IF NEW.status IS DISTINCT FROM OLD.status OR NEW.note IS DISTINCT FROM OLD.note THEN
  NEW.reviewed_at:=clock_timestamp();
  NEW.reviewed_by:=auth.uid();
 END IF;
 RETURN NEW;
END $body$;
REVOKE ALL ON FUNCTION private.guard_party_document_attempt() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS guard_party_document_attempt ON public.party_documents;
CREATE TRIGGER guard_party_document_attempt
 BEFORE INSERT OR UPDATE OR DELETE ON public.party_documents
 FOR EACH ROW EXECUTE FUNCTION private.guard_party_document_attempt();

-- Party students must not be able to erase failed attempts from their history.
DROP POLICY IF EXISTS party_documents_delete ON public.party_documents;
CREATE POLICY party_documents_delete ON public.party_documents FOR DELETE TO authenticated
 USING (private.is_game_teacher(game_id));

-- SECURITY DEFINER avoids circular RLS evaluation when file, document and
-- certificate policies refer to one another; it returns only a boolean.
CREATE OR REPLACE FUNCTION private.party_registration_certified(p_party_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $function$
 SELECT EXISTS(SELECT 1 FROM public.game_parties p
  JOIN public.formal_documents cert ON cert.game_id=p.game_id
     AND cert.doc_type='party_certificate' AND cert.status_code='published' AND cert.metadata->>'party_id'=p.id::text
  WHERE p.id=p_party_id AND p.registration_status='registered')
$function$;
REVOKE ALL ON FUNCTION private.party_registration_certified(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.party_registration_certified(uuid) TO authenticated;

-- The existing permissive SELECT policy exposed approved files to everybody before
-- the Ministry's decision. Keep teachers and same-party members private; outsiders
-- get only the current accepted version AFTER registration AND certificate issuance.
DROP POLICY IF EXISTS party_documents_read ON public.party_documents;
CREATE POLICY party_documents_read ON public.party_documents FOR SELECT TO authenticated USING (
 private.is_game_teacher(game_id)
 OR EXISTS(SELECT 1 FROM public.game_parties p JOIN public.game_members m
     ON m.game_id=p.game_id AND m.team=p.name
     WHERE p.id=party_documents.party_id AND p.game_id=party_documents.game_id
       AND m.user_id=(SELECT auth.uid()) AND m.kind='student' AND m.roster_archived_at IS NULL)
 OR (private.party_registration_certified(party_documents.party_id)
     AND status='accepted'
     AND doc_kind=ANY(ARRAY['charter','program','symbol','congress_minutes'])
     AND version_no=(SELECT max(d2.version_no) FROM public.party_documents d2
                       WHERE d2.party_id=party_documents.party_id AND d2.doc_kind=party_documents.doc_kind)
     AND private.is_game_member(game_id))
);

-- Storage is private as well: a row-level policy alone does not stop signing a
-- known object path from the shared game-assets bucket.
DROP POLICY IF EXISTS party_dossier_storage_release ON storage.objects;
CREATE POLICY party_dossier_storage_release ON storage.objects
 AS RESTRICTIVE FOR SELECT TO authenticated USING (
 bucket_id<>'game-assets'
 OR split_part(name,'/',2)<>'parties'
 OR split_part(name,'/',4)<>'docs'
 OR private.is_game_teacher((split_part(name,'/',1))::uuid)
 OR (
  EXISTS(SELECT 1 FROM public.party_documents d WHERE d.storage_path=storage.objects.name
   AND (private.is_game_teacher(d.game_id)
    OR EXISTS(SELECT 1 FROM public.game_parties p JOIN public.game_members m
      ON m.game_id=p.game_id AND m.team=p.name
      WHERE p.id=d.party_id AND m.user_id=(SELECT auth.uid())
       AND m.kind='student' AND m.roster_archived_at IS NULL)
    OR (d.status='accepted'
     AND private.party_registration_certified(d.party_id)
     AND d.version_no=(SELECT max(z.version_no) FROM public.party_documents z WHERE z.party_id=d.party_id AND z.doc_kind=d.doc_kind))
  ))
 )
);

-- Official letters to the party are private until registration. Certificate remains
-- visible after publication. This complements the party_documents/storage policies.
DROP POLICY IF EXISTS party_justice_correspondence_visibility ON public.formal_documents;
CREATE POLICY party_justice_correspondence_visibility ON public.formal_documents
 AS RESTRICTIVE FOR SELECT TO authenticated USING (
 doc_type NOT IN ('justice_response','party_certificate')
 OR metadata->>'party_id' IS NULL
 OR private.is_game_teacher(game_id)
 OR EXISTS(SELECT 1 FROM public.game_parties p JOIN public.game_members m
     ON m.game_id=p.game_id AND m.team=p.name
     WHERE p.id::text=formal_documents.metadata->>'party_id'
       AND m.user_id=(SELECT auth.uid()) AND m.kind='student' AND m.roster_archived_at IS NULL)
 OR private.party_registration_certified((formal_documents.metadata->>'party_id')::uuid)
);

-- Only the latest accepted Vn of each of the six required kinds qualifies.
CREATE OR REPLACE FUNCTION public.submit_party_registration(p_party_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $body$
DECLARE p public.game_parties%rowtype; v_uid uuid:=auth.uid(); missing text;
BEGIN
 SELECT * INTO p FROM public.game_parties WHERE id=p_party_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Партия не найдена'; END IF;
 IF p.registration_status='registered' THEN RAISE EXCEPTION 'Партия уже зарегистрирована'; END IF;
 IF NOT private.is_game_teacher(p.game_id) AND p.leader_user_id IS DISTINCT FROM v_uid THEN
  RAISE EXCEPTION 'Подать пакет может председатель партии' USING errcode='42501';
 END IF;
 SELECT string_agg(req.kind,', ') INTO missing FROM
 (VALUES('application'),('charter'),('program'),('fee'),('symbol'),('congress_minutes')) req(kind)
 WHERE NOT EXISTS(SELECT 1 FROM public.party_documents d WHERE d.party_id=p.id
  AND d.doc_kind=req.kind AND d.version_no=(
   SELECT max(v.version_no) FROM public.party_documents v WHERE v.party_id=p.id AND v.doc_kind=req.kind)
  AND d.status IN ('submitted','accepted'));
 IF missing IS NOT NULL THEN RAISE EXCEPTION 'Загрузите актуальные версии документов: %',missing; END IF;
 UPDATE public.game_parties SET registration_status='submitted',registration_note=null,
   registration_submitted_at=clock_timestamp() WHERE id=p.id;
 INSERT INTO public.game_events(game_id,round_no,category,severity,title,body,created_by)
 VALUES(p.game_id,1,'Регистрация партии','notice','Партия подала пакет на регистрацию',p.name,v_uid);
END $body$;
REVOKE ALL ON FUNCTION public.submit_party_registration(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_party_registration(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.review_party_registration(p_party_id uuid,p_status text,p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $body$
DECLARE p public.game_parties%rowtype; uid uuid:=auth.uid(); missing text;
BEGIN
 SELECT * INTO p FROM public.game_parties WHERE id=p_party_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Партия не найдена'; END IF;
 IF NOT private.is_game_teacher(p.game_id) THEN RAISE EXCEPTION 'Рассмотрение доступно Минюсту' USING errcode='42501'; END IF;
 IF p_status NOT IN ('registered','revision','rejected') THEN RAISE EXCEPTION 'Неизвестное решение'; END IF;
 IF p_status='registered' THEN
  SELECT string_agg(req.kind,', ') INTO missing FROM
    (VALUES('application'),('charter'),('program'),('fee'),('symbol'),('congress_minutes')) req(kind)
  WHERE NOT EXISTS(SELECT 1 FROM public.party_documents d
   WHERE d.party_id=p.id AND d.doc_kind=req.kind AND d.status='accepted'
     AND d.version_no=(SELECT max(v.version_no) FROM public.party_documents v
                       WHERE v.party_id=p.id AND v.doc_kind=req.kind));
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'Не приняты последние версии: %',missing; END IF;
 END IF;
 UPDATE public.game_parties SET registration_status=p_status,
   registration_note=CASE WHEN p_status='registered' THEN 'Партия зарегистрирована. Свидетельство выдано.' WHEN p_status='revision' THEN 'Пакет направлен на доработку. Заключение доступно членам партии.' ELSE 'В регистрации отказано. Заключение доступно членам партии.' END,
   registration_reviewed_at=clock_timestamp(),registration_reviewed_by=uid WHERE id=p.id;
 INSERT INTO public.game_events(game_id,round_no,category,severity,title,body,created_by)
 VALUES(p.game_id,1,'Регистрация партии',CASE WHEN p_status='registered' THEN 'notice' ELSE 'warning' END,
 CASE WHEN p_status='registered' THEN 'Партия зарегистрирована' WHEN p_status='revision'
 THEN 'Пакет партии возвращён на доработку' ELSE 'В регистрации партии отказано' END,
 p.name,uid);
END $body$;
REVOKE ALL ON FUNCTION public.review_party_registration(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_party_registration(uuid,text,text) TO authenticated;

-- Existing public-process policies may allow other parties to SELECT Minjust
-- letters. Restrict private registration decisions at the row level as well.
DROP POLICY IF EXISTS party_pending_justice_post_visibility ON public.political_posts;
CREATE POLICY party_pending_justice_post_visibility ON public.political_posts
 AS RESTRICTIVE FOR SELECT TO authenticated USING (
 actor_key IS DISTINCT FROM 'minjust'
 OR internal_view IS DISTINCT FROM 'parties'
 OR context->>'party_id' IS NULL
 OR private.is_game_teacher(game_id)
 OR EXISTS(SELECT 1 FROM public.game_parties p JOIN public.game_members m
   ON m.game_id=p.game_id AND m.team=p.name
   WHERE p.id::text=political_posts.context->>'party_id'
    AND m.user_id=(SELECT auth.uid()) AND m.kind='student' AND m.roster_archived_at IS NULL)
 OR EXISTS(SELECT 1 FROM public.game_parties p
   WHERE p.id::text=political_posts.context->>'party_id'
   AND private.party_registration_certified(p.id))
);

-- Private Ministry replies are retained as records for the party and teacher.\n-- The restrictive SELECT policy above prevents publication until certification.\n