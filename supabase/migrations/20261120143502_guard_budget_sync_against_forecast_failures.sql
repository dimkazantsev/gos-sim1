-- Do not cancel an accepted vote, legal publication or metric action if
-- the budget forecast unexpectedly fails. Existing budget read can retry later.
-- One bounded server attempt; no background retry loop.
SET LOCAL lock_timeout='1500ms';
SET LOCAL statement_timeout='10s';
DO $guard$ BEGIN
 IF md5(pg_get_functiondef('private.reconcile_budget_driver_trigger()'::regprocedure))<>'57a9137e738df16f499ee53b89641bde' THEN
  RAISE EXCEPTION 'Budget sync trigger drift';
 END IF;
END $guard$;
CREATE OR REPLACE FUNCTION private.reconcile_budget_driver_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
BEGIN
 IF TG_OP='UPDATE' AND NEW.metric_key IN ('lawfulness','economy','public_trust')
  AND NEW.value IS DISTINCT FROM OLD.value THEN
   BEGIN
     PERFORM private.reconcile_budget_driver(NEW.game_id);
   EXCEPTION WHEN OTHERS THEN
     -- A forecast problem must not undo a legitimate legal/game action.
     -- Next authorized budget read still has its existing reconciliation path.
     RAISE WARNING 'ГОС.ID: budget sync failed for game %, SQLSTATE %',NEW.game_id,SQLSTATE;
   END;
 END IF;
 RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION private.reconcile_budget_driver_trigger() FROM PUBLIC,anon,authenticated;
