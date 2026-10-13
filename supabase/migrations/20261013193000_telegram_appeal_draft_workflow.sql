-- Telegram reception: short-lived drafts, explicit confirmation, no fictitious appeals.
create table if not exists public.telegram_appeal_drafts (
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 author_id uuid not null,
 recipient_id uuid not null,
 status text not null default 'awaiting_text'
  check (status in ('awaiting_text','preview','sent','cancelled')),
 body text,
 source_message_id bigint,
 appeal_id uuid references public.official_appeals(id) on delete set null,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default (now()+interval '30 minutes'),
 sent_at timestamptz,
 constraint telegram_appeal_draft_body_length check
  (body is null or length(body) between 10 and 4000)
);
create unique index if not exists telegram_appeal_one_active_draft
 on public.telegram_appeal_drafts(game_id,author_id)
 where status in ('awaiting_text','preview');
create index if not exists telegram_appeal_drafts_expiry
 on public.telegram_appeal_drafts(expires_at) where status in ('awaiting_text','preview');
alter table public.telegram_appeal_drafts enable row level security;
revoke all on public.telegram_appeal_drafts from public,anon,authenticated;
grant select,insert,update on public.telegram_appeal_drafts to service_role;
-- No end-user policy; these are private, service-operated state transitions.
create or replace function public.telegram_confirm_appeal_draft(
 p_telegram_user_id bigint, p_draft_id uuid
) returns uuid
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare d public.telegram_appeal_drafts%rowtype; actor uuid; result uuid;
begin
 if auth.role() is distinct from 'service_role' then
  raise exception 'Telegram service only';
 end if;
 select * into d from public.telegram_appeal_drafts
 where id=p_draft_id for update;
 if d.id is null then raise exception 'Draft not found'; end if;
 select l.user_id into actor from public.telegram_links l
 join public.game_members m on m.game_id=l.game_id and m.user_id=l.user_id
 where l.telegram_user_id=p_telegram_user_id and l.game_id=d.game_id
  and m.roster_archived_at is null and m.kind<>'observer'
 limit 1;
 if actor is null or actor<>d.author_id then raise exception 'Draft access denied'; end if;
 if d.status='sent' and d.appeal_id is not null then return d.appeal_id; end if;
 if d.status<>'preview' or d.expires_at<=now()
    or d.source_message_id is null or d.body is null then
  raise exception 'Draft expired or unconfirmed';
 end if;
 if not exists (
  select 1 from public.game_members m where m.game_id=d.game_id
  and m.user_id=d.recipient_id and m.roster_archived_at is null
  and m.kind<>'observer' and m.user_id<>d.author_id
 ) then raise exception 'Recipient no longer available'; end if;
 result:=public.telegram_create_official_appeal(
  p_telegram_user_id,d.game_id,d.recipient_id,d.body,d.source_message_id
 );
 update public.telegram_appeal_drafts
 set status='sent',appeal_id=result,sent_at=now() where id=d.id;
 return result;
end $$;
revoke all on function public.telegram_confirm_appeal_draft(bigint,uuid)
 from public,anon,authenticated;
grant execute on function public.telegram_confirm_appeal_draft(bigint,uuid)
 to service_role;
