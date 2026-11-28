-- Apply only after the final survey UI is serving production.
DO $gate$
DECLARE d text;old_block text;new_block text;
BEGIN
 SELECT pg_get_functiondef('private.stage_readiness_json(uuid,integer)'::regprocedure) INTO d;
 old_block:=$old$  select count(*) into c3 from (select r.user_id from public.game_reflections r join public.game_members gm on gm.game_id=r.game_id and gm.user_id=r.user_id and gm.kind='student' and gm.roster_archived_at is null where r.game_id=p_game and r.status in ('submitted','reviewed') group by r.user_id having count(distinct r.phase_key)>=6) q;
  m:=jsonb_build_object('students',c,'students_completed_reflection',c3);
  if c=0 then b:=b||jsonb_build_array('В игре нет студентов, для которых можно провести итоговую рефлексию');
  elsif c3<c then b:=b||jsonb_build_array('Не все студенты сдали рефлексию по шести фазам игры'); end if;
  if exists(select 1 from public.game_reflections where game_id=p_game and status='submitted') then w:=w||jsonb_build_array('Есть сданные рефлексии, которые преподаватель ещё не разобрал'); end if;$old$;
 new_block:=$new$  select count(*) into c3 from public.game_final_surveys r join public.game_members gm on gm.game_id=r.game_id and gm.user_id=r.user_id and gm.kind='student' and gm.roster_archived_at is null where r.game_id=p_game;
  m:=jsonb_build_object('students',c,'students_completed_survey',c3,'students_completed_reflection',c3);
  if c=0 then b:=b||jsonb_build_array('В игре нет студентов, для которых можно провести итоговое анкетирование');
  elsif c3<c then b:=b||jsonb_build_array('Не все студенты сдали итоговую анкету'); end if;$new$;
 IF strpos(d,old_block)=0 OR strpos(replace(d,old_block,''),old_block)>0 THEN RAISE EXCEPTION 'Unexpected readiness definition'; END IF;
 EXECUTE replace(d,old_block,new_block);
END $gate$;
