-- Read-only audit of the original 330-choice bank; run as a trusted database maintainer.
WITH c AS (
 SELECT e.game_id,e.id,e.case_key,e.effect_plan->'options' AS opts
 FROM public.event_cases e
 WHERE jsonb_typeof(e.effect_plan->'options')='array'
), o AS (
 SELECT c.game_id,c.id,c.case_key,opt
 FROM c CROSS JOIN LATERAL jsonb_array_elements(c.opts) opt
), cases AS (
 SELECT game_id,count(*) AS total_cases FROM c GROUP BY game_id
)
SELECT o.game_id,max(cases.total_cases) AS cases,count(*) AS options,
 count(*) FILTER (WHERE opt ? 'trust' AND opt ? 'lawful') AS annotated_options,
 count(*) FILTER (WHERE jsonb_typeof(opt->'fiscal_effect')='object') AS direct_fiscal_options,
 count(DISTINCT o.id) FILTER (WHERE jsonb_typeof(opt->'fiscal_effect')='object') AS direct_fiscal_cases,
 count(*) FILTER (WHERE jsonb_typeof(opt->'fiscal_effect')='object' AND (opt->'fiscal_effect')='{}'::jsonb) AS empty_effects
FROM o JOIN cases ON cases.game_id=o.game_id GROUP BY o.game_id
HAVING max(cases.total_cases)=330;
