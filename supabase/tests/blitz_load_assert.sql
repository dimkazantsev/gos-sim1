
-- All checks run inside this isolated disposable database.
DO $qa$
DECLARE n integer; a uuid:=md5('extra-1')::uuid; b uuid:=md5('extra-2')::uuid; blocked boolean:=false;
BEGIN
 SELECT count(*) INTO n FROM public.blitz_assignments WHERE answered_at IS NOT NULL AND is_correct IS TRUE;
 IF n<>30 THEN RAISE EXCEPTION 'Expected 30 distinct completed correct attempts, got %',n; END IF;
 SELECT count(*) INTO n FROM public.blitz_assignments
 WHERE user_id=md5('student-1')::uuid AND answered_at IS NULL AND started_at IS NOT NULL;
 IF n<>1 THEN RAISE EXCEPTION 'Concurrent opening started % active questions instead of 1',n; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.blitz_assignments WHERE id=a AND started_at IS NOT NULL) THEN
  RAISE EXCEPTION 'The expected first pending assignment was not opened';
 END IF;
 IF EXISTS(SELECT 1 FROM public.blitz_assignments WHERE id=b AND started_at IS NOT NULL) THEN
  RAISE EXCEPTION 'A second pending assignment was opened concurrently';
 END IF;
 PERFORM set_config('request.jwt.claim.sub',md5('student-1')::uuid::text,true);
 BEGIN
  PERFORM public.blitz_answer(b,0);
 EXCEPTION WHEN SQLSTATE '22023' THEN blocked:=true;
 END;
 IF NOT blocked THEN RAISE EXCEPTION 'A guessed unopened question returned its answer'; END IF;
 IF EXISTS(SELECT 1 FROM public.blitz_assignments WHERE id=b AND answered_at IS NOT NULL) THEN
  RAISE EXCEPTION 'Premature answer consumed a question';
 END IF;
 -- Simulate an expired 20-second attempt, then answer with a valid choice.
 UPDATE public.blitz_assignments SET started_at=clock_timestamp()-interval '40 seconds' WHERE id=a;
 PERFORM public.blitz_answer(a,0);
 IF NOT EXISTS(SELECT 1 FROM public.blitz_assignments WHERE id=a AND answered_at IS NOT NULL
  AND is_correct IS FALSE AND chosen_index IS NULL) THEN RAISE EXCEPTION 'Deadline bypass'; END IF;
 -- Replaying a completed answer must not change its result.
 PERFORM public.blitz_answer(md5('assignment-1')::uuid,1);
 IF NOT EXISTS(SELECT 1 FROM public.blitz_assignments WHERE id=md5('assignment-1')::uuid
  AND is_correct IS TRUE AND chosen_index=0) THEN RAISE EXCEPTION 'Replay changed the original answer'; END IF;
 -- A different student's JWT cannot alter or read another student's answer through the RPC.
 PERFORM set_config('request.jwt.claim.sub',md5('student-2')::uuid::text,true);
 blocked:=false;
 BEGIN PERFORM public.blitz_answer(md5('assignment-1')::uuid,0);
 EXCEPTION WHEN SQLSTATE '42501' THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Cross-user RPC access permitted'; END IF;
 RAISE NOTICE 'PASS: 30 concurrent students, serialized opens, timed out answer, protected key, idempotent replay, authorization';
END $qa$;
