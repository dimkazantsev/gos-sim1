-- New answers only. Preserve previously submitted surveys.
DO $migration$
DECLARE d text; n text;
BEGIN
 SELECT pg_get_functiondef('private.final_survey_validate(jsonb,text)'::regprocedure) INTO d;
 n:=replace(d,'(x::text)::int NOT BETWEEN 0 AND upper_bound','(x::text)::int NOT BETWEEN (CASE WHEN i=36 THEN 1 ELSE 0 END) AND upper_bound');
 IF n=d THEN RAISE EXCEPTION 'Unexpected multiple-choice validator'; END IF;
 d:=n;
 n:=replace(d,'(CASE WHEN i=39 THEN 1 ELSE 0 END) AND (CASE WHEN i=39 THEN 10 ELSE 5 END)','1 AND (CASE WHEN i=39 THEN 10 ELSE 5 END)');
 IF n=d THEN RAISE EXCEPTION 'Unexpected scale validator'; END IF;
 EXECUTE n;
END $migration$;
