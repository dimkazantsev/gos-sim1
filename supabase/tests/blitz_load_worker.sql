
\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('request.jwt.claim.sub',md5('student-'||:'i')::uuid::text,true);
SELECT public.blitz_open(md5('game')::uuid);
SELECT public.blitz_answer(md5('assignment-'||:'i')::uuid,0);
COMMIT;
