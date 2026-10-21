-- Avoid one Vercel HTTP invocation every minute when the Telegram queue is idle.
-- Scope: the existing pg_cron FALLBACK only. Preserve the INSERT trigger and its
-- immediate wake for new notifications, including mixed scheduled/due batches.
-- Existing partial index telegram_outbox_ready_idx covers the due-job lookup.
do $migration$
declare v_job_id bigint;
begin
 if not exists(select 1 from pg_extension where extname='pg_cron') then return; end if;
 select jobid into v_job_id from cron.job
 where jobname='gos_id_telegram_dispatch' limit 1;
 if v_job_id is null then return; end if;
 perform cron.alter_job(v_job_id,command=>$sql$
  select private.request_telegram_dispatch()
  where exists (
   select 1 from public.telegram_outbox
   where sent_at is null and attempts < 5 and next_attempt_at <= now()
  )
 $sql$);
end $migration$;
