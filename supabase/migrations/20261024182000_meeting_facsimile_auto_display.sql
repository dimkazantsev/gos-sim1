-- ГОС.ID: Display an uploaded *game* signature as an automatically attached
-- facsimile on published agendas/minutes. This is NOT a personal signing event.
-- Formal signatures and the person's explicit sign_institution_document RPC stay intact.
CREATE TABLE IF NOT EXISTS public.formal_meeting_facsimiles (
 document_id uuid NOT NULL REFERENCES public.formal_documents(id) ON DELETE CASCADE,
 game_id uuid NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
 signer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 office text NOT NULL,
 signature_path text NOT NULL,
 attached_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(document_id,signer_id)
);
CREATE INDEX IF NOT EXISTS formal_meeting_facsimiles_game_path
 ON public.formal_meeting_facsimiles(game_id,signature_path);
ALTER TABLE public.formal_meeting_facsimiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.formal_meeting_facsimiles FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.formal_meeting_facsimiles TO authenticated;
CREATE POLICY published_meeting_facsimiles_read
 ON public.formal_meeting_facsimiles FOR SELECT TO authenticated
 USING (
  NOT coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
  AND private.is_game_member(game_id)
  AND EXISTS(SELECT 1 FROM public.formal_documents d WHERE d.id=document_id
    AND d.game_id=game_id AND d.doc_type IN ('meeting_agenda','minutes')
    AND d.status_code IN ('published','adopted','signed'))
 );

-- Existing authority resolution for GD and KSRF is authoritative.
-- Other institutional meeting documents use recorded approvers/chairs only;
-- document authors and teachers are NOT automatically treated as chairs.
CREATE OR REPLACE FUNCTION private.meeting_facsimile_signers(p_document uuid)
RETURNS TABLE(user_id uuid,office text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
DECLARE d public.formal_documents%rowtype; v_approved uuid; v_chair uuid;
BEGIN
 SELECT * INTO d FROM public.formal_documents WHERE id=p_document;
 IF d.id IS NULL OR d.doc_type NOT IN ('meeting_agenda','minutes')
    OR d.status_code NOT IN ('published','adopted','signed') THEN RETURN; END IF;
 IF d.subject_key IN ('gd','ksrf') THEN
  RETURN QUERY SELECT s.user_id,s.office FROM private.institution_document_signers(d.id) s;
  RETURN;
 END IF;
 SELECT CASE WHEN d.doc_type='meeting_agenda' THEN m.agenda_approved_by
             ELSE m.minutes_approved_by END
 INTO v_approved
 FROM public.institution_meeting_records m WHERE m.game_id=d.game_id
 AND m.stage_no=d.stage_no AND m.institution_key=d.subject_key
 AND (CASE WHEN d.doc_type='meeting_agenda'
           THEN m.agenda_document_id=d.id ELSE m.minutes_document_id=d.id END)
 LIMIT 1;
 IF d.subject_key='government' THEN
  SELECT coalesce(g.chair_user_id,g.agenda_approved_by)
  INTO v_chair FROM public.government_sessions g
  WHERE g.game_id=d.game_id AND
    (g.agenda_document_id=d.id OR g.id::text=d.metadata->>'automatic_session_id')
  LIMIT 1;
 END IF;
 v_approved:=coalesce(v_chair,v_approved);
 IF v_approved IS NULL THEN RETURN; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.game_members gm WHERE gm.game_id=d.game_id
  AND gm.user_id=v_approved AND gm.roster_archived_at IS NULL) THEN RETURN; END IF;
 RETURN QUERY SELECT v_approved,
  CASE WHEN v_chair IS NOT NULL THEN
    'Председатель Правительства Российской Федерации'::text
  WHEN d.doc_type='meeting_agenda' THEN
    'Утвердивший повестку заседания'::text
  ELSE 'Утвердивший протокол заседания'::text END;
END $$;
REVOKE ALL ON FUNCTION private.meeting_facsimile_signers(uuid) FROM PUBLIC,anon,authenticated;

-- A real image is snapped once for each authorized signer and published edition.
-- No fabricated handwritten image, signing history or signed status is created.
CREATE OR REPLACE FUNCTION private.attach_published_meeting_facsimiles(p_document uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
BEGIN
 INSERT INTO public.formal_meeting_facsimiles(document_id,game_id,signer_id,office,signature_path)
 SELECT d.id,d.game_id,s.user_id,s.office,p.signature_path
 FROM public.formal_documents d
 JOIN LATERAL private.meeting_facsimile_signers(d.id) s ON true
 JOIN public.game_profiles p ON p.game_id=d.game_id AND p.user_id=s.user_id
 JOIN public.game_members gm ON gm.game_id=p.game_id AND gm.user_id=p.user_id
 WHERE d.id=p_document AND d.doc_type IN('meeting_agenda','minutes')
  AND d.status_code IN('published','adopted','signed')
  AND gm.roster_archived_at IS NULL AND nullif(p.signature_path,'') IS NOT NULL
  AND p.signature_path LIKE d.game_id::text||'/profiles/'||s.user_id::text||'/signature-%.png'
 ON CONFLICT(document_id,signer_id) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION private.attach_published_meeting_facsimiles(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.attach_facsimiles_on_publish()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
BEGIN
 IF NEW.doc_type IN('meeting_agenda','minutes') AND NEW.status_code IN('published','adopted','signed')
 THEN PERFORM private.attach_published_meeting_facsimiles(NEW.id); END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS meeting_facsimiles_publish ON public.formal_documents;
CREATE TRIGGER meeting_facsimiles_publish
 AFTER INSERT OR UPDATE OF status_code ON public.formal_documents
 FOR EACH ROW EXECUTE FUNCTION private.attach_facsimiles_on_publish();

CREATE OR REPLACE FUNCTION private.attach_facsimiles_on_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
BEGIN
 IF NEW.agenda_document_id IS NOT NULL AND NEW.agenda_approved_by IS NOT NULL
 THEN PERFORM private.attach_published_meeting_facsimiles(NEW.agenda_document_id); END IF;
 IF NEW.minutes_document_id IS NOT NULL AND NEW.minutes_approved_by IS NOT NULL
 THEN PERFORM private.attach_published_meeting_facsimiles(NEW.minutes_document_id); END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS meeting_facsimiles_approval ON public.institution_meeting_records;
CREATE TRIGGER meeting_facsimiles_approval
 AFTER INSERT OR UPDATE OF agenda_approved_by,minutes_approved_by ON public.institution_meeting_records
 FOR EACH ROW EXECUTE FUNCTION private.attach_facsimiles_on_approval();

CREATE OR REPLACE FUNCTION private.attach_facsimiles_on_profile_signature()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
DECLARE doc record;
BEGIN
 IF nullif(NEW.signature_path,'') IS NULL OR
   (TG_OP='UPDATE' AND NEW.signature_path IS NOT DISTINCT FROM OLD.signature_path)
 THEN RETURN NEW; END IF;
 FOR doc IN SELECT d.id FROM public.formal_documents d
   WHERE d.game_id=NEW.game_id AND d.doc_type IN ('meeting_agenda','minutes')
     AND d.status_code IN ('published','adopted','signed')
 LOOP PERFORM private.attach_published_meeting_facsimiles(doc.id); END LOOP;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS meeting_facsimiles_after_signature ON public.game_profiles;
CREATE TRIGGER meeting_facsimiles_after_signature
 AFTER INSERT OR UPDATE OF signature_path ON public.game_profiles
 FOR EACH ROW EXECUTE FUNCTION private.attach_facsimiles_on_profile_signature();

-- Allow viewing ONLY the specific stored facsimile used in a published game document.
-- Original private profile images remain private until attached.
CREATE POLICY meeting_facsimile_published_asset_read ON storage.objects
 FOR SELECT TO authenticated USING (
  bucket_id='game-assets'
  AND NOT coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
  AND EXISTS(SELECT 1 FROM public.formal_meeting_facsimiles f
   JOIN public.formal_documents d ON d.id=f.document_id AND d.game_id=f.game_id
   WHERE f.signature_path=objects.name AND d.doc_type IN('meeting_agenda','minutes')
    AND d.status_code IN ('published','adopted','signed')
    AND private.is_game_member(f.game_id))
 );

-- Return a single authorized signature list in the existing read-only RPC.
-- "signed" only means an actual, separately confirmed personal signature.
CREATE OR REPLACE FUNCTION public.get_institution_document_signers(p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,private,pg_temp AS $$
DECLARE d public.formal_documents%rowtype;v_uid uuid:=auth.uid();v_needed jsonb;v_can boolean;
BEGIN
 SELECT * INTO d FROM public.formal_documents WHERE id=p_document_id;
 IF d.id IS NULL OR v_uid IS NULL OR NOT private.is_game_member(d.game_id)
 THEN RAISE EXCEPTION 'Документ недоступен' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'user_id',s.user_id,'office',s.office,
  'facsimile_path',(SELECT f.signature_path FROM public.formal_meeting_facsimiles f
    WHERE f.document_id=d.id AND f.signer_id=s.user_id),
  'signed',EXISTS(SELECT 1 FROM public.formal_document_signatures x
    WHERE x.document_id=d.id AND x.signer_id=s.user_id
      AND x.signed_at>=coalesce(nullif(d.metadata->>'revision_changed_at','')::timestamptz,'-infinity'::timestamptz))
 ) ORDER BY s.office,s.user_id),'[]'::jsonb) INTO v_needed
 FROM (
  SELECT r.user_id,r.office FROM private.institution_document_signers(d.id) r
    WHERE d.doc_type NOT IN('meeting_agenda','minutes')
  UNION
  SELECT r.user_id,r.office FROM private.meeting_facsimile_signers(d.id) r
    WHERE d.doc_type IN('meeting_agenda','minutes')
 ) s;
 SELECT EXISTS(SELECT 1 FROM private.institution_document_signers(d.id) s
  WHERE s.user_id=v_uid
    AND NOT EXISTS(SELECT 1 FROM public.formal_document_signatures x
      WHERE x.document_id=d.id AND x.signer_id=v_uid
        AND x.signed_at>=coalesce(nullif(d.metadata->>'revision_changed_at','')::timestamptz,'-infinity'::timestamptz)))
 INTO v_can;
 RETURN jsonb_build_object('required',v_needed,'can_sign',v_can);
END $$;
REVOKE ALL ON FUNCTION public.get_institution_document_signers(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_institution_document_signers(uuid) TO authenticated;

-- Backfill only currently published meeting documents, without modifying prior
-- signatures, approval records, published texts or user profiles.
DO $$
DECLARE d record;
BEGIN
 FOR d IN SELECT id FROM public.formal_documents
   WHERE doc_type IN ('meeting_agenda','minutes')
     AND status_code IN ('published','adopted','signed')
 LOOP PERFORM private.attach_published_meeting_facsimiles(d.id); END LOOP;
END $$;
