
\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('request.jwt.claim.sub',md5('student-1')::uuid::text,true);
SELECT public.blitz_open(md5('game')::uuid);
SELECT pg_sleep(0.05);
COMMIT;
