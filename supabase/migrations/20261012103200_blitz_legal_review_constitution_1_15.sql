-- First independently checked legal release batch: Constitution questions 1-15.
-- Checked 12.10.2026 against the current Constitution text in ConsultantPlus.
WITH approved(id,source_url) AS (VALUES
 (1::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/249eba46b69e162f87771713b6e37fb0780f2c40/'),
 (2::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/5fc039bb7454f1af7eba9238d9b35574d81dd447/'),
 (3::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/ec531d2938f351bcb3a9b2f1b50a6f119eac231a/'),
 (4::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/5b9338a7944b7701fbe63f48c943e8175be16462/'),
 (5::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/3655bfcee47bf17d80f9ddbf47d99b3ab4139fde/'),
 (6::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/54dd4e1f61e0b8fa47bff695f0c08b192a95f7a3/'),
 (7::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/6e9322b9a111e965ab5650f7f01bf0039d6a29c6/'),
 (8::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/a4d26fe6022253f9f9e396e9ca6f63c80946702f/'),
 (9::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/c6952b5a450ecbd400a69c936207692e2af4c14d/'),
 (10::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/67433a12b43ee077f730388b5f6edd346d7a9902/'),
 (11::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/67433a12b43ee077f730388b5f6edd346d7a9902/'),
 (12::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/b1cc9eda7877c41dda0c988cbd0c10ba155c9166/'),
 (13::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/a966cb7bf74cfc516528e2d2b8b56ae756147013/'),
 (14::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/a966cb7bf74cfc516528e2d2b8b56ae756147013/'),
 (15::bigint,'https://www.consultant.ru/document/cons_doc_LAW_28399/61e68127368c3047081b302a235c939f5aa26805/')
)
UPDATE public.blitz_questions q
SET source_url=a.source_url,
    legal_review_status='approved',
    legal_reviewed_at=clock_timestamp(),
    legal_reviewed_by=NULL,
    legal_review_note='Сверено 12.10.2026 с действующей Конституцией РФ; вопрос, варианты и правильный ответ соответствуют указанной статье.'
FROM approved a
WHERE q.id=a.id
  AND q.verified=true
  AND q.legal_act='Конституция Российской Федерации';

DO $verify$
BEGIN
 IF (SELECT count(*) FROM public.blitz_questions WHERE id BETWEEN 1 AND 15 AND legal_review_status='approved')<>15 THEN
  RAISE EXCEPTION 'Constitution legal review batch did not approve exactly 15 expected questions';
 END IF;
END $verify$;
