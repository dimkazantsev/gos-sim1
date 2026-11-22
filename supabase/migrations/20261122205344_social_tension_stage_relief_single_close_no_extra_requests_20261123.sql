-- ГОС.ID confirmed social-tension relief and resource audit fix.
-- Generated from production function versions; no historic replay.
-- Baseline: 2026-11-22 20:53:14.618426+00; stage-close computation only, no new API/RPC, polling,
-- trigger, index, table, or realtime subscription.

-- One stage-close calculation, using only already existing journals.
-- One budget-visible tension value changes at most once per settlement.
-- At overlapping active stages, the prior COMPLETED stage timestamp is
-- a global lower watermark: no source row is counted twice.
CREATE OR REPLACE FUNCTION private.settle_stage_social_tension(
 p_game uuid,p_stage_no integer,p_opened timestamptz,p_closed timestamptz)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $stage$
DECLARE v_floor timestamptz;
 v_infl numeric:=0;v_rate numeric:=0;v_activity numeric:=0;
 v_economy numeric:=0;v_law numeric:=0;v_crisis numeric:=0;
 v_rate_effect numeric:=0;v_total numeric;v_applied numeric;
 v_id uuid;v_old numeric;v_new numeric;
BEGIN
 IF p_game IS NULL OR p_stage_no IS NULL OR p_closed IS NULL THEN RETURN 0;END IF;
 -- Historical stages and historic actions are never replayed.
 -- Completed stages are serialized in fiscal_closed_stage_trigger.
 SELECT greatest(
  '2026-11-22 20:53:14.618426+00'::timestamptz,
  coalesce(p_opened,'2026-11-22 20:53:14.618426+00'::timestamptz),
  coalesce((SELECT max(s.completed_at) FROM public.game_stages s
    JOIN private.fiscal_periods fp ON fp.game_id=s.game_id AND fp.stage_no=s.stage_no
    WHERE s.game_id=p_game AND s.stage_no<>p_stage_no
     AND s.status='completed'
     AND (s.completed_at<p_closed OR (s.completed_at=p_closed AND s.stage_no<p_stage_no))),'2026-11-22 20:53:14.618426+00'::timestamptz)
 ) INTO v_floor;
 -- Existing authoritative macro journal, no calculated activity or re-read
 -- of any UI panel. Only comparable before/after numbers count.
 SELECT
 coalesce(sum(CASE WHEN jsonb_typeof(l.before_values->'inflation')='number'
  AND jsonb_typeof(l.after_values->'inflation')='number'
  THEN (l.after_values->>'inflation')::numeric-(l.before_values->>'inflation')::numeric ELSE 0 END),0),
 coalesce(sum(CASE WHEN jsonb_typeof(l.before_values->'key_rate')='number'
  AND jsonb_typeof(l.after_values->'key_rate')='number'
  THEN (l.after_values->>'key_rate')::numeric-(l.before_values->>'key_rate')::numeric ELSE 0 END),0),
 coalesce(sum(CASE WHEN jsonb_typeof(l.before_values->'activity_override')='number'
  AND jsonb_typeof(l.after_values->'activity_override')='number'
  THEN (l.after_values->>'activity_override')::numeric-
       (l.before_values->>'activity_override')::numeric ELSE 0 END),0)
 INTO v_infl,v_rate,v_activity
 FROM public.fiscal_change_ledger l
 WHERE l.game_id=p_game AND l.source_type='macro'
  AND l.created_at>v_floor AND l.created_at<=p_closed;
 -- A rate cut only reduces tension if inflation did not increase over
 -- the same settlement window. A rate hike may still raise tension.
 v_rate_effect:=CASE WHEN v_rate<0 AND v_infl>0 THEN 0 ELSE 0.25*v_rate END;
 SELECT
  coalesce(sum(CASE WHEN h.metric_key='economy' THEN -0.5*h.delta ELSE 0 END),0),
  coalesce(sum(CASE WHEN h.metric_key='lawfulness' THEN -0.3*h.delta ELSE 0 END),0)
 INTO v_economy,v_law
 FROM public.state_metric_history h
 WHERE h.game_id=p_game AND h.recorded_at>v_floor AND h.recorded_at<=p_closed
  AND ((h.metric_key='economy' AND h.source_type IN ('teacher','decision','fiscal'))
   OR (h.metric_key='lawfulness' AND h.source_type IN ('teacher','decision','event_authority')));
 -- Only actual authorized crisis management actions, protected by the
 -- established unique(crisis_id,action_id). No initial crisis shock replay.
 SELECT coalesce(sum(
    0.08*(h.new_threat-h.old_threat)
   -0.05*(h.new_containment-h.old_containment)
   -CASE WHEN h.kind='finish' THEN 2 ELSE 0 END),0)
 INTO v_crisis
 FROM public.crisis_management_history h
 WHERE h.game_id=p_game AND h.created_at>v_floor AND h.created_at<=p_closed
  AND h.kind IN ('escalate','stabilize','finish');
 v_total:=round(0.9*v_infl+v_rate_effect-0.4*v_activity+v_economy+v_law+v_crisis,6);
 -- One-stage anti-farming limit, both directions symmetrically bounded.
 v_applied:=greatest(-8,least(8,v_total));
 IF v_applied=0 THEN RETURN 0;END IF;
 UPDATE public.state_metrics m SET previous_value=m.value,
  value=greatest(coalesce(m.min_value,0),least(coalesce(m.max_value,100),m.value+v_applied)),
  updated_at=now()
 WHERE m.game_id=p_game AND m.metric_key='social_tension'
  AND greatest(coalesce(m.min_value,0),least(coalesce(m.max_value,100),m.value+v_applied))
     IS DISTINCT FROM m.value
 RETURNING m.id,m.previous_value,m.value INTO v_id,v_old,v_new;
 IF NOT FOUND THEN RETURN 0;END IF;
 INSERT INTO public.state_metric_history
  (game_id,metric_id,metric_key,value,previous_value,delta,source_type,source_id,actor_id,note)
 VALUES(p_game,v_id,'social_tension',v_new,v_old,v_new-v_old,
 'derived:stage_tension','stage:'||p_stage_no::text,NULL,
 'Социальное напряжение: проверенные экономические, правовые и кризисные изменения за этап '||
 p_stage_no::text||'; предел ±8. По исходным журналам, без двойного учёта легитимности.');
 RETURN v_new-v_old;
END;
$stage$;
REVOKE ALL ON FUNCTION private.settle_stage_social_tension(uuid,integer,timestamptz,timestamptz)
FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION private.apply_legitimacy_social_links()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE v_skip_tension boolean;
BEGIN
 IF NEW.metric_key <> 'legitimacy' OR NEW.delta=0 THEN RETURN NEW;END IF;
 -- Economically induced legitimacy remains legitimate but does not
 -- award tension twice: the existing stage-close model owns that channel.
 -- Suppress automatic political bonuses from routine votes/posts only.
 v_skip_tension:=coalesce(current_setting('app.gos_skip_formal_tension',true),'')='yes'
   OR (NEW.source_type='derived:legitimacy'
     AND (NEW.source_id LIKE 'macro_political:%'
          OR NEW.source_id LIKE 'business_activity:economy:%'));
 -- Four indexed rows updated as ONE statement, and history inserted as ONE
 -- statement; only changed values are written (0..100 saturating bounds).
 WITH changed AS (
  UPDATE public.state_metrics m
  SET previous_value=m.value,
      value=greatest(coalesce(m.min_value,0),least(coalesce(m.max_value,100),
                      m.value+NEW.delta*weights.k)),
      updated_at=now()
  FROM (VALUES
   ('social_stability'::text,2::numeric),
   ('social_tension'::text,-3::numeric),
   ('media_climate'::text,1.5::numeric),
   ('international_standing'::text,1::numeric)
  ) AS weights(metric_key,k)
  WHERE m.game_id=NEW.game_id
    AND m.metric_key=weights.metric_key
    AND (NOT v_skip_tension OR weights.metric_key<>'social_tension')
    AND greatest(coalesce(m.min_value,0),least(coalesce(m.max_value,100),
                 m.value+NEW.delta*weights.k)) IS DISTINCT FROM m.value
  RETURNING m.id,m.metric_key,m.value,m.previous_value
 )
 INSERT INTO public.state_metric_history
  (game_id,metric_id,metric_key,value,previous_value,delta,
   source_type,source_id,actor_id,note)
 SELECT NEW.game_id,id,metric_key,value,previous_value,value-previous_value,
        'derived:legitimacy-social',NEW.id::text,NEW.actor_id,
        'Автоматическое последствие изменения легитимности на '||
        NEW.delta::text||' п.п. · '||left(coalesce(NEW.note,''),250)
 FROM changed;
 RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION private.apply_rule_effects(p_game uuid, p_rule impact_rules, p_source_type text, p_source_id text, p_actor uuid, p_context jsonb, p_note text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
 kv record;
 m public.state_metrics%rowtype;
 party public.game_parties%rowtype;
 delta numeric;
 v_old numeric;
 v_new numeric;
 v_actual numeric;
 v_actual_metrics jsonb:='{}'::jsonb;
 v_actual_effects jsonb:='{}'::jsonb;
 v_legit_derived numeric:=0;
 v_skip_tension boolean:=false;v_previous_skip text;
begin
 if not p_rule.enabled or not p_rule.auto_apply then return false;end if;
 if not private.impact_condition_matches(p_rule.conditions,p_context) then return false;end if;
 if exists(select 1 from public.impact_ledger where game_id=p_game and rule_key=p_rule.rule_key and source_type=p_source_type and source_id=p_source_id) then return false;end if;
 -- The live game can have old rule settings. Remove only social-tension
 -- relief for future formal procedures while retaining all other outcomes.
 v_skip_tension:=p_rule.rule_key IN ('vote_passed','post_official');
 IF v_skip_tension THEN
   v_previous_skip:=current_setting('app.gos_skip_formal_tension',true);
   PERFORM set_config('app.gos_skip_formal_tension','yes',true);
 END IF;

 for kv in select key,value from jsonb_each_text(coalesce(p_rule.effects->'metrics','{}'::jsonb))
 order by case when key='legitimacy' then 1 else 0 end,key
 loop
   delta:=kv.value::numeric;
   select * into m from public.state_metrics where game_id=p_game and metric_key=kv.key for update;
   if m.id is not null and delta<>0 and NOT (v_skip_tension AND kv.key='social_tension') then
     v_old:=m.value;
     v_new:=v_old+delta;
     if m.min_value is not null then v_new:=greatest(m.min_value,v_new);end if;
     if m.max_value is not null then v_new:=least(m.max_value,v_new);end if;
     v_actual:=v_new-v_old;
     if v_actual<>0 then
       perform private.record_metric_change(p_game,kv.key,v_new,'rule:'||p_rule.rule_key,p_source_id,p_actor,coalesce(p_note,p_rule.label));
       v_actual_metrics:=v_actual_metrics||jsonb_build_object(kv.key,v_actual);
     end if;
   end if;
 end loop;

 -- One aggregate legitimacy update for all dimensions of one accepted rule.
 -- The metric-history trigger explicitly skips source_type 'rule:*' to
 -- avoid intermediate writes and duplicated Realtime notifications.
 IF (v_actual_metrics ? 'public_trust') OR (v_actual_metrics ? 'elite_support') THEN
  v_legit_derived:=private.write_weighted_legitimacy_delta(p_game,
   0.18*coalesce((v_actual_metrics->>'public_trust')::numeric,0)
   +0.12*coalesce((v_actual_metrics->>'elite_support')::numeric,0),
   p_source_id,p_actor,'Зависимость легитимности от доверия граждан и поддержки элит · '||
    coalesce(p_note,p_rule.label));
 END IF;
 IF v_skip_tension THEN
   PERFORM set_config('app.gos_skip_formal_tension',coalesce(v_previous_skip,''),true);
 END IF;
 v_actual_effects:=jsonb_build_object('metrics',v_actual_metrics);
 IF v_skip_tension THEN
   -- Distinguishes new reversible awards from historic awards.
   v_actual_effects:=v_actual_effects||jsonb_build_object('tension_suppressed',true);
 END IF;
 -- Historical ledger entries lack this field; do not reverse effects they never gained.
 IF v_legit_derived<>0 THEN
  v_actual_effects:=v_actual_effects||jsonb_build_object('legitimacy_derivative',v_legit_derived);
 END IF;

 if (p_rule.effects ? 'actor_party_support') and p_actor is not null then
   select gp.* into party
   from public.game_members gm join public.game_parties gp on gp.game_id=gm.game_id and gp.name=gm.team
   where gm.game_id=p_game and gm.user_id=p_actor limit 1 for update of gp;
   if party.id is not null then
     delta:=(p_rule.effects->>'actor_party_support')::numeric;
     v_old:=party.support;
     v_new:=least(100,greatest(0,v_old+delta));
     v_actual:=v_new-v_old;
     if v_actual<>0 then
       update public.game_parties set support=v_new where id=party.id;
       insert into public.party_support_history(game_id,party_id,value,previous_value,delta,source_type,source_id)
       values(p_game,party.id,v_new,v_old,v_actual,'rule:'||p_rule.rule_key,p_source_id);
       v_actual_effects:=v_actual_effects||jsonb_build_object('actor_party_support',v_actual);
     end if;
   end if;
 end if;

 insert into public.impact_ledger(game_id,rule_id,rule_key,source_type,source_id,actor_id,effects,note)
 values(p_game,p_rule.id,p_rule.rule_key,p_source_type,p_source_id,p_actor,v_actual_effects,coalesce(p_note,p_rule.label));
 return true;
end;
$function$;
CREATE OR REPLACE FUNCTION public.revert_impact_entry(p_ledger_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare l public.impact_ledger%rowtype;kv record;m public.state_metrics%rowtype;party public.game_parties%rowtype;delta numeric;v_old numeric;v_new numeric;v_previous_skip text;v_skip_tension boolean;
begin
 select * into l from public.impact_ledger where id=p_ledger_id for update;
 if l.id is null then raise exception 'Impact entry not found';end if;
 if not private.is_game_teacher(l.game_id) then raise exception 'Teacher access required';end if;
 if l.status='reverted' then return;end if;
 -- Historic entries reverse their actual old awards. New procedural votes
 -- record the suppression flag, so only those inverses skip the link.
 v_skip_tension:=coalesce((l.effects->>'tension_suppressed')::boolean,false);
 IF v_skip_tension THEN
   v_previous_skip:=current_setting('app.gos_skip_formal_tension',true);
   PERFORM set_config('app.gos_skip_formal_tension','yes',true);
 END IF;

 for kv in select key,value from jsonb_each_text(coalesce(l.effects->'metrics','{}'::jsonb))
 order by case when key='legitimacy' then 1 else 0 end,key
 loop
   delta:=kv.value::numeric;
   select * into m from public.state_metrics where game_id=l.game_id and metric_key=kv.key for update;
   if m.id is not null and delta<>0 then
     perform private.record_metric_change(l.game_id,kv.key,m.value-delta,'rule_revert:'||l.rule_key,l.id::text,(select auth.uid()),'Отмена автоматического эффекта: '||coalesce(l.note,l.rule_key));
   end if;
 end loop;
 -- Exact inverse of a NEW rule. Old votes never had a linked component.
 IF l.effects ? 'legitimacy_derivative' THEN
  PERFORM private.write_weighted_legitimacy(l.game_id,
   -(l.effects->>'legitimacy_derivative')::numeric,
   l.id::text,auth.uid(),'Отмена производной легитимности: '||coalesce(l.note,l.rule_key));
 END IF;

 if (l.effects ? 'actor_party_support') and l.actor_id is not null then
   select gp.* into party
   from public.game_members gm join public.game_parties gp on gp.game_id=gm.game_id and gp.name=gm.team
   where gm.game_id=l.game_id and gm.user_id=l.actor_id limit 1 for update of gp;
   if party.id is not null then
     delta:=(l.effects->>'actor_party_support')::numeric;
     v_old:=party.support;v_new:=least(100,greatest(0,v_old-delta));
     update public.game_parties set support=v_new where id=party.id;
     insert into public.party_support_history(game_id,party_id,value,previous_value,delta,source_type,source_id)
     values(l.game_id,party.id,v_new,v_old,v_new-v_old,'rule_revert:'||l.rule_key,l.id::text);
   end if;
 end if;
 IF v_skip_tension THEN
   PERFORM set_config('app.gos_skip_formal_tension',coalesce(v_previous_skip,''),true);
 END IF;
 update public.impact_ledger set status='reverted',reverted_at=now() where id=l.id;
end;
$function$;
CREATE OR REPLACE FUNCTION private.record_metric_change(p_game uuid, p_metric_key text, p_new numeric, p_source_type text, p_source_id text, p_actor uuid, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare m public.state_metrics%rowtype;v_old numeric;v_new numeric;
begin
 select * into m from public.state_metrics where game_id=p_game and metric_key=p_metric_key for update;
 if m.id is null then raise exception 'Metric % not found',p_metric_key;end if;
 v_old:=m.value;
 v_new:=p_new;
 if m.min_value is not null then v_new:=greatest(m.min_value,v_new);end if;
 if m.max_value is not null then v_new:=least(m.max_value,v_new);end if;
 if v_new IS NOT DISTINCT FROM v_old THEN RETURN;END IF;
 update public.state_metrics
 set previous_value=v_old,value=v_new,updated_at=now()
 where id=m.id;
 insert into public.state_metric_history(game_id,metric_id,metric_key,value,previous_value,delta,source_type,source_id,actor_id,note)
 values(p_game,m.id,p_metric_key,v_new,v_old,v_new-v_old,p_source_type,p_source_id,p_actor,p_note);
end;
$function$;
CREATE OR REPLACE FUNCTION private.fiscal_closed_stage_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$DECLARE v_period_exists boolean;
BEGIN
 IF NEW.status='completed' AND OLD.status IS DISTINCT FROM NEW.status THEN
  -- A very rare stage-close advisory lock serializes concurrent closing
  -- stages in the same game (two stages can be open simultaneously).
  PERFORM pg_advisory_xact_lock(hashtextextended('gos-stage-social:'||NEW.game_id::text,0));
  SELECT EXISTS(SELECT 1 FROM private.fiscal_periods
   WHERE game_id=NEW.game_id AND stage_no=NEW.stage_no) INTO v_period_exists;
  PERFORM private.advance_fiscal_period(NEW.game_id,NEW.stage_no);
  IF NOT v_period_exists THEN
   PERFORM private.settle_stage_social_tension(NEW.game_id,NEW.stage_no,NEW.opened_at,
     coalesce(NEW.completed_at,clock_timestamp()));
  END IF;
 END IF;
 RETURN NEW;
END$function$;
-- Only remove the SOCIAL TENSION bonus of two existing rules in the
-- existing game. All other gameplay outcomes and reversal ledger retained.
UPDATE public.impact_rules
SET effects=jsonb_set(effects,'{metrics}',(effects->'metrics')-'social_tension')
WHERE rule_key IN ('vote_passed','post_official')
 AND effects->'metrics' ? 'social_tension';
CREATE OR REPLACE TRIGGER publish_public_metric_rating
 AFTER INSERT ON public.state_metric_history FOR EACH ROW
 WHEN (NEW.source_type IS DISTINCT FROM 'derived:legitimacy-social'
 AND NEW.source_type IS DISTINCT FROM 'derived:security'
 AND NEW.source_type IS DISTINCT FROM 'derived:macro_economy'
 AND NEW.source_type IS DISTINCT FROM 'derived:tension_stability'
 AND NEW.source_type IS DISTINCT FROM 'derived:stage_tension')
 EXECUTE FUNCTION private.publish_rating_change();
