-- Preserve exact budget rounding for expenditure-sensitive inflation.
-- Avoid tiny nonzero effects when only the inflation cost multiplier changed.
CREATE OR REPLACE FUNCTION private.budget_discretionary_expenditure(p_calculation jsonb)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $body$
 SELECT coalesce(sum(
  coalesce((item->>'base_amount')::numeric,0)
  -round(greatest(0,coalesce((item->>'baseline')::numeric,0)
     *coalesce((p_calculation->>'cost')::numeric,1)),2)
  +coalesce((item->>'items_amount')::numeric,0)
 ),0)
 FROM jsonb_array_elements(coalesce(p_calculation->'expense_lines','[]'::jsonb)) item
 WHERE item->>'key'<>'13'
$body$;
REVOKE ALL ON FUNCTION private.budget_discretionary_expenditure(jsonb) FROM PUBLIC,anon,authenticated;