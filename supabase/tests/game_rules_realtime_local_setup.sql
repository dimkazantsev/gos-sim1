-- Disposable local WebSocket fixture only; never apply to the game database.
DO $guard$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.qa_blitz_disposable_guard WHERE marker='gos-id-disposable-blitz-v1')
    OR EXISTS(SELECT 1 FROM auth.users LIMIT 1)
    OR EXISTS(SELECT 1 FROM public.games LIMIT 1) THEN
  RAISE EXCEPTION 'Empty disposable private Realtime fixture required';
 END IF;
END;
$guard$;
DO $tables$
DECLARE table_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['stage_deadline_rules','parliamentary_election_rules','regional_election_rules'] LOOP
  EXECUTE format('CREATE TABLE public.%I (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), game_id uuid NOT NULL REFERENCES public.games(id) ON DELETE CASCADE, probe integer NOT NULL DEFAULT 0)',table_name);
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('CREATE POLICY qa_game_rule_read ON public.%I FOR SELECT TO authenticated USING (private.is_game_member(game_id))',table_name);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated',table_name);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',table_name);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role',table_name);
 END LOOP;
END;
$tables$;
