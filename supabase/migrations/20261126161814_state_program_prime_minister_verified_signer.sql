-- State programme passports are signed in Stage 11 but belong to Stage 10.
-- Keep immutable separate signatures and resolve the actual appointed signer in
-- the existing detail RPC, without rewriting a closed-stage programme.
DO $patch$
DECLARE v_def text;
 v_mark constant text:=' IF d.doc_type=''meeting_agenda'' THEN';
 v_branch constant text:=$branch$
 IF d.doc_type='state_program' AND d.metadata->>'document_kind'='stage10_state_program' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'user_id',f.signer_id,'office','Председатель Правительства Российской Федерации',
    'display_name',coalesce((SELECT nullif(btrim(n.candidate_name),'') FROM public.government_nominations n WHERE n.game_id=d.game_id AND n.candidate_user_id=f.signer_id AND n.office_key='prime_minister' AND n.appointed_at<=f.signed_at ORDER BY n.appointed_at DESC,n.created_at DESC LIMIT 1),(SELECT m.full_name FROM public.game_members m WHERE m.game_id=d.game_id AND m.user_id=f.signer_id)),
    'signed',true,'facsimile_path',NULL
  )),'[]'::jsonb) INTO needed
  FROM (
   SELECT DISTINCT ON (sig.signer_id) sig.signer_id,sig.signed_at
   FROM public.formal_document_signatures sig
   JOIN public.state_programs p ON p.game_id=d.game_id AND p.id::text=d.metadata->>'state_program_id' AND p.signed_by=sig.signer_id AND p.signed_at IS NOT NULL
   WHERE sig.document_id=d.id AND sig.game_id=d.game_id
   AND sig.signed_at>=coalesce(nullif(d.metadata->>'revision_changed_at','')::timestamptz,'-infinity'::timestamptz)
   ORDER BY sig.signer_id,sig.signed_at DESC
  ) f;
  RETURN jsonb_build_object('required',needed,'can_sign',false);
 END IF;
$branch$;
BEGIN
 v_def:=pg_get_functiondef('public.get_institution_document_signers(uuid)'::regprocedure);
 IF strpos(v_def,v_branch)=0 THEN
  IF strpos(v_def,v_mark)=0 THEN RAISE EXCEPTION 'Signer RPC changed';END IF;
  EXECUTE replace(v_def,v_mark,v_branch||v_mark);
 END IF;
END $patch$;
