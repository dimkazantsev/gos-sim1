-- Telegram bridge for GOS//SIMS. Run with migration privileges.
-- Bot data is private: only audited RPCs and server-side service_role may access it.
create table if not exists public.telegram_links (
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid not null,
  telegram_user_id bigint not null,
  chat_id bigint not null,
  notifications_enabled boolean not null default true,
  default_channel_id uuid null references public.chat_channels(id) on delete set null,
  linked_at timestamptz not null default now(),
  primary key (game_id,user_id),
  unique (game_id,telegram_user_id),
  foreign key (game_id,user_id) references public.game_members(game_id,user_id) on delete cascade
);
create index if not exists telegram_links_telegram_idx on public.telegram_links(telegram_user_id);
create table if not exists public.telegram_link_requests (
  game_id uuid not null,
  user_id uuid not null,
  token text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (game_id,user_id),
  foreign key (game_id,user_id) references public.game_members(game_id,user_id) on delete cascade
);
create index if not exists telegram_link_requests_expires_idx on public.telegram_link_requests(expires_at);
create table if not exists public.telegram_outbox (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid not null,
  category text not null check (category in ('chat','stage','vote','event','document')),
  source_id uuid,
  channel_id uuid references public.chat_channels(id) on delete set null,
  body text not null check (length(body) <= 4000),
  created_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  attempts integer not null default 0,
  last_error text,
  unique (game_id,user_id,category,source_id),
  foreign key (game_id,user_id) references public.game_members(game_id,user_id) on delete cascade
);
create table if not exists public.telegram_incoming_messages (
  chat_id bigint not null,
  telegram_message_id bigint not null,
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid not null,
  posted_message_id uuid references public.chat_messages(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key(chat_id,telegram_message_id),
  foreign key(game_id,user_id) references public.game_members(game_id,user_id) on delete cascade
);
create index if not exists telegram_incoming_messages_created_idx on public.telegram_incoming_messages(created_at);
alter table public.telegram_incoming_messages enable row level security;
revoke all on table public.telegram_incoming_messages from public,anon,authenticated;
grant select,insert,update,delete on table public.telegram_incoming_messages to service_role;
create index if not exists telegram_outbox_ready_idx on public.telegram_outbox(next_attempt_at,id) where sent_at is null and attempts < 5;
alter table public.telegram_links enable row level security;
alter table public.telegram_link_requests enable row level security;
alter table public.telegram_outbox enable row level security;
revoke all on table public.telegram_links,public.telegram_link_requests,public.telegram_outbox from public,anon,authenticated;
grant select,insert,update,delete on table public.telegram_links,public.telegram_link_requests,public.telegram_outbox to service_role;
grant usage,select on sequence public.telegram_outbox_id_seq to service_role;

create or replace function public.telegram_generate_link(p_game_id uuid)
returns text language plpgsql security definer set search_path = ''
as $fn$
declare v_uid uuid := auth.uid(); v_token text;
begin
 if v_uid is null or not exists (
   select 1 from public.game_members where game_id=p_game_id and user_id=v_uid and roster_archived_at is null
 ) then raise exception 'Нет доступа к игре.'; end if;
 v_token:=encode(extensions.gen_random_bytes(24),'hex');
 insert into public.telegram_link_requests(game_id,user_id,token,expires_at)
 values(p_game_id,v_uid,v_token,now()+interval '10 minutes')
 on conflict (game_id,user_id) do update set token=excluded.token,expires_at=excluded.expires_at,created_at=now();
 return v_token;
end;$fn$;
create or replace function public.telegram_status(p_game_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $fn$
declare v_uid uuid := auth.uid(); v_link public.telegram_links%rowtype;
begin
 if v_uid is null or not exists(select 1 from public.game_members where game_id=p_game_id and user_id=v_uid and roster_archived_at is null)
 then raise exception 'Нет доступа к игре.'; end if;
 select * into v_link from public.telegram_links where game_id=p_game_id and user_id=v_uid;
 return jsonb_build_object('linked',found,'notifications_enabled',coalesce(v_link.notifications_enabled,false),'linked_at',v_link.linked_at);
end;$fn$;
create or replace function public.telegram_unlink(p_game_id uuid)
returns void language plpgsql security definer set search_path = ''
as $fn$
begin
 if auth.uid() is null then raise exception 'Требуется вход.'; end if;
 delete from public.telegram_links where game_id=p_game_id and user_id=auth.uid();
 delete from public.telegram_link_requests where game_id=p_game_id and user_id=auth.uid();
 delete from public.telegram_outbox where game_id=p_game_id and user_id=auth.uid() and sent_at is null;
end;$fn$;
create or replace function public.telegram_configure(p_game_id uuid,p_enabled boolean)
returns void language plpgsql security definer set search_path = ''
as $fn$
begin
 if auth.uid() is null then raise exception 'Требуется вход.'; end if;
 update public.telegram_links set notifications_enabled=p_enabled
 where game_id=p_game_id and user_id=auth.uid();
 if not found then raise exception 'Telegram ещё не привязан.'; end if;
end;$fn$;

-- These three RPCs are callable ONLY with a server-side service key, not from a browser.
create or replace function public.telegram_connect(p_token text,p_telegram_user_id bigint,p_chat_id bigint)
returns uuid language plpgsql security invoker set search_path = ''
as $fn$
declare v_req public.telegram_link_requests%rowtype;
begin
 select * into v_req from public.telegram_link_requests where token=p_token and expires_at>now() for update;
 if not found then raise exception 'Код истёк или недействителен.'; end if;
 if not exists (select 1 from public.game_members where game_id=v_req.game_id and user_id=v_req.user_id and roster_archived_at is null)
 then raise exception 'Пользователь больше не участвует в игре.'; end if;
 insert into public.telegram_links(game_id,user_id,telegram_user_id,chat_id,linked_at)
 values(v_req.game_id,v_req.user_id,p_telegram_user_id,p_chat_id,now())
 on conflict (game_id,user_id) do update
 set telegram_user_id=excluded.telegram_user_id,chat_id=excluded.chat_id,linked_at=now();
 delete from public.telegram_link_requests where game_id=v_req.game_id and user_id=v_req.user_id;
 return v_req.game_id;
end;$fn$;
create or replace function public.telegram_post_chat(p_telegram_user_id bigint,p_game_id uuid,p_channel_id uuid,p_text text,p_chat_id bigint,p_message_id bigint)
returns uuid language plpgsql security invoker set search_path = ''
as $fn$
declare v_user uuid;v_kind public.member_kind;v_channel text;v_id uuid;v_duplicate uuid;
begin
 if length(trim(coalesce(p_text,'')))=0 or length(p_text)>3500 then raise exception 'Длина сообщения: от 1 до 3500 символов.'; end if;
 select l.user_id,m.kind into v_user,v_kind from public.telegram_links l
 join public.game_members m on m.game_id=l.game_id and m.user_id=l.user_id
 where l.telegram_user_id=p_telegram_user_id and l.game_id=p_game_id and l.chat_id=p_chat_id and m.roster_archived_at is null;
 if v_user is null or v_kind='observer' then raise exception 'Нет права отправлять сообщения.'; end if;
 select kind into v_channel from public.chat_channels where id=p_channel_id and game_id=p_game_id;
 if v_channel is null or not (v_channel='public' or v_kind='teacher' or exists(
    select 1 from public.channel_members where channel_id=p_channel_id and user_id=v_user
 )) then raise exception 'Нет доступа к каналу.'; end if;
 if p_message_id < 1 then raise exception 'Неверный идентификатор сообщения Telegram.'; end if;
 insert into public.telegram_incoming_messages(chat_id,telegram_message_id,game_id,user_id)
 values(p_chat_id,p_message_id,p_game_id,v_user)
 on conflict (chat_id,telegram_message_id) do nothing;
 if not found then
   select posted_message_id into v_duplicate from public.telegram_incoming_messages
   where chat_id=p_chat_id and telegram_message_id=p_message_id;
   if v_duplicate is null then raise exception 'Повторная отправка уже обрабатывается.'; end if;
   return v_duplicate;
 end if;
 insert into public.chat_messages(game_id,channel_id,author_id,kind,text)
 values(p_game_id,p_channel_id,v_user,'text',trim(p_text)) returning id into v_id;
 update public.telegram_incoming_messages
 set posted_message_id=v_id where chat_id=p_chat_id and telegram_message_id=p_message_id;
 return v_id;
end;$fn$;
create or replace function public.telegram_select_channel(p_telegram_user_id bigint,p_game_id uuid,p_channel_id uuid)
returns boolean language plpgsql security invoker set search_path = ''
as $fn$
declare v_user uuid;v_kind public.member_kind;v_channel text;
begin
 select l.user_id,m.kind into v_user,v_kind from public.telegram_links l
 join public.game_members m on m.game_id=l.game_id and m.user_id=l.user_id
 where l.telegram_user_id=p_telegram_user_id and l.game_id=p_game_id and m.roster_archived_at is null;
 if v_user is null then return false; end if;
 select kind into v_channel from public.chat_channels where id=p_channel_id and game_id=p_game_id;
 if v_channel is null or not (v_channel='public' or v_kind='teacher' or exists(
   select 1 from public.channel_members where channel_id=p_channel_id and user_id=v_user
 )) then return false; end if;
 update public.telegram_links set default_channel_id=p_channel_id where game_id=p_game_id and user_id=v_user;
 return true;
end;$fn$;

revoke execute on function public.telegram_generate_link(uuid),public.telegram_status(uuid),public.telegram_unlink(uuid),public.telegram_configure(uuid,boolean),
 public.telegram_connect(text,bigint,bigint),public.telegram_post_chat(bigint,uuid,uuid,text,bigint,bigint),public.telegram_select_channel(bigint,uuid,uuid) from public,anon,authenticated;
grant execute on function public.telegram_generate_link(uuid),public.telegram_status(uuid),public.telegram_unlink(uuid),public.telegram_configure(uuid,boolean) to authenticated;
grant execute on function public.telegram_connect(text,bigint,bigint),public.telegram_post_chat(bigint,uuid,uuid,text),public.telegram_select_channel(bigint,uuid,uuid) to service_role;

-- Chat delivery is queued after successful writes; no external HTTP inside DB transactions.
create or replace function private.telegram_chat_enqueue() returns trigger
language plpgsql security definer set search_path = ''
as $fn$
declare v_channel public.chat_channels%rowtype; v_author text;
begin
 if new.kind not in ('text','system') or coalesce(new.text,'')='' then return new; end if;
 select * into v_channel from public.chat_channels where id=new.channel_id;
 select full_name into v_author from public.game_members where game_id=new.game_id and user_id=new.author_id;
 insert into public.telegram_outbox(game_id,user_id,category,source_id,body,channel_id)
 select new.game_id,l.user_id,'chat',new.id,
 left('Чат «'||v_channel.name||'»'||E'\n'||coalesce(v_author,'Система')||': '||left(new.text,3000),3900),new.channel_id
 from public.telegram_links l join public.game_members m on m.game_id=l.game_id and m.user_id=l.user_id
 where l.game_id=new.game_id and l.user_id is distinct from new.author_id
   and l.notifications_enabled and m.roster_archived_at is null
   and (v_channel.kind='public' or m.kind='teacher' or exists(
     select 1 from public.channel_members cm where cm.channel_id=new.channel_id and cm.user_id=l.user_id
   ))
 on conflict do nothing;
 return new;
end;$fn$;
drop trigger if exists telegram_chat_enqueue on public.chat_messages;
create trigger telegram_chat_enqueue after insert on public.chat_messages for each row execute function private.telegram_chat_enqueue();

create or replace function private.telegram_stage_enqueue() returns trigger
language plpgsql security definer set search_path = ''
as $fn$
begin
 if new.status='open' and (tg_op='INSERT' or old.status is distinct from new.status) then
  insert into public.telegram_outbox(game_id,user_id,category,source_id,body)
  select new.game_id,l.user_id,'stage',new.id,
  left('Открыт этап '||new.stage_no||': '||new.title||coalesce(E'\nСрок: '||to_char(new.deadline at time zone 'UTC','DD.MM.YYYY HH24:MI')||' UTC',''),3900)
  from public.telegram_links l join public.game_members m on m.game_id=l.game_id and m.user_id=l.user_id
  where l.game_id=new.game_id and l.notifications_enabled and m.roster_archived_at is null
  on conflict do nothing;
 end if;
 return new;
end;$fn$;
drop trigger if exists telegram_stage_enqueue on public.game_stages;
create trigger telegram_stage_enqueue after insert or update of status on public.game_stages
for each row execute function private.telegram_stage_enqueue();

create or replace function private.telegram_vote_enqueue() returns trigger
language plpgsql security definer set search_path = ''
as $fn$
begin
 if new.status='open' and (tg_op='INSERT' or old.status is distinct from new.status) then
  insert into public.telegram_outbox(game_id,user_id,category,source_id,body)
  select new.game_id,l.user_id,'vote',new.id,'В игре открыто голосование. Перейдите на сайт, чтобы проверить доступ и проголосовать.'
  from public.telegram_links l join public.game_members m on m.game_id=l.game_id and m.user_id=l.user_id
  where l.game_id=new.game_id and l.notifications_enabled and m.roster_archived_at is null
  on conflict do nothing;
 end if;
 return new;
end;$fn$;
drop trigger if exists telegram_vote_enqueue on public.game_votes;
create trigger telegram_vote_enqueue after insert or update of status on public.game_votes
for each row execute function private.telegram_vote_enqueue();

-- Generic notifications deliberately do not expose private event/document content.
create or replace function private.telegram_event_enqueue() returns trigger
language plpgsql security definer set search_path = ''
as $fn$
begin
 if new.published_at is not null and (tg_op='INSERT' or old.published_at is distinct from new.published_at) then
  insert into public.telegram_outbox(game_id,user_id,category,source_id,body)
  select new.game_id,l.user_id,'event',new.id,'В игре появилось новое событие. Откройте GOS//SIMS, чтобы проверить доступ и ознакомиться.'
  from public.telegram_links l
  join public.game_members m on m.game_id=l.game_id and m.user_id=l.user_id
  where l.game_id=new.game_id and l.notifications_enabled and m.roster_archived_at is null
  on conflict do nothing;
 end if;
 return new;
end;$fn$;
drop trigger if exists telegram_event_enqueue on public.game_events;
create trigger telegram_event_enqueue after insert or update of published_at on public.game_events
for each row execute function private.telegram_event_enqueue();

create or replace function private.telegram_document_enqueue() returns trigger
language plpgsql security definer set search_path = ''
as $fn$
begin
 if new.status_code <> 'draft'
   and (tg_op='INSERT' or old.status_code is distinct from new.status_code) then
  insert into public.telegram_outbox(game_id,user_id,category,source_id,body)
  select new.game_id,l.user_id,'document',new.id,'Изменился статус документа в игре. Откройте реестр GOS//SIMS, чтобы проверить доступ и ознакомиться.'
  from public.telegram_links l
  join public.game_members m on m.game_id=l.game_id and m.user_id=l.user_id
  where l.game_id=new.game_id and l.notifications_enabled and m.roster_archived_at is null
  on conflict do nothing;
 end if;
 return new;
end;$fn$;
drop trigger if exists telegram_document_enqueue on public.formal_documents;
create trigger telegram_document_enqueue after insert or update of status_code on public.formal_documents
for each row execute function private.telegram_document_enqueue();

-- Targeted alerts for assigned training cases. Never expose the case description to an unverified Telegram chat.
create or replace function private.telegram_assignment_enqueue() returns trigger
language plpgsql security definer set search_path = ''
as $fn$
begin
 insert into public.telegram_outbox(game_id,user_id,category,source_id,body)
 select new.game_id,l.user_id,'event',new.id,
  'Вам назначена новая игровая ситуация. Откройте GOS//SIMS для изучения условий и ответа.'
 from public.telegram_links l
 join public.game_members m on m.game_id=l.game_id and m.user_id=l.user_id
 where l.game_id=new.game_id and l.user_id=new.recipient_id
   and l.notifications_enabled and m.roster_archived_at is null
 on conflict do nothing;
 return new;
end;$fn$;
drop trigger if exists telegram_assignment_enqueue on public.event_assignments;
create trigger telegram_assignment_enqueue after insert on public.event_assignments
for each row execute function private.telegram_assignment_enqueue();
