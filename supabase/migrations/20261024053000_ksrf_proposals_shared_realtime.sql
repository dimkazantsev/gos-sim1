-- ГОС.ID: KSRF proposal updates across students via the existing shared game socket.
-- Both tables are already protected by authenticated-only, game-scoped SELECT RLS.
-- No additional subscription channels or recurring SQL jobs are created.
DO $pub$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
  IF NOT EXISTS (
   SELECT 1 FROM pg_publication_tables
   WHERE pubname='supabase_realtime' AND schemaname='public'
    AND tablename='parliamentary_election_rules'
  ) THEN
   ALTER PUBLICATION supabase_realtime ADD TABLE public.parliamentary_election_rules;
  END IF;
  IF NOT EXISTS (
   SELECT 1 FROM pg_publication_tables
   WHERE pubname='supabase_realtime' AND schemaname='public'
    AND tablename='regional_election_rules'
  ) THEN
   ALTER PUBLICATION supabase_realtime ADD TABLE public.regional_election_rules;
  END IF;
 ELSE
  RAISE EXCEPTION 'Realtime publication is unavailable; KSRF proposal sync not enabled';
 END IF;
END $pub$;
