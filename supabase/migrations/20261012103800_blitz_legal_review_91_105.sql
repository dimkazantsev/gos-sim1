-- Seventh independently checked legal release batch: questions 91-105.
WITH approved(id,source_url) AS (VALUES
 (91::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/7faf10d5db4889ccd421abd45b63fd2b43a3dea7/'),
 (92::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/7faf10d5db4889ccd421abd45b63fd2b43a3dea7/'),
 (93::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/7faf10d5db4889ccd421abd45b63fd2b43a3dea7/'),
 (94::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/7faf10d5db4889ccd421abd45b63fd2b43a3dea7/'),
 (95::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/7faf10d5db4889ccd421abd45b63fd2b43a3dea7/'),
 (96::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/c6e42f15d1b028b04b556f3f9ca32433ae2cc969/'),
 (97::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/c6e42f15d1b028b04b556f3f9ca32433ae2cc969/'),
 (98::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/c6e42f15d1b028b04b556f3f9ca32433ae2cc969/'),
 (99::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/c6e42f15d1b028b04b556f3f9ca32433ae2cc969/'),
 (100::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/cfb954800fba644bd8d1873945545cd9ac92ea34/'),
 (101::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/e6a76ed8e23016c15ac41b93c7cdc8fd1da6997b/'),
 (102::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/e6a76ed8e23016c15ac41b93c7cdc8fd1da6997b/'),
 (103::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/e6a76ed8e23016c15ac41b93c7cdc8fd1da6997b/'),
 (104::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/e6a76ed8e23016c15ac41b93c7cdc8fd1da6997b/'),
 (105::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/4d0c771f1574596b2546829d3c6c524c56ebf40e/')
)
UPDATE public.blitz_questions q
SET source_url=a.source_url,
 legal_review_status='approved',
 legal_reviewed_at=clock_timestamp(),
 legal_reviewed_by=NULL,
 legal_review_note='Сверено 12.10.2026 с действующей Конституцией РФ; вопрос, варианты и правильный ответ соответствуют указанной статье.'
FROM approved a
WHERE q.id=a.id AND q.verified=true;

DO $verify$
BEGIN
 IF (SELECT count(*) FROM public.blitz_questions WHERE id BETWEEN 91 AND 105 AND legal_review_status='approved')<>15 THEN
  RAISE EXCEPTION 'Legal review batch 91-105 did not approve exactly 15 expected questions';
 END IF;
END $verify$;
