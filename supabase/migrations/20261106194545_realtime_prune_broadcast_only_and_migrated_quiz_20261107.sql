-- ГОС.ID, 2026-11-07. Remove redundant WAL subscriptions from public.supabase_realtime.
-- Seven actively used tables deliver invalidations via existing private realtime.send triggers;
-- the authoritative client listens on the same game-scoped private Realtime channel.
-- Five old ORG-QUIZ tables belong to the separately migrated QWIZ-PARTY service.
-- No data, RLS, functions, or triggers are changed. Preserve suspended chat tables for safe reactivation.
DO $migration$
DECLARE v_tab text; v_found int;
BEGIN
 -- Fail closed if the seven Broadcast triggers have been replaced or disabled.
 SELECT count(DISTINCT c.relname) INTO v_found
 FROM pg_trigger t
 JOIN pg_class c ON c.oid=t.tgrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_proc f ON f.oid=t.tgfoid
 WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgenabled IN ('O','A')
   AND c.relname IN ('game_parties','party_documents','duma_sessions','duma_agenda_items','institution_session_registrations','bill_amendments','bill_amendment_packs')
   AND t.tgtype & 1 = 1
   AND t.tgtype & 4 = 4
   AND t.tgtype & 8 = 8
   AND t.tgtype & 16 = 16
   AND pg_get_functiondef(f.oid) LIKE '%realtime.send%';
 IF v_found <> 7 THEN RAISE EXCEPTION 'Only % of 7 expected INSERT/UPDATE/DELETE private Broadcast triggers found',v_found;END IF;
 FOR v_tab IN SELECT unnest(ARRAY['game_parties','party_documents','duma_sessions','duma_agenda_items','institution_session_registrations','bill_amendments','bill_amendment_packs','org_quiz_answers','org_quiz_participants','org_quiz_power_uses','org_quiz_sessions','org_quiz_teams']) LOOP
   IF EXISTS (SELECT 1 FROM pg_publication_tables
              WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=v_tab) THEN
     EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I',v_tab);
   END IF;
 END LOOP;
END
$migration$;
