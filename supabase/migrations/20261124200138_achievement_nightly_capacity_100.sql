DO $guard$
BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtextextended('gos_id_achievement_nightly',0)) THEN RAISE EXCEPTION 'Nightly worker is active; retry outside current run'; END IF;
 IF md5(pg_get_functiondef('private.run_nightly_achievements(timestamptz)'::regprocedure))<>'550f811b74c6fd6238159eedd898c2de' THEN RAISE EXCEPTION 'Original worker changed'; END IF;
 IF to_regprocedure('private.run_nightly_achievements_batch(timestamptz)') IS NOT NULL THEN RAISE EXCEPTION 'Batch worker already exists'; END IF;
 IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='gos_id_achievement_nightly' AND active AND schedule='1-10,12-30,32-50,52-59 20 * * *' AND command='set statement_timeout=''15s'';select private.run_nightly_achievements();') THEN RAISE EXCEPTION 'Cron configuration changed'; END IF;
 IF EXISTS(SELECT 1 FROM public.game_presence WHERE last_seen_at>now()-interval '3 minutes') THEN RAISE EXCEPTION 'Active classroom'; END IF;
END
$guard$;
-- Bounded adaptive nightly worker; tested in disposable PostgreSQL. Retain the original single-student worker,
-- night window, five-minute retries, attempt cap, catalog and permissions.
-- Increase capacity only when remaining ready work exceeds future cron slots.
CREATE OR REPLACE FUNCTION private.run_nightly_achievements_batch(p_now timestamptz DEFAULT clock_timestamp())
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,private,pg_temp AS $batch$
DECLARE
 local_day date:=(p_now AT TIME ZONE 'Asia/Novosibirsk')::date;
 local_minute integer:=extract(minute FROM p_now AT TIME ZONE 'Asia/Novosibirsk')::integer;
 remaining_slots integer;
 ready_count integer;
 completed integer;
 started timestamptz:=clock_timestamp();
BEGIN
 IF p_now IS NULL OR extract(hour FROM p_now AT TIME ZONE 'Asia/Novosibirsk')<>3 THEN RETURN 0; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('gos_id_achievement_nightly',0)) THEN RETURN 0; END IF;
 completed:=private.run_nightly_achievements(p_now);
 -- Do not start additional work when a single calculation is unusually slow.
 -- The existing 15-second statement timeout remains an independent hard limit.
 IF clock_timestamp()-started>=interval '1 second' THEN RETURN completed; END IF;
 remaining_slots:=59-local_minute
  -(CASE WHEN local_minute<11 THEN 1 ELSE 0 END)
  -(CASE WHEN local_minute<31 THEN 1 ELSE 0 END)
  -(CASE WHEN local_minute<51 THEN 1 ELSE 0 END);
 SELECT count(*)::integer INTO ready_count FROM (
  SELECT 1 FROM public.game_members m
  LEFT JOIN private.achievement_snapshots s ON s.game_id=m.game_id AND s.user_id=m.user_id
  WHERE m.kind='student' AND m.roster_archived_at IS NULL
   AND (s.checked_at IS NULL OR (s.checked_at AT TIME ZONE 'Asia/Novosibirsk')::date<local_day)
   AND (s.last_attempt_at IS NULL OR (s.last_attempt_at AT TIME ZONE 'Asia/Novosibirsk')::date<local_day
    OR (s.attempts<3 AND s.last_attempt_at<=p_now-interval '5 minutes'))
  LIMIT (remaining_slots+1)
 ) ready;
 IF ready_count>remaining_slots AND clock_timestamp()-started<interval '1 second' THEN
  completed:=completed+private.run_nightly_achievements(p_now);
 END IF;
 RETURN completed;
END;
$batch$;
REVOKE ALL ON FUNCTION private.run_nightly_achievements_batch(timestamptz) FROM PUBLIC,anon,authenticated;
-- Same named job and slots, no additional cron process or schedule.
SELECT cron.schedule('gos_id_achievement_nightly','1-10,12-30,32-50,52-59 20 * * *',
 'set statement_timeout=''15s'';select private.run_nightly_achievements_batch();');
