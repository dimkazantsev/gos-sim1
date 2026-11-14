-- The student debrief window begins at actual stage completion, including early closure.
-- Keep one analysis per stage/student, teacher's final scores immutable, and the
-- authenticated-student-only entrypoint. There are no background jobs or new indexes.
create or replace function public.submit_stage_debrief(
 p_game_id uuid,p_stage_no integer,p_body text
) returns uuid language plpgsql security definer
set search_path=public,private,pg_temp as $$
declare
 v_uid uuid:=(select auth.uid());
 v_id uuid;
 v_assessment_status text;
 v_stage_status text;
 v_completed_at timestamptz;
 v_now timestamptz;
begin
 if v_uid is null then raise exception 'Authentication required';end if;
 if not exists(select 1 from public.game_members
  where game_id=p_game_id and user_id=v_uid and kind='student')
 then raise exception 'Student access required';end if;
 if p_stage_no<1 or p_stage_no>16 then raise exception 'Only stages 1-16 are assessed';end if;
 -- Lock the stage row against concurrent administrative state changes.
 select status,completed_at into v_stage_status,v_completed_at
 from public.game_stages where game_id=p_game_id and stage_no=p_stage_no for share;
 if not found or v_stage_status is distinct from 'completed' or v_completed_at is null then
  raise exception 'Анализ доступен только после завершения этапа.';
 end if;
 v_now:=clock_timestamp();
 if v_now<v_completed_at then
  raise exception 'Время начала анализа ещё не наступило.';
 end if;
 if v_now>=v_completed_at+interval '1 hour' then
  raise exception 'Час на анализ завершён. Отправка недоступна.';
 end if;
 if length(trim(coalesce(p_body,'')))<40 then raise exception 'Debrief is too short';end if;
 select status into v_assessment_status from public.stage_assessments
 where game_id=p_game_id and stage_no=p_stage_no and user_id=v_uid for update;
 insert into public.stage_debriefs(game_id,stage_no,user_id,body)
 values(p_game_id,p_stage_no,v_uid,trim(p_body))
 on conflict(game_id,stage_no,user_id)
 do update set body=excluded.body,updated_at=now()
 returning id into v_id;
 if v_assessment_status is distinct from 'final' then
  perform private.compute_vsn_assessment(p_game_id,v_uid,p_stage_no,'debrief');
 end if;
 return v_id;
end;$$;
revoke all on function public.submit_stage_debrief(uuid,integer,text) from public,anon;
grant execute on function public.submit_stage_debrief(uuid,integer,text) to authenticated;
