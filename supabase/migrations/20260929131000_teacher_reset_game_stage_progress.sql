-- Stage progress reset: teacher-only, transactional and audited.
-- Resets stage lifecycle fields only; preserves votes, documents, grades and other work.
create or replace function public.reset_game_stage_progress(
  p_game_id uuid,
  p_stage_no integer default null
)
returns integer
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $function$
declare
  v_count integer := 0;
  v_game_round integer;
  v_was_open boolean := false;
  v_target_id uuid;
begin
  if p_game_id is null or not private.is_game_teacher(p_game_id) then
    raise exception 'Teacher access required';
  end if;
  if p_stage_no is not null and (p_stage_no < 1 or p_stage_no > 16) then
    raise exception 'Stage must be between 1 and 16';
  end if;

  select current_round into v_game_round
    from public.games where id = p_game_id for update;
  if not found then raise exception 'Game does not exist'; end if;

  if p_stage_no is null then
    -- Clear only the lifecycle of the 16 stages, not student submissions or grades.
    update public.game_stages
      set status = 'locked', opened_at = null, completed_at = null, deadline = null
      where game_id = p_game_id;
    get diagnostics v_count = row_count;
    update public.games set current_round = 1, turn_open = false,
      turn_ends_at = null, status = 'paused'
      where id = p_game_id;
  else
    select id, status = 'open' into v_target_id, v_was_open
      from public.game_stages
      where game_id = p_game_id and stage_no = p_stage_no
      for update;
    if not found then raise exception 'Stage does not exist'; end if;
    update public.game_stages
      set status = 'locked', opened_at = null, completed_at = null, deadline = null
      where id = v_target_id;
    get diagnostics v_count = row_count;
    -- Pause only if the currently running stage was reset.
    if v_was_open and v_game_round = p_stage_no then
      update public.games set turn_open = false, turn_ends_at = null,
        status = 'paused'
        where id = p_game_id;
    end if;
  end if;

  insert into public.audit_log(game_id,actor_id,action,entity_type,entity_id,payload)
  values (
    p_game_id, auth.uid(),
    case when p_stage_no is null then 'all_stage_progress_reset' else 'stage_progress_reset' end,
    'game_stages',v_target_id,
    jsonb_build_object('stage_no',p_stage_no,'affected_stages',v_count,'preserves_work',true)
  );
  return v_count;
end;
$function$;

revoke all on function public.reset_game_stage_progress(uuid,integer) from public,anon;
grant execute on function public.reset_game_stage_progress(uuid,integer) to authenticated;
