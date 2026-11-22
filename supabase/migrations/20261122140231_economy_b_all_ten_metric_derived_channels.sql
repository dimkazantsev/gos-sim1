-- ГОС.ID · ten metric model B: 7 derived channels, no retroactive balance change.
-- Reuse prior sensitivities; group weights are new model decisions.
CREATE OR REPLACE FUNCTION private.budget_aux_impact(p_game uuid, p_anchor jsonb)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public','private','pg_temp'
AS $aux$
WITH shifted AS (
 SELECT m.metric_key,m.value-coalesce((p_anchor->'aux_metrics'->>m.metric_key)::numeric,m.value) AS delta
 FROM public.state_metrics m WHERE m.game_id=p_game AND m.metric_key IN ('social_stability','security','elite_support','international_standing','social_tension','legitimacy','media_climate')
), groups AS (
 SELECT coalesce(sum(case when metric_key='social_tension' then -delta when metric_key in ('social_stability','security','elite_support','international_standing') then delta else 0 end),0)/5 AS activity_points,
        coalesce(sum(case when metric_key in ('legitimacy','media_climate') then delta else 0 end),0)/2 AS collection_points
 FROM shifted
)
SELECT jsonb_build_object('activity_adjustment',greatest(-.03,least(.03,activity_points*.002)),
 'collection_adjustment',greatest(-.01,least(.01,collection_points*.0005))) FROM groups
$aux$;
REVOKE ALL ON FUNCTION private.budget_aux_impact(uuid,jsonb) FROM PUBLIC,anon,authenticated;
DO $migration$
DECLARE f text;
BEGIN
SELECT pg_get_functiondef('private.ensure_budget_simulator(uuid)'::regprocedure) INTO f;
IF position('''trust'',coalesce((select value from state_metrics where game_id=p_game and metric_key=''public_trust''),50));' in f)=0 THEN RAISE EXCEPTION 'Model B source mismatch: private.ensure_budget_simulator(uuid) step 1'; END IF;
f:=replace(f,'''trust'',coalesce((select value from state_metrics where game_id=p_game and metric_key=''public_trust''),50));','''trust'',coalesce((select value from state_metrics where game_id=p_game and metric_key=''public_trust''),50),
 ''aux_metrics'',(select coalesce(jsonb_object_agg(metric_key,value),''{}''::jsonb)
 from state_metrics where game_id=p_game and metric_key in (''social_stability'',''security'',''elite_support'',''international_standing'',''social_tension'',''legitimacy'',''media_climate'')));');
EXECUTE f;
SELECT pg_get_functiondef('private.budget_forecast_signature(uuid,jsonb)'::regprocedure) INTO f;
IF position('''economy_b_approved_coefficients_v4''' in f)=0 THEN RAISE EXCEPTION 'Model B source mismatch: private.budget_forecast_signature(uuid,jsonb) step 1'; END IF;
f:=replace(f,'''economy_b_approved_coefficients_v4''','''economy_b_all_metrics_derived_v1''');
IF position('t.metric_key in (''economy'',''public_trust'',''lawfulness'')' in f)=0 THEN RAISE EXCEPTION 'Model B source mismatch: private.budget_forecast_signature(uuid,jsonb) step 2'; END IF;
f:=replace(f,'t.metric_key in (''economy'',''public_trust'',''lawfulness'')','t.metric_key in (''economy'',''public_trust'',''lawfulness'',''social_stability'',''security'',''elite_support'',''international_standing'',''social_tension'',''legitimacy'',''media_climate'')');
EXECUTE f;
SELECT pg_get_functiondef('private.calculate_budget_simulator(uuid,jsonb)'::regprocedure) INTO f;
IF position('v_collection numeric;' in f)=0 THEN RAISE EXCEPTION 'Model B source mismatch: private.calculate_budget_simulator(uuid,jsonb) step 1'; END IF;
f:=replace(f,'v_collection numeric;','v_collection numeric;v_aux jsonb;v_activity_adj numeric;v_collection_adj numeric;');
IF position('
 fx:=p.fx_rate*' in f)=0 THEN RAISE EXCEPTION 'Model B source mismatch: private.calculate_budget_simulator(uuid,jsonb) step 2'; END IF;
f:=replace(f,'
 fx:=p.fx_rate*','
 v_aux:=private.budget_aux_impact(p_game,a);
 v_activity_adj:=coalesce((v_aux->>''activity_adjustment'')::numeric,0);
 v_collection_adj:=coalesce((v_aux->>''collection_adjustment'')::numeric,0);
 fx:=p.fx_rate*');
IF position('e*.002+t*.001)));' in f)=0 THEN RAISE EXCEPTION 'Model B source mismatch: private.calculate_budget_simulator(uuid,jsonb) step 3'; END IF;
f:=replace(f,'e*.002+t*.001)));','e*.002+t*.001+v_activity_adj)));');
IF position('+t*.0005));' in f)=0 THEN RAISE EXCEPTION 'Model B source mismatch: private.calculate_budget_simulator(uuid,jsonb) step 4'; END IF;
f:=replace(f,'+t*.0005));','+t*.0005+v_collection_adj));');
IF position('''uncertainty'',uncertainty,' in f)=0 THEN RAISE EXCEPTION 'Model B source mismatch: private.calculate_budget_simulator(uuid,jsonb) step 5'; END IF;
f:=replace(f,'''uncertainty'',uncertainty,','''uncertainty'',uncertainty,''model_b_additional_channels'',v_aux,');
EXECUTE f;
SELECT pg_get_functiondef('private.reconcile_budget_driver_trigger()'::regprocedure) INTO f;
IF position('(''lawfulness'',''economy'',''public_trust'')' in f)=0 THEN RAISE EXCEPTION 'Model B source mismatch: private.reconcile_budget_driver_trigger() step 1'; END IF;
f:=replace(f,'(''lawfulness'',''economy'',''public_trust'')','(''lawfulness'',''economy'',''public_trust'',''social_stability'',''security'',''elite_support'',''international_standing'',''social_tension'',''legitimacy'',''media_climate'')');
EXECUTE f;
SELECT pg_get_functiondef('public.get_fiscal_context(uuid)'::regprocedure) INTO f;
IF position('''policy'',to_jsonb(p)' in f)=0 THEN RAISE EXCEPTION 'Model B source mismatch: public.get_fiscal_context(uuid) step 1'; END IF;
f:=replace(f,'''policy'',to_jsonb(p)','''policy'',to_jsonb(p)||jsonb_build_object(''budget_aux_anchor'',coalesce((select s.anchor->''aux_metrics'' from budget_simulator_state s where s.game_id=p_game_id),''{}''::jsonb))');
EXECUTE f;
END
$migration$;
UPDATE public.budget_simulator_state s
SET anchor=jsonb_set(s.anchor,'{aux_metrics}',
 (SELECT coalesce(jsonb_object_agg(m.metric_key,m.value),'{}'::jsonb)
  FROM public.state_metrics m WHERE m.game_id=s.game_id AND m.metric_key IN ('social_stability','security','elite_support','international_standing','social_tension','legitimacy','media_climate')
 ),true)
WHERE NOT (s.anchor ? 'aux_metrics');
DROP TRIGGER IF EXISTS sync_budget_after_driver_change ON public.state_metrics;
CREATE CONSTRAINT TRIGGER sync_budget_after_driver_change AFTER UPDATE OF value
 ON public.state_metrics DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
 WHEN (NEW.metric_key IN ('lawfulness','economy','public_trust','social_stability','security','elite_support','international_standing','social_tension','legitimacy','media_climate') AND NEW.value IS DISTINCT FROM OLD.value)
 EXECUTE FUNCTION private.reconcile_budget_driver_trigger();