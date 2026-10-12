-- Draft-only hardening. Do not deploy before transactional QA.
CREATE OR REPLACE FUNCTION public.blitz_open(p_game uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE uid uuid:=auth.uid(); a record; q record;
BEGIN
 IF uid IS NULL OR NOT EXISTS(SELECT 1 FROM public.game_members WHERE game_id=p_game AND user_id=uid AND kind='student') THEN
  RAISE EXCEPTION 'Forbidden' USING errcode='42501';
 END IF;
 -- Serialize opens for a single participant; never skip a locked row and open another attempt.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_game::text||':'||uid::text, 0));
 SELECT * INTO a FROM public.blitz_assignments
 WHERE game_id=p_game AND user_id=uid AND answered_at IS NULL AND started_at IS NOT NULL
 ORDER BY started_at,available_at,id LIMIT 1 FOR UPDATE;
 IF NOT FOUND THEN
  SELECT * INTO a FROM public.blitz_assignments
  WHERE game_id=p_game AND user_id=uid AND answered_at IS NULL AND available_at<=clock_timestamp()
  ORDER BY available_at,id LIMIT 1 FOR UPDATE;
 END IF;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF a.started_at IS NULL THEN
  UPDATE public.blitz_assignments SET started_at=clock_timestamp() WHERE id=a.id RETURNING * INTO a;
 END IF;
 SELECT * INTO q FROM public.blitz_questions WHERE id=a.question_id;
 RETURN jsonb_build_object('id',a.id,'question',q.question,'options',q.options,'topic',q.topic,
 'deadline',a.started_at+interval '20 seconds','stage_no',a.stage_no);
END $$;
REVOKE ALL ON FUNCTION public.blitz_open(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.blitz_open(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.blitz_answer(p_id uuid,p_choice integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE uid uuid:=auth.uid(); a record; q record; choice_result integer; current_at timestamptz;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'Forbidden' USING errcode='42501'; END IF;
 SELECT * INTO a FROM public.blitz_assignments WHERE id=p_id AND user_id=uid FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS (
  SELECT 1 FROM public.game_members WHERE game_id=a.game_id AND user_id=uid AND kind='student'
 ) THEN RAISE EXCEPTION 'Forbidden' USING errcode='42501'; END IF;
 -- Never reveal the key or consume a pending attempt when an ID is guessed before opening.
 IF a.started_at IS NULL THEN RAISE EXCEPTION 'Question not opened' USING errcode='22023'; END IF;
 SELECT * INTO q FROM public.blitz_questions WHERE id=a.question_id;
 IF a.answered_at IS NULL THEN
  current_at:=clock_timestamp(); -- must read AFTER waiting for row lock
  choice_result:=CASE WHEN current_at<=a.started_at+interval '20 seconds'
   AND p_choice>=0 AND p_choice<jsonb_array_length(q.options) THEN p_choice ELSE NULL END;
  UPDATE public.blitz_assignments
  SET chosen_index=choice_result,is_correct=(choice_result IS NOT NULL AND choice_result=q.correct_index),
      answered_at=current_at WHERE id=p_id RETURNING * INTO a;
 END IF;
 RETURN jsonb_build_object('id',a.id,'is_correct',a.is_correct,'chosen_index',a.chosen_index,
 'correct_index',q.correct_index,'legal_act',q.legal_act,'article',q.article,
 'source_url',q.source_url,'explanation',q.explanation,'timed_out',a.chosen_index IS NULL);
END $$;
REVOKE ALL ON FUNCTION public.blitz_answer(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.blitz_answer(uuid,integer) TO authenticated;
