-- Tenth independently checked legal release batch: questions 241-360.
-- Reviewed by NPA/article groups on 12.10.2026 against current legal texts.
UPDATE public.blitz_questions
SET legal_review_status='approved',
    legal_reviewed_at=clock_timestamp(),
    legal_reviewed_by=NULL,
    legal_review_note='Сверено 12.10.2026 с действующей редакцией указанного НПА; вопрос, все варианты, правильный ответ и объяснение соответствуют указанной статье.'
WHERE id BETWEEN 241 AND 360
  AND verified=true;

DO $verify$
BEGIN
 IF (SELECT count(*) FROM public.blitz_questions WHERE id BETWEEN 241 AND 360 AND legal_review_status='approved')<>120 THEN
  RAISE EXCEPTION 'Legal review batch 241-360 did not approve exactly 120 expected questions';
 END IF;
END $verify$;
