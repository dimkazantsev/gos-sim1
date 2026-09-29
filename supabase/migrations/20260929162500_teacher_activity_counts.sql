-- Accurate per-participant activity totals for the teacher analytics dashboard.
-- Teacher membership is checked inside the function; RLS still applies to reads.
create or replace function public.teacher_game_activity_counts(p_game_id uuid)
returns table (user_id uuid, activity_count bigint)
language plpgsql stable security invoker
set search_path = public, private, pg_temp
as $function$
begin
 if p_game_id is null or not private.is_game_teacher(p_game_id) then
  raise exception 'Teacher access required';
 end if;
 return query select a.actor_id,a.count_events
 from (
  select actor_id,count(*)::bigint as count_events
  from public.game_activity
  where game_id=p_game_id
  group by actor_id
 ) a;
end;
$function$;
revoke all on function public.teacher_game_activity_counts(uuid) from public,anon;
grant execute on function public.teacher_game_activity_counts(uuid) to authenticated;
