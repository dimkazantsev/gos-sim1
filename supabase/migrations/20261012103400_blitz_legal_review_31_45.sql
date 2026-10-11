-- Third independently checked legal release batch: questions 31-45.
WITH approved(id,source_url) AS (VALUES
 (31::bigint,'https://www.consultant.ru/document/cons_doc_LAW_366950/6e0710d16ad0b6822dffa58aefee38d5fb93fe18/'),
 (32::bigint,'https://www.consultant.ru/document/cons_doc_LAW_366950/6e0710d16ad0b6822dffa58aefee38d5fb93fe18/'),
 (33::bigint,'https://www.consultant.ru/document/cons_doc_LAW_366950/1476b5ba852007ccfa5e05820ccda1da994efb39/'),
 (34::bigint,'https://www.consultant.ru/document/cons_doc_LAW_366950/1476b5ba852007ccfa5e05820ccda1da994efb39/'),
 (35::bigint,'https://www.consultant.ru/document/cons_doc_LAW_366950/1476b5ba852007ccfa5e05820ccda1da994efb39/'),
 (36::bigint,'https://www.consultant.ru/document/cons_doc_LAW_366950/ac08bf2201b09f39f39301debc5a3a2ad2c64e96/'),
 (37::bigint,'https://www.consultant.ru/document/cons_doc_LAW_366950/2eb8b65c2bdc789afebbb32e74beac72539d9a88/'),
 (38::bigint,'https://www.consultant.ru/document/cons_doc_LAW_404070/a81544525cc9436f1e9792fd3925893d21115485/'),
 (39::bigint,'https://www.consultant.ru/document/cons_doc_LAW_404070/b1cb0c1385c89e2396c3f614f4158981032a000e/'),
 (40::bigint,'https://www.consultant.ru/document/cons_doc_LAW_404070/dd1341b06a7d5aff370204a361fa7a537de31f00/'),
 (41::bigint,'https://www.consultant.ru/document/cons_doc_LAW_404070/dd1341b06a7d5aff370204a361fa7a537de31f00/'),
 (42::bigint,'https://www.consultant.ru/document/cons_doc_LAW_164841/4f41fe599ce341751e4e34dc50a4b676674c1416/'),
 (43::bigint,'https://www.consultant.ru/document/cons_doc_LAW_164841/4f41fe599ce341751e4e34dc50a4b676674c1416/'),
 (44::bigint,'https://www.consultant.ru/document/cons_doc_LAW_164841/4f41fe599ce341751e4e34dc50a4b676674c1416/'),
 (45::bigint,'https://www.consultant.ru/document/cons_doc_LAW_164841/4f41fe599ce341751e4e34dc50a4b676674c1416/')
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
 IF (SELECT count(*) FROM public.blitz_questions WHERE id BETWEEN 31 AND 45 AND legal_review_status='approved')<>15 THEN
  RAISE EXCEPTION 'Legal review batch 31-45 did not approve exactly 15 expected questions';
 END IF;
END $verify$;
