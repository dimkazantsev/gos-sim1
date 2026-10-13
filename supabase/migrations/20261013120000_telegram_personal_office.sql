-- ГОС.ID · Telegram personal office.
-- Additive migration: existing bot links, notification queue, RPC, and game data remain untouched.
create table if not exists public.telegram_bot_preferences (
  game_id uuid not null,
  user_id uuid not null,
  daily_digest boolean not null default true,
  notify_tasks boolean not null default true,
  notify_documents boolean not null default true,
  notify_messages boolean not null default true,
  notify_events boolean not null default true,
  quiet_start time,
  quiet_end time,
  timezone text not null default 'Asia/Barnaul'
    check (timezone in ('Asia/Barnaul','Asia/Novosibirsk','Europe/Moscow','UTC')),
  updated_at timestamptz not null default now(),
  primary key(game_id,user_id),
  foreign key(game_id,user_id) references public.telegram_links(game_id,user_id) on delete cascade,
  check ((quiet_start is null and quiet_end is null) or (quiet_start is not null and quiet_end is not null))
);
alter table public.telegram_bot_preferences enable row level security;
revoke all on public.telegram_bot_preferences from anon;
grant select on public.telegram_bot_preferences to authenticated;
drop policy if exists telegram_bot_preferences_self on public.telegram_bot_preferences;
create policy telegram_bot_preferences_self on public.telegram_bot_preferences
  for select to authenticated using (user_id=(select auth.uid()));
-- Telegram webhook uses authenticated Bot API user ID and service-role writes.
revoke insert,update,delete on public.telegram_bot_preferences from authenticated;

create table if not exists public.telegram_reception_requests (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  sender_id uuid not null,
  recipient_id uuid not null,
  telegram_chat_id bigint not null,
  telegram_message_id bigint not null,
  subject text not null check(length(btrim(subject)) between 3 and 160),
  body text not null check(length(btrim(body)) between 5 and 3000),
  status text not null default 'received' check(status in ('received','processing','answered','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(game_id,sender_id,telegram_chat_id,telegram_message_id),
  foreign key(game_id,sender_id) references public.game_members(game_id,user_id),
  foreign key(game_id,recipient_id) references public.game_members(game_id,user_id)
);
create index if not exists telegram_reception_recipient_idx on public.telegram_reception_requests(game_id,recipient_id,status,created_at desc);
alter table public.telegram_reception_requests enable row level security;
revoke all on public.telegram_reception_requests from anon;
grant select on public.telegram_reception_requests to authenticated;
revoke insert,update,delete on public.telegram_reception_requests from authenticated;
drop policy if exists telegram_reception_participant_read on public.telegram_reception_requests;
create policy telegram_reception_participant_read on public.telegram_reception_requests
 for select to authenticated using(
  exists(select 1 from public.game_members m where m.game_id=telegram_reception_requests.game_id
   and m.user_id=(select auth.uid()) and m.roster_archived_at is null
   and (m.kind='teacher' or m.user_id=telegram_reception_requests.sender_id
     or m.user_id=telegram_reception_requests.recipient_id))
 );

-- Insert-only notifications: no access to unrelated correspondence.
create or replace function private.gos_reception_telegram_enqueue()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
 insert into public.telegram_outbox(game_id,user_id,category,source_id,body)
 select new.game_id,new.recipient_id,'reception',new.id,
  '📥 В вашу приёмную поступило обращение «'||left(new.subject,120)||'». Откройте раздел «Приёмная» для рассмотрения.'
 from public.telegram_links l
 join public.game_members m on m.game_id=l.game_id and m.user_id=l.user_id
 where l.game_id=new.game_id and l.user_id=new.recipient_id
  and l.notifications_enabled and m.roster_archived_at is null
 on conflict do nothing;
 return new;
end $$;
drop trigger if exists gos_reception_telegram_notify on public.telegram_reception_requests;
create trigger gos_reception_telegram_notify
 after insert on public.telegram_reception_requests
 for each row execute function private.gos_reception_telegram_enqueue();

comment on table public.telegram_bot_preferences is 'Private per-game Telegram digest, category and quiet-hours preferences.';
comment on table public.telegram_reception_requests is 'Authenticated cross-office correspondence via Telegram; never publicly writable.';
