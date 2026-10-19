-- ГОС.ID: registration decision based on individually reviewed documents, not OCR hints.
-- Post-registration complaints and court referrals are handled separately at stage 7.
DO $migration$
DECLARE src text;
BEGIN
 src:=pg_get_functiondef('public.record_presidential_cec_decision(uuid,text,integer,numeric,text,text)'::regprocedure);
 IF strpos(src,'''registered'',''revision'',''rejected'',''withdrawn''')=0 OR
    strpos(src,'v_reasoning:=private.presidential_submission_review_json(c.id);')=0 THEN
   RAISE EXCEPTION 'Unexpected CEC decision function signature / content';
 END IF;
 src:=replace(src,'''registered'',''revision'',''rejected'',''withdrawn''','''registered'',''revision'',''rejected''');
 src:=replace(src,'v_reasoning:=private.presidential_submission_review_json(c.id);',
 $guard$
 -- Reject repeated initial-registration decisions on finalized candidacies.
 IF c.registration_status IN ('registered','withdrawn','rejected') THEN
  RAISE EXCEPTION 'Окончательное решение о регистрации уже принято; используйте процедуру обжалования на этапе 7'
   USING ERRCODE='42501';
 END IF;
 IF p_status='registered' AND c.nomination_type <> 'fictional' AND (
  (SELECT count(*) FROM public.presidential_candidate_documents d
   WHERE d.candidate_id=c.id AND d.archived_at IS NULL AND d.is_submitted
     AND d.status='accepted' AND d.doc_kind = ANY(
      CASE WHEN c.nomination_type='party'
       THEN ARRAY['party_decision','party_egrul','consent','passport','income','real_estate','expenses']::text[]
       ELSE ARRAY['group_petition','signature_sheets','consent','passport','income','real_estate','expenses']::text[]
      END
     ))<>7
  OR EXISTS (SELECT 1 FROM public.presidential_candidate_documents d
   WHERE d.candidate_id=c.id AND d.archived_at IS NULL AND d.is_submitted AND d.status<>'accepted')
 ) THEN
  RAISE EXCEPTION 'Для регистрации ЦИК обязана принять каждый обязательный документ'
   USING ERRCODE='23514';
 END IF;
 IF p_status='revision' AND NOT EXISTS (
  SELECT 1 FROM public.presidential_candidate_documents d
  WHERE d.candidate_id=c.id AND d.archived_at IS NULL AND d.is_submitted AND d.status='revision'
 ) THEN
  RAISE EXCEPTION 'Для возврата на доработку укажите замечания к конкретным документам'
   USING ERRCODE='23514';
 END IF;
 IF p_status='rejected' AND (
  length(trim(coalesce(p_private_summary,'')))<30
  OR coalesce(p_private_summary,'') !~* '(19-ФЗ|67-ФЗ|Конституц|стать[яие]|ст[. ]+[0-9]+)'
 ) THEN
  RAISE EXCEPTION 'При отказе в регистрации требуется мотивированное правовое основание со ссылкой на норму закона'
   USING ERRCODE='23514';
 END IF;
 v_reasoning:=private.presidential_submission_review_json(c.id);
 $guard$);
 EXECUTE src;
END
$migration$;
