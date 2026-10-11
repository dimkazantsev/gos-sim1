-- Eighth independently checked legal release batch: questions 106-120.
WITH approved(id,source_url) AS (VALUES
 (106::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/4d0c771f1574596b2546829d3c6c524c56ebf40e/'),
 (107::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/d91fc17db4e2a338f5d23f6e14c724a338483baa/'),
 (108::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/d91fc17db4e2a338f5d23f6e14c724a338483baa/'),
 (109::bigint,'https://www.consultant.ru/document/cons_doc_LAW_19671/ab54b1f6e016638e006428e90971b05636b17cbf/'),
 (110::bigint,'https://www.consultant.ru/document/cons_doc_LAW_19671/ab54b1f6e016638e006428e90971b05636b17cbf/'),
 (111::bigint,'https://www.consultant.ru/document/cons_doc_LAW_19671/ab54b1f6e016638e006428e90971b05636b17cbf/'),
 (112::bigint,'https://www.consultant.ru/document/cons_doc_LAW_19671/ab54b1f6e016638e006428e90971b05636b17cbf/'),
 (113::bigint,'https://www.consultant.ru/document/cons_doc_LAW_19671/ab54b1f6e016638e006428e90971b05636b17cbf/'),
 (114::bigint,'https://www.consultant.ru/document/cons_doc_LAW_19671/ab54b1f6e016638e006428e90971b05636b17cbf/'),
 (115::bigint,'https://www.consultant.ru/document/cons_doc_LAW_19671/ab54b1f6e016638e006428e90971b05636b17cbf/'),
 (116::bigint,'https://www.consultant.ru/document/cons_doc_LAW_19671/ab54b1f6e016638e006428e90971b05636b17cbf/'),
 (117::bigint,'https://www.consultant.ru/document/cons_doc_LAW_19671/ab54b1f6e016638e006428e90971b05636b17cbf/'),
 (118::bigint,'https://www.consultant.ru/document/cons_doc_LAW_19671/ab54b1f6e016638e006428e90971b05636b17cbf/'),
 (119::bigint,'https://www.consultant.ru/document/cons_doc_LAW_19671/27c48775695f5049e317dfe269ede10c3394b4ae/'),
 (120::bigint,'https://www.consultant.ru/document/cons_doc_LAW_19671/27c48775695f5049e317dfe269ede10c3394b4ae/')
)
UPDATE public.blitz_questions q
SET source_url=a.source_url,
 legal_review_status='approved',
 legal_reviewed_at=clock_timestamp(),
 legal_reviewed_by=NULL,
 legal_review_note='Сверено 12.10.2026 с действующей редакцией указанного НПА; вопрос, варианты и правильный ответ соответствуют норме.'
FROM approved a
WHERE q.id=a.id AND q.verified=true;
DO $verify$ BEGIN
 IF (SELECT count(*) FROM public.blitz_questions WHERE id BETWEEN 106 AND 120 AND legal_review_status='approved')<>15 THEN
  RAISE EXCEPTION 'Legal review batch 106-120 did not approve exactly 15 expected questions';
 END IF;
END $verify$;