-- Wake Telegram dispatcher after queue inserts, including when no browser is online.
-- Database Vault stores the same CRON_SECRET as the private Vercel environment.
-- The trigger only signals the dispatcher; its durable outbox keeps delivery reliable.
create or replace function private.request_telegram_dispatch()
returns boolean language plpgsql security definer
set search_path to 'pg_catalog','public','vault','net','pg_temp'
as $fn$
declare v_secret text;
begin
 if not exists(select 1 from pg_extension where extname='pg_net') then return false; end if;
 select decrypted_secret into v_secret from vault.decrypted_secrets
 where name='gos_id_telegram_dispatch_secret' limit 1;
 if v_secret is null or length(v_secret)<24 then return false;end if;
 perform net.http_get(
  url:='https://gos-sim1.vercel.app/api/telegram/dispatch',
  headers:=jsonb_build_object('Authorization','Bearer '||v_secret),
  timeout_milliseconds:=5000
 );
 return true;
exception when others then
 -- A temporary network problem must not abort a participant's game action.
 raise warning 'Telegram wake request failed: SQLSTATE %',sqlstate;
 return false;
end $fn$;
revoke all on function private.request_telegram_dispatch() from public,anon,authenticated;

create or replace function private.telegram_outbox_wake_trigger()
returns trigger language plpgsql security definer
set search_path to 'pg_catalog','public','private','pg_temp'
as $fn$
begin
 -- A multi-recipient notification issues just one network wake per transaction.
 if current_setting('private.telegram_dispatch_requested',true) is distinct from '1' then
  perform set_config('private.telegram_dispatch_requested','1',true);
  perform private.request_telegram_dispatch();
 end if;
 return new;
end $fn$;
revoke all on function private.telegram_outbox_wake_trigger() from public,anon,authenticated;
drop trigger if exists gos_id_telegram_outbox_wake on public.telegram_outbox;
create trigger gos_id_telegram_outbox_wake
 after insert on public.telegram_outbox for each row
 execute function private.telegram_outbox_wake_trigger();

-- A missing wake, network failure or delayed notification is retried without clients.
do $cron$
begin
 if exists(select 1 from pg_extension where extname='pg_cron') and
    not exists(select 1 from cron.job where jobname='gos_id_telegram_dispatch') then
  perform cron.schedule('gos_id_telegram_dispatch','* * * * *',
   'select private.request_telegram_dispatch()');
 end if;
end $cron$;
