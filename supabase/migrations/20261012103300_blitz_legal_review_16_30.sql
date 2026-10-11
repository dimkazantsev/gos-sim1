-- Second independently checked legal release batch: questions 16-30.
-- Checked 12.10.2026 against current Constitution and FKZ No. 4-FKZ texts.
WITH approved(id,source_url) AS (VALUES
 (16::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/3f8c850abc4dc2ba4207acc563b176d93bdcf5f7/'),
 (17::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/068ddd2c9f869e0c10125fda62b9bb7a608c9a4c/'),
 (18::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/d74c9f6cc78d8ae59cd3ecd974f6e5a690a998c4/'),
 (19::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/0b3885e36003852fe32df6bcfefdcdcb6e7ec85e/'),
 (20::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/4db010c9950baa1d07371f4a0ab352d5a0027d20/'),
 (21::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/4db010c9950baa1d07371f4a0ab352d5a0027d20/'),
 (22::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/d53234a916c89027929f05225dd567d2a8b3d15f/'),
 (23::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/d53234a916c89027929f05225dd567d2a8b3d15f/'),
 (24::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/8f4aa3d43fcd8ccf6cfbf4843536a14ae6f758f2/'),
 (25::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/c07038c724cae52fe849aad193a0eac08bda5f93/'),
 (26::bigint,'https://www.consultant.ru/document/cons_doc_LAW_366950/c77a998811b14def1ab6fc577c40bc0efb3a789e/'),
 (27::bigint,'https://www.consultant.ru/document/cons_doc_LAW_366950/c77a998811b14def1ab6fc577c40bc0efb3a789e/'),
 (28::bigint,'https://www.consultant.ru/document/cons_doc_LAW_366950/a1bca0dec80440197ca29ebcf0a1344c6d61c906/'),
 (29::bigint,'https://www.consultant.ru/document/cons_doc_LAW_366950/a1bca0dec80440197ca29ebcf0a1344c6d61c906/'),
 (30::bigint,'https://www.consultant.ru/document/cons_doc_LAW_366950/6e0710d16ad0b6822dffa58aefee38d5fb93fe18/')
)
UPDATE public.blitz_questions q
SET source_url=a.source_url,
    legal_review_status='approved',
    legal_reviewed_at=clock_timestamp(),
    legal_reviewed_by=NULL,
    legal_review_note='Сверено 12.10.2026 с действующей редакцией указанного НПА; вопрос, варианты и правильный ответ соответствуют норме.'
FROM approved a
WHERE q.id=a.id AND q.verified=true;

DO $verify$
BEGIN
 IF (SELECT count(*) FROM public.blitz_questions WHERE id BETWEEN 16 AND 30 AND legal_review_status='approved')<>15 THEN
  RAISE EXCEPTION 'Legal review batch 16-30 did not approve exactly 15 expected questions';
 END IF;
END $verify$;
