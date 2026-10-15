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
