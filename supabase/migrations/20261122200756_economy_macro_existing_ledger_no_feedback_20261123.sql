-- ГОС.ID. Approved: derive the Economy index from existing macro changes.
-- For actual macro ledger change: ΔE=clip(-.9Δinflation-.6Δrate
--  +.5Δmanual activity-.08ΔFX+.06Δoil,-4,+4). No backfill, no new RPC.
CREATE OR REPLACE FUNCTION private.apply_macro_economy_effect(
 p_game uuid,p_before jsonb,p_after jsonb,p_source_id text,p_actor uuid,p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $fn$
DECLARE di numeric:=0;dr numeric:=0;da numeric:=0;dfx numeric:=0;doil numeric:=0;
 d numeric;v_id uuid;v_old numeric;v_new numeric;
BEGIN
 IF p_game IS NULL OR p_before IS NULL OR p_after IS NULL THEN RETURN;END IF;
 IF jsonb_typeof(p_before->'inflation')='number'
 AND jsonb_typeof(p_after->'inflation')='number' THEN
  di:=(p_after->>'inflation')::numeric-(p_before->>'inflation')::numeric;
 END IF;
 IF jsonb_typeof(p_before->'key_rate')='number'
 AND jsonb_typeof(p_after->'key_rate')='number' THEN
  dr:=(p_after->>'key_rate')::numeric-(p_before->>'key_rate')::numeric;
 END IF;
 -- Only independently specified numeric before/after manual activity
 -- counts. A null starting value is NOT a fictitious 0% baseline.
 IF jsonb_typeof(p_before->'activity_override')='number'
 AND jsonb_typeof(p_after->'activity_override')='number' THEN
  da:=(p_after->>'activity_override')::numeric-(p_before->>'activity_override')::numeric;
 END IF;
 IF jsonb_typeof(p_before->'fx_rate')='number'
 AND jsonb_typeof(p_after->'fx_rate')='number' THEN
  dfx:=(p_after->>'fx_rate')::numeric-(p_before->>'fx_rate')::numeric;
 END IF;
 IF jsonb_typeof(p_before->'oil_price')='number'
 AND jsonb_typeof(p_after->'oil_price')='number' THEN
  doil:=(p_after->>'oil_price')::numeric-(p_before->>'oil_price')::numeric;
 END IF;
 d:=greatest(-4,least(4,round(-0.9*di-0.6*dr+0.5*da-0.08*dfx+0.06*doil,6)));
 IF d=0 THEN RETURN;END IF;
 -- One indexed UPDATE and one existing history INSERT, or no writes
 -- when the 0..100 bound means the value cannot change.
 UPDATE public.state_metrics m
 SET previous_value=m.value,
   value=greatest(coalesce(m.min_value,0),least(coalesce(m.max_value,100),m.value+d)),
   updated_at=now()
 WHERE m.game_id=p_game AND m.metric_key='economy'
 AND greatest(coalesce(m.min_value,0),least(coalesce(m.max_value,100),m.value+d))
   IS DISTINCT FROM m.value
 RETURNING m.id,m.previous_value,m.value INTO v_id,v_old,v_new;
 IF NOT FOUND THEN RETURN;END IF;
 INSERT INTO public.state_metric_history
 (game_id,metric_id,metric_key,value,previous_value,delta,source_type,source_id,actor_id,note)
 VALUES (p_game,v_id,'economy',v_new,v_old,v_new-v_old,
  'derived:macro_economy',coalesce(p_source_id,'macro'),p_actor,
  'Экономика: инфляция −0,9; ставка −0,6; заданная активность +0,5; курс −0,08; нефть +0,06; предел ±4. '||
  left(coalesce(p_note,''),200));
END;$fn$;
REVOKE ALL ON FUNCTION private.apply_macro_economy_effect(uuid,jsonb,jsonb,text,uuid,text)
 FROM PUBLIC,anon,authenticated;

-- Extend existing fiscal-change handler, no new ledger trigger.
CREATE OR REPLACE FUNCTION private.fiscal_ledger_metrics_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
BEGIN
 IF NEW.source_type IN ('event','act') THEN
  PERFORM private.apply_fiscal_metrics(NEW.id);
 ELSIF NEW.source_type='macro' THEN
  PERFORM private.apply_macro_political_effect(NEW.game_id,NEW.before_values,
    NEW.after_values,NEW.source_id,NEW.actor_id,NEW.note);
  PERFORM private.apply_macro_economy_effect(NEW.game_id,NEW.before_values,
    NEW.after_values,NEW.source_id,NEW.actor_id,NEW.note);
 END IF;
 RETURN NEW;
END;
$function$;

-- Stop recursive social/legitimacy effects before an existing trigger call.
DROP TRIGGER IF EXISTS trg_derived_legitimacy_on_metric_history ON public.state_metric_history;
CREATE TRIGGER trg_derived_legitimacy_on_metric_history
AFTER INSERT ON public.state_metric_history FOR EACH ROW
WHEN (NEW.delta<>0 AND NEW.metric_key IN ('public_trust','elite_support','economy')
 AND NEW.source_type IS DISTINCT FROM 'derived:macro_economy')
EXECUTE FUNCTION private.derive_legitimacy_from_metric_history();

-- Macro change already affects security directly: no second effect via E.
DROP TRIGGER IF EXISTS trg_security_independent_metrics ON public.state_metric_history;
CREATE TRIGGER trg_security_independent_metrics AFTER INSERT ON public.state_metric_history
FOR EACH ROW
WHEN (NEW.delta<>0 AND NEW.metric_key IN
 ('economy','social_tension','lawfulness','international_standing')
 AND NEW.source_type IS DISTINCT FROM 'derived:macro_economy')
EXECUTE FUNCTION private.security_from_metric_history();

-- No redundant news publications; do not change normal news behavior.
CREATE OR REPLACE TRIGGER publish_public_metric_rating
AFTER INSERT ON public.state_metric_history FOR EACH ROW
WHEN (NEW.source_type IS DISTINCT FROM 'derived:legitimacy-social'
 AND NEW.source_type IS DISTINCT FROM 'derived:security'
 AND NEW.source_type IS DISTINCT FROM 'derived:macro_economy')
EXECUTE FUNCTION private.publish_rating_change();