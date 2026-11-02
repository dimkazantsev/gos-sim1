-- Analysis is submitted ONLY within the final hour of an open stage.
-- A teacher's early closure ends submission immediately; no retroactive changes
-- to previously submitted analyses, finalized scores, or any scoring formulas.
create or replace function public.submit_stage_debrief(
 p_game_id uuid,p_stage_no integer,p_body text
) returns uuid language plpgsql security definer
set search_path=public,private,pg_temp as $$
declare
 v_uid uuid:=(select auth.uid());
 v_id uuid;
 v_assessment_status text;
 v_stage_status text;
 v_deadline timestamptz;
 v_now timestamptz;
begin
 if v_uid is null then raise exception 'Authentication required';end if;
 if not exists(select 1 from public.game_members
  where game_id=p_game_id and user_id=v_uid and kind='student')
 then raise exception 'Student access required';end if;
 if p_stage_no<1 or p_stage_no>16 then raise exception 'Only stages 1-16 are assessed';end if;
 -- Lock the stage while saving so simultaneous teacher closure cannot race
 -- with the submission. The deadline is verified using the DB clock.
 select status,deadline into v_stage_status,v_deadline
 from public.game_stages where game_id=p_game_id and stage_no=p_stage_no for share;
 if not found or v_stage_status is distinct from 'open' then
  raise exception 'Этап уже завершён. Отправка анализа недоступна.';
 end if;
 if v_deadline is null then
  raise exception 'Время завершения этапа ещё не установлено.';
 end if;
 v_now:=clock_timestamp();
 if v_now<v_deadline-interval '1 hour' then
  raise exception 'Анализ можно отправить за час до окончания этапа.';
 end if;
 if v_now>=v_deadline then
  raise exception 'Срок этапа истёк. Отправка анализа недоступна.';
 end if;
 if length(trim(coalesce(p_body,'')))<40 then raise exception 'Debrief is too short';end if;
 select status into v_assessment_status from public.stage_assessments
 where game_id=p_game_id and stage_no=p_stage_no and user_id=v_uid for update;
 insert into public.stage_debriefs(game_id,stage_no,user_id,body)
 values(p_game_id,p_stage_no,v_uid,trim(p_body))
 on conflict(game_id,stage_no,user_id)
 do update set body=excluded.body,updated_at=now()
 returning id into v_id;
 -- Existing finalized grades remain immutable. Preserve current score policy.
 if v_assessment_status is distinct from 'final' then
  perform private.compute_vsn_assessment(p_game_id,v_uid,p_stage_no,'debrief');
 end if;
 return v_id;
end;$$;
revoke all on function public.submit_stage_debrief(uuid,integer,text) from public,anon;
grant execute on function public.submit_stage_debrief(uuid,integer,text) to authenticated;

-- Compact 16-row teacher-only projection. The existing composite index
-- (game_id, stage_no, user_id) serves the grouped scan; no new index needed.
create or replace function public.get_stage_debrief_counts(p_game_id uuid)
returns table(stage_no integer,submitted integer)
language plpgsql stable security definer
set search_path=public,private,pg_temp as $$
begin
 if (select auth.uid()) is null or not private.is_game_teacher(p_game_id) then
  raise exception 'Teacher access required';
 end if;
 return query
 select d.stage_no,count(*)::integer
 from public.stage_debriefs d
 join public.game_members m on m.game_id=d.game_id and m.user_id=d.user_id
 where d.game_id=p_game_id and d.stage_no between 1 and 16
   and m.kind='student' and m.roster_archived_at is null
 group by d.stage_no order by d.stage_no;
end;$$;
revoke all on function public.get_stage_debrief_counts(uuid) from public,anon;
grant execute on function public.get_stage_debrief_counts(uuid) to authenticated;
