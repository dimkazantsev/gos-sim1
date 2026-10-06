-- Chat ordering, unread state, persistent channel pins and mentions.
create table if not exists public.chat_channel_state(
  game_id uuid not null references public.games(id) on delete cascade,
  channel_id uuid not null references public.chat_channels(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz,last_sent_at timestamptz,pinned_at timestamptz,pinned_rank integer,
  updated_at timestamptz not null default now(),primary key(channel_id,user_id)
);
create index if not exists chat_channel_state_user_game_idx on public.chat_channel_state(user_id,game_id,pinned_rank,last_sent_at desc);
create table if not exists public.chat_mentions(
 id uuid primary key default gen_random_uuid(),game_id uuid not null references public.games(id) on delete cascade,
 channel_id uuid not null references public.chat_channels(id) on delete cascade,message_id uuid not null references public.chat_messages(id) on delete cascade,
 author_id uuid not null references auth.users(id) on delete cascade,mentioned_user_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),read_at timestamptz,unique(message_id,mentioned_user_id)
);
create index if not exists chat_mentions_user_unread_idx on public.chat_mentions(mentioned_user_id,game_id,read_at,created_at desc);
create index if not exists chat_messages_channel_activity_idx on public.chat_messages(channel_id,created_at desc);
create index if not exists chat_messages_game_author_activity_idx on public.chat_messages(game_id,author_id,created_at desc);
alter table public.chat_channel_state enable row level security;alter table public.chat_mentions enable row level security;
revoke all on public.chat_channel_state from anon,authenticated;revoke all on public.chat_mentions from anon,authenticated;
grant select on public.chat_channel_state to authenticated;grant select on public.chat_mentions to authenticated;
drop policy if exists chat_channel_state_self_read on public.chat_channel_state;
create policy chat_channel_state_self_read on public.chat_channel_state for select to authenticated using(user_id=(select auth.uid()));
drop policy if exists chat_mentions_self_read on public.chat_mentions;
create policy chat_mentions_self_read on public.chat_mentions for select to authenticated using(mentioned_user_id=(select auth.uid()) or private.is_game_teacher(game_id));
create or replace function private.touch_chat_sender_state() returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
begin if new.author_id is not null then insert into public.chat_channel_state(game_id,channel_id,user_id,last_read_at,last_sent_at,updated_at)
 values(new.game_id,new.channel_id,new.author_id,new.created_at,new.created_at,now()) on conflict(channel_id,user_id) do update
 set game_id=excluded.game_id,last_read_at=greatest(coalesce(chat_channel_state.last_read_at,'epoch'::timestamptz),excluded.last_read_at),
 last_sent_at=greatest(coalesce(chat_channel_state.last_sent_at,'epoch'::timestamptz),excluded.last_sent_at),updated_at=now();end if;return new;end;$$;
drop trigger if exists trg_touch_chat_sender_state on public.chat_messages;
create trigger trg_touch_chat_sender_state after insert on public.chat_messages for each row execute function private.touch_chat_sender_state();
create or replace function public.mark_chat_channel_read(p_channel_id uuid) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_game uuid;v_now timestamptz:=now();begin if (select auth.uid()) is null or not private.can_access_channel(p_channel_id) then raise exception 'Нет доступа к диалогу.';end if;
select game_id into v_game from public.chat_channels where id=p_channel_id;if v_game is null then raise exception 'Диалог не найден.';end if;
insert into public.chat_channel_state(game_id,channel_id,user_id,last_read_at,updated_at) values(v_game,p_channel_id,(select auth.uid()),v_now,now())
on conflict(channel_id,user_id) do update set last_read_at=greatest(coalesce(chat_channel_state.last_read_at,'epoch'::timestamptz),excluded.last_read_at),updated_at=now();
update public.chat_mentions set read_at=coalesce(read_at,v_now) where channel_id=p_channel_id and mentioned_user_id=(select auth.uid()) and read_at is null;end;$$;
revoke all on function public.mark_chat_channel_read(uuid) from public,anon;grant execute on function public.mark_chat_channel_read(uuid) to authenticated;
create or replace function public.set_my_chat_channel_pin(p_channel_id uuid,p_pin boolean) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_game uuid;v_rank integer;begin if (select auth.uid()) is null or not private.can_access_channel(p_channel_id) then raise exception 'Нет доступа к диалогу.';end if;
select game_id into v_game from public.chat_channels where id=p_channel_id;if p_pin then select coalesce(max(pinned_rank),0)+1 into v_rank from public.chat_channel_state where user_id=(select auth.uid()) and game_id=v_game;
insert into public.chat_channel_state(game_id,channel_id,user_id,pinned_at,pinned_rank,updated_at) values(v_game,p_channel_id,(select auth.uid()),now(),v_rank,now())
on conflict(channel_id,user_id) do update set pinned_at=coalesce(chat_channel_state.pinned_at,now()),pinned_rank=coalesce(chat_channel_state.pinned_rank,v_rank),updated_at=now();
else insert into public.chat_channel_state(game_id,channel_id,user_id,pinned_at,pinned_rank,updated_at) values(v_game,p_channel_id,(select auth.uid()),null,null,now())
on conflict(channel_id,user_id) do update set pinned_at=null,pinned_rank=null,updated_at=now();end if;end;$$;
revoke all on function public.set_my_chat_channel_pin(uuid,boolean) from public,anon;grant execute on function public.set_my_chat_channel_pin(uuid,boolean) to authenticated;
create or replace function public.send_chat_text(p_game uuid,p_channel uuid,p_text text,p_mentioned_users uuid[] default '{}'::uuid[]) returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_uid uuid:=(select auth.uid());v_id uuid;v_kind text;begin
if v_uid is null or trim(coalesce(p_text,''))='' then raise exception 'Сообщение пустое.';end if;if not private.can_access_channel(p_channel) then raise exception 'Нет доступа к диалогу.';end if;
if not exists(select 1 from public.chat_channels where id=p_channel and game_id=p_game) then raise exception 'Диалог не относится к игре.';end if;
if exists(select 1 from public.game_members where game_id=p_game and user_id=v_uid and kind='observer') then raise exception 'Гостевой режим доступен только для чтения.';end if;
insert into public.chat_messages(game_id,channel_id,author_id,kind,text) values(p_game,p_channel,v_uid,'text',trim(p_text)) returning id into v_id;
select kind into v_kind from public.chat_channels where id=p_channel;
insert into public.chat_mentions(game_id,channel_id,message_id,author_id,mentioned_user_id)
select p_game,p_channel,v_id,v_uid,x.uid from (select distinct unnest(coalesce(p_mentioned_users,'{}'::uuid[])) uid)x
join public.game_members gm on gm.game_id=p_game and gm.user_id=x.uid and gm.kind<>'observer'
where x.uid<>v_uid and (v_kind='public' or exists(select 1 from public.channel_members cm where cm.channel_id=p_channel and cm.user_id=x.uid))
on conflict(message_id,mentioned_user_id) do nothing;return v_id;end;$$;
revoke all on function public.send_chat_text(uuid,uuid,text,uuid[]) from public,anon;grant execute on function public.send_chat_text(uuid,uuid,text,uuid[]) to authenticated;
create or replace function public.get_my_chat_overview(p_game_id uuid)
returns table(channel_id uuid,last_message_at timestamptz,last_message_text text,last_message_author_id uuid,unread_count bigint,mention_count bigint,last_sent_at timestamptz,last_read_at timestamptz,pinned_at timestamptz,pinned_rank integer)
language sql stable security definer set search_path=public,private,pg_temp as $$
with accessible as(select c.id,c.created_at from public.chat_channels c where c.game_id=p_game_id and private.can_access_channel(c.id)
 and(c.kind<>'private' or(select count(*) from public.channel_members cm where cm.channel_id=c.id)=2)),
state as(select s.* from public.chat_channel_state s where s.game_id=p_game_id and s.user_id=(select auth.uid()))
select a.id,lm.created_at,lm.text,lm.author_id,
(select count(*) from public.chat_messages m where m.channel_id=a.id and m.author_id is distinct from(select auth.uid()) and m.created_at>coalesce(s.last_read_at,'epoch'::timestamptz)),
(select count(*) from public.chat_mentions mn where mn.channel_id=a.id and mn.mentioned_user_id=(select auth.uid()) and mn.read_at is null),
s.last_sent_at,s.last_read_at,s.pinned_at,s.pinned_rank from accessible a left join state s on s.channel_id=a.id
left join lateral(select m.created_at,m.text,m.author_id from public.chat_messages m where m.channel_id=a.id order by m.created_at desc limit 1)lm on true
order by case when s.pinned_at is not null then 0 else 1 end,s.pinned_rank nulls last,lm.created_at desc nulls last,a.created_at desc;$$;
revoke all on function public.get_my_chat_overview(uuid) from public,anon;grant execute on function public.get_my_chat_overview(uuid) to authenticated;
do $$begin
if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='chat_channel_state') then alter publication supabase_realtime add table public.chat_channel_state;end if;
if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='chat_mentions') then alter publication supabase_realtime add table public.chat_mentions;end if;
end$$;
