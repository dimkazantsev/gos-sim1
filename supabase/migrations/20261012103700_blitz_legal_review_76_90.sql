-- Sixth independently checked legal release batch: questions 76-90.
WITH approved(id,source_url) AS (VALUES
 (76::bigint,'https://www.consultant.ru/document/cons_doc_LAW_61763/baabe5b69a3c031bfb8d485891bf8077d6809a94/'),
 (77::bigint,'https://www.consultant.ru/document/cons_doc_LAW_61763/baabe5b69a3c031bfb8d485891bf8077d6809a94/'),
 (78::bigint,'https://www.consultant.ru/document/cons_doc_LAW_61763/baabe5b69a3c031bfb8d485891bf8077d6809a94/'),
 (79::bigint,'https://www.consultant.ru/document/cons_doc_LAW_61763/baabe5b69a3c031bfb8d485891bf8077d6809a94/'),
 (80::bigint,'https://www.consultant.ru/document/cons_doc_LAW_61763/baabe5b69a3c031bfb8d485891bf8077d6809a94/'),
 (81::bigint,'https://www.consultant.ru/document/cons_doc_LAW_61763/baabe5b69a3c031bfb8d485891bf8077d6809a94/'),
 (82::bigint,'https://www.consultant.ru/document/cons_doc_LAW_61763/baabe5b69a3c031bfb8d485891bf8077d6809a94/'),
 (83::bigint,'https://www.consultant.ru/document/cons_doc_LAW_61763/baabe5b69a3c031bfb8d485891bf8077d6809a94/'),
 (84::bigint,'https://www.consultant.ru/document/cons_doc_LAW_61763/851f7a5f6d99da11639600f4c686a2949ab23feb/'),
 (85::bigint,'https://www.consultant.ru/document/cons_doc_LAW_61763/851f7a5f6d99da11639600f4c686a2949ab23feb/'),
 (86::bigint,'https://www.consultant.ru/document/cons_doc_LAW_61763/851f7a5f6d99da11639600f4c686a2949ab23feb/'),
 (87::bigint,'https://www.consultant.ru/document/cons_doc_LAW_61763/851f7a5f6d99da11639600f4c686a2949ab23feb/'),
 (88::bigint,'https://www.consultant.ru/document/cons_doc_LAW_61763/851f7a5f6d99da11639600f4c686a2949ab23feb/'),
 (89::bigint,'https://www.consultant.ru/document/cons_doc_LAW_61763/baabe5b69a3c031bfb8d485891bf8077d6809a94/'),
 (90::bigint,'https://www.consultant.ru/document/cons_doc_LAW_61763/baabe5b69a3c031bfb8d485891bf8077d6809a94/')
)
UPDATE public.blitz_questions q
SET source_url=a.source_url,
 legal_review_status='approved',
 legal_reviewed_at=clock_timestamp(),
 legal_reviewed_by=NULL,
 legal_review_note='Сверено 12.10.2026 с действующей редакцией ФЗ № 135-ФЗ; вопрос, варианты и правильный ответ соответствуют указанной норме.'
FROM approved a
WHERE q.id=a.id AND q.verified=true;

DO $verify$
BEGIN
 IF (SELECT count(*) FROM public.blitz_questions WHERE id BETWEEN 76 AND 90 AND legal_review_status='approved')<>15 THEN
  RAISE EXCEPTION 'Legal review batch 76-90 did not approve exactly 15 expected questions';
 END IF;
END $verify$;
