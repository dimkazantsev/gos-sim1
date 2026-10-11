-- Twelfth independently checked legal release batch: questions 481-600.
UPDATE public.blitz_questions
SET legal_review_status='approved',
    legal_reviewed_at=clock_timestamp(),
    legal_reviewed_by=NULL,
    legal_review_note='Сверено 12.10.2026 с действующей редакцией указанного НПА; вопрос, все варианты, правильный ответ и объяснение соответствуют указанной статье.'
WHERE id BETWEEN 481 AND 600
  AND verified=true;

DO $verify$
BEGIN
 IF (SELECT count(*) FROM public.blitz_questions WHERE id BETWEEN 481 AND 600 AND legal_review_status='approved')<>120 THEN
  RAISE EXCEPTION 'Legal review batch 481-600 did not approve exactly 120 expected questions';
 END IF;
END $verify$;
