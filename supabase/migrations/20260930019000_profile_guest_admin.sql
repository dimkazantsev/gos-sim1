-- Explicit self-declared gender and onboarding flags. Never infer identity/privileges from names.
alter table public.game_profiles add column if not exists gender text not null default 'unspecified'
 check(gender in ('male','female','unspecified'));
alter table public.game_profiles add column if not exists onboarding_completed_at timestamptz;
create table if not exists public.platform_admins(
 user_id uuid primary key references auth.users(id) on delete cascade,
 granted_by uuid references auth.users(id),
 granted_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from anon,authenticated;
create or replace function private.is_platform_admin()
returns boolean language sql stable security definer set search_path=public,private,pg_temp as $$
 select exists(select 1 from public.platform_admins where user_id=(select auth.uid()))
$$;
revoke all on function private.is_platform_admin() from public,anon,authenticated;
create or replace function private.is_game_teacher(g uuid)
returns boolean language sql stable security definer set search_path=public,private,pg_temp as $$
 select private.is_platform_admin() or exists(
  select 1 from public.game_members gm where gm.game_id=g and gm.user_id=(select auth.uid()) and gm.kind='teacher'
 )
$$;
-- Guests are read-only across all public gameplay write tables that support game_id.
do $$
declare t text;
begin
 foreach t in array ARRAY[
 'player_actions','political_posts','chat_messages','formal_documents','game_votes',
 'game_ballots','game_events','game_parties','party_documents','event_cases',
 'event_assignments','event_decisions','game_activity'
 ] loop
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name=t and column_name='game_id') then
   execute format('drop policy if exists guests_cannot_write on public.%I',t);
   execute format(
    'create policy guests_cannot_write on public.%I as restrictive for all to authenticated using
     ((select auth.uid()) not in (select user_id from public.game_members where game_id=%I.game_id and kind=''observer''))
     with check ((select auth.uid()) not in (select user_id from public.game_members where game_id=%I.game_id and kind=''observer''))',
    t,t,t
   );
  end if;
 end loop;
end;
$$;
-- Teacher creates separate observer invite codes with normal crypt hashing.
create or replace function public.create_observer_invite(p_game_id uuid,p_code text)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher required';end if;
 if char_length(trim(p_code))<6 then raise exception 'Observer code must have 6+ characters';end if;
 insert into public.invite_codes(game_id,code_hash,kind,active)
 values(p_game_id,extensions.crypt(trim(p_code),extensions.gen_salt('bf')),'observer',true);
end;
$$;
revoke all on function public.create_observer_invite(uuid,text) from public,anon;
grant execute on function public.create_observer_invite(uuid,text) to authenticated;
