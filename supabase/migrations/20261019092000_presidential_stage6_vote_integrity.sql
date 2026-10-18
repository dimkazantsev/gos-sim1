-- Additional stage-6 election integrity protections.
-- Preserve poll procedure while disallowing reopening a closed student ballot.
CREATE OR REPLACE FUNCTION public.open_presidential_poll_decision(p_game_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,private,pg_temp AS $fn$
BEGIN
 PERFORM private.require_active_presidential_teacher(p_game_id);
 IF NOT private.is_game_teacher(p_game_id) THEN RAISE EXCEPTION 'Голосование открывает преподаватель';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.game_stages WHERE game_id=p_game_id AND stage_no=6 AND status='open')
 THEN RAISE EXCEPTION 'Личное голосование проводится на шестом этапе';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.presidential_election_schedule WHERE game_id=p_game_id)
 THEN RAISE EXCEPTION 'Сначала назначьте даты выборов в Совете Федерации';END IF;
 IF EXISTS(SELECT 1 FROM public.presidential_poll_decision WHERE game_id=p_game_id)
 THEN RAISE EXCEPTION 'Голосование о социологическом опросе уже открывалось; закрытый результат нельзя сбросить';END IF;
 INSERT INTO public.presidential_poll_decision(game_id,status,result,opened_at,closed_at,created_by)
 VALUES(p_game_id,'open',null,now(),null,auth.uid());
END;$fn$;

CREATE OR REPLACE FUNCTION public.vote_presidential_poll_decision(p_game_id uuid,p_choice boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,private,pg_temp AS $fn$
DECLARE v_uid uuid:=auth.uid();
BEGIN
 IF v_uid IS NULL OR NOT EXISTS(SELECT 1 FROM public.game_members
  WHERE game_id=p_game_id AND user_id=v_uid AND kind='student' AND roster_archived_at IS NULL)
 THEN RAISE EXCEPTION 'Лично голосуют только действующие студенты' USING ERRCODE='42501';END IF;
 IF p_choice IS NULL THEN RAISE EXCEPTION 'Выберите «За» или «Против»';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.game_stages WHERE game_id=p_game_id AND stage_no=6 AND status='open')
 THEN RAISE EXCEPTION 'Голосование шестого этапа завершено';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('presidential-poll-decision:'||p_game_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM public.presidential_poll_decision WHERE game_id=p_game_id AND status='open')
 THEN RAISE EXCEPTION 'Голосование закрыто';END IF;
 INSERT INTO public.presidential_poll_decision_votes(game_id,user_id,choice)
 VALUES(p_game_id,v_uid,p_choice)
 ON CONFLICT(game_id,user_id) DO UPDATE SET choice=excluded.choice,created_at=now();
END;$fn$;

CREATE OR REPLACE FUNCTION public.close_presidential_poll_decision(p_game_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,private,pg_temp AS $fn$
DECLARE v_yes int;v_no int;v_result boolean;
BEGIN
 PERFORM private.require_active_presidential_teacher(p_game_id);
 IF NOT private.is_game_teacher(p_game_id) THEN RAISE EXCEPTION 'Только преподаватель закрывает голосование';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('presidential-poll-decision:'||p_game_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM public.presidential_poll_decision WHERE game_id=p_game_id AND status='open')
 THEN RAISE EXCEPTION 'Голосование уже закрыто или не открыто';END IF;
 SELECT count(*) FILTER(WHERE choice),count(*) FILTER(WHERE NOT choice) INTO v_yes,v_no
 FROM public.presidential_poll_decision_votes WHERE game_id=p_game_id;
 IF v_yes+v_no=0 THEN RAISE EXCEPTION 'Ни один студент не проголосовал';END IF;
 IF v_yes=v_no THEN RAISE EXCEPTION 'Голоса поровну: требуется повторное голосование';END IF;
 v_result:=v_yes>v_no;
 UPDATE public.presidential_poll_decision SET status='closed',result=v_result,closed_at=now() WHERE game_id=p_game_id;
 -- Synchronize only the poll setting. Preserve student-selected system and results.
 INSERT INTO public.presidential_election_settings(game_id,poll_enabled,updated_by)
 VALUES(p_game_id,v_result,auth.uid())
 ON CONFLICT(game_id) DO UPDATE SET poll_enabled=v_result,updated_at=now(),updated_by=auth.uid();
 RETURN v_result;
END;$fn$;

-- The Senate date RPC is an implementation detail: only the three-day wrapper
-- may issue or revise the underlying stage 6 document.
REVOKE ALL ON FUNCTION public.set_presidential_election_date(uuid,date) FROM PUBLIC,anon,authenticated;

DO $patch$
DECLARE v_def text;v_old text:='IF p_first_day IS NULL OR p_first_day<current_date THEN';
BEGIN
 SELECT pg_get_functiondef('public.set_presidential_three_day_election(uuid,date)'::regprocedure) INTO v_def;
 IF v_def IS NULL OR position(v_old IN v_def)=0 THEN RAISE EXCEPTION 'Schedule function changed unexpectedly';END IF;
 v_def:=replace(v_def,v_old,
 'IF p_first_day IS NULL OR (now() at time zone ''Asia/Barnaul'') >= p_first_day::timestamp+interval ''8 hours'' THEN');
 EXECUTE v_def;
END;$patch$;
