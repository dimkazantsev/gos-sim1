-- Keep every submission and teacher decision as an immutable document version.
-- Existing records remain untouched except for backfilled version numbers.
ALTER TABLE public.party_documents
 ADD COLUMN IF NOT EXISTS version_no integer;
WITH numbered AS (
 SELECT id,row_number() OVER(PARTITION BY party_id,doc_kind ORDER BY created_at,id)::integer AS version
 FROM public.party_documents
)
UPDATE public.party_documents d SET version_no=n.version FROM numbered n WHERE d.id=n.id AND d.version_no IS NULL;
ALTER TABLE public.party_documents ALTER COLUMN version_no SET NOT NULL;
ALTER TABLE public.party_documents ADD CONSTRAINT party_documents_version_positive CHECK (version_no>0);
CREATE UNIQUE INDEX IF NOT EXISTS party_documents_party_kind_version_idx
 ON public.party_documents(party_id,doc_kind,version_no);

-- Protect the same party/kind sequence under concurrent student uploads.
CREATE OR REPLACE FUNCTION private.assign_party_document_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,private,pg_temp AS $$
DECLARE v_party public.game_parties%rowtype;
BEGIN
 SELECT * INTO v_party FROM public.game_parties WHERE id=NEW.party_id FOR UPDATE;
 IF v_party.id IS NULL OR v_party.game_id IS DISTINCT FROM NEW.game_id THEN
  RAISE EXCEPTION 'Party does not match the game';
 END IF;
 IF v_party.registration_status='registered' THEN
  RAISE EXCEPTION 'The party is already registered; its registration package is locked';
 END IF;
 -- Version numbers are assigned by the database, never by a client.
 SELECT coalesce(max(version_no),0)+1 INTO NEW.version_no
 FROM public.party_documents WHERE party_id=NEW.party_id AND doc_kind=NEW.doc_kind;
 RETURN NEW;
END;$$;
DROP TRIGGER IF EXISTS assign_party_document_version ON public.party_documents;
CREATE TRIGGER assign_party_document_version BEFORE INSERT ON public.party_documents
FOR EACH ROW EXECUTE FUNCTION private.assign_party_document_version();

-- Registration is based only on the latest document of each required kind.
-- An old accepted V1 must not allow registration if V2 is awaiting review.
CREATE OR REPLACE FUNCTION private.party_dossier_latest_accepted(p_party_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,private,pg_temp AS $$
 SELECT NOT EXISTS(
  SELECT 1 FROM (VALUES('application'),('charter'),('program'),('fee'),('symbol'),('congress_minutes')) kinds(kind)
  WHERE NOT EXISTS(
   SELECT 1 FROM public.party_documents d
   WHERE d.party_id=p_party_id AND d.doc_kind=kinds.kind AND d.status='accepted'
    AND d.version_no=(SELECT max(x.version_no) FROM public.party_documents x
                      WHERE x.party_id=p_party_id AND x.doc_kind=kinds.kind)
  )
 );
$$;
REVOKE ALL ON FUNCTION private.party_dossier_latest_accepted(uuid) FROM PUBLIC,anon,authenticated;

-- Prevent an out-of-date accepted document from being used to issue registration.
CREATE OR REPLACE FUNCTION private.guard_party_registration_versions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,private,pg_temp AS $$
BEGIN
 IF NEW.registration_status='registered' AND
    (TG_OP='INSERT' OR OLD.registration_status IS DISTINCT FROM 'registered') AND
    NOT private.party_dossier_latest_accepted(NEW.id) THEN
  RAISE EXCEPTION 'All six latest documents must be accepted before registration';
 END IF;
 RETURN NEW;
END;$$;
DROP TRIGGER IF EXISTS guard_party_registration_versions ON public.game_parties;
CREATE TRIGGER guard_party_registration_versions BEFORE INSERT OR UPDATE OF registration_status
 ON public.game_parties FOR EACH ROW EXECUTE FUNCTION private.guard_party_registration_versions();

-- Security-definer helper avoids recursive RLS policy evaluation.
CREATE OR REPLACE FUNCTION private.is_latest_party_doc_version(
 p_party_id uuid,p_kind text,p_version integer
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,private,pg_temp AS $
 SELECT p_version=(SELECT max(version_no) FROM public.party_documents
                   WHERE party_id=p_party_id AND doc_kind=p_kind)
$;
REVOKE ALL ON FUNCTION private.is_latest_party_doc_version(uuid,text,integer)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.is_latest_party_doc_version(uuid,text,integer) TO authenticated;

-- Only current accepted documents of registered parties are public.
DROP POLICY IF EXISTS party_documents_read ON public.party_documents;
CREATE POLICY party_documents_read ON public.party_documents FOR SELECT TO authenticated
 USING (
  private.is_game_member(game_id)
  AND (
    private.is_game_teacher(game_id)
    OR EXISTS (
     SELECT 1 FROM public.game_parties p
     JOIN public.game_members gm ON gm.game_id=p.game_id AND gm.team=p.name
     WHERE p.id=party_documents.party_id AND gm.user_id=(SELECT auth.uid())
       AND gm.roster_archived_at IS NULL
    )
    OR (
     status='accepted'
     AND doc_kind=ANY(ARRAY['charter','program','symbol','congress_minutes'])
     AND EXISTS (
      SELECT 1 FROM public.game_parties p
      WHERE p.id=party_documents.party_id AND p.registration_status='registered'
     )
     AND private.is_latest_party_doc_version(party_documents.party_id,party_documents.doc_kind,party_documents.version_no)
    )
  )
 );

-- Prevent changing an already-decided version; new submissions must use V(n+1).
CREATE OR REPLACE FUNCTION private.guard_party_document_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,private,pg_temp AS $$
DECLARE p public.game_parties%rowtype;
BEGIN
 SELECT * INTO p FROM public.game_parties WHERE id=NEW.party_id;
 IF p.registration_status='registered' THEN
  RAISE EXCEPTION 'Registered party documents cannot be re-reviewed';
 END IF;
 IF NEW.id<>OLD.id OR NEW.party_id<>OLD.party_id OR NEW.doc_kind<>OLD.doc_kind
    OR NEW.version_no<>OLD.version_no OR NEW.storage_path<>OLD.storage_path THEN
  RAISE EXCEPTION 'Cannot rewrite a submitted document version';
 END IF;
 IF OLD.status IN ('accepted','revision') THEN
  RAISE EXCEPTION 'This version has already been decided; upload a new version';
 END IF;
 IF NEW.version_no IS DISTINCT FROM (
    SELECT max(d.version_no) FROM public.party_documents d
    WHERE d.party_id=NEW.party_id AND d.doc_kind=NEW.doc_kind
 ) THEN
  RAISE EXCEPTION 'Review only the latest version';
 END IF;
 RETURN NEW;
END;$$;
DROP TRIGGER IF EXISTS guard_party_document_review ON public.party_documents;
CREATE TRIGGER guard_party_document_review BEFORE UPDATE ON public.party_documents
 FOR EACH ROW EXECUTE FUNCTION private.guard_party_document_review();


-- Storage must enforce the same embargo. Existing permissive game_assets_news_visibility
-- covered *all* non-news paths, so narrow it to news before adding the per-party rule.
CREATE OR REPLACE FUNCTION private.can_read_party_document_asset(
 p_game_id uuid,p_party_id uuid,p_path text
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,private,pg_temp AS $$
 SELECT private.is_game_member(p_game_id) AND (
  private.is_game_teacher(p_game_id)
  OR EXISTS(
   SELECT 1 FROM public.game_parties p
   JOIN public.game_members gm ON gm.game_id=p.game_id AND gm.team=p.name
   WHERE p.id=p_party_id AND p.game_id=p_game_id
     AND gm.user_id=(SELECT auth.uid()) AND gm.roster_archived_at IS NULL
  )
  OR EXISTS(
   SELECT 1 FROM public.party_documents d
   JOIN public.game_parties p ON p.id=d.party_id AND p.game_id=d.game_id
   WHERE d.game_id=p_game_id AND d.party_id=p_party_id
    AND d.storage_path=p_path AND p.registration_status='registered'
    AND d.status='accepted'
    AND d.doc_kind=ANY(ARRAY['charter','program','symbol','congress_minutes'])
    AND private.is_latest_party_doc_version(d.party_id,d.doc_kind,d.version_no)
  )
 );
$$;
REVOKE ALL ON FUNCTION private.can_read_party_document_asset(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.can_read_party_document_asset(uuid,uuid,text) TO authenticated;

DROP POLICY IF EXISTS game_assets_news_visibility ON storage.objects;
CREATE POLICY game_assets_news_visibility ON storage.objects FOR SELECT TO authenticated
 USING (
  bucket_id='game-assets'
  AND split_part(name,'/',2)='news'
  AND (
   split_part(name,'/',3)=(SELECT auth.uid())::text
   OR private.is_game_teacher((split_part(name,'/',1))::uuid)
   OR EXISTS(
    SELECT 1 FROM public.political_post_media pm
    JOIN public.political_posts pp ON pp.id=pm.post_id
    WHERE pm.storage_path=name AND pp.deleted_at IS NULL
      AND private.is_game_member(pp.game_id)
   )
  )
 );

DROP POLICY IF EXISTS game_assets_read ON storage.objects;
CREATE POLICY game_assets_read ON storage.objects FOR SELECT TO authenticated USING (
 bucket_id='game-assets'
 AND CASE
  WHEN name ~ '^[^/]+/parties/[^/]+/docs/[^/]+$'
  THEN private.can_read_party_document_asset(
   (split_part(name,'/',1))::uuid,
   (split_part(name,'/',3))::uuid,
   name
  )
  WHEN name ~ '^[^/]+/profiles/[^/]+/signature-[^/]+[.]png$'
  THEN (
   split_part(name,'/',3)=(SELECT auth.uid())::text
   OR private.is_game_teacher((split_part(name,'/',1))::uuid)
   OR EXISTS(
    SELECT 1 FROM public.formal_document_signatures fs
    WHERE fs.signature_path=name AND private.is_game_member(fs.game_id)
   )
  )
  ELSE private.is_game_member((split_part(name,'/',1))::uuid)
 END
);


-- Draft package decisions stay in the party's private dossier.
-- Only a successful registration is issued as a public official answer/certificate.
CREATE OR REPLACE FUNCTION public.review_party_package_privately(
 p_party_id uuid,p_status text,p_note text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,private,pg_temp AS $$
DECLARE p public.game_parties%rowtype;
BEGIN
 SELECT * INTO p FROM public.game_parties WHERE id=p_party_id FOR UPDATE;
 IF p.id IS NULL OR NOT private.is_game_teacher(p.game_id) THEN
  RAISE EXCEPTION 'Only the teacher may review registration documents';
 END IF;
 IF p.registration_status='registered' THEN
  RAISE EXCEPTION 'Registered party status is final';
 END IF;
 IF p_status NOT IN ('revision','rejected') THEN
  RAISE EXCEPTION 'Only non-public revision or rejection decisions are supported';
 END IF;
 IF nullif(trim(coalesce(p_note,'')),'') IS NULL THEN
  RAISE EXCEPTION 'State the grounds for the registration-package decision';
 END IF;
 UPDATE public.game_parties
 SET registration_status=p_status,registration_note=trim(p_note),
     registration_reviewed_at=now(),registration_reviewed_by=(SELECT auth.uid())
 WHERE id=p_party_id;
END;$$;
REVOKE ALL ON FUNCTION public.review_party_package_privately(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_party_package_privately(uuid,text,text) TO authenticated;


-- Notify all opted-in members of the party, not only the original uploader.
CREATE OR REPLACE FUNCTION private.notify_party_dossier_members()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,private,pg_temp AS $$
BEGIN
 IF NEW.status IS NOT DISTINCT FROM OLD.status
    OR NEW.status NOT IN ('accepted','revision') THEN RETURN NEW; END IF;
 INSERT INTO public.telegram_outbox(game_id,user_id,category,source_id,body)
 SELECT NEW.game_id,gm.user_id,'party_review',NEW.id,
  'Минюст рассмотрел документ партии «'||p.name||'» · В'||NEW.version_no||
  ': '||CASE WHEN NEW.status='accepted' THEN 'принят' ELSE 'возвращён на доработку' END||
  '. Откройте раздел «Партии и фракции» для просмотра решения и замечаний.'
 FROM public.game_parties p
 JOIN public.game_members gm ON gm.game_id=p.game_id AND gm.team=p.name
 JOIN public.telegram_links t ON t.game_id=gm.game_id AND t.user_id=gm.user_id AND t.notifications_enabled
 WHERE p.id=NEW.party_id AND gm.kind='student' AND gm.roster_archived_at IS NULL
 ON CONFLICT(game_id,user_id,category,source_id) DO NOTHING;
 RETURN NEW;
END;$$;
DROP TRIGGER IF EXISTS notify_party_dossier_members ON public.party_documents;
CREATE TRIGGER notify_party_dossier_members AFTER UPDATE OF status ON public.party_documents
FOR EACH ROW EXECUTE FUNCTION private.notify_party_dossier_members();
