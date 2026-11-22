-- ГОС.ID: No new client RPC/queries, subscriptions, timers or tables.
-- Apply macro contributions inside the existing fiscal ledger trigger.
-- Apply the approved weighted legitimacy derivative on already recorded metric changes.
-- New tuning (explicit modelling assumptions):
-- inflation +1 pp => trust -0.10, elite -0.05;
-- key rate +1 pp => trust -0.05, elite -0.05;
-- activity +1 pp => trust +0.08, elite +0.10;
-- oil +1 USD/barrel => elite +0.02.
-- Macro contribution bounded to +/-0.5 pp for each indicator per ledger action.
-- Relative change only: previously published outcomes and initial metrics are immutable.

CREATE OR REPLACE FUNCTION private.apply_societal_metric_deltas(
 p_game uuid,p_trust numeric,p_elite numeric,p_source_type text,p_source_id text,
 p_actor uuid,p_note text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','private','pg_temp'
AS $func$
DECLARE v record;v_id uuid;v_old numeric;v_new numeric;
BEGIN
 IF coalesce(p_trust,0)=0 AND coalesce(p_elite,0)=0 THEN RETURN;END IF;
 -- One indexed UPDATE per changed metric, not SELECT + UPDATE + another SELECT.
 -- Stable order (elite first) matches the existing impact-rule processing order.
 FOR v IN SELECT metric_key,delta FROM
 (VALUES ('elite_support'::text,coalesce(p_elite,0)),
         ('public_trust'::text,coalesce(p_trust,0))) AS x(metric_key,delta)
 ORDER BY metric_key LOOP
  IF v.delta=0 THEN CONTINUE;END IF;
  UPDATE public.state_metrics m
  SET previous_value=m.value,
      value=greatest(coalesce(m.min_value,0),
          least(coalesce(m.max_value,100),m.value+v.delta)),
      updated_at=now()
  WHERE m.game_id=p_game AND m.metric_key=v.metric_key
   AND greatest(coalesce(m.min_value,0),least(coalesce(m.max_value,100),m.value+v.delta)) IS DISTINCT FROM m.value
  RETURNING m.id,m.previous_value,m.value INTO v_id,v_old,v_new;
  IF FOUND THEN
   INSERT INTO public.state_metric_history(game_id,metric_id,metric_key,value,previous_value,delta,
    source_type,source_id,actor_id,note)
   VALUES(p_game,v_id,v.metric_key,v_new,v_old,v_new-v_old,p_source_type,p_source_id,p_actor,p_note);
  END IF;
 END LOOP;
END;
$func$;
REVOKE ALL ON FUNCTION private.apply_societal_metric_deltas(uuid,numeric,numeric,text,text,uuid,text)
 FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.apply_macro_political_effect(
 p_game uuid,p_before jsonb,p_after jsonb,p_source_id text,p_actor uuid,p_note text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','private','pg_temp'
AS $func$
DECLARE d_infl numeric:=0;d_rate numeric:=0;d_oil numeric:=0;d_activity numeric:=0;
 v_trust numeric;v_elite numeric;
BEGIN
 IF p_before IS NULL OR p_after IS NULL THEN RETURN;END IF;
 IF p_before ? 'inflation' AND p_after ? 'inflation' THEN
  d_infl:=coalesce((p_after->>'inflation')::numeric,0)-coalesce((p_before->>'inflation')::numeric,0);
 END IF;
 IF p_before ? 'key_rate' AND p_after ? 'key_rate' THEN
  d_rate:=coalesce((p_after->>'key_rate')::numeric,0)-coalesce((p_before->>'key_rate')::numeric,0);
 END IF;
 IF p_before ? 'oil_price' AND p_after ? 'oil_price' THEN
  d_oil:=coalesce((p_after->>'oil_price')::numeric,0)-coalesce((p_before->>'oil_price')::numeric,0);
 END IF;
 IF p_before ? 'activity_override' AND p_after ? 'activity_override'
    AND jsonb_typeof(p_before->'activity_override')='number'
    AND jsonb_typeof(p_after->'activity_override')='number' THEN
  d_activity:=(p_after->>'activity_override')::numeric-(p_before->>'activity_override')::numeric;
 END IF;
 IF d_infl=0 AND d_rate=0 AND d_oil=0 AND d_activity=0 THEN RETURN;END IF;
 v_trust:=greatest(-0.5,least(0.5,
   round(-0.10*d_infl-0.05*d_rate+0.08*d_activity,5)));
 v_elite:=greatest(-0.5,least(0.5,
   round(-0.05*d_infl-0.05*d_rate+0.10*d_activity+0.02*d_oil,5)));
 PERFORM private.apply_societal_metric_deltas(
 p_game,v_trust,v_elite,'macro_political',coalesce(p_source_id,'macro'),
 p_actor,'Автоматическое влияние инфляции, ставки, деловой активности и цены нефти: '||
 left(coalesce(p_note,'изменение экономических условий'),350));
END;
$func$;
REVOKE ALL ON FUNCTION private.apply_macro_political_effect(uuid,jsonb,jsonb,text,uuid,text)
 FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.derive_legitimacy_from_metric_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','private','pg_temp'
AS $func$
DECLARE v_action text;v_prev_raw numeric:=0;v_raw numeric;v_delta numeric;
 v_id uuid;v_before numeric;v_after numeric;v_part numeric;
BEGIN
 IF NEW.delta=0 THEN RETURN NEW;END IF;
 IF NEW.metric_key='economy' THEN
  -- Economy affects business activity by the EXISTING 0.002 sensitivity:
  -- +1 economy point = +0.2 pp activity. Do not respond to derived activity
  -- from trust or elite support: that would create a feedback cycle.
  v_part:=NEW.delta*0.2;
  PERFORM private.apply_societal_metric_deltas(
    NEW.game_id,
    greatest(-0.5,least(0.5,round(v_part*0.08,5))),
    greatest(-0.5,least(0.5,round(v_part*0.10,5))),
    'business_activity','economy:'||NEW.id::text,NEW.actor_id,
    'Деловая активность: изменение индекса экономики (без обратной связи от доверия/элит)');
  RETURN NEW;
 END IF;
 IF NEW.metric_key NOT IN ('public_trust','elite_support') THEN RETURN NEW;END IF;
 v_part:=NEW.delta*CASE WHEN NEW.metric_key='public_trust' THEN 0.18 ELSE 0.12 END;
 IF v_part=0 THEN RETURN NEW;END IF;
 -- Cap the combined contribution by logical source within a DB transaction,
 -- including a rule that changes trust and elite support separately.
 v_action:=NEW.game_id::text||':'||NEW.source_type||':'||coalesce(NEW.source_id,'history:'||NEW.id::text);
 IF current_setting('app.gos_legitimacy_action',true)=v_action THEN
  v_prev_raw:=coalesce(nullif(current_setting('app.gos_legitimacy_raw',true),'')::numeric,0);
 END IF;
 v_raw:=v_prev_raw+v_part;
 v_delta:=greatest(-1,least(1,v_raw))-greatest(-1,least(1,v_prev_raw));
 PERFORM set_config('app.gos_legitimacy_action',v_action,true);
 PERFORM set_config('app.gos_legitimacy_raw',v_raw::text,true);
 IF v_delta=0 THEN RETURN NEW;END IF;
 UPDATE public.state_metrics m SET
   previous_value=m.value,
   value=greatest(coalesce(m.min_value,0),
     least(coalesce(m.max_value,100),m.value+v_delta)),
   updated_at=now()
 WHERE m.game_id=NEW.game_id AND m.metric_key='legitimacy'
   AND greatest(coalesce(m.min_value,0),least(coalesce(m.max_value,100),m.value+v_delta))
       IS DISTINCT FROM m.value
 RETURNING m.id,m.previous_value,m.value INTO v_id,v_before,v_after;
 IF FOUND THEN
  INSERT INTO public.state_metric_history(game_id,metric_id,metric_key,
   value,previous_value,delta,source_type,source_id,actor_id,note)
  VALUES(NEW.game_id,v_id,'legitimacy',v_after,v_before,v_after-v_before,
   'derived:legitimacy',NEW.id::text,NEW.actor_id,
   'Формула легитимности: 0,18 × Δ доверия + 0,12 × Δ поддержки элит; предел ±1 п.п. на исходное действие');
 END IF;
 RETURN NEW;
END;
$func$;
REVOKE ALL ON FUNCTION private.derive_legitimacy_from_metric_history()
 FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS trg_derived_legitimacy_on_metric_history ON public.state_metric_history;
CREATE TRIGGER trg_derived_legitimacy_on_metric_history
 AFTER INSERT ON public.state_metric_history
 FOR EACH ROW
 WHEN (NEW.delta<>0 AND NEW.metric_key IN ('public_trust','elite_support','economy'))
 EXECUTE FUNCTION private.derive_legitimacy_from_metric_history();

-- Reuse the existing fiscal-ledger trigger rather than adding a second one.
-- This also avoids an existing unnecessary ledger SELECT for every 'macro',
-- 'teacher' or other non-event ledger write.
CREATE OR REPLACE FUNCTION private.fiscal_ledger_metrics_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','private','pg_temp'
AS $func$
BEGIN
 IF NEW.source_type IN ('event','act') THEN
  PERFORM private.apply_fiscal_metrics(NEW.id);
 ELSIF NEW.source_type='macro' THEN
  PERFORM private.apply_macro_political_effect(NEW.game_id,NEW.before_values,
    NEW.after_values,NEW.source_id,NEW.actor_id,NEW.note);
 END IF;
 RETURN NEW;
END;
$func$;

-- Preserve the pre-existing vote result as exactly +0.50 legitimacy:
-- the new derivation adds +0.15 from +0.50 trust and +0.50 elite support,
-- so the direct component becomes +0.35. This is future-facing only.
UPDATE public.impact_rules
 SET effects=jsonb_set(effects,'{metrics,legitimacy}','0.35'::jsonb,true),
     updated_at=now()
WHERE rule_key='vote_passed' AND (effects->'metrics'->>'legitimacy')::numeric=0.5;
