-- Restore the nightly-only contract after the older daytime throttling migration.
create or replace function public.evaluate_game_achievements(p_game_id uuid)
returns integer language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 if auth.uid() is null or not exists(
  select 1 from public.game_members where game_id=p_game_id and user_id=auth.uid() and kind='student'
 ) then return 0;end if;
 return 0;
end$$;
revoke all on function public.evaluate_game_achievements(uuid) from public,anon;
grant execute on function public.evaluate_game_achievements(uuid) to authenticated;
