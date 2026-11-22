-- ГОС.ID: approved strong legitimacy model. Server-side only.
-- A REAL change of legitimacy by 1 pp changes:
-- social_stability +2; social_tension -3; media_climate +1.5;
-- international_standing +1. Never feed any of these back into legitimacy.
-- Existing fiscal model B already uses these metrics: do not change it.
CREATE OR REPLACE FUNCTION private.apply_legitimacy_social_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $fn$
BEGIN
 IF NEW.metric_key <> 'legitimacy' OR NEW.delta=0 THEN RETURN NEW;END IF;
 -- Four indexed rows updated as ONE statement, and history inserted as ONE
 -- statement; only changed values are written (0..100 saturating bounds).
 WITH changed AS (
  UPDATE public.state_metrics m
  SET previous_value=m.value,
      value=greatest(coalesce(m.min_value,0),least(coalesce(m.max_value,100),
                      m.value+NEW.delta*weights.k)),
      updated_at=now()
  FROM (VALUES
   ('social_stability'::text,2::numeric),
   ('social_tension'::text,-3::numeric),
   ('media_climate'::text,1.5::numeric),
   ('international_standing'::text,1::numeric)
  ) AS weights(metric_key,k)
  WHERE m.game_id=NEW.game_id
    AND m.metric_key=weights.metric_key
    AND greatest(coalesce(m.min_value,0),least(coalesce(m.max_value,100),
                 m.value+NEW.delta*weights.k)) IS DISTINCT FROM m.value
  RETURNING m.id,m.metric_key,m.value,m.previous_value
 )
 INSERT INTO public.state_metric_history
  (game_id,metric_id,metric_key,value,previous_value,delta,
   source_type,source_id,actor_id,note)
 SELECT NEW.game_id,id,metric_key,value,previous_value,value-previous_value,
        'derived:legitimacy-social',NEW.id::text,NEW.actor_id,
        'Автоматическое последствие изменения легитимности на '||
        NEW.delta::text||' п.п. · '||left(coalesce(NEW.note,''),250)
 FROM changed;
 RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION private.apply_legitimacy_social_links()
FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS trg_legitimacy_social_links ON public.state_metric_history;
CREATE TRIGGER trg_legitimacy_social_links
AFTER INSERT ON public.state_metric_history
FOR EACH ROW
WHEN (NEW.metric_key='legitimacy' AND NEW.delta<>0)
EXECUTE FUNCTION private.apply_legitimacy_social_links();

-- Keep the pre-existing rating news for the source legitimacy change.
-- Four derivative rows are visible in dashboard/history and Realtime already.
-- Avoid four expensive automatic political-post writes and notifications.
CREATE OR REPLACE TRIGGER publish_public_metric_rating
AFTER INSERT ON public.state_metric_history
FOR EACH ROW
WHEN (NEW.source_type IS DISTINCT FROM 'derived:legitimacy-social')
EXECUTE FUNCTION private.publish_rating_change();

-- Both fiscal-ledger and metric-driver reconciliations are DEFERRABLE.
-- At end of the same transaction, only one expensive budget calculation
-- per game is necessary, even with multiple changed metrics.
CREATE OR REPLACE FUNCTION private.reconcile_budget_driver_once(p_game uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $fn$
DECLARE v_completed text:=coalesce(current_setting('gos.budget_driver_processed',true),'');
BEGIN
 IF p_game IS NULL OR position('|'||p_game::text||'|' IN v_completed)>0 THEN RETURN; END IF;
 PERFORM private.reconcile_budget_driver(p_game);
 PERFORM set_config('gos.budget_driver_processed',
                    v_completed||'|'||p_game::text||'|',true);
END;
$fn$;
REVOKE ALL ON FUNCTION private.reconcile_budget_driver_once(uuid)
FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.reconcile_budget_driver_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $fn$
BEGIN
 IF TG_OP='UPDATE' AND NEW.metric_key IN
  ('lawfulness','economy','public_trust','social_stability','security',
   'elite_support','international_standing','social_tension','legitimacy','media_climate')
 AND NEW.value IS DISTINCT FROM OLD.value THEN
  BEGIN
   PERFORM private.reconcile_budget_driver_once(NEW.game_id);
  EXCEPTION WHEN OTHERS THEN
   RAISE WARNING 'ГОС.ID: budget sync failed for game %, SQLSTATE %',NEW.game_id,SQLSTATE;
  END;
 END IF;
 RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION private.sync_budget_from_fiscal_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $fn$
DECLARE v_relevant boolean:=false;
BEGIN
 IF NEW.source_type IN ('event','teacher') THEN
  v_relevant:=
   (NEW.before_values->'enterprises') IS DISTINCT FROM (NEW.after_values->'enterprises')
   OR (NEW.before_values->'activity_multiplier') IS DISTINCT FROM (NEW.after_values->'activity_multiplier');
 ELSIF NEW.source_type='macro' THEN
  v_relevant:=
   (NEW.before_values->'key_rate') IS DISTINCT FROM (NEW.after_values->'key_rate')
   OR (NEW.before_values->'fx_rate') IS DISTINCT FROM (NEW.after_values->'fx_rate')
   OR (NEW.before_values->'oil_price') IS DISTINCT FROM (NEW.after_values->'oil_price')
   OR (NEW.before_values->'inflation') IS DISTINCT FROM (NEW.after_values->'inflation')
   OR (NEW.before_values->'fnb_total') IS DISTINCT FROM (NEW.after_values->'fnb_total')
   OR (NEW.before_values->'fnb_liquid') IS DISTINCT FROM (NEW.after_values->'fnb_liquid')
   OR (NEW.before_values->'fnb_fx_share') IS DISTINCT FROM (NEW.after_values->'fnb_fx_share');
 ELSIF NEW.source_type='act' AND NEW.region_code='00' THEN
  v_relevant:=
   split_part(NEW.source_id,':',2) IN ('vat','profit')
   AND (NEW.before_values->'rate') IS DISTINCT FROM (NEW.after_values->'rate');
 END IF;
 IF v_relevant THEN
  BEGIN
   PERFORM private.reconcile_budget_driver_once(NEW.game_id);
  EXCEPTION WHEN OTHERS THEN
   RAISE WARNING 'ГОС.ID: fiscal-ledger budget sync failed for game %, SQLSTATE %',
    NEW.game_id,SQLSTATE;
  END;
 END IF;
 RETURN NEW;
END;
$fn$;