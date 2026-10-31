-- Reduce teacher journal transfer to the last 20 events per update.
-- Historical rows stay in the database and can be paged on demand.
-- Changes transport only; journal, Presence persistence, roles and scoring are unchanged.
create or replace function public.get_classroom_telemetry_projection(p_game_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  -- The existing classroom screen is for teachers; the helper includes
  -- the permanent platform administrator. Table RLS remains authoritative.
  if auth.uid() is null or not private.is_game_teacher(p_game_id) then
    raise exception 'Нет доступа к журналу аудитории.' using errcode='42501';
  end if;

  return jsonb_build_object(
    'activity',coalesce((
      select jsonb_agg(to_jsonb(a) order by a.created_at desc,a.id desc)
      from (
        select * from public.game_activity
        where game_id=p_game_id
        order by created_at desc,id desc
        limit 20
      ) a
    ),'[]'::jsonb),
    'presence',coalesce((
      select jsonb_agg(to_jsonb(p) order by p.last_seen_at desc)
      from public.game_presence p
      where p.game_id=p_game_id
    ),'[]'::jsonb)
  );
end;
$function$;

revoke all on function public.get_classroom_telemetry_projection(uuid) from public, anon;
grant execute on function public.get_classroom_telemetry_projection(uuid) to authenticated;
