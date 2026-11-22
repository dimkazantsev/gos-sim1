-- Approved GOС.ID tension consequences, no new tables, triggers,
-- indexes, client RPC, polls, subscriptions, or background tasks.
-- Replace the old tension anchor-delta activity contribution with a
-- permanent -min(.04,max(0,T-60)*.001) at the actual tension level.
CREATE OR REPLACE FUNCTION private.budget_aux_impact(p_game uuid, p_anchor jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
WITH shifted AS (
 SELECT m.metric_key,m.value AS level,m.value-coalesce((p_anchor->'aux_metrics'->>m.metric_key)::numeric,m.value) AS delta
 FROM public.state_metrics m WHERE m.game_id=p_game AND m.metric_key IN ('social_stability','security','elite_support','international_standing','social_tension','legitimacy','media_climate')
), groups AS (
 SELECT coalesce(sum(case when metric_key in ('social_stability','security','elite_support','international_standing') then delta else 0 end),0)/5 AS activity_points,
        coalesce(sum(case when metric_key in ('legitimacy','media_climate') then delta else 0 end),0)/2 AS collection_points,
        max(case when metric_key='social_tension' then level end) AS tension_level
 FROM shifted
)
SELECT jsonb_build_object('activity_adjustment',greatest(-.03,least(.03,activity_points*.002))-least(.04,greatest(0,coalesce(tension_level,0)-60)*.001),
 'collection_adjustment',greatest(-.01,least(.01,collection_points*.0005))) FROM groups
$function$;

-- Versioned, lazy budget cache invalidation; no historical revaluation.
CREATE OR REPLACE FUNCTION private.budget_forecast_signature(p_game uuid, p_draft jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
 SELECT md5(jsonb_build_array(
  'economy_b_tension_level_v2',
  p_draft,
  (select data from private.budget_baseline where year=2026),
  (select status from public.games where id=p_game),
  (select to_jsonb(t) from public.budget_simulator_state t where t.game_id=p_game),
  (select to_jsonb(t) from public.game_fiscal_policy t where t.game_id=p_game),
  (select coalesce(jsonb_agg(jsonb_build_array(t.region_code,t.enterprises,t.activity_multiplier) order by t.region_code),'[]'::jsonb) from public.game_fiscal_regions t where t.game_id=p_game),
  (select coalesce(jsonb_agg(jsonb_build_array(t.tax_key,t.rate) order by t.tax_key),'[]'::jsonb) from public.game_fiscal_rates t where t.game_id=p_game and t.region_code='00' and t.tax_key in ('vat','profit')),
  (select coalesce(jsonb_agg(jsonb_build_array(t.metric_key,t.value) order by t.metric_key),'[]'::jsonb) from public.state_metrics t where t.game_id=p_game and t.metric_key in ('economy','public_trust','lawfulness','social_stability','security','elite_support','international_standing','social_tension','legitimacy','media_climate')),
  (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.budget_transfer_requests t where t.game_id=p_game),
  (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.state_programs t where t.game_id=p_game),
  (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.state_program_goals t where t.game_id=p_game),
  (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.state_program_components t where t.game_id=p_game),
  (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.state_program_expenses t where t.game_id=p_game),
  (select coalesce(jsonb_agg(to_jsonb(t) order by t.program_id,t.budget_year),'[]'::jsonb) from public.state_program_budget_commitments t where t.game_id=p_game),
  (select coalesce(jsonb_agg(jsonb_build_array(c.source_key,c.issued_month,c.issued_rubles,c.status,c.principal) order by c.id),'[]'::jsonb) from public.budget_finance_contracts c where c.game_id=p_game),
  (select coalesce(jsonb_agg(jsonb_build_array(t.id,t.title) order by t.id),'[]'::jsonb) from public.event_cases t where t.game_id=p_game and exists(select 1 from public.budget_transfer_requests r where r.game_id=p_game and r.event_case_id=t.id)),
  (select coalesce(jsonb_agg(jsonb_build_array(t.code,t.name) order by t.code),'[]'::jsonb) from public.fiscal_region_reference t where exists(select 1 from public.budget_transfer_requests r where r.game_id=p_game and r.region_code=t.code))
 )::text);
$function$;

-- Keep existing independent-security trigger and thresholds; extend only
-- its independent social-tension branch with stability + security outputs.
CREATE OR REPLACE FUNCTION private.security_from_metric_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE k numeric:=0;v_old numeric;v_new numeric;v_before numeric;v_after numeric;
BEGIN
 IF NEW.delta=0 THEN RETURN NEW;END IF;
 IF NEW.metric_key='economy' AND NEW.source_type IN ('teacher','decision','fiscal')
 THEN k:=0.7;
 ELSIF NEW.metric_key='social_tension' AND NEW.source_type IN ('teacher','decision')
 THEN
  -- Piecewise continuous integral: crossing 60/80/90 is proportional to
  -- the actual movement; reductions have exactly the opposite direction.
  v_old:=greatest(0,least(100,NEW.previous_value));
  v_new:=greatest(0,least(100,NEW.value));
  v_before:=0.4*least(v_old,60)+0.6*least(greatest(v_old-60,0),20)
           +0.8*least(greatest(v_old-80,0),10)+greatest(v_old-90,0);
  v_after:=0.4*least(v_new,60)+0.6*least(greatest(v_new-60,0),20)
           +0.8*least(greatest(v_new-80,0),10)+greatest(v_new-90,0);
  PERFORM private.apply_security_delta(NEW.game_id,-(v_after-v_before),
    NEW.source_type,NEW.source_id,NEW.actor_id,
    'Безопасность: самостоятельное изменение социального напряжения, пороги 60/80/90');
  -- Same existing trigger: 1 indexed update, 1 history insert if actual
  -- social stability changes; no new triggers, subscriptions or requests.
  WITH changed AS (
    UPDATE public.state_metrics m
    SET previous_value=m.value,
      value=greatest(coalesce(m.min_value,0),
             least(coalesce(m.max_value,100),m.value-0.8*NEW.delta)),
      updated_at=now()
    WHERE m.game_id=NEW.game_id AND m.metric_key='social_stability'
    AND greatest(coalesce(m.min_value,0),
             least(coalesce(m.max_value,100),m.value-0.8*NEW.delta))
        IS DISTINCT FROM m.value
    RETURNING m.id,m.value,m.previous_value
  )
  INSERT INTO public.state_metric_history
   (game_id,metric_id,metric_key,value,previous_value,delta,source_type,source_id,actor_id,note)
  SELECT NEW.game_id,id,'social_stability',value,previous_value,value-previous_value,
    'derived:tension_stability',NEW.id::text,NEW.actor_id,
    'Социальная стабильность: −0,8 × самостоятельное изменение напряжения'
  FROM changed;
  RETURN NEW;
 ELSIF NEW.metric_key='lawfulness'
 AND NEW.source_type IN ('teacher','decision','event_authority')
 THEN k:=0.3;
 ELSIF NEW.metric_key='international_standing'
 AND NEW.source_type IN ('teacher','decision')
 THEN k:=0.2;
 END IF;
 IF k=0 THEN RETURN NEW;END IF;
 -- One security case should not be charged twice from its own fiscal/legal
 -- outcomes and from its independently classified event outcome.
 IF (NEW.metric_key='economy' AND NEW.source_type='fiscal')
 OR (NEW.metric_key='lawfulness' AND NEW.source_type='event_authority') THEN
  IF EXISTS(SELECT 1 FROM public.event_cases c
     WHERE c.game_id=NEW.game_id AND c.id::text=NEW.source_id
       AND c.category='Безопасность') THEN RETURN NEW;END IF;
 END IF;
 PERFORM private.apply_security_delta(NEW.game_id,NEW.delta*k,
 NEW.source_type,NEW.source_id,NEW.actor_id,
 'Безопасность: самостоятельное изменение '||NEW.metric_key||' × '||k::text);
 RETURN NEW;
END;$function$;

CREATE OR REPLACE TRIGGER publish_public_metric_rating
AFTER INSERT ON public.state_metric_history FOR EACH ROW
WHEN (NEW.source_type IS DISTINCT FROM 'derived:legitimacy-social'
 AND NEW.source_type IS DISTINCT FROM 'derived:security'
 AND NEW.source_type IS DISTINCT FROM 'derived:macro_economy'
 AND NEW.source_type IS DISTINCT FROM 'derived:tension_stability')
EXECUTE FUNCTION private.publish_rating_change();