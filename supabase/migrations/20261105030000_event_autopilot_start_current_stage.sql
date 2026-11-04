-- ГОС.ID: the teacher's "Запустить" enables event dispatch on the CURRENT open stage.
-- Keep approved case/stage matrix, authority checks, rate limits, and the existing hourly cron.
-- No new client requests, timers, subscriptions, cron jobs, or polling.
DO $patch$
DECLARE
  v_dispatch text;
  v_routing text;
  v_start integer;
  v_end integer;
  v_tail constant text := 'return jsonb_build_object(''sent'',0,''reason'',''duma_not_elected'');end if;';
BEGIN
  -- The previous prerequisite made ALL event dispatch impossible before stage 6,
  -- regardless of the teacher's explicit activation.
  v_dispatch := pg_get_functiondef('private.run_game_autopilot(uuid)'::regprocedure);
  IF position('duma_not_elected' IN v_dispatch)>0 THEN
    v_start := position(' if v_round<6 or not exists(' IN v_dispatch);
    v_end := position(v_tail IN v_dispatch);
    IF v_start=0 OR v_end<=v_start OR
       position('private.ensure_event_case_routing(p_game)' IN v_dispatch)=0 OR
       position('gm.roster_archived_at is null' IN v_dispatch)=0 OR
       position('ea.status=''pending''' IN v_dispatch)=0 THEN
      RAISE EXCEPTION 'Event autopilot changed: check the existing access and rate-limit contract before patching';
    END IF;
    v_dispatch := substring(v_dispatch FROM 1 FOR v_start-1) ||
                  substring(v_dispatch FROM v_end+length(v_tail));
    EXECUTE v_dispatch;
  END IF;

  -- Preserve the source matrix's three stage-1 cases rather than moving
  -- ALL cases with an early start to stage 6. Later-stage cases remain gated.
  v_routing := pg_get_functiondef('private.ensure_event_case_routing(uuid)'::regprocedure);
  IF position('greatest(6,m.early)' IN v_routing)>0 THEN
    v_routing := replace(v_routing,'greatest(6,m.early)','greatest(1,m.early)');
    EXECUTE v_routing;
  ELSIF position('greatest(1,m.early)' IN v_routing)=0 THEN
    RAISE EXCEPTION 'Event stage matrix changed; refusing an unreviewed routing rewrite';
  END IF;
END;
$patch$;

-- Repair only the three original stage-1 entries in already-prepared sessions.
-- No changes to later case eligibility, scores, outcomes, or previous assignments.
UPDATE public.event_case_routing r
SET earliest_stage=1
FROM public.event_cases c
WHERE r.game_id=c.game_id AND r.case_id=c.id AND r.earliest_stage=6
  AND c.case_key IN ('bank-legal-2026-098','bank-legal-2026-099','bank-legal-2026-142');

-- Reuse the existing teacher RPC: enabling and FIRST eligible dispatch happen
-- in a single transaction/HTTP request. Save/pause must not reseed the bank.
CREATE OR REPLACE FUNCTION public.configure_game_event_autopilot(
  p_game_id uuid,p_enabled boolean,p_interval_hours integer,p_activity_weight numeric,
  p_max_daily integer,p_trust_per_20 numeric,p_backlog_penalty numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path='public','private','pg_temp'
AS $fn$
DECLARE v_was_enabled boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_game_teacher(p_game_id) THEN
    RAISE EXCEPTION 'Доступ разрешён только преподавателю игры.' USING ERRCODE='42501';
  END IF;
  IF p_interval_hours NOT BETWEEN 4 AND 72 OR p_activity_weight NOT BETWEEN 0 AND 2
     OR p_max_daily NOT BETWEEN 1 AND 3 OR p_trust_per_20 NOT BETWEEN 0 AND 4
     OR p_backlog_penalty NOT BETWEEN 0 AND 2 THEN
    RAISE EXCEPTION 'Недопустимые настройки автоматической отправки.';
  END IF;
  SELECT enabled INTO v_was_enabled FROM public.event_auto_settings
  WHERE game_id=p_game_id FOR UPDATE;

  -- New games need the bank once. Do not regenerate deleted cases on every save.
  IF p_enabled AND NOT EXISTS(
    SELECT 1 FROM public.event_cases WHERE game_id=p_game_id
  ) THEN
    PERFORM private.seed_event_bank_extended(p_game_id);
  END IF;
  INSERT INTO public.event_auto_settings(
    game_id,enabled,interval_hours,activity_weight,max_daily,trust_per_20,backlog_penalty)
  VALUES(p_game_id,p_enabled,p_interval_hours,p_activity_weight,
         p_max_daily,p_trust_per_20,p_backlog_penalty)
  ON CONFLICT(game_id) DO UPDATE SET
    enabled=excluded.enabled,interval_hours=excluded.interval_hours,
    activity_weight=excluded.activity_weight,max_daily=excluded.max_daily,
    trust_per_20=excluded.trust_per_20,backlog_penalty=excluded.backlog_penalty,
    updated_at=now();

  IF p_enabled AND NOT coalesce(v_was_enabled,false) THEN
    -- The existing dispatcher enforces open stage, roles, per-player cooldown,
    -- three pending maximum, 24-hour cap and 55-minute server cooldown.
    PERFORM private.run_game_autopilot(p_game_id);
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.configure_game_event_autopilot(
  uuid,boolean,integer,numeric,integer,numeric,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.configure_game_event_autopilot(
  uuid,boolean,integer,numeric,integer,numeric,numeric) TO authenticated;

-- One bounded reconciliation for a session whose teacher ALREADY enabled dispatch
-- but whose first run was previously blocked. Never repeat for checked sessions.
DO $catchup$
DECLARE v_game uuid;
BEGIN
  FOR v_game IN
    SELECT s.game_id
    FROM public.event_auto_settings s
    JOIN public.games g ON g.id=s.game_id
    JOIN public.game_stages st ON st.game_id=g.id AND st.stage_no=g.current_round
    WHERE s.enabled AND s.last_run_at IS NULL
      AND g.status NOT IN ('finished','archived') AND st.status='open'
  LOOP
    PERFORM private.run_game_autopilot(v_game);
  END LOOP;
END;
$catchup$;
