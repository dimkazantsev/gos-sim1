-- ГОС.ID: exact two-decimal final grades (0..3) without changing criterion rules.
ALTER TABLE public.stage_assessments
  ALTER COLUMN final_score TYPE numeric(3,2) USING final_score::numeric(3,2);
ALTER TABLE public.game_evaluations
  ALTER COLUMN score TYPE numeric(3,2) USING score::numeric(3,2);

DROP FUNCTION public.finalize_stage_assessment(uuid,integer,text);
CREATE FUNCTION public.finalize_stage_assessment(
 p_assessment_id uuid,p_score numeric,p_teacher_note text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path='public','private','pg_temp' AS $$
DECLARE a public.stage_assessments%ROWTYPE;v_uid uuid:=auth.uid();v_eval uuid;
BEGIN
 IF p_score IS NULL OR p_score<0 OR p_score>3 OR p_score<>round(p_score,2) THEN
  RAISE EXCEPTION 'Балл должен быть от 0 до 3, не более двух знаков после запятой' USING ERRCODE='22023';
 END IF;
 SELECT * INTO a FROM public.stage_assessments WHERE id=p_assessment_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Оценка не найдена';END IF;
 IF v_uid IS NULL OR NOT private.is_game_teacher(a.game_id) THEN
  RAISE EXCEPTION 'Утверждать оценки может только преподаватель этой игры' USING ERRCODE='42501';
 END IF;
 UPDATE public.stage_assessments
 SET final_score=p_score,status='final',teacher_note=nullif(trim(coalesce(p_teacher_note,'')), ''),
     finalized_by=v_uid,finalized_at=now(),updated_at=now()
 WHERE id=a.id;
 SELECT id INTO v_eval FROM public.game_evaluations
 WHERE game_id=a.game_id AND stage_no=a.stage_no AND user_id=a.user_id
 ORDER BY updated_at DESC LIMIT 1;
 IF v_eval IS NULL THEN
  INSERT INTO public.game_evaluations(game_id,stage_no,user_id,evaluator_id,score,note)
  VALUES(a.game_id,a.stage_no,a.user_id,v_uid,p_score,
   coalesce(nullif(trim(coalesce(p_teacher_note,'')),''),a.public_rationale));
 ELSE
  UPDATE public.game_evaluations
  SET evaluator_id=v_uid,score=p_score,
      note=coalesce(nullif(trim(coalesce(p_teacher_note,'')),''),a.public_rationale),updated_at=now()
  WHERE id=v_eval;
 END IF;
END;$$;
REVOKE ALL ON FUNCTION public.finalize_stage_assessment(uuid,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.finalize_stage_assessment(uuid,numeric,text) TO authenticated,service_role;

-- Keep public results consistent with teacher-approved decimal values.
DROP FUNCTION public.get_public_stage_scores(uuid);
CREATE FUNCTION public.get_public_stage_scores(p_game_id uuid)
RETURNS TABLE(user_id uuid,stage_no integer,auto_score numeric,final_score numeric,status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path='public','private','pg_temp' AS $$
BEGIN
 IF NOT private.is_game_member(p_game_id) THEN RAISE EXCEPTION 'Game access required' USING ERRCODE='42501';END IF;
 RETURN QUERY SELECT a.user_id,a.stage_no,a.auto_score,a.final_score,a.status
 FROM public.stage_assessments a WHERE a.game_id=p_game_id ORDER BY a.user_id,a.stage_no;
END;$$;
REVOKE ALL ON FUNCTION public.get_public_stage_scores(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_public_stage_scores(uuid) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
