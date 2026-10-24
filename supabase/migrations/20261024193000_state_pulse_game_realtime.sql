-- ГОС.ID: Deliver authorised changes to the state pulse without polling.
-- Existing SELECT policies restrict each table to members of its game.
-- Both are already used by game clients; this changes no historical scores.
DO $pulse$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname='supabase_realtime' AND schemaname='public'
       AND tablename='state_metrics'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.state_metrics;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname='supabase_realtime' AND schemaname='public'
       AND tablename='state_metric_history'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.state_metric_history;
  END IF;
END
$pulse$;
