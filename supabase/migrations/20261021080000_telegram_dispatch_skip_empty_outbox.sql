-- Skip the minute-by-minute HTTP wake while no Telegram notice is due.
-- The existing insert trigger still wakes immediately for new notices;
-- pg_cron keeps its one-minute retry cadence for delayed notices.
-- Covers all games; no RLS, delivery status or user data is modified.
create or replace function private.request_telegram_dispatch()
returns boolean language plpgsql security definer
set search_path to 'pg_catalog','public','vault','net','pg_temp'
as $fn$
declare v_secret text;
begin
 -- The existing partial index telegram_outbox_ready_idx supports this
 -- indexable existence check. Do not wake Vercel for an empty/paused queue.
 if not exists (
  select 1 from public.telegram_outbox
  where sent_at is null and attempts < 5 and next_attempt_at <= now()
 ) then return false; end if;
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
 -- Delivery problems must never roll back a player's in-game operation.
 raise warning 'Telegram wake request failed: SQLSTATE %',sqlstate;
 return false;
end $fn$;
revoke all on function private.request_telegram_dispatch() from public,anon,authenticated;
