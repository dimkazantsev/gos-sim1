CREATE OR REPLACE FUNCTION public.get_institution_document_signers(p_document_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE d public.formal_documents%rowtype; uid uuid:=auth.uid(); needed jsonb; can_sign boolean;
BEGIN
 SELECT * INTO d FROM public.formal_documents WHERE id=p_document_id;
 IF d.id IS NULL OR uid IS NULL OR NOT private.is_game_member(d.game_id)
 THEN RAISE EXCEPTION 'Документ недоступен' USING ERRCODE='42501'; END IF;
 IF d.doc_type='meeting_agenda' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'user_id',s.user_id,'office',s.office,
    'display_name',coalesce((SELECT n.candidate_name FROM public.government_nominations n WHERE n.game_id=d.game_id AND n.candidate_user_id=s.user_id AND n.status='appointed' AND (lower(btrim(n.office_title))=lower(btrim(s.office)) OR n.office_key='prime_minister' AND s.office ~* '^председатель[[:space:]]+правительства([[:space:]]|$)') ORDER BY n.appointed_at DESC NULLS LAST,n.created_at DESC LIMIT 1),(SELECT m.full_name FROM public.game_members m WHERE m.game_id=d.game_id AND m.user_id=s.user_id)),
    'facsimile_path',NULL,
    'signed',EXISTS(SELECT 1 FROM public.formal_document_signatures f
      WHERE f.document_id=d.id AND f.signer_id=s.user_id
       AND f.signed_at>=coalesce(nullif(d.metadata->>'revision_changed_at','')::timestamptz,'-infinity'::timestamptz))
   ) ORDER BY s.office,s.user_id),'[]'::jsonb)
   INTO needed FROM private.agenda_required_signers(d.id) s;
  SELECT EXISTS(SELECT 1 FROM private.agenda_required_signers(d.id) s
    WHERE s.user_id=uid AND private.role_is_available(d.game_id,uid)
      AND NOT EXISTS(SELECT 1 FROM public.formal_document_signatures f
       WHERE f.document_id=d.id AND f.signer_id=uid
        AND f.signed_at>=coalesce(nullif(d.metadata->>'revision_changed_at','')::timestamptz,'-infinity'::timestamptz)))
   INTO can_sign;
  RETURN jsonb_build_object('required',needed,'can_sign',can_sign,'approved',private.agenda_all_signed(d.id));
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'user_id',s.user_id,'office',s.office,
    'display_name',coalesce((SELECT n.candidate_name FROM public.government_nominations n WHERE n.game_id=d.game_id AND n.candidate_user_id=s.user_id AND n.status='appointed' AND (lower(btrim(n.office_title))=lower(btrim(s.office)) OR n.office_key='prime_minister' AND s.office ~* '^председатель[[:space:]]+правительства([[:space:]]|$)') ORDER BY n.appointed_at DESC NULLS LAST,n.created_at DESC LIMIT 1),(SELECT m.full_name FROM public.game_members m WHERE m.game_id=d.game_id AND m.user_id=s.user_id)),
  'facsimile_path',(SELECT f.signature_path FROM public.formal_meeting_facsimiles f
    WHERE f.document_id=d.id AND f.signer_id=s.user_id),
  'signed',EXISTS(SELECT 1 FROM public.formal_document_signatures x
    WHERE x.document_id=d.id AND x.signer_id=s.user_id
     AND x.signed_at>=coalesce(nullif(d.metadata->>'revision_changed_at','')::timestamptz,'-infinity'::timestamptz))
 ) ORDER BY s.office,s.user_id),'[]'::jsonb) INTO needed
 FROM (
  SELECT r.user_id,r.office FROM private.institution_document_signers(d.id) r
    WHERE d.doc_type<>'minutes'
  UNION
  SELECT r.user_id,r.office FROM private.meeting_facsimile_signers(d.id) r
    WHERE d.doc_type='minutes'
 ) s;
 SELECT EXISTS(SELECT 1 FROM private.institution_document_signers(d.id) s
   WHERE s.user_id=uid AND NOT EXISTS(SELECT 1 FROM public.formal_document_signatures x
   WHERE x.document_id=d.id AND x.signer_id=uid
    AND x.signed_at>=coalesce(nullif(d.metadata->>'revision_changed_at','')::timestamptz,'-infinity'::timestamptz)))
 INTO can_sign;
 RETURN jsonb_build_object('required',needed,'can_sign',can_sign);
END $function$
;