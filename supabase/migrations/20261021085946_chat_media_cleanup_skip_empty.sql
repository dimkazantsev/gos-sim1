-- Preserve the existing minute-level schedule and Edge Function security.
-- Only avoid the HTTP invoke when no expired object OR orphaned message exists.
-- The second branch preserves a finalization retry if a Storage deletion
-- succeeded but the subsequent message finalization did not.
do $migration$
declare v_job_id bigint;
begin
 if not exists(select 1 from pg_extension where extname='pg_cron') then return;end if;
 select jobid into v_job_id from cron.job where jobname='gos_chat_media_cleanup_1m' limit 1;
 if v_job_id is null then return;end if;
 perform cron.alter_job(v_job_id,command=>$cron$
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
 $cron$);
end $migration$;
