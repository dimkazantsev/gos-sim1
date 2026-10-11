-- Run against a non-production database when available. All fixture writes are rolled back.
BEGIN;
DO $blitz_test$
DECLARE
 gameid uuid; uid uuid; stranger uuid:=gen_random_uuid();
 n integer; v jsonb; knowledge jsonb; q uuid; wrongq uuid; lateq uuid; good integer; bad integer;
 nopts integer; first_answer jsonb; repeated jsonb; blocked boolean:=false; pending jsonb;
BEGIN
 SELECT id INTO gameid FROM public.games ORDER BY created_at LIMIT 1;
 SELECT u.id INTO uid FROM auth.users u WHERE NOT EXISTS(SELECT 1 FROM public.game_members m WHERE m.user_id=u.id) ORDER BY u.created_at LIMIT 1;
 IF gameid IS NULL OR uid IS NULL THEN RAISE EXCEPTION 'No isolated test account available'; END IF;
 INSERT INTO public.game_members(game_id,user_id,full_name,kind) VALUES(gameid,uid,'Blitz QA rollback only','student');
 PERFORM set_config('request.jwt.claim.sub',uid::text,true);
 n:=public.blitz_issue_for_day(gameid,uid,(now() at time zone 'Europe/Moscow')::date,1);
 IF n NOT BETWEEN 3 AND 5 THEN RAISE EXCEPTION 'Bad daily allocation: %',n; END IF;
 IF (SELECT count(DISTINCT b.topic) FROM public.blitz_questions b JOIN public.blitz_assignments a ON a.question_id=b.id WHERE a.game_id=gameid AND a.user_id=uid)<>n THEN RAISE EXCEPTION 'Same-day topics repeated'; END IF;
 IF public.blitz_issue_for_day(gameid,uid,(now() at time zone 'Europe/Moscow')::date,1)<>0 THEN RAISE EXCEPTION 'Second allocation duplicated items'; END IF;
 v:=public.blitz_archive(gameid,uid,0,50);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(v) x WHERE x->>'question' IS NOT NULL OR x->>'options' IS NOT NULL OR x->>'correct_index' IS NOT NULL) THEN RAISE EXCEPTION 'Pending data leaked into archive'; END IF;
 -- A guessed assignment ID must not disclose answers or consume a pending question.
 SELECT id INTO q FROM public.blitz_assignments WHERE game_id=gameid AND user_id=uid AND started_at IS NULL LIMIT 1;
 blocked:=false;
 BEGIN PERFORM public.blitz_answer(q,0); EXCEPTION WHEN SQLSTATE '22023' THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Pre-open answer request was accepted'; END IF;
 IF EXISTS(SELECT 1 FROM public.blitz_assignments WHERE id=q AND (answered_at IS NOT NULL OR started_at IS NOT NULL)) THEN
  RAISE EXCEPTION 'Pre-open request consumed assignment';
 END IF;
 UPDATE public.blitz_assignments SET available_at=clock_timestamp()-interval '2 minutes' WHERE game_id=gameid AND user_id=uid;
 v:=public.blitz_open(gameid);
 IF v IS NULL OR v ? 'correct_index' THEN RAISE EXCEPTION 'Question open error or secret leak'; END IF;
 q:=(v->>'id')::uuid;
 SELECT b.correct_index,jsonb_array_length(b.options) INTO good,nopts FROM public.blitz_assignments a JOIN public.blitz_questions b ON b.id=a.question_id WHERE a.id=q;
 first_answer:=public.blitz_answer(q,good);
 IF (first_answer->>'is_correct')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Correct answer scored incorrectly'; END IF;
 repeated:=public.blitz_answer(q,(good+1)%nopts);
 IF (repeated->>'chosen_index')::integer IS DISTINCT FROM good OR (repeated->>'is_correct')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Repeat changed locked answer'; END IF;
 v:=public.blitz_archive(gameid,uid,0,50);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v) x WHERE x->>'id'=q::text AND x->>'correct_index' IS NOT NULL AND x->>'explanation' IS NOT NULL) THEN RAISE EXCEPTION 'Completed answer unavailable in archive'; END IF;
 SELECT a.id,b.correct_index,jsonb_array_length(b.options) INTO wrongq,good,nopts FROM public.blitz_assignments a JOIN public.blitz_questions b ON b.id=a.question_id WHERE a.game_id=gameid AND a.user_id=uid AND a.id<>q LIMIT 1;
 UPDATE public.blitz_assignments SET started_at=clock_timestamp() WHERE id=wrongq;
 bad:=(good+1)%nopts;v:=public.blitz_answer(wrongq,bad);
 IF (v->>'is_correct')::boolean IS DISTINCT FROM false OR (v->>'chosen_index')::integer IS DISTINCT FROM bad THEN RAISE EXCEPTION 'Wrong answer not registered'; END IF;
 SELECT id INTO lateq FROM public.blitz_assignments WHERE game_id=gameid AND user_id=uid AND id NOT IN(q,wrongq) LIMIT 1;
 UPDATE public.blitz_assignments SET started_at=clock_timestamp()-interval '40 seconds' WHERE id=lateq;
 v:=public.blitz_answer(lateq,0);
 IF (v->>'is_correct')::boolean IS DISTINCT FROM false OR v->>'chosen_index' IS NOT NULL THEN RAISE EXCEPTION 'Deadline bypass'; END IF;
 knowledge:=public.blitz_vsn(gameid,uid,1);
 IF (knowledge->>'score')::numeric NOT BETWEEN 0 AND 1 OR (knowledge->>'quiz_answered')::integer<>2 THEN RAISE EXCEPTION 'Invalid knowledge aggregation: %',knowledge; END IF;
 PERFORM set_config('request.jwt.claim.sub',stranger::text,true);
 BEGIN PERFORM public.blitz_answer(q,0); EXCEPTION WHEN SQLSTATE '42501' THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Cross-user write allowed'; END IF;
 RAISE NOTICE 'PASS allocation, topic diversity, idempotence, hiding answers, correct, wrong, retry, timeout, isolation';
END $blitz_test$;
ROLLBACK;