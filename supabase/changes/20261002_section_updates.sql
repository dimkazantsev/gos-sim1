create table if not exists public.section_reads (
 game_id uuid not null references public.games(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 section_key text not null check(section_key in ('documents','votes','events')),
 seen_at timestamptz not null default '-infinity',primary key(game_id,user_id,section_key)
);
alter table public.section_reads enable row level security;
create policy section_reads_own_select on public.section_reads for select to authenticated using(user_id=auth.uid() and private.is_game_member(game_id));
create or replace function public.get_section_updates(p_game_id uuid) returns jsonb language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare d timestamptz;v timestamptz;e timestamptz;u uuid:=auth.uid(); begin
 if not private.is_game_member(p_game_id) then raise exception 'Нет доступа к игре.';end if;
 select coalesce(max(seen_at),'-infinity') into d from section_reads where game_id=p_game_id and user_id=u and section_key='documents';
 select coalesce(max(seen_at),'-infinity') into v from section_reads where game_id=p_game_id and user_id=u and section_key='votes';
 select coalesce(max(seen_at),'-infinity') into e from section_reads where game_id=p_game_id and user_id=u and section_key='events';
 return jsonb_build_object(
 'documents',(select count(*) from formal_documents where game_id=p_game_id and updated_at>d),
 'votes',(select count(*) from game_votes where game_id=p_game_id and opened_at>v),
 'events',(select count(*) from (select id from event_assignments where game_id=p_game_id and recipient_id=u and created_at>e union all select id from event_collaboration_invites where game_id=p_game_id and recipient_id=u and status='pending' and created_at>e) q));
end $$;
create or replace function public.mark_section_read(p_game_id uuid,p_section text,p_seen_at timestamptz) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 if not private.is_game_member(p_game_id) then raise exception 'Нет доступа к игре.';end if;
 if p_section not in ('documents','votes','events') then raise exception 'Неизвестный раздел.';end if;
 insert into section_reads(game_id,user_id,section_key,seen_at) values(p_game_id,auth.uid(),p_section,least(p_seen_at,clock_timestamp()))
 on conflict(game_id,user_id,section_key) do update set seen_at=greatest(section_reads.seen_at,excluded.seen_at);
end $$;
revoke all on function public.get_section_updates(uuid), public.mark_section_read(uuid,text,timestamptz) from public,anon;
grant execute on function public.get_section_updates(uuid), public.mark_section_read(uuid,text,timestamptz) to authenticated;
