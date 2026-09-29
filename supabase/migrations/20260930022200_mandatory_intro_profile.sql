-- A player enters normal gameplay only after the introductory comic and a complete,
-- verified and user-owned profile. Password hashes never leave Supabase Auth.
alter table public.game_profiles add column if not exists intro_seen_at timestamptz;
create or replace function public.update_my_game_identity(p_game uuid,p_full_name text,p_gender text)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 if auth.uid() is null or not private.is_game_member(p_game) then raise exception 'Game membership required';end if;
 if not p_full_name ~ '^[^[:space:]]+[[:space:]]+[^[:space:]]+[[:space:]]+[^[:space:]]+'
 then raise exception 'Укажите полностью фамилию, имя и отчество';end if;
 if p_gender not in ('male','female','unspecified') then raise exception 'Invalid gender';end if;
 update public.game_members set full_name=trim(p_full_name) where game_id=p_game and user_id=auth.uid();
 insert into public.game_profiles(game_id,user_id,gender)
 values(p_game,auth.uid(),p_gender) on conflict(game_id,user_id) do update set gender=excluded.gender;
end;
$$;
revoke all on function public.update_my_game_identity(uuid,text,text) from public,anon;
grant execute on function public.update_my_game_identity(uuid,text,text) to authenticated;
create or replace function public.mark_my_intro_seen(p_game uuid)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 if not private.is_game_member(p_game) then raise exception 'Game membership required';end if;
 insert into public.game_profiles(game_id,user_id,intro_seen_at)
 values(p_game,auth.uid(),now()) on conflict(game_id,user_id) do update set intro_seen_at=coalesce(game_profiles.intro_seen_at,now());
end;
$$;
revoke all on function public.mark_my_intro_seen(uuid) from public,anon;
grant execute on function public.mark_my_intro_seen(uuid) to authenticated;
create or replace function public.complete_my_game_profile(p_game uuid)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare m public.game_members%rowtype;p public.game_profiles%rowtype;u record;
begin
 select * into m from public.game_members where game_id=p_game and user_id=auth.uid();
 if m.user_id is null or m.kind='observer' then raise exception 'Only students and teachers complete onboarding';end if;
 select * into p from public.game_profiles where game_id=p_game and user_id=auth.uid();
 select email,email_confirmed_at,encrypted_password into u from auth.users where id=auth.uid();
 if p.intro_seen_at is null then raise exception 'Сначала посмотрите приветственный комикс';end if;
 if not trim(m.full_name) ~ '^[^[:space:]]+[[:space:]]+[^[:space:]]+[[:space:]]+[^[:space:]]+'
 then raise exception 'Укажите ФИО полностью';end if;
 if coalesce(p.gender,'unspecified')='unspecified' then raise exception 'Укажите пол для аватара';end if;
 if length(trim(coalesce(p.bio,'')))<15 then raise exception 'Добавьте описание не короче 15 символов';end if;
 if nullif(trim(coalesce(p.signature_path,'')),'') is null then raise exception 'Загрузите игровую подпись';end if;
 if u.email is null or u.email_confirmed_at is null or nullif(u.encrypted_password,'') is null
 then raise exception 'Подтвердите почту и установите личный пароль';end if;
 update public.game_profiles set onboarding_completed_at=coalesce(onboarding_completed_at,now())
 where game_id=p_game and user_id=auth.uid();
end;
$$;
revoke all on function public.complete_my_game_profile(uuid) from public,anon;
grant execute on function public.complete_my_game_profile(uuid) to authenticated;