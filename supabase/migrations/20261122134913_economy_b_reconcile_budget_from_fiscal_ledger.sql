-- ГОС.ID: reconcile federal forecast only after a financially relevant,
-- committed game fiscal action. This does not alter model B coefficients,
-- past decisions, grades or the legal status of a budget document.
CREATE OR REPLACE FUNCTION private.sync_budget_from_fiscal_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  v_relevant boolean := false;
BEGIN
  IF NEW.source_type IN ('event', 'teacher') THEN
    -- Only these regional fields drive the approved federal forecast.
    v_relevant :=
      (NEW.before_values->'enterprises') IS DISTINCT FROM (NEW.after_values->'enterprises')
      OR (NEW.before_values->'activity_multiplier') IS DISTINCT FROM (NEW.after_values->'activity_multiplier');
  ELSIF NEW.source_type = 'macro' THEN
    -- The simulator already uses these four existing policy inputs.
    v_relevant :=
      (NEW.before_values->'key_rate') IS DISTINCT FROM (NEW.after_values->'key_rate')
      OR (NEW.before_values->'fx_rate') IS DISTINCT FROM (NEW.after_values->'fx_rate')
      OR (NEW.before_values->'oil_price') IS DISTINCT FROM (NEW.after_values->'oil_price')
      OR (NEW.before_values->'inflation') IS DISTINCT FROM (NEW.after_values->'inflation');
  ELSIF NEW.source_type = 'act' AND NEW.region_code = '00' THEN
    -- Only federal VAT/profit rates are read by the existing simulator.
    v_relevant :=
      split_part(NEW.source_id, ':', 2) IN ('vat', 'profit')
      AND (NEW.before_values->'rate') IS DISTINCT FROM (NEW.after_values->'rate');
  END IF;

  IF v_relevant THEN
    BEGIN
      -- Reuse the same per-game advisory lock, snapshot signature, one cache
      -- row and no-duplicate history logic as the metric-driven reconciliation.
      PERFORM private.reconcile_budget_driver(NEW.game_id);
    EXCEPTION WHEN OTHERS THEN
      -- A forecast failure must not invalidate a completed game action.
      RAISE WARNING 'ГОС.ID: fiscal-ledger budget sync failed for game %, SQLSTATE %',
        NEW.game_id, SQLSTATE;
    END;
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION private.sync_budget_from_fiscal_ledger()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sync_budget_from_fiscal_ledger ON public.fiscal_change_ledger;

CREATE CONSTRAINT TRIGGER sync_budget_from_fiscal_ledger
AFTER INSERT ON public.fiscal_change_ledger
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (NEW.source_type IN ('event', 'teacher', 'macro', 'act'))
EXECUTE FUNCTION private.sync_budget_from_fiscal_ledger();

COMMENT ON FUNCTION private.sync_budget_from_fiscal_ledger() IS
  'Model B: on a completed fiscal ledger action, reconcile the existing federal forecast only if approved federal drivers changed; no second financial effect.';
