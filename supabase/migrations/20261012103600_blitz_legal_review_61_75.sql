-- Fifth independently checked legal release batch: questions 61-75.
WITH approved(id,source_url) AS (VALUES
 (61::bigint,'https://www.consultant.ru/document/cons_doc_LAW_19702/055a71948dbf2a4fc2478437cd89cd864ee8e6e5/'),
 (62::bigint,'https://www.consultant.ru/document/cons_doc_LAW_19702/055a71948dbf2a4fc2478437cd89cd864ee8e6e5/'),
 (63::bigint,'https://www.consultant.ru/document/cons_doc_LAW_19702/055a71948dbf2a4fc2478437cd89cd864ee8e6e5/'),
 (64::bigint,'https://www.consultant.ru/document/cons_doc_LAW_19702/055a71948dbf2a4fc2478437cd89cd864ee8e6e5/'),
 (65::bigint,'https://www.consultant.ru/document/cons_doc_LAW_19702/055a71948dbf2a4fc2478437cd89cd864ee8e6e5/'),
 (66::bigint,'https://www.consultant.ru/document/cons_doc_LAW_19702/055a71948dbf2a4fc2478437cd89cd864ee8e6e5/'),
 (67::bigint,'https://www.consultant.ru/document/cons_doc_LAW_19702/055a71948dbf2a4fc2478437cd89cd864ee8e6e5/'),
 (68::bigint,'https://www.consultant.ru/document/cons_doc_LAW_19702/055a71948dbf2a4fc2478437cd89cd864ee8e6e5/'),
 (69::bigint,'https://www.consultant.ru/document/cons_doc_LAW_19702/055a71948dbf2a4fc2478437cd89cd864ee8e6e5/'),
 (70::bigint,'https://www.consultant.ru/document/cons_doc_LAW_19702/055a71948dbf2a4fc2478437cd89cd864ee8e6e5/'),
 (71::bigint,'https://www.consultant.ru/document/cons_doc_LAW_501319/eb81b30d34d25b572f9b7b164d60c647eda3ee64/'),
 (72::bigint,'https://www.consultant.ru/document/cons_doc_LAW_501319/eb81b30d34d25b572f9b7b164d60c647eda3ee64/'),
 (73::bigint,'https://www.consultant.ru/document/cons_doc_LAW_501319/5ee5abac8367f9203ebdd796caf8f876657f20b8/'),
 (74::bigint,'https://www.consultant.ru/document/cons_doc_LAW_501319/5ee5abac8367f9203ebdd796caf8f876657f20b8/'),
 (75::bigint,'https://www.consultant.ru/document/cons_doc_LAW_501319/724d2a13a1e8150bc5e9245707a9f71b50db9dad/')
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
 IF (SELECT count(*) FROM public.blitz_questions WHERE id BETWEEN 61 AND 75 AND legal_review_status='approved')<>15 THEN
  RAISE EXCEPTION 'Legal review batch 61-75 did not approve exactly 15 expected questions';
 END IF;
END $verify$;
