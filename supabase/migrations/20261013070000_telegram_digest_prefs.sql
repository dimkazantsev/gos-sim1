-- ГОС.ID Telegram notification preferences and idempotent morning digests.
-- This migration adds independent data and never updates or deletes game records.
create table if not exists public.telegram_notification_preferences(
 game_id uuid not null,
 user_id uuid not null,
 daily_brief boolean not null default true,
 task_reminders boolean not null default true,
 mentions boolean not null default true,
 documents boolean not null default true,
 votes boolean not null default true,
 events boolean not null default true,
 quiet_hours boolean not null default false,
 updated_at timestamptz not null default now(),
 primary key(game_id,user_id),
 foreign key(game_id,user_id) references public.game_members(game_id,user_id) on delete cascade
);
alter table public.telegram_notification_preferences enable row level security;
revoke all on public.telegram_notification_preferences from anon;
grant select,insert,update on public.telegram_notification_preferences to authenticated;
drop policy if exists telegram_prefs_owner_select on public.telegram_notification_preferences;
create policy telegram_prefs_owner_select on public.telegram_notification_preferences
 for select to authenticated using(user_id=(select auth.uid()) and
  exists(select 1 from public.game_members gm where gm.game_id=telegram_notification_preferences.game_id
  and gm.user_id=(select auth.uid()) and gm.roster_archived_at is null));
drop policy if exists telegram_prefs_owner_insert on public.telegram_notification_preferences;
create policy telegram_prefs_owner_insert on public.telegram_notification_preferences
 for insert to authenticated with check(user_id=(select auth.uid()) and
  exists(select 1 from public.game_members gm where gm.game_id=telegram_notification_preferences.game_id
  and gm.user_id=(select auth.uid()) and gm.roster_archived_at is null));
drop policy if exists telegram_prefs_owner_update on public.telegram_notification_preferences;
create policy telegram_prefs_owner_update on public.telegram_notification_preferences
 for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
-- Avoid an externally editable "already sent" marker (digest ID is internal).
create table if not exists private.telegram_daily_digest_ledger(
 game_id uuid not null,user_id uuid not null,day_local date not null,
 queued_at timestamptz not null default now(), primary key(game_id,user_id,day_local)
);
revoke all on private.telegram_daily_digest_ledger from public,anon,authenticated;

create or replace function public.telegram_queue_morning_digest()
returns integer language plpgsql security definer set search_path to ''
as $$
declare delivered integer;
begin
 if auth.role() is distinct from 'service_role' then
  raise exception 'Only the Telegram dispatcher may queue morning digests';
 end if;
 with eligible as(
  select l.game_id,l.user_id,g.title as game_title,g.current_round,s.title as stage_title,
   (select count(*) from public.game_assigned_tasks t
      where t.game_id=l.game_id and t.recipient_id=l.user_id and t.status<>'confirmed') as pending_tasks,
   (select count(*) from public.formal_document_deliveries d
      where d.game_id=l.game_id and d.recipient_id=l.user_id) as received_documents
  from public.telegram_links l
  join public.game_members m on m.game_id=l.game_id and m.user_id=l.user_id and m.roster_archived_at is null and m.kind<>'observer'
  join public.games g on g.id=l.game_id
  left join public.game_stages s on s.game_id=g.id and s.stage_no=g.current_round
  left join public.telegram_notification_preferences p on p.game_id=l.game_id and p.user_id=l.user_id
  where l.notifications_enabled and coalesce(p.daily_brief,true)
 ),queued as(
  insert into private.telegram_daily_digest_ledger(game_id,user_id,day_local)
  select game_id,user_id,(now() at time zone 'Asia/Barnaul')::date from eligible
  on conflict do nothing returning game_id,user_id,day_local
 ),outbox as(
  insert into public.telegram_outbox(game_id,user_id,category,body)
  select q.game_id,q.user_id,'daily_brief',
   '☀️ ГОС.ID · Утренний государственный доклад'||E'\n\n'||
   '🏛 '||coalesce(e.game_title,'Республика')||E'\n'||
   '📍 '||coalesce(e.stage_title,'Этап пока не назначен')||E'\n'||
   '📌 Поручений к исполнению: '||e.pending_tasks||E'\n'||
   '📥 Полученных документов: '||e.received_documents||E'\n\n'||
   'Откройте личный аппарат, чтобы посмотреть подробности.'
  from queued q join eligible e on e.game_id=q.game_id and e.user_id=q.user_id
  returning id
 )
 select count(*) into delivered from outbox;
 return delivered;
end $$;
revoke all on function public.telegram_queue_morning_digest() from public,anon,authenticated;
grant execute on function public.telegram_queue_morning_digest() to service_role;
