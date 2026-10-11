-- Teacher-only legal release decision. No bulk approval endpoint by design.
CREATE OR REPLACE FUNCTION public.blitz_set_legal_review(
 p_game uuid,p_question bigint,p_status text,p_note text default null
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE uid uuid:=auth.uid(); is_verified boolean;
BEGIN
 IF uid IS NULL OR NOT EXISTS(
  SELECT 1 FROM public.game_members m
  WHERE m.game_id=p_game AND m.user_id=uid AND m.kind='teacher'
 ) THEN RAISE EXCEPTION 'Forbidden' USING errcode='42501'; END IF;
 IF p_status NOT IN ('pending','approved','rejected') THEN
  RAISE EXCEPTION 'Invalid review status' USING errcode='22023';
 END IF;
 SELECT verified INTO is_verified FROM public.blitz_questions WHERE id=p_question FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Question not found' USING errcode='P0002'; END IF;
 IF p_status='approved' AND NOT is_verified THEN
  RAISE EXCEPTION 'Technical verification is required before legal approval' USING errcode='22023';
 END IF;
 UPDATE public.blitz_questions
 SET legal_review_status=p_status,
     legal_reviewed_at=CASE WHEN p_status='pending' THEN NULL ELSE clock_timestamp() END,
     legal_reviewed_by=CASE WHEN p_status='pending' THEN NULL ELSE uid END,
     legal_review_note=nullif(trim(coalesce(p_note,'')),'')
 WHERE id=p_question;
END $$;
REVOKE ALL ON FUNCTION public.blitz_set_legal_review(uuid,bigint,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.blitz_set_legal_review(uuid,bigint,text,text) TO authenticated;
