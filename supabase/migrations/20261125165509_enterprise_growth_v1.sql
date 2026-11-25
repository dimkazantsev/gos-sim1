-- ГОС.ID: dynamics of enterprise count, once per fiscal period.
-- All rates are approved educational coefficients, percentage points per input point.
CREATE TABLE IF NOT EXISTS private.enterprise_growth_reference (
 game_id uuid PRIMARY KEY REFERENCES public.games(id) ON DELETE CASCADE,
 inputs jsonb NOT NULL,
 last_period text NOT NULL,
 raw_pct numeric NOT NULL,
 applied_pct numeric NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE private.enterprise_growth_reference ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.enterprise_growth_reference FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.enterprise_growth_raw_v1(current_values jsonb, previous_values jsonb)
RETURNS numeric LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO '' AS $f$
 SELECT coalesce(sum(c.coefficient*(coalesce((current_values->>c.key)::numeric,(previous_values->>c.key)::numeric,0)-coalesce((previous_values->>c.key)::numeric,(current_values->>c.key)::numeric,0))),0)
 FROM (VALUES ('economy',.5),('key_rate',-.4),('inflation',-.3),('activity_pct',.3),('profit_rate',-.5),
 ('social_stability',.3),('security',.3),('lawfulness',.2),('international_standing',.2),('social_tension',-.3)) c(key,coefficient)
$f$;
REVOKE ALL ON FUNCTION private.enterprise_growth_raw_v1(jsonb,jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.enterprise_growth_inputs_v1(p_game uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public','private','pg_temp' AS $f$
DECLARE p public.game_fiscal_policy%ROWTYPE; a jsonb; m jsonb; e numeric;t numeric;fx numeric;aux numeric;auto numeric;activity numeric;profit numeric;v2 boolean;
BEGIN
 SELECT * INTO p FROM public.game_fiscal_policy WHERE game_id=p_game;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT anchor INTO a FROM public.budget_simulator_state WHERE game_id=p_game;
 a:=coalesce(a,'{}'::jsonb);v2:=a->>'economic_model_version'='2';
 SELECT coalesce(jsonb_object_agg(metric_key,value),'{}'::jsonb) INTO m FROM public.state_metrics WHERE game_id=p_game AND metric_key IN ('economy','public_trust','social_stability','security','lawfulness','international_standing','social_tension','elite_support');
 e:=coalesce((m->>'economy')::numeric,p.baseline_economy)-p.baseline_economy;
 t:=coalesce((m->>'public_trust')::numeric,p.baseline_trust)-p.baseline_trust;
 fx:=p.fx_rate*greatest(.75,least(1.3,1-e*.001-t*.001-(p.key_rate-16)*.0015));
 IF v2 THEN
  aux:=greatest(-.25,least(.25,
    .004*coalesce((m->>'social_stability')::numeric-(a->'aux_metrics'->>'social_stability')::numeric,0)+
    .004*coalesce((m->>'security')::numeric-(a->'aux_metrics'->>'security')::numeric,0)+
    .002*coalesce((m->>'elite_support')::numeric-(a->'aux_metrics'->>'elite_support')::numeric,0)+
    .004*coalesce((m->>'international_standing')::numeric-(a->'aux_metrics'->>'international_standing')::numeric,0)))
    -greatest(0,least(.20,(coalesce((m->>'social_tension')::numeric,60)-60)*.005));
  auto:=greatest(.2,least(2,1-(p.key_rate-16)*.015+e*.010+t*.005-(fx/80-1)*.06+aux));
 ELSE
  aux:=coalesce((private.budget_aux_impact(p_game,a)->>'activity_adjustment')::numeric,0);
  auto:=greatest(.65,least(1.4,1-(p.key_rate-16)*.007+e*.002+t*.001-(fx/80-1)*.06+aux));
 END IF;
 activity:=CASE WHEN p.activity_override IS NULL THEN auto ELSE greatest(0,least(10,p.activity_override/100*auto/CASE WHEN p.activity_reference>0 THEN p.activity_reference ELSE auto END)) END;
 SELECT coalesce((SELECT rate FROM public.game_fiscal_rates WHERE game_id=p_game AND region_code='00' AND tax_key='profit'),25) INTO profit;
 RETURN m||jsonb_build_object('key_rate',p.key_rate,'inflation',p.inflation,'activity_pct',activity*100,'profit_rate',profit);
END
$f$;
REVOKE ALL ON FUNCTION private.enterprise_growth_inputs_v1(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.advance_enterprise_growth_v1(p_game uuid,p_stage integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','private','pg_temp' AS $f$
DECLARE c jsonb;b jsonb;a jsonb;v_source text;v_last text;v_raw numeric;v_pct numeric;v_changed integer:=0;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.games WHERE id=p_game AND status NOT IN ('finished','archived')) THEN RETURN 0; END IF;
 IF p_stage IS NOT NULL AND NOT EXISTS(SELECT 1 FROM private.fiscal_periods WHERE game_id=p_game AND stage_no=p_stage) THEN RETURN 0; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('gos-stage-social:'||p_game::text,0));
 v_source:=CASE WHEN p_stage IS NULL THEN 'enterprises-v1:initial' ELSE 'enterprises-v1:stage:'||p_stage::text END;
 SELECT inputs,last_period INTO b,v_last FROM private.enterprise_growth_reference WHERE game_id=p_game FOR UPDATE;
 IF b IS NOT NULL AND (p_stage IS NULL OR v_last=v_source) THEN RETURN 0; END IF;
 -- Existing stage trigger prevents a historic/reopened stage from running again.
 IF p_stage IS NOT NULL AND EXISTS(SELECT 1 FROM public.fiscal_change_ledger WHERE game_id=p_game AND source_type='period' AND source_id=v_source) THEN RETURN 0; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.budget_simulator_state WHERE game_id=p_game) THEN PERFORM private.ensure_budget_simulator(p_game); END IF;
 c:=private.enterprise_growth_inputs_v1(p_game);
 IF c IS NULL THEN RETURN 0; END IF;
 IF b IS NULL THEN
  SELECT anchor INTO a FROM public.budget_simulator_state WHERE game_id=p_game;
  SELECT coalesce(jsonb_object_agg(metric_key,value),'{}'::jsonb) INTO b FROM (
    SELECT DISTINCT ON(metric_key) metric_key,value FROM public.state_metric_history
    WHERE game_id=p_game AND source_type='baseline' AND metric_key IN ('economy','social_stability','security','lawfulness','international_standing','social_tension')
    ORDER BY metric_key,id
  ) initial;
  b:=c||b||jsonb_build_object('key_rate',coalesce((a->>'key_rate')::numeric,16),'inflation',coalesce((a->>'inflation')::numeric,6),'activity_pct',100*coalesce((a->>'regional_activity_reference')::numeric,1),'profit_rate',25);
 END IF;
 v_raw:=private.enterprise_growth_raw_v1(c,b);
 v_pct:=greatest(-10,least(10,v_raw));
 IF v_pct<>0 THEN
  WITH old_rows AS MATERIALIZED (
   SELECT r.game_id,r.region_code,r.enterprises,to_jsonb(r) before_values,
    least(10000000,greatest(0,round(r.enterprises*(1+v_pct/100))))::integer AS next_count
   FROM public.game_fiscal_regions r WHERE r.game_id=p_game ORDER BY r.region_code FOR UPDATE
  ), changed AS (
   UPDATE public.game_fiscal_regions r SET enterprises=o.next_count,updated_at=clock_timestamp()
   FROM old_rows o WHERE r.game_id=o.game_id AND r.region_code=o.region_code AND r.enterprises<>o.next_count
   RETURNING r.region_code,o.before_values,to_jsonb(r) after_values
  )
  INSERT INTO public.fiscal_change_ledger(game_id,region_code,source_type,source_id,note,before_values,after_values)
  SELECT p_game,region_code,'period',v_source,'Изменение числа предприятий: '||round(v_pct,4)::text||'% · '||CASE WHEN p_stage IS NULL THEN 'однократный начальный пересчёт' ELSE 'завершение этапа '||p_stage::text END,
   before_values,after_values||jsonb_build_object('enterprise_growth_raw_pct',v_raw,'enterprise_growth_applied_pct',v_pct)
  FROM changed;
  GET DIAGNOSTICS v_changed=ROW_COUNT;
 END IF;
 INSERT INTO private.enterprise_growth_reference(game_id,inputs,last_period,raw_pct,applied_pct)
 VALUES(p_game,c,v_source,v_raw,v_pct)
 ON CONFLICT(game_id) DO UPDATE SET inputs=excluded.inputs,last_period=excluded.last_period,raw_pct=excluded.raw_pct,applied_pct=excluded.applied_pct,updated_at=clock_timestamp();
 IF v_changed>0 THEN PERFORM private.reconcile_budget_driver_once(p_game); END IF;
 RETURN v_changed;
END
$f$;
REVOKE ALL ON FUNCTION private.advance_enterprise_growth_v1(uuid,integer) FROM PUBLIC,anon,authenticated;

-- Preserve the existing stage fiscal and tension work and run the enterprise model only after it.
CREATE OR REPLACE FUNCTION private.fiscal_closed_stage_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','private','pg_temp' AS $f$
DECLARE v_period_exists boolean;
BEGIN
 IF NEW.status='completed' AND OLD.status IS DISTINCT FROM NEW.status THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('gos-stage-social:'||NEW.game_id::text,0));
  SELECT EXISTS(SELECT 1 FROM private.fiscal_periods WHERE game_id=NEW.game_id AND stage_no=NEW.stage_no) INTO v_period_exists;
  PERFORM private.advance_fiscal_period(NEW.game_id,NEW.stage_no);
  IF NOT v_period_exists THEN
   PERFORM private.settle_stage_social_tension(NEW.game_id,NEW.stage_no,NEW.opened_at,coalesce(NEW.completed_at,clock_timestamp()));
   PERFORM private.advance_enterprise_growth_v1(NEW.game_id,NEW.stage_no);
  END IF;
 END IF;
 RETURN NEW;
END
$f$;

-- Fail transaction if any of the approved coefficients or privileges differ.
DO $test$
DECLARE kv record;
BEGIN
 FOR kv IN SELECT * FROM (VALUES ('economy',.5),('key_rate',-.4),('inflation',-.3),('activity_pct',.3),('profit_rate',-.5),('social_stability',.3),('security',.3),('lawfulness',.2),('international_standing',.2),('social_tension',-.3)) v(key,coefficient)
 LOOP
  IF private.enterprise_growth_raw_v1(jsonb_build_object(kv.key,1),jsonb_build_object(kv.key,0)) IS DISTINCT FROM kv.coefficient THEN RAISE EXCEPTION 'Enterprise coefficient failed: %',kv.key;END IF;
 END LOOP;
 IF private.enterprise_growth_raw_v1('{"economy":16,"inflation":6}'::jsonb,'{"economy":16,"inflation":6}'::jsonb)<>0 THEN RAISE EXCEPTION 'Nonzero neutral scenario';END IF;
 IF has_function_privilege('authenticated','private.advance_enterprise_growth_v1(uuid,integer)','EXECUTE') OR has_function_privilege('anon','private.advance_enterprise_growth_v1(uuid,integer)','EXECUTE') THEN RAISE EXCEPTION 'Enterprise mutation must be private';END IF;
END
$test$;

-- One authorized, audited recalculation for existing running games only; never replay old stages.
DO $recalculate$
DECLARE g record;n integer;cnt numeric;expected numeric;ref private.enterprise_growth_reference%ROWTYPE;prev_count numeric;v_stage_count integer;
BEGIN
 FOR g IN SELECT id FROM public.games WHERE status='running' AND EXISTS(SELECT 1 FROM public.budget_simulator_state s WHERE s.game_id=games.id) ORDER BY id
 LOOP
  IF EXISTS(SELECT 1 FROM private.enterprise_growth_reference WHERE game_id=g.id) THEN CONTINUE; END IF;
  SELECT sum(enterprises) INTO prev_count FROM public.game_fiscal_regions WHERE game_id=g.id;
  SELECT count(*) INTO v_stage_count FROM private.fiscal_periods WHERE game_id=g.id;
  n:=private.advance_enterprise_growth_v1(g.id,NULL);
  SELECT * INTO STRICT ref FROM private.enterprise_growth_reference WHERE game_id=g.id;
  SELECT sum(enterprises) INTO cnt FROM public.game_fiscal_regions WHERE game_id=g.id;
  SELECT coalesce(sum((after_values->>'enterprises')::numeric-(before_values->>'enterprises')::numeric),0) INTO expected FROM public.fiscal_change_ledger WHERE game_id=g.id AND source_type='period' AND source_id='enterprises-v1:initial';
  IF cnt IS DISTINCT FROM prev_count+expected OR abs(ref.applied_pct)>10 OR n<>(SELECT count(*) FROM public.fiscal_change_ledger WHERE game_id=g.id AND source_type='period' AND source_id='enterprises-v1:initial') THEN RAISE EXCEPTION 'Enterprise reconciliation check failed'; END IF;
  IF private.advance_enterprise_growth_v1(g.id,NULL)<>0 OR cnt IS DISTINCT FROM (SELECT sum(enterprises) FROM public.game_fiscal_regions WHERE game_id=g.id) THEN RAISE EXCEPTION 'Enterprise initial replay detected';END IF;
  IF v_stage_count<>(SELECT count(*) FROM private.fiscal_periods WHERE game_id=g.id) THEN RAISE EXCEPTION 'Historical fiscal periods changed';END IF;
 END LOOP;
END
$recalculate$;
