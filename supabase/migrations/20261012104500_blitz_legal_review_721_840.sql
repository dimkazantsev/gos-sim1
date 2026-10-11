-- Correct constitutional article metadata discovered during independent legal audit.
WITH fixes(id,article,source_url) AS (VALUES
 (805::bigint,'статья 95','https://www.consultant.ru/document/cons_doc_LAW_28399/a966cb7bf74cfc516528e2d2b8b56ae756147013/'),
 (806::bigint,'статья 97','https://www.consultant.ru/document/cons_doc_LAW_28399/b609d63d916e795b53c1e27dc4df3ff8d994a0b9/'),
 (807::bigint,'статья 97','https://www.consult.ru/document/cons_doc_LAW_28399/b609d63d916e795b53c1e27dc4df3ff8d994a0b9/'),
 (808::bigint,'статья 99','https://www.consultant.ru/document/cons_doc_LAW_28399/4777b3ea56f0dd9ddfe8686104aa20cb400b7bdb/'),
 (809::bigint,'статья 99','https://www.consultant.ru/document/cons_doc_LAW_28399/4777b3ea56f0dd9ddfe8686104aa20cb400b7bdb/'),
 (810::bigint,'статья 99','https://www.consultant.ru/document/cons_doc_LAW_28399/4777b3ea56f0dd9ddfe8686104aa20cb400b7bdb/'),
 (813::bigint,'статья 100','https://www.consultant.ru/document/cons_doc_LAW_28399/c29eea3947a621f8f8266c9506cf256ef103eb41/')
)
UPDATE public.blitz_questions q SET article=f.article,source_url=f.source_url,
 explanation=q.explanation||' Реквизиты статьи уточнены при юридической проверке 12.10.2026.'
FROM fixes f WHERE q.id=f.id;

-- Fourteenth independently checked legal release batch: questions 721-840.
UPDATE public.blitz_questions
SET legal_review_status='approved',
 legal_reviewed_at=clock_timestamp(),
 legal_reviewed_by=NULL,
 legal_review_note='Сверено 12.10.2026 с действующей редакцией указанного НПА; реквизиты спорных конституционных карточек исправлены до допуска.'
WHERE id BETWEEN 721 AND 840 AND verified=true;

DO $verify$ BEGIN
 IF (SELECT count(*) FROM public.blitz_questions WHERE id BETWEEN 721 AND 840 AND legal_review_status='approved')<>120 THEN
  RAISE EXCEPTION 'Legal review batch 721-840 did not approve exactly 120 expected questions';
 END IF;
 IF EXISTS(SELECT 1 FROM public.blitz_questions WHERE id=805 AND article<>'статья 95') OR
    EXISTS(SELECT 1 FROM public.blitz_questions WHERE id IN(806,807) AND article<>'статья 97') OR
    EXISTS(SELECT 1 FROM public.blitz_questions WHERE id BETWEEN 808 AND 810 AND article<>'статья 99') OR
    EXISTS(SELECT 1 FROM public.blitz_questions WHERE id=813 AND article<>'статья 100') THEN
  RAISE EXCEPTION 'Constitution metadata correction failed';
 END IF;
END $verify$;