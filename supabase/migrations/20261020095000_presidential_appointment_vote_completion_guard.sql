-- ГОС.ID: согласовать издание указа Президента с утверждённым маршрутом НПА.
-- Не изменять чужие документы, назначения, результаты и полномочия.
DO $patch$
DECLARE v_def text;
BEGIN
 v_def:=pg_get_functiondef('private.stage8_create_appointment_decree(uuid)'::regprocedure);
 IF position("v_body,'president_act',2," in v_def)>0 THEN RETURN; END IF;
 IF position("v_body,'president_decree',2," in v_def)=0
   OR position("n.office_kind='central_bank_chair' then return null" in lower(v_def))=0
   OR position("n.appointment_document_id is not null" in lower(v_def))=0
   OR jsonb_array_length(private.formal_workflow('president_act'))<3
   OR private.formal_workflow('president_act')->2->>'code' IS DISTINCT FROM 'signed'
 THEN RAISE EXCEPTION 'Текущая процедура указа или утверждённый маршрут изменились'; END IF;
 v_def:=replace(v_def,"v_body,'president_decree',2,","v_body,'president_act',2,");
 IF position("v_body,'president_act',2," in v_def)=0 THEN
  RAISE EXCEPTION 'Замена маршрута указа Президента не выполнена'; END IF;
 EXECUTE v_def;
END;
$patch$;

-- Защита серверного закрытия голосований. Роли и кворум остаются прежними;
-- не-преподаватель должен дождаться голоса КАЖДОГО зарегистрированного
-- участника, имеющего вес в исходном составе голосования.
DO $patch$
DECLARE v_def text;
v_target text:='return private.finalize_procedural_vote(p_vote_id,p_note);';
v_guard text:=$guard$
 if not private.is_game_teacher(v.game_id)
    and (coalesce((v.electorate_snapshot->>'attendance_required')::boolean,false)
         or v.procedure_key in ('registered_session','presidential_system',
                               'sf_resolution','government_nomination')) then
   if not exists(
     select 1 from public.institution_session_registrations r
     where r.game_id=v.game_id and r.stage_no=v.stage_no
       and r.institution_key=v.institution_key
       and coalesce((v.electorate_snapshot->'weights'->>r.user_id::text)::numeric,0)>0
       and private.vote_eligible_weight(v,r.user_id)>0
   ) or exists(
     select 1 from public.institution_session_registrations r
     where r.game_id=v.game_id and r.stage_no=v.stage_no
       and r.institution_key=v.institution_key
       and coalesce((v.electorate_snapshot->'weights'->>r.user_id::text)::numeric,0)>0
       and private.vote_eligible_weight(v,r.user_id)>0
       and not exists(
         select 1 from public.game_ballots b
         where b.vote_id=v.id and b.voter_id=r.user_id
       )
   ) then
     raise exception 'Голосование не завершено: ещё не все зарегистрированные участники проголосовали'
       using errcode='42501';
   end if;
 end if;
$guard$;
BEGIN
 v_def:=pg_get_functiondef('public.close_procedural_vote(uuid,text)'::regprocedure);
 IF position('Голосование не завершено: ещё не все зарегистрированные участники проголосовали' in v_def)>0
 THEN RETURN; END IF;
 IF position(v_target in v_def)=0
   OR position('private.can_close_procedural_vote(' in v_def)=0
   OR position('for update' in lower(v_def))=0
 THEN RAISE EXCEPTION 'Процедура закрытия голосования изменилась'; END IF;
 v_def:=replace(v_def,v_target,v_guard||E'\n '||v_target);
 EXECUTE v_def;
END;
$patch$;
