-- Secure official Telegram correspondence. No existing data changes.
create table if not exists public.official_appeals(
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 author_id uuid not null,
 recipient_id uuid not null,
 body text not null check(char_length(btrim(body)) between 10 and 4000),
 reply_text text,
 status text not null default 'open' check(status in ('open','replied')),
 telegram_message_id bigint not null,
 reply_message_id bigint,
 created_at timestamptz not null default now(),
 replied_at timestamptz,
 foreign key(game_id,author_id) references public.game_members(game_id,user_id),
 foreign key(game_id,recipient_id) references public.game_members(game_id,user_id),
 unique(game_id,author_id,telegram_message_id)
);
create index if not exists official_appeals_receiver on public.official_appeals(game_id,recipient_id,created_at desc);
alter table public.official_appeals enable row level security;
revoke all on public.official_appeals from anon,authenticated;
grant select on public.official_appeals to authenticated;
grant select,insert,update on public.official_appeals to service_role;
drop policy if exists official_appeals_read on public.official_appeals;
create policy official_appeals_read on public.official_appeals for select to authenticated
 using((author_id=(select auth.uid()) or recipient_id=(select auth.uid())
   or exists(select 1 from public.game_members gm where gm.game_id=official_appeals.game_id and gm.user_id=(select auth.uid()) and gm.kind='teacher' and gm.roster_archived_at is null))
 and exists(select 1 from public.game_members gm where gm.game_id=official_appeals.game_id and gm.user_id=(select auth.uid()) and gm.roster_archived_at is null));

create or replace function public.telegram_create_official_appeal(
 p_telegram_user_id bigint,p_game_id uuid,p_recipient_id uuid,p_body text,p_message_id bigint
) returns uuid language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare actor uuid; result uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Telegram service only'; end if;
 select l.user_id into actor from public.telegram_links l
 join public.game_members m on m.game_id=l.game_id and m.user_id=l.user_id
 where l.telegram_user_id=p_telegram_user_id and l.game_id=p_game_id
 and m.kind<>'observer' and m.roster_archived_at is null;
 if actor is null or actor=p_recipient_id or
 not exists(select 1 from public.game_members m where m.game_id=p_game_id and m.user_id=p_recipient_id and m.kind<>'observer' and m.roster_archived_at is null)
 then raise exception 'Appeal access denied';end if;
 if length(btrim(coalesce(p_body,''))) not between 10 and 4000 then raise exception 'Invalid appeal length';end if;
 insert into public.official_appeals(game_id,author_id,recipient_id,body,telegram_message_id)
 values(p_game_id,actor,p_recipient_id,btrim(p_body),p_message_id)
 on conflict(game_id,author_id,telegram_message_id) do update set id=official_appeals.id
 returning id into result;
 return result;
end $$;
create or replace function public.telegram_reply_official_appeal(
 p_telegram_user_id bigint,p_appeal_id uuid,p_text text,p_message_id bigint
) returns boolean language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare actor uuid; a public.official_appeals%rowtype;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Telegram service only';end if;
 select * into a from public.official_appeals where id=p_appeal_id for update;
 if a.id is null then raise exception 'Appeal not found';end if;
 select l.user_id into actor from public.telegram_links l
 join public.game_members m on m.game_id=l.game_id and m.user_id=l.user_id
 where l.telegram_user_id=p_telegram_user_id and l.game_id=a.game_id and m.roster_archived_at is null
  and m.kind<>'observer' and (l.user_id=a.recipient_id or m.kind='teacher') limit 1;
 if actor is null then raise exception 'Reply access denied';end if;
 if a.status='replied' and a.reply_message_id=p_message_id then return true;end if;
 if a.status<>'open' then raise exception 'Appeal already answered';end if;
 if length(btrim(coalesce(p_text,''))) not between 1 and 4000 then raise exception 'Invalid reply';end if;
 update public.official_appeals set reply_text=btrim(p_text),status='replied',reply_message_id=p_message_id,replied_at=now() where id=p_appeal_id;
 return true;
end $$;
revoke all on function public.telegram_create_official_appeal(bigint,uuid,uuid,text,bigint) from public,anon,authenticated;
revoke all on function public.telegram_reply_official_appeal(bigint,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.telegram_create_official_appeal(bigint,uuid,uuid,text,bigint) to service_role;
grant execute on function public.telegram_reply_official_appeal(bigint,uuid,text,bigint) to service_role;

create or replace function private.gos_appeal_notify()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
 if tg_op='INSERT' then
 insert into public.telegram_outbox(game_id,user_id,category,source_id,body)
 select new.game_id,new.recipient_id,'appeal',new.id,
  '📨 Новое официальное обращение: '||left(new.body,300)||E'\n'||
  'Откройте «Приёмную» и подготовьте ответ.'
 from public.telegram_links l where l.game_id=new.game_id and l.user_id=new.recipient_id and l.notifications_enabled
 on conflict do nothing;
 elsif new.status='replied' and old.status='open' then
 insert into public.telegram_outbox(game_id,user_id,category,source_id,body)
 select new.game_id,new.author_id,'appeal_reply',new.id,
  '📬 Получен ответ на ваше обращение: '||left(new.reply_text,300)
 from public.telegram_links l where l.game_id=new.game_id and l.user_id=new.author_id and l.notifications_enabled
 on conflict do nothing;
 end if;
 return new;
end $$;
drop trigger if exists gos_appeal_notify on public.official_appeals;
create trigger gos_appeal_notify after insert or update of status on public.official_appeals
 for each row execute function private.gos_appeal_notify();
