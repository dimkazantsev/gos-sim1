-- Protect completion flags from direct profile-table updates.
create or replace function private.guard_profile_completion_flags()
returns trigger language plpgsql set search_path='' as $$
begin
 if current_user='authenticated' then
  if tg_op='INSERT' and (new.onboarding_completed_at is not null or new.intro_seen_at is not null) then raise exception 'Пройдите приветствие и завершите настройку профиля';end if;
  if tg_op='UPDATE' and (new.onboarding_completed_at is distinct from old.onboarding_completed_at or new.intro_seen_at is distinct from old.intro_seen_at) then raise exception 'Завершайте настройку через форму профиля';end if;
 end if;
 return new;
end;$$;
create trigger guard_profile_completion_flags before insert or update on public.game_profiles for each row execute function private.guard_profile_completion_flags();

-- Avatar owners may clean up obsolete avatars; historical signatures are excluded.
create policy own_avatar_cleanup on storage.objects for delete to authenticated using
 (bucket_id='game-assets' and split_part(name,'/',2)='profiles' and split_part(name,'/',3)=(select auth.uid())::text and split_part(name,'/',4) like 'avatar-%' and private.is_game_member(split_part(name,'/',1)::uuid) and not private.is_game_observer(split_part(name,'/',1)::uuid));

-- Guests could previously upload a file even though the profile row was blocked.
-- Limit this change to profile uploads; leave all other storage policies intact.
drop policy if exists game_assets_profile_insert on storage.objects;
create policy game_assets_profile_insert on storage.objects for insert to authenticated with check
 (bucket_id='game-assets' and split_part(name,'/',2)='profiles' and split_part(name,'/',3)=(select auth.uid())::text and private.is_game_member(split_part(name,'/',1)::uuid) and not private.is_game_observer(split_part(name,'/',1)::uuid));
