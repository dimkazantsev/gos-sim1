-- Production scheduler for gos-sim (Supabase project bderfrcfuhnutuoyudje).
-- Apply after deploying chat-media-cleanup Edge Function and the matching
-- 20261013180000 migration. Adapt the URL on a non-production database.
-- The Vault token is read at execution time; it never appears in cron.job.
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
 );
 $cron$
);
