-- Fourth independently checked legal release batch: questions 46-60.
WITH approved(id,source_url) AS (VALUES
 (46::bigint,'https://www.consultant.ru/document/cons_doc_LAW_164841/4f41fe599ce341751e4e34dc50a4b676674c1416/'),
 (47::bigint,'https://www.consultant.ru/document/cons_doc_LAW_164841/4f41fe599ce341751e4e34dc50a4b676674c1416/'),
 (48::bigint,'https://www.consultant.ru/document/cons_doc_LAW_164841/fe7140d7cfc6c641ae322fe648d99702d8b2a8f1/'),
 (49::bigint,'https://www.consultant.ru/document/cons_doc_LAW_164841/fe7140d7cfc6c641ae322fe648d99702d8b2a8f1/'),
 (50::bigint,'https://www.consultant.ru/document/cons_doc_LAW_103023/1ad52ab9177bbc53835519b62dbd061ddcc96223/'),
 (51::bigint,'https://www.consultant.ru/document/cons_doc_LAW_103023/1ad52ab9177bbc53835519b62dbd061ddcc96223/'),
 (52::bigint,'https://www.consultant.ru/document/cons_doc_LAW_103023/1ad52ab9177bbc53835519b62dbd061ddcc96223/'),
 (53::bigint,'https://www.consultant.ru/document/cons_doc_LAW_103023/a2588b2a1374c05e0939bb4df8e54fc0dfd6e000/'),
 (54::bigint,'https://www.consultant.ru/document/cons_doc_LAW_103023/a2588b2a1374c05e0939bb4df8e54fc0dfd6e000/'),
 (55::bigint,'https://www.consultant.ru/document/cons_doc_LAW_59999/23fb391f3632e3f68a11e40c5a7711f3513cc674/'),
 (56::bigint,'https://www.consultant.ru/document/cons_doc_LAW_59999/23fb391f3632e3f68a11e40c5a7711f3513cc674/'),
 (57::bigint,'https://www.consultant.ru/document/cons_doc_LAW_59999/23fb391f3632e3f68a11e40c5a7711f3513cc674/'),
 (58::bigint,'https://www.consultant.ru/document/cons_doc_LAW_59999/2c75005c904788f7ff378d62d74258d77678b387/'),
 (59::bigint,'https://www.consultant.ru/document/cons_doc_LAW_19702/055a71948dbf2a4fc2478437cd89cd864ee8e6e5/'),
 (60::bigint,'https://www.consultant.ru/document/cons_doc_LAW_19702/055a71948dbf2a4fc2478437cd89cd864ee8e6e5/')
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
 IF (SELECT count(*) FROM public.blitz_questions WHERE id BETWEEN 46 AND 60 AND legal_review_status='approved')<>15 THEN
  RAISE EXCEPTION 'Legal review batch 46-60 did not approve exactly 15 expected questions';
 END IF;
END $verify$;
