-- Harden VSN assessment internals and lock student debriefs after finalization.

revoke execute on function private.compute_vsn_assessment(uuid,uuid,integer,text) from public, anon, authenticated;
revoke execute on function private.run_vsn_game(uuid,text) from public, anon, authenticated;
revoke execute on function private.run_vsn_all(text) from public, anon, authenticated;
revoke execute on function private.run_due_nightly_vsn() from public, anon, authenticated;
revoke execute on function private.vsn_stage_window(uuid,integer) from public, anon, authenticated;
revoke execute on function private.vsn_stage_status_trigger() from public, anon, authenticated;
revoke execute on function private.vsn_new_student_trigger() from public, anon, authenticated;

revoke insert, update, delete on table public.stage_debriefs from authenticated, anon;

drop policy if exists stage_debriefs_insert on public.stage_debriefs;
drop policy if exists stage_debriefs_update on public.stage_debriefs;

create or replace function public.submit_stage_debrief(
  p_game_id uuid,p_stage_no integer,p_body text
) returns uuid
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare
  v_uid uuid:=(select auth.uid());
  v_id uuid;
  v_assessment_status text;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  if not exists(
    select 1
    from public.game_members
    where game_id=p_game_id and user_id=v_uid and kind='student'
  ) then
    raise exception 'Student access required';
  end if;

  if p_stage_no<1 or p_stage_no>16 then
    raise exception 'Only stages 1-16 are assessed';
  end if;

  if not exists(
    select 1
    from public.game_stages
    where game_id=p_game_id
      and stage_no=p_stage_no
      and status in ('open','completed')
  ) then
    raise exception 'Debrief is available only for an open or completed stage';
  end if;

  select status into v_assessment_status
  from public.stage_assessments
  where game_id=p_game_id and stage_no=p_stage_no and user_id=v_uid
  for update;

  if v_assessment_status='final' then
    raise exception 'Final assessment is locked';
  end if;

  if length(trim(coalesce(p_body,'')))<40 then
    raise exception 'Debrief is too short';
  end if;

  insert into public.stage_debriefs(game_id,stage_no,user_id,body)
  values(p_game_id,p_stage_no,v_uid,trim(p_body))
  on conflict(game_id,stage_no,user_id)
  do update set body=excluded.body,updated_at=now()
  returning id into v_id;

  perform private.compute_vsn_assessment(p_game_id,v_uid,p_stage_no,'debrief');
  return v_id;
end;
$$;

revoke all on function public.submit_stage_debrief(uuid,integer,text) from public,anon;
grant execute on function public.submit_stage_debrief(uuid,integer,text) to authenticated;
