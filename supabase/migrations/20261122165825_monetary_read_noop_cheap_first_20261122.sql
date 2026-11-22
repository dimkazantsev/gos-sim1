-- Skip membership and game status queries on passive fiscal reads when no rate impulse is pending.
-- Same authorization, locks, cap and settlement function; only read-order optimization.
CREATE OR REPLACE FUNCTION private.settle_monetary_inflation(p_game uuid, p_as_of date DEFAULT NULL::date)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
 v_today date:=coalesce(p_as_of,(now() AT TIME ZONE 'Asia/Barnaul')::date);
 v_p public.game_fiscal_policy%rowtype;
 v_day record;v_old numeric;v_next numeric;v_delta numeric;v_total numeric:=0;
 v_last_effect numeric:=0;v_last_date date;v_details jsonb:='[]'::jsonb;
 v_weights integer[]:=ARRAY[9,13,16,17,15,11,8,5,4,2];
BEGIN
 SELECT monetary_last_settled_on,monetary_started_at
 INTO v_p.monetary_last_settled_on,v_p.monetary_started_at
 FROM public.game_fiscal_policy WHERE game_id=p_game;
 IF NOT FOUND OR v_p.monetary_last_settled_on>=v_today THEN RETURN 0;END IF;
 -- No rate decisions in the relevant 10-day window => no locks and no writes.
 IF NOT EXISTS (
  SELECT 1 FROM public.fiscal_change_ledger l
  WHERE l.game_id=p_game AND l.source_type='macro'
    AND l.created_at>v_p.monetary_started_at AND l.before_values ? 'key_rate'
    AND l.after_values ? 'key_rate'
    AND (l.before_values->>'key_rate') IS DISTINCT FROM (l.after_values->>'key_rate')
    AND (l.created_at AT TIME ZONE 'Asia/Barnaul')::date+1<=v_today
    AND (l.created_at AT TIME ZONE 'Asia/Barnaul')::date+10>v_p.monetary_last_settled_on
 ) THEN RETURN 0;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.games WHERE id=p_game AND status NOT IN ('finished','archived')) THEN RETURN 0;END IF;
 -- Guests and observers must never trigger financial writes.
 IF auth.uid() IS NOT NULL AND NOT (
  private.is_game_teacher(p_game) OR EXISTS(
   SELECT 1 FROM public.game_members m WHERE m.game_id=p_game AND m.user_id=auth.uid()
    AND m.kind='student' AND m.roster_archived_at IS NULL AND private.role_is_available(p_game,m.user_id)
  )
 ) THEN RETURN 0;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('gos-monetary:'||p_game::text,0));
 SELECT * INTO v_p FROM public.game_fiscal_policy WHERE game_id=p_game FOR UPDATE;
 IF NOT FOUND OR v_p.monetary_last_settled_on>=v_today THEN RETURN 0;END IF;
 v_old:=v_p.inflation;v_next:=v_old;
 -- Group ALL rate changes by their real calendar date: same-day netting.
 -- Iterate only days impacted by confirmed changes, maximum 10 per impulse.
 FOR v_day IN
  SELECT (l.created_at AT TIME ZONE 'Asia/Barnaul')::date+day_number.n AS economic_day,
   sum(-1.5*((l.after_values->>'key_rate')::numeric-(l.before_values->>'key_rate')::numeric)
    *v_weights[day_number.n]/100) AS raw_effect
  FROM public.fiscal_change_ledger l CROSS JOIN generate_series(1,10) AS day_number(n)
  WHERE l.game_id=p_game AND l.source_type='macro' AND l.created_at>v_p.monetary_started_at
   AND l.before_values ? 'key_rate' AND l.after_values ? 'key_rate'
   AND (l.before_values->>'key_rate') IS DISTINCT FROM (l.after_values->>'key_rate')
   AND (l.created_at AT TIME ZONE 'Asia/Barnaul')::date+day_number.n>v_p.monetary_last_settled_on
   AND (l.created_at AT TIME ZONE 'Asia/Barnaul')::date+day_number.n<=v_today
  GROUP BY 1 ORDER BY 1
 LOOP
  v_delta:=greatest(-1,least(1,round(v_day.raw_effect,8)));
  v_next:=greatest(0,round(v_next+v_delta,8));
  v_last_effect:=v_next-v_old-v_total;
  v_total:=v_next-v_old;
  v_last_date:=v_day.economic_day;
  v_details:=v_details||jsonb_build_array(jsonb_build_object('date',v_last_date,'change',v_last_effect));
 END LOOP;
 IF v_last_date IS NULL THEN RETURN 0;END IF;
 UPDATE public.game_fiscal_policy
 SET inflation=v_next,monetary_last_settled_on=v_today,
  monetary_cumulative_effect=monetary_cumulative_effect+v_total,
  monetary_last_daily_effect=v_last_effect,monetary_last_effect_date=v_last_date,
  monetary_last_day_details=v_details,updated_at=CASE WHEN v_total<>0 THEN now() ELSE updated_at END
 WHERE game_id=p_game;
 IF v_total<>0 THEN
  INSERT INTO public.fiscal_change_ledger
   (game_id,region_code,source_type,source_id,note,before_values,after_values)
  VALUES(p_game,'00','macro','monetary:'||v_today::text,
   'Денежно-кредитная политика: последствия по календарным дням.',
   jsonb_build_object('inflation',v_old),
   jsonb_build_object('inflation',v_next,'daily_effects',v_details))
  ON CONFLICT(game_id,source_type,source_id,region_code) DO NOTHING;
 END IF;
 RETURN v_total;
END
$function$
;