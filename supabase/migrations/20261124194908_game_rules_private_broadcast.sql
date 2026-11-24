-- Phase 1 of the rolling migration: keep the existing publication during rollout.
-- Only a table name is emitted per changed game and SQL statement.
-- All three sources already use private.is_game_member(game_id) for SELECT.
SET LOCAL lock_timeout = '2s';
CREATE OR REPLACE FUNCTION private.broadcast_game_rules_invalidation()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE target_game uuid;
BEGIN
 IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME NOT IN
   ('stage_deadline_rules','parliamentary_election_rules','regional_election_rules')
   OR TG_LEVEL <> 'STATEMENT' THEN
  RAISE EXCEPTION 'Unexpected game-rule signal source';
 END IF;
 IF TG_OP = 'INSERT' THEN
  FOR target_game IN SELECT DISTINCT game_id FROM new_rules WHERE game_id IS NOT NULL LOOP
   BEGIN
    PERFORM realtime.send(jsonb_build_object('table',TG_TABLE_NAME),'game_rules_changed','gos-id-live:'||target_game::text,true);
   EXCEPTION WHEN OTHERS THEN NULL; -- Existing polling/visibility recovery remains available.
   END;
  END LOOP;
 ELSIF TG_OP = 'UPDATE' THEN
  FOR target_game IN SELECT game_id FROM old_rules WHERE game_id IS NOT NULL
                     UNION SELECT game_id FROM new_rules WHERE game_id IS NOT NULL LOOP
   BEGIN
    PERFORM realtime.send(jsonb_build_object('table',TG_TABLE_NAME),'game_rules_changed','gos-id-live:'||target_game::text,true);
   EXCEPTION WHEN OTHERS THEN NULL;
   END;
  END LOOP;
 ELSIF TG_OP = 'DELETE' THEN
  FOR target_game IN SELECT DISTINCT game_id FROM old_rules WHERE game_id IS NOT NULL LOOP
   BEGIN
    PERFORM realtime.send(jsonb_build_object('table',TG_TABLE_NAME),'game_rules_changed','gos-id-live:'||target_game::text,true);
   EXCEPTION WHEN OTHERS THEN NULL;
   END;
  END LOOP;
 END IF;
 RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION private.broadcast_game_rules_invalidation() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER gos_rule_insert AFTER INSERT ON public.stage_deadline_rules
REFERENCING NEW TABLE AS new_rules FOR EACH STATEMENT
EXECUTE FUNCTION private.broadcast_game_rules_invalidation();
CREATE TRIGGER gos_rule_update AFTER UPDATE ON public.stage_deadline_rules
REFERENCING OLD TABLE AS old_rules NEW TABLE AS new_rules FOR EACH STATEMENT
EXECUTE FUNCTION private.broadcast_game_rules_invalidation();
CREATE TRIGGER gos_rule_delete AFTER DELETE ON public.stage_deadline_rules
REFERENCING OLD TABLE AS old_rules FOR EACH STATEMENT
EXECUTE FUNCTION private.broadcast_game_rules_invalidation();
CREATE TRIGGER gos_rule_insert AFTER INSERT ON public.parliamentary_election_rules
REFERENCING NEW TABLE AS new_rules FOR EACH STATEMENT
EXECUTE FUNCTION private.broadcast_game_rules_invalidation();
CREATE TRIGGER gos_rule_update AFTER UPDATE ON public.parliamentary_election_rules
REFERENCING OLD TABLE AS old_rules NEW TABLE AS new_rules FOR EACH STATEMENT
EXECUTE FUNCTION private.broadcast_game_rules_invalidation();
CREATE TRIGGER gos_rule_delete AFTER DELETE ON public.parliamentary_election_rules
REFERENCING OLD TABLE AS old_rules FOR EACH STATEMENT
EXECUTE FUNCTION private.broadcast_game_rules_invalidation();
CREATE TRIGGER gos_rule_insert AFTER INSERT ON public.regional_election_rules
REFERENCING NEW TABLE AS new_rules FOR EACH STATEMENT
EXECUTE FUNCTION private.broadcast_game_rules_invalidation();
CREATE TRIGGER gos_rule_update AFTER UPDATE ON public.regional_election_rules
REFERENCING OLD TABLE AS old_rules NEW TABLE AS new_rules FOR EACH STATEMENT
EXECUTE FUNCTION private.broadcast_game_rules_invalidation();
CREATE TRIGGER gos_rule_delete AFTER DELETE ON public.regional_election_rules
REFERENCING OLD TABLE AS old_rules FOR EACH STATEMENT
EXECUTE FUNCTION private.broadcast_game_rules_invalidation();
