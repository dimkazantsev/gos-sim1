-- Only the appointed ministry head for this GP can reopen it; teacher retains oversight.
CREATE OR REPLACE FUNCTION public.begin_stage11_program_revision(p_program_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_program public.state_programs%rowtype;v_uid uuid:=auth.uid();
BEGIN
 IF v_uid IS NULL OR p_program_id IS NULL THEN RAISE EXCEPTION 'Войдите в игру' USING ERRCODE='42501';END IF;
 PERFORM private.lock_active_program_actor((SELECT game_id FROM public.state_programs WHERE id=p_program_id));
 SELECT * INTO v_program FROM public.state_programs WHERE id=p_program_id FOR UPDATE;
 IF v_program.id IS NULL OR v_program.stage_no<>10
   OR NOT EXISTS(SELECT 1 FROM public.game_stages s WHERE s.game_id=v_program.game_id AND s.stage_no=11 AND s.status='open')
 THEN RAISE EXCEPTION 'Доработка возможна только на Этапе 11' USING ERRCODE='42501';END IF;
 IF NOT private.is_game_teacher(v_program.game_id)
    AND (v_program.responsible_minister_id IS DISTINCT FROM v_uid
      OR NOT private.role_is_available(v_program.game_id,v_uid))
 THEN RAISE EXCEPTION 'Редактировать эту ГП может только ответственный министр' USING ERRCODE='42501';END IF;
 IF NOT private.is_game_teacher(v_program.game_id)
   AND NOT EXISTS (
     SELECT 1 FROM public.institution_units u
     WHERE u.game_id=v_program.game_id AND u.unit_kind='ministry'
       AND u.head_user_id=v_uid
   )
 THEN RAISE EXCEPTION 'Доработка доступна только действующему министру' USING ERRCODE='42501';END IF;
 IF v_program.signed_at IS NOT NULL OR v_program.government_vote_id IS NOT NULL
   OR v_program.status NOT IN ('draft','revision','minister_review','pm_review','ready')
   OR EXISTS(SELECT 1 FROM public.government_program_agenda a
        WHERE a.program_id=v_program.id AND a.vote_id IS NOT NULL)
 THEN RAISE EXCEPTION 'После открытия голосования ГП не редактируется' USING ERRCODE='42501';END IF;
 IF v_program.status IN ('ready','pm_review') THEN
   PERFORM set_config('app.gos_stage11_program_edit_id',v_program.id::text,true);
   UPDATE public.state_programs
    SET status='revision',pm_revision_reason=NULL,updated_at=now()
    WHERE id=v_program.id;
 END IF;
END;
$function$;
