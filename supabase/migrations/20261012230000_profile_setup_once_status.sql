-- First-login setup prompt and authoritative missing-field checklist.
-- Separate from the intro comic flag, and never expose Auth password fields.
alter table public.game_profiles
 add column if not exists profile_setup_prompt_seen_at timestamptz;

create or replace function public.get_my_game_profile_setup(p_game uuid)
returns jsonb language plpgsql stable security definer
set search_path=public,private,pg_temp as $$
declare
 m public.game_members%rowtype;
 p public.game_profiles%rowtype;
 account record;
 missing text[] := array[]::text[];
begin
 if auth.uid() is null or not private.is_game_member(p_game) then
  raise exception 'Нет доступа к игре';
 end if;
 select * into m from public.game_members where game_id=p_game and user_id=auth.uid();
 if m.user_id is null or m.kind='observer' then
  raise exception 'Настройка профиля доступна участникам и преподавателю';
 end if;
 select * into p from public.game_profiles where game_id=p_game and user_id=auth.uid();
 if p.onboarding_completed_at is null then
  if trim(coalesce(m.full_name,'')) !~ '^[^[:space:]]+[[:space:]]+[^[:space:]]+[[:space:]]+' then missing:=array_append(missing,'name');end if;
  if coalesce(p.gender,'unspecified')='unspecified' then missing:=array_append(missing,'gender');end if;
  if length(trim(coalesce(p.bio,'')))<15 then missing:=array_append(missing,'bio');end if;
  if nullif(trim(coalesce(p.signature_path,'')),'') is null then missing:=array_append(missing,'signature');end if;
  select email,email_confirmed_at,encrypted_password,is_anonymous
    into account from auth.users where id=auth.uid();
  if account.email is null or account.email_confirmed_at is null or coalesce(account.is_anonymous,false) then
   missing:=array_append(missing,'email');
  end if;
  if nullif(account.encrypted_password,'') is null then
   missing:=array_append(missing,'password');
  end if;
 end if;
 return jsonb_build_object(
  'completed',p.onboarding_completed_at is not null,
  'prompt_seen',p.profile_setup_prompt_seen_at is not null or p.onboarding_completed_at is not null,
  'missing',to_jsonb(missing)
 );
end;$$;

create or replace function public.mark_my_game_profile_setup_prompt_seen(p_game uuid)
returns void language plpgsql security definer
set search_path=public,private,pg_temp as $$
begin
 if auth.uid() is null or not private.is_game_member(p_game) or private.is_game_observer(p_game) then
  raise exception 'Нет доступа к настройке профиля';
 end if;
 insert into public.game_profiles(game_id,user_id,profile_setup_prompt_seen_at)
 values (p_game,auth.uid(),now())
 on conflict (game_id,user_id) do update
 set profile_setup_prompt_seen_at=coalesce(game_profiles.profile_setup_prompt_seen_at,excluded.profile_setup_prompt_seen_at);
end;$$;
revoke all on function public.get_my_game_profile_setup(uuid) from public,anon;
grant execute on function public.get_my_game_profile_setup(uuid) to authenticated;
revoke all on function public.mark_my_game_profile_setup_prompt_seen(uuid) from public,anon;
grant execute on function public.mark_my_game_profile_setup_prompt_seen(uuid) to authenticated;