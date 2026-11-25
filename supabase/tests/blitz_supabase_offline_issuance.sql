-- Disposable PostgreSQL fixture. Run only in the isolated CI database.
-- All objects and changes roll back even on success.
BEGIN;
SET LOCAL statement_timeout = '10s';
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE public.games (id uuid PRIMARY KEY, current_round integer NOT NULL);
CREATE TABLE public.game_members (
 game_id uuid NOT NULL, user_id uuid NOT NULL, kind text NOT NULL,
 roster_archived_at timestamptz, PRIMARY KEY(game_id,user_id)
);
CREATE TABLE public.game_stages (
 game_id uuid NOT NULL, stage_no integer NOT NULL, status text NOT NULL,
 PRIMARY KEY(game_id,stage_no)
);
CREATE TABLE public.blitz_daily_plans (
 game_id uuid NOT NULL, user_id uuid NOT NULL, assigned_day date NOT NULL,
 PRIMARY KEY(game_id,user_id,assigned_day)
);
CREATE TEMP TABLE offline_calls (game_id uuid, user_id uuid, stage_no integer);
-- Observe only the outer scheduler's invocations. The real inner RPC is
-- independently exercised by the existing Blitz integration checks.
CREATE FUNCTION public.blitz_issue_for_day(p_game uuid,p_user uuid,p_day date,p_stage integer)
RETURNS integer LANGUAGE plpgsql AS $fn$
BEGIN
 INSERT INTO pg_temp.offline_calls VALUES(p_game,p_user,p_stage);
 RETURN 0;
END
$fn$;
INSERT INTO public.games VALUES
 ('00000000-0000-0000-0000-000000000001',3),
 ('00000000-0000-0000-0000-000000000002',4),
 ('00000000-0000-0000-0000-000000000003',5);
INSERT INTO public.game_stages VALUES
 ('00000000-0000-0000-0000-000000000001',3,'open'),
 ('00000000-0000-0000-0000-000000000002',4,'open'),
 ('00000000-0000-0000-0000-000000000003',5,'closed');
INSERT INTO public.game_members
 SELECT '00000000-0000-0000-0000-000000000001'::uuid,
        ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'student',null
 FROM generate_series(1,100) n;
-- An archived student, teacher, closed-stage student, and same student
-- in another game must not be confused with the first game's plans.
INSERT INTO public.game_members VALUES
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000101','student',now()),
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000102','teacher',null),
 ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000103','student',null),
 ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','student',null);
\ir ../migrations/20261124190637_skip_existing_blitz_daily_plans.sql
DO $check$
DECLARE day_msk date := (now() AT TIME ZONE 'Europe/Moscow')::date;
BEGIN
 PERFORM private.blitz_issue_offline_today();
 IF (SELECT count(*) FROM pg_temp.offline_calls)<>101 THEN RAISE EXCEPTION 'Expected 100 students + one other-game student'; END IF;
 TRUNCATE pg_temp.offline_calls;
 INSERT INTO public.blitz_daily_plans
 SELECT game_id,user_id,day_msk FROM public.game_members
 WHERE game_id='00000000-0000-0000-0000-000000000001'
 AND kind='student' AND roster_archived_at IS NULL
 ORDER BY user_id LIMIT 70;
 INSERT INTO public.blitz_daily_plans VALUES
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000071',day_msk-1);
 PERFORM private.blitz_issue_offline_today();
 IF (SELECT count(*) FROM pg_temp.offline_calls)<>31 OR
    NOT EXISTS(SELECT 1 FROM pg_temp.offline_calls WHERE game_id='00000000-0000-0000-0000-000000000002' AND stage_no=4) OR
    NOT EXISTS(SELECT 1 FROM pg_temp.offline_calls WHERE user_id='00000000-0000-0000-0000-000000000071' AND stage_no=3)
 THEN RAISE EXCEPTION 'Expected 30 unassigned, prior-day eligible, other game independent'; END IF;
 TRUNCATE pg_temp.offline_calls;
 INSERT INTO public.blitz_daily_plans
 SELECT game_id,user_id,day_msk FROM public.game_members
 WHERE kind='student' AND roster_archived_at IS NULL ON CONFLICT DO NOTHING;
 PERFORM private.blitz_issue_offline_today();
 IF EXISTS(SELECT 1 FROM pg_temp.offline_calls) THEN RAISE EXCEPTION 'Already issued plans must not invoke inner procedure'; END IF;
END
$check$;
ROLLBACK;
