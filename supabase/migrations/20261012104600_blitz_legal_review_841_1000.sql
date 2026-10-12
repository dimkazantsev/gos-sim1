-- Final independent legal-release batch: questions 841-1000.
-- Grouped article-by-article review performed against current 12.10.2026 editions.
-- Correct direct citations discovered during review before approving the batch.
WITH fixes(id,article,source_url,note) AS (VALUES
 (841::bigint,'статья 112','https://www.consultant.ru/document/cons_doc_LAW_28399/22a68266a5913540792d0e2d4b3186201b2d0f49/','Прямая ссылка на статью 112 уточнена.'),
 (842::bigint,'статья 83, пункт «д.1»; статья 112, часть 2','https://www.consultant.ru/document/cons_doc_LAW_28399/8797c0ff5480db98af51382b6d5800fa84d1c875/','Непосредственное основание назначения министра обороны — пункт «д.1» статьи 83; часть 2 статьи 112 исключает эту категорию из утверждения Государственной Думой.'),
 (843::bigint,'статья 114','https://www.consultant.ru/document/cons_doc_LAW_28399/0b3885e36003852fe32df6bcfefdcdcb6e7ec85e/','Прямая ссылка на статью 114 уточнена.'),
 (844::bigint,'статья 114','https://www.consultant.ru/document/cons_doc_LAW_28399/0b3885e36003852fe32df6bcfefdcdcb6e7ec85e/','Прямая ссылка на статью 114 уточнена.'),
 (845::bigint,'статья 115','https://www.consultant.ru/document/cons_doc_LAW_28399/c2ce44b5dc2c2b00b1f2ea014b5cc21217aad131/','Прямая ссылка на статью 115 уточнена.'),
 (846::bigint,'статья 115','https://www.consultant.ru/document/cons_doc_LAW_28399/c2ce44b5dc2c2b00b1f2ea014b5cc21217aad131/','Прямая ссылка на статью 115 уточнена.'),
 (847::bigint,'статья 116','https://www.consultant.ru/document/cons_doc_LAW_28399/44f3794a1dcc5f225a6f45f72fa76c62b7aca864/','Прямая ссылка на статью 116 уточнена.'),
 (848::bigint,'статья 117','https://www.consultant.ru/document/cons_doc_LAW_28399/863184db4f609c547d33cad5346107a505f5ee32/','Прямая ссылка на статью 117 уточнена.'),
 (849::bigint,'статья 117','https://www.consultant.ru/document/cons_doc_LAW_28399/863184db4f609c547d33cad5346107a505f5ee32/','Прямая ссылка на статью 117 уточнена.'),
 (850::bigint,'статья 117','https://www.consultant.ru/document/cons_doc_LAW_28399/863184db4f609c547d33cad5346107a505f5ee32/','Прямая ссылка на статью 117 уточнена.'),
 (851::bigint,'статья 117','https://www.consultant.ru/document/cons_doc_LAW_28399/863184db4f609c547d33cad5346107a505f5ee32/','Прямая ссылка на статью 117 уточнена.'),
 (954::bigint,'статья 53','https://www.consultant.ru/document/cons_doc_LAW_19671/b29e24e860227047531cd9675998899d4118471d/','Прямая ссылка на статью 53 НК РФ уточнена.'),
 (955::bigint,'статья 53','https://www.consultant.ru/document/cons_doc_LAW_19671/b29e24e860227047531cd9675998899d4118471d/','Прямая ссылка на статью 53 НК РФ уточнена.'),
 (956::bigint,'статья 56','https://www.consultant.ru/document/cons_doc_LAW_19671/4cada6c7ce0d8a4a287f0eeb6d5c1ed5f4d08045/','Прямая ссылка на статью 56 НК РФ уточнена.'),
 (957::bigint,'статья 56','https://www.consultant.ru/document/cons_doc_LAW_19671/4cada6c7ce0d8a4a287f0eeb6d5c1ed5f4d08045/','Прямая ссылка на статью 56 НК РФ уточнена.')
)
UPDATE public.blitz_questions q
SET article=f.article,
    source_url=f.source_url,
    explanation=q.explanation||' '||f.note
FROM fixes f WHERE q.id=f.id;

UPDATE public.blitz_questions
SET legal_review_status='approved',
    legal_reviewed_at=clock_timestamp(),
    legal_reviewed_by=NULL,
    legal_review_note='Групповая постатейная сверка 12.10.2026 с действующей редакцией указанного НПА; спорные реквизиты исправлены до допуска.'
WHERE id BETWEEN 841 AND 1000 AND verified=true;

DO $verify$
BEGIN
 IF (SELECT count(*) FROM public.blitz_questions WHERE id BETWEEN 841 AND 1000 AND legal_review_status='approved')<>160 THEN
  RAISE EXCEPTION 'Legal review batch 841-1000 did not approve exactly 160 expected questions';
 END IF;
 IF EXISTS(SELECT 1 FROM public.blitz_questions WHERE id BETWEEN 841 AND 1000 AND verified IS DISTINCT FROM true) THEN
  RAISE EXCEPTION 'Unverified question was included in final legal batch';
 END IF;
 IF NOT EXISTS(
   SELECT 1 FROM public.blitz_questions
   WHERE id=842 AND article='статья 83, пункт «д.1»; статья 112, часть 2'
     AND source_url LIKE '%/8797c0ff5480db98af51382b6d5800fa84d1c875/%'
 ) THEN
  RAISE EXCEPTION 'Question 842 constitutional citation correction failed';
 END IF;
 IF EXISTS(
   SELECT 1 FROM public.blitz_questions
   WHERE id IN (841,842,843,844,845,846,847,848,849,850,851,954,955,956,957)
     AND source_url ~ '/cons_doc_LAW_[0-9]+/$'
 ) THEN
  RAISE EXCEPTION 'Reviewed high-risk questions still use document-root URLs';
 END IF;
END $verify$;
