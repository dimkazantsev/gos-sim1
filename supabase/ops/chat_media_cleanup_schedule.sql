-- Server-only cleanup. One check per minute, but no HTTP/Edge Function
-- or Storage RPC when nothing has expired. The existing 1-hour retention,
-- orphaned-object cleanup and finalize-after-remove logic are unchanged.
-- The Vault value is retrieved only if work is ready.
select cron.schedule(
 'gos_chat_media_cleanup_1m',
 '* * * * *',
 $cron$
 select net.http_post(
   url := 'https://bderfrcfuhnutuoyudje.supabase.co/functions/v1/chat-media-cleanup',
   headers := jsonb_build_object(
     'Content-Type','application/json',
     'x-chat-cleanup-token',
     (select decrypted_secret from vault.decrypted_secrets
       where name = 'gos_chat_media_cleanup_token' limit 1)
   ),
   body := '{}'::jsonb,
   timeout_milliseconds := 20000
 )
 where (
  exists (select 1 from public.chat_media_expired_candidates(1))
  or exists (
    select 1 from public.chat_messages m
    where m.kind in ('audio','video')
      and m.storage_path is not null
      and m.created_at <= now() - interval '1 hour'
      and not exists (
        select 1 from storage.objects o
        where o.bucket_id = 'game-media' and o.name = m.storage_path
      )
  )
);
 $cron$
);
