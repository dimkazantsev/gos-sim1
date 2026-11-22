-- Shorten the per-game budget-cache input signature without changing budget formulas.
-- Only federal calculation inputs are included from regions/rates/metrics:
-- regions: enterprises and activity multiplier; rates: national VAT/profit;
-- metrics: economy, trust, lawfulness value. Other tables remain untouched.
-- Existing checks for transfers, published state programs, and input draft stay.
-- First request refreshes the cached signature once; all subsequent reads reuse it.
-- No new tables, client requests, subscriptions, timers or numeric coefficients.
CREATE OR REPLACE FUNCTION private.budget_forecast_signature(p_game uuid, p_draft jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
 SELECT md5(jsonb_build_array(
  'economy_b_approved_coefficients_v4',
  p_draft,
  (select data from private.budget_baseline where year=2026),
  (select status from public.games where id=p_game),
  (select to_jsonb(t) from public.budget_simulator_state t where t.game_id=p_game),
  (select to_jsonb(t) from public.game_fiscal_policy t where t.game_id=p_game),
  (select coalesce(jsonb_agg(jsonb_build_array(t.region_code,t.enterprises,t.activity_multiplier) order by t.region_code),'[]'::jsonb) from public.game_fiscal_regions t where t.game_id=p_game),
  (select coalesce(jsonb_agg(jsonb_build_array(t.tax_key,t.rate) order by t.tax_key),'[]'::jsonb) from public.game_fiscal_rates t where t.game_id=p_game and t.region_code='00' and t.tax_key in ('vat','profit')),
  (select coalesce(jsonb_agg(jsonb_build_array(t.metric_key,t.value) order by t.metric_key),'[]'::jsonb) from public.state_metrics t where t.game_id=p_game and t.metric_key in ('economy','public_trust','lawfulness')),
  (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.budget_transfer_requests t where t.game_id=p_game),
  (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.state_programs t where t.game_id=p_game),
  (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.state_program_goals t where t.game_id=p_game),
  (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.state_program_components t where t.game_id=p_game),
  (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.state_program_expenses t where t.game_id=p_game),
  (select coalesce(jsonb_agg(to_jsonb(t) order by t.program_id,t.budget_year),'[]'::jsonb) from public.state_program_budget_commitments t where t.game_id=p_game),
  (select coalesce(jsonb_agg(jsonb_build_array(t.id,t.title) order by t.id),'[]'::jsonb) from public.event_cases t where t.game_id=p_game and exists(select 1 from public.budget_transfer_requests r where r.game_id=p_game and r.event_case_id=t.id)),
  (select coalesce(jsonb_agg(jsonb_build_array(t.code,t.name) order by t.code),'[]'::jsonb) from public.fiscal_region_reference t where exists(select 1 from public.budget_transfer_requests r where r.game_id=p_game and r.region_code=t.code))
 )::text);
$function$
;
