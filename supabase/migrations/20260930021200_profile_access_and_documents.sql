-- Explicit account-based administration. Names never confer privileges.
create or replace function private.is_game_member(g uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select private.is_platform_admin() or exists(select 1 from public.game_members where game_id=g and user_id=(select auth.uid()));
$$;
grant execute on function private.is_platform_admin() to authenticated;

create or replace function public.ensure_my_game_access(p_game uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Войдите в учётную запись';end if;
 if not private.is_platform_admin() then return;end if;
 if not exists(select 1 from public.games where id=p_game) then raise exception 'Игра не найдена';end if;
 insert into public.game_members(game_id,user_id,full_name,kind,role_title)
 select p_game,auth.uid(),coalesce((select full_name from public.game_members where user_id=auth.uid() order by joined_at desc limit 1),'Администратор'),'teacher','Руководитель симуляции'
 on conflict(game_id,user_id) do update set kind='teacher',role_title=case when game_members.role_title is null or game_members.role_title in ('Преподаватель','Участник','Гость') then 'Руководитель симуляции' else game_members.role_title end
 where game_members.kind<>'teacher' or game_members.role_title is null or game_members.role_title in ('Преподаватель','Участник','Гость');
end;$$;
revoke all on function public.ensure_my_game_access(uuid) from public,anon;
grant execute on function public.ensure_my_game_access(uuid) to authenticated;

create or replace function public.resume_member_game(p_game_code text)
returns uuid language plpgsql security definer set search_path='' as $$
declare g uuid;
begin
 if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,true) then raise exception 'Войдите с электронной почтой и личным паролем';end if;
 select id into g from public.games where game_code=upper(trim(p_game_code));
 if g is null then raise exception 'Игра с таким кодом не найдена';end if;
 perform public.ensure_my_game_access(g);
 if not private.is_game_member(g) then raise exception 'Ваша учётная запись не участвует в этой игре';end if;
 return g;
end;$$;

create or replace function private.preserve_platform_admin_role()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.platform_admins where user_id=new.user_id) then
  new.kind:='teacher';
  if new.role_title is null or new.role_title in ('Участник','Гость','Преподаватель') then new.role_title:='Руководитель симуляции';end if;
 end if;
 return new;
end;$$;
drop trigger if exists preserve_platform_admin_role on public.game_members;
create trigger preserve_platform_admin_role before insert or update on public.game_members for each row execute function private.preserve_platform_admin_role();

create or replace function private.is_game_observer(g uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select not private.is_platform_admin() and exists(select 1 from public.game_members where game_id=g and user_id=(select auth.uid()) and kind='observer');
$$;
grant execute on function private.is_game_observer(uuid) to authenticated;
revoke all on function private.is_game_observer(uuid) from public,anon;

create table if not exists public.profile_document_links(
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 title text not null check(char_length(trim(title)) between 1 and 160),
 provider text not null check(provider in ('google','yandex')),
 url text not null check(char_length(url)<=2048),
 created_at timestamptz not null default now(),
 constraint supported_document_url check(
  (provider='google' and url ~ '^https://(docs\.google\.com|drive\.google\.com)/[^[:space:]]+$') or
  (provider='yandex' and url ~ '^https://(docs\.yandex\.(ru|com)|disk\.yandex\.(ru|com)|doc\.yandex\.(ru|com)|yadi\.sk)/[^[:space:]]*$')),
 unique(game_id,user_id,url)
);
create index if not exists profile_document_links_owner on public.profile_document_links(user_id,game_id);
alter table public.profile_document_links enable row level security;
grant select,insert,update,delete on public.profile_document_links to authenticated;
create policy own_document_links on public.profile_document_links for all to authenticated using(user_id=(select auth.uid()) and private.is_game_member(game_id) and not private.is_game_observer(game_id)) with check(user_id=(select auth.uid()) and private.is_game_member(game_id) and not private.is_game_observer(game_id));
create trigger guard_observer_write before insert or update or delete on public.profile_document_links for each row execute function private.prevent_observer_mutation();
