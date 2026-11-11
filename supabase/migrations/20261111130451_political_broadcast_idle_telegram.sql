-- Only table-level invalidation travels over existing private game topic.
-- User-facing political posts continue to be fetched with unchanged RLS.
CREATE OR REPLACE FUNCTION private.broadcast_political_posts_invalidation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','private','realtime','pg_temp'
AS $function$
DECLARE v_game uuid;
BEGIN
 IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME<>'political_posts' THEN
  RAISE EXCEPTION 'Unexpected source for political post signal';
 END IF;
 v_game:=CASE WHEN TG_OP='DELETE' THEN OLD.game_id ELSE NEW.game_id END;
 IF v_game IS NOT NULL THEN
  BEGIN
   PERFORM realtime.send(
    jsonb_build_object('table','political_posts'),
    'political_posts_changed','gos-id-live:'||v_game::text,true
   );
  EXCEPTION WHEN OTHERS THEN NULL; -- Do not fail post mutations on a messaging outage.
  END;
 END IF;
 IF TG_OP='UPDATE' AND OLD.game_id IS DISTINCT FROM NEW.game_id
    AND OLD.game_id IS NOT NULL THEN
  BEGIN
   PERFORM realtime.send(
    jsonb_build_object('table','political_posts'),
    'political_posts_changed','gos-id-live:'||OLD.game_id::text,true
   );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
 END IF;
 RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION private.broadcast_political_posts_invalidation()
 FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS broadcast_political_posts_invalidation ON public.political_posts;
CREATE TRIGGER broadcast_political_posts_invalidation
 AFTER INSERT OR UPDATE OR DELETE ON public.political_posts
 FOR EACH ROW EXECUTE FUNCTION private.broadcast_political_posts_invalidation();

-- No missed Telegram deliveries: only disable an empty and already paused
-- dispatcher, retaining its schedule and command for explicit restoration.
SELECT cron.alter_job(jobid,active=>false)
 FROM cron.job
 WHERE jobname='gos_id_telegram_dispatch' AND active
   AND command LIKE '%private.request_telegram_dispatch%'
   AND NOT EXISTS (
    SELECT 1 FROM public.telegram_outbox
    WHERE sent_at IS NULL AND attempts<5
   );
