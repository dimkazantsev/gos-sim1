DO $qa$
DECLARE result jsonb; s numeric; partial jsonb;
BEGIN
 result:=private.blitz_vsn_components(md5('game')::uuid,md5('student-2')::uuid,1);
 s:=(result->>'score')::numeric;
 IF s<>1 OR (result->>'cases')::numeric<>0.3
        OR (result->>'actions')::numeric<>0.3
        OR (result->>'blitz')::numeric<>0.3
        OR (result->>'completion')::numeric<>0.1 THEN
  RAISE EXCEPTION 'Fully correct four-part score is invalid: %',result;
 END IF;
 result:=private.blitz_vsn_components(md5('game')::uuid,md5('student-3')::uuid,1);
 IF (result->>'score')::numeric<>0.7 THEN
  RAISE EXCEPTION 'Case + quiz + completeness without lawful actions != 0.70: %',result;
 END IF;
 partial:=private.blitz_vsn_components(md5('game')::uuid,md5('student-1')::uuid,1);
 IF (partial->>'score')::numeric>=0.4 OR (partial->>'quiz_answered')::integer<>1 THEN
  RAISE EXCEPTION 'Missed or timed-out Blitz must not receive full credit: %',partial;
 END IF;
 result:=private.blitz_vsn_components(md5('game')::uuid,md5('student-30')::uuid,2);
 IF (result->>'score')::numeric<>0 THEN
  RAISE EXCEPTION 'Unassigned stage must score zero: %',result;
 END IF;
 RAISE NOTICE 'PASS VSN exact component: 0.30+0.30+0.30+0.10, partially completed, missed and empty stages';
END $qa$;
