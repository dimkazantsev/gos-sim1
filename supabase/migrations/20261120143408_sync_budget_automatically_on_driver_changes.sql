-- ГОС.ID: budget is reconciled once per transaction after changes to
-- economy, lawfulness or public trust, not by adding any polling on clients.
-- Initially deferred constraint trigger combines metric changes from one action.
-- No game data, results, rules or teacher roles are changed.
SET LOCAL lock_timeout='1500ms';
SET LOCAL statement_timeout='20s';
CREATE OR REPLACE FUNCTION private.reconcile_budget_driver(p_game uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
 v_plan jsonb;v_draft jsonb;v_base jsonb;v_calc jsonb;v_sig text;
 v_metric uuid;v_old numeric;v_new numeric;v_exp numeric;
 v_latest public.budget_income_history%rowtype;
 v_mode text;v_note text;v_sync text;
BEGIN
 -- Do not initialize a simulator or create a new budget for unrelated games.
 IF NOT EXISTS (SELECT 1 FROM public.budget_simulator_state WHERE game_id=p_game) THEN RETURN; END IF;
 SELECT id,value INTO v_metric,v_old FROM public.state_metrics
 WHERE game_id=p_game AND metric_key='budget';
 IF v_metric IS NULL THEN RETURN; END IF;

 -- Shared transaction key with get_budget_pulse avoids overwriting newer results.
 PERFORM pg_advisory_xact_lock(hashtextextended('gos-budget-pulse:'||p_game::text,0));

 -- Exactly the current pulse's plan policy: latest 30 plans, prefer a draft.
 SELECT to_jsonb(p) INTO v_plan FROM (
   SELECT pl.* FROM (
     SELECT * FROM public.budget_simulator_plans
     WHERE game_id=p_game ORDER BY updated_at DESC LIMIT 30
   ) pl
   ORDER BY CASE WHEN pl.status='draft' THEN 0 ELSE 1 END,pl.updated_at DESC LIMIT 1
 ) p;
 IF v_plan IS NULL THEN
   SELECT data INTO v_base FROM private.budget_baseline WHERE year=2026;
   v_draft:=jsonb_build_object(
     'title','Проект федерального бюджета на 2026 год','note','',
     'income_changes','{}'::jsonb,'spending_changes','{}'::jsonb,
     'revenue_adjustments','{}'::jsonb,
     'financing',v_base->'financing',
     'terms',jsonb_build_object('ofz_fixed',60,'ofz_float',60,'bank_credit',12,'external',60),
     'transfer_ids','[]'::jsonb);
   v_mode:='baseline';
   v_note:='Исходный план 2026 года с учетом текущих игровых условий.';
 ELSE
   v_draft:=v_plan->'draft';
   v_mode:=v_plan->>'status';
   v_note:=CASE v_mode
     WHEN 'draft' THEN 'Общий сохраненный черновик'
     WHEN 'document' THEN 'Проект закона в реестре'
     ELSE 'Опубликованный игровой бюджет'
   END||': '||(v_plan->>'title')||'.';
 END IF;
 v_sig:=private.budget_forecast_signature(p_game,v_draft);
 SELECT calculation INTO v_calc FROM private.budget_forecast_cache
 WHERE game_id=p_game AND input_signature=v_sig;
 IF v_calc IS NULL THEN
   v_calc:=private.calculate_budget_simulator(p_game,v_draft);
   INSERT INTO private.budget_forecast_cache(game_id,input_signature,calculation)
   VALUES(p_game,v_sig,v_calc)
   ON CONFLICT(game_id) DO UPDATE SET input_signature=excluded.input_signature,
     calculation=excluded.calculation,updated_at=clock_timestamp()
   WHERE private.budget_forecast_cache.input_signature IS DISTINCT FROM excluded.input_signature;
 END IF;
 v_new:=(v_calc->>'revenue')::numeric;
 v_exp:=(v_calc->>'expenditure')::numeric;
 IF v_new IS NULL OR v_exp IS NULL THEN
   RAISE EXCEPTION 'Missing calculated federal budget for game %',p_game;
 END IF;
 SELECT * INTO v_latest FROM public.budget_income_history
 WHERE game_id=p_game ORDER BY id DESC LIMIT 1;
 IF v_latest.id IS NULL OR v_latest.value IS DISTINCT FROM v_new
  OR v_latest.expenditure IS DISTINCT FROM v_exp
  OR v_latest.plan_id IS DISTINCT FROM (v_plan->>'id')::uuid
  OR v_latest.mode IS DISTINCT FROM v_mode THEN
   INSERT INTO public.budget_income_history(game_id,plan_id,value,previous_value,expenditure,mode,note)
   VALUES(p_game,(v_plan->>'id')::uuid,v_new,v_latest.value,v_exp,v_mode,v_note);
 END IF;
 IF v_old IS DISTINCT FROM v_new THEN
   v_sync:=current_setting('gos.budget_income_sync',true);
   PERFORM set_config('gos.budget_income_sync','on',true);
   UPDATE public.state_metrics
   SET previous_value=value,value=v_new
   WHERE id=v_metric AND value IS DISTINCT FROM v_new;
   PERFORM set_config('gos.budget_income_sync',coalesce(v_sync,''),true);
 END IF;
END
$function$;
CREATE OR REPLACE FUNCTION private.reconcile_budget_driver_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
BEGIN
 IF TG_OP='UPDATE' AND NEW.metric_key IN ('lawfulness','economy','public_trust')
  AND NEW.value IS DISTINCT FROM OLD.value THEN
   PERFORM private.reconcile_budget_driver(NEW.game_id);
 END IF;
 RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION private.reconcile_budget_driver(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.reconcile_budget_driver_trigger() FROM PUBLIC,anon,authenticated;
CREATE CONSTRAINT TRIGGER sync_budget_after_driver_change
AFTER UPDATE OF value ON public.state_metrics
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (NEW.metric_key IN ('lawfulness','economy','public_trust')
  AND NEW.value IS DISTINCT FROM OLD.value)
EXECUTE FUNCTION private.reconcile_budget_driver_trigger();
