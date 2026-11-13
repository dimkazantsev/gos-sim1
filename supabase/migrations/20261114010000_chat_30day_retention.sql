-- ГОС.ID: bounded 30-day chat retention, including attachments.
-- Only chat_messages and the private game-media bucket are eligible.
-- Byte deletion is performed by Storage API in the existing Edge Function.
-- A single daily pg_cron job replaces the former per-minute check.
-- Never delete government documents or their deduplication receipts.

ALTER TABLE private.gd_council_chat_document_delivery
 ALTER COLUMN message_id DROP NOT NULL;
ALTER TABLE private.gd_council_chat_document_delivery
 DROP CONSTRAINT IF EXISTS gd_council_chat_document_delivery_message_id_fkey;
ALTER TABLE private.gd_council_chat_document_delivery
 ADD CONSTRAINT gd_council_chat_document_delivery_message_id_fkey
 FOREIGN KEY (message_id) REFERENCES public.chat_messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS chat_messages_retention_time_idx
 ON public.chat_messages(created_at,id);
CREATE INDEX IF NOT EXISTS chat_messages_storage_reference_idx
 ON public.chat_messages(storage_path) WHERE storage_path IS NOT NULL;

DROP POLICY IF EXISTS chat_media_one_hour_visibility ON public.chat_messages;
DROP POLICY IF EXISTS chat_messages_30day_visibility ON public.chat_messages;
CREATE POLICY chat_messages_30day_visibility
 ON public.chat_messages AS RESTRICTIVE FOR SELECT TO authenticated
 USING (created_at > now() - interval '30 days');

-- The path must follow the approved chat upload convention:
-- game UUID / channel UUID / author UUID / random filename.
-- Never delete files still referenced by any non-expired message.
CREATE OR REPLACE FUNCTION public.chat_media_expired_candidates(p_limit integer DEFAULT 100)
RETURNS TABLE(storage_path text, message_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $function$
 SELECT o.name,
   (SELECT m.id FROM public.chat_messages m
     WHERE m.storage_path=o.name AND m.created_at <= now()-interval '30 days'
     ORDER BY m.created_at LIMIT 1)
 FROM storage.objects o
 WHERE o.bucket_id='game-media'
   AND o.name ~* '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/){3}[0-9a-z._-]+$'
   AND o.name NOT LIKE '%..%'
   AND NOT EXISTS (
     SELECT 1 FROM public.chat_messages current_m
     WHERE current_m.storage_path=o.name
       AND current_m.created_at > now()-interval '30 days'
   )
   AND (
     EXISTS (
       SELECT 1 FROM public.chat_messages expired_m
       WHERE expired_m.storage_path=o.name
         AND expired_m.created_at <= now()-interval '30 days'
     )
     OR (
       o.created_at <= now()-interval '30 days'
       AND NOT EXISTS (
         SELECT 1 FROM public.chat_messages linked
         WHERE linked.storage_path=o.name
       )
     )
   )
 ORDER BY o.created_at
 LIMIT least(greatest(coalesce(p_limit,100),1),250);
$function$;

-- Delete in small oldest-first batches after all referenced Storage bytes
-- are gone; text/system rows have no bytes and can be deleted directly.
-- Existing FK cascades clean pins/mentions. The GD delivery ledger survives.
CREATE OR REPLACE FUNCTION public.chat_media_finalize_expired()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE removed integer;
BEGIN
 WITH eligible AS (
   SELECT m.id FROM public.chat_messages m
   WHERE m.created_at <= now()-interval '30 days'
     AND (
       m.storage_path IS NULL
       OR (
         m.storage_path ~* '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/){3}[0-9a-z._-]+$'
         AND m.storage_path NOT LIKE '%..%'
         AND NOT EXISTS (
           SELECT 1 FROM storage.objects o
           WHERE o.bucket_id='game-media' AND o.name=m.storage_path
         )
       )
     )
   ORDER BY m.created_at,m.id
   LIMIT 500
 )
 DELETE FROM public.chat_messages m
 USING eligible e WHERE m.id=e.id;
 GET DIAGNOSTICS removed=ROW_COUNT;
 RETURN removed;
END;
$function$;

REVOKE ALL ON FUNCTION public.chat_media_expired_candidates(integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.chat_media_finalize_expired() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.chat_media_expired_candidates(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_media_finalize_expired() TO service_role;

-- Consolidate the chat cleanup: one inexpensive check daily at 03:00 UTC.
-- Invoke the Edge Function only if there is expired work; no polling of
-- the storage API, no Vercel cron and no retries on HTTP 402.
DO $cron_setup$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
   IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='gos_chat_media_cleanup_1m') THEN
     PERFORM cron.unschedule('gos_chat_media_cleanup_1m');
   END IF;
   IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='gos_chat_retention_30d_daily') THEN
     PERFORM cron.schedule(
       'gos_chat_retention_30d_daily','0 3 * * *',
       $task$
       SELECT net.http_post(
         url:='https://bderfrcfuhnutuoyudje.supabase.co/functions/v1/chat-media-cleanup',
         headers:=jsonb_build_object(
           'Content-Type','application/json',
           'x-chat-cleanup-token',
           (SELECT decrypted_secret FROM vault.decrypted_secrets
             WHERE name='gos_chat_media_cleanup_token' LIMIT 1)
         ),
         body:='{}'::jsonb,
         timeout_milliseconds:=20000
       )
       WHERE EXISTS(
         SELECT 1 FROM public.chat_messages m
         WHERE m.created_at <= now()-interval '30 days'
       )
       OR EXISTS(
         SELECT 1 FROM storage.objects o
         WHERE o.bucket_id='game-media'
           AND o.created_at <= now()-interval '30 days'
       );
       $task$
     );
   END IF;
 END IF;
END;
$cron_setup$;
