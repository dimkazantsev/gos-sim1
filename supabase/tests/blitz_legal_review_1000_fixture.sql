-- Reset only the disposable CI database after transactional tests.
TRUNCATE public.blitz_assignments, public.blitz_questions CASCADE;
INSERT INTO public.blitz_questions(
 id,question,topic,options,correct_index,legal_act,article,source_url,explanation,verified
)
SELECT i,
       'CI legal review question '||i,
       'CI topic',
       '["Да","Нет"]'::jsonb,
       0,
       CASE WHEN i BETWEEN 1 AND 15 THEN 'Конституция Российской Федерации' ELSE 'CI legal act' END,
       'статья 1',
       'https://example.invalid/document',
       'Synthetic row used only to verify legal-review migration coverage.',
       true
FROM generate_series(1,1000) AS i;
