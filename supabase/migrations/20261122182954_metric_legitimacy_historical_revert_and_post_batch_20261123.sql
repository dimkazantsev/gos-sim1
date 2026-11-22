-- ГОС.ID — protect historical votes; batch political metric effects.
CREATE OR REPLACE FUNCTION private.write_weighted_legitimacy_delta(p_game uuid, p_delta numeric, p_source_id text, p_actor uuid, p_note text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE v_id uuid;v_old numeric;v_new numeric;v_effect numeric;
BEGIN
 v_effect:=greatest(-1,least(1,coalesce(p_delta,0)));
 IF v_effect=0 THEN RETURN 0;END IF;
 UPDATE public.state_metrics m
 SET previous_value=m.value,
     value=greatest(coalesce(m.min_value,0),
       least(coalesce(m.max_value,100),m.value+v_effect)),
     updated_at=now()
 WHERE m.game_id=p_game AND m.metric_key='legitimacy'
   AND greatest(coalesce(m.min_value,0),
     least(coalesce(m.max_value,100),m.value+v_effect)) IS DISTINCT FROM m.value
 RETURNING m.id,m.previous_value,m.value INTO v_id,v_old,v_new;
 IF FOUND THEN
  INSERT INTO public.state_metric_history(game_id,metric_id,metric_key,value,previous_value,delta,
   source_type,source_id,actor_id,note)
  VALUES(p_game,v_id,'legitimacy',v_new,v_old,v_new-v_old,
   'derived:legitimacy',p_source_id,p_actor,p_note);
  RETURN v_new-v_old;
 END IF;
 RETURN 0;
END $function$;
REVOKE ALL ON FUNCTION private.write_weighted_legitimacy_delta(uuid,numeric,text,uuid,text) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION private.write_weighted_legitimacy(
 p_game uuid,p_delta numeric,p_source_id text,p_actor uuid,p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','private','pg_temp'
AS $function$
BEGIN
 PERFORM private.write_weighted_legitimacy_delta(p_game,p_delta,p_source_id,p_actor,p_note);
END;
$function$;
CREATE OR REPLACE FUNCTION private.derive_legitimacy_from_metric_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE v_action text;v_prev_raw numeric:=0;v_raw numeric;v_delta numeric;
 v_part numeric;
BEGIN
 IF NEW.delta=0 THEN RETURN NEW;END IF;
 IF NEW.metric_key='economy' THEN
  -- Economy affects business activity by the EXISTING 0.002 sensitivity:
  -- +1 economy point = +0.2 pp activity. Do not respond to derived activity
  -- from trust or elite support: that would create a feedback cycle.
  v_part:=NEW.delta*0.2;
  PERFORM private.apply_societal_metric_deltas(
    NEW.game_id,
    greatest(-0.5,least(0.5,round(v_part*0.08,5))),
    greatest(-0.5,least(0.5,round(v_part*0.10,5))),
    'business_activity','economy:'||NEW.id::text,NEW.actor_id,
    'Деловая активность: изменение индекса экономики (без обратной связи от доверия/элит)');
  RETURN NEW;
 END IF;
 IF NEW.metric_key NOT IN ('public_trust','elite_support')
  OR NEW.source_type IN ('macro_political','business_activity','decision')
  OR NEW.source_type LIKE 'rule:%'
  OR NEW.source_type LIKE 'rule_revert:%'
 THEN RETURN NEW;END IF;
 v_part:=NEW.delta*CASE WHEN NEW.metric_key='public_trust' THEN 0.18 ELSE 0.12 END;
 IF v_part=0 THEN RETURN NEW;END IF;
 -- Cap the combined contribution by logical source within a DB transaction,
 -- including a rule that changes trust and elite support separately.
 v_action:=NEW.game_id::text||':'||NEW.source_type||':'||coalesce(NEW.source_id,'history:'||NEW.id::text);
 IF current_setting('app.gos_legitimacy_action',true)=v_action THEN
  v_prev_raw:=coalesce(nullif(current_setting('app.gos_legitimacy_raw',true),'')::numeric,0);
 END IF;
 v_raw:=v_prev_raw+v_part;
 v_delta:=greatest(-1,least(1,v_raw))-greatest(-1,least(1,v_prev_raw));
 PERFORM set_config('app.gos_legitimacy_action',v_action,true);
 PERFORM set_config('app.gos_legitimacy_raw',v_raw::text,true);
 IF v_delta=0 THEN RETURN NEW;END IF;
 PERFORM private.write_weighted_legitimacy(NEW.game_id,v_delta,NEW.id::text,NEW.actor_id,
  'Формула легитимности: 0,18 × Δ доверия + 0,12 × Δ поддержки элит; предел ±1 п.п. на исходное действие');
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
begin
 if not p_rule.enabled or not p_rule.auto_apply then return false;end if;
 if not private.impact_condition_matches(p_rule.conditions,p_context) then return false;end if;
 if exists(select 1 from public.impact_ledger where game_id=p_game and rule_key=p_rule.rule_key and source_type=p_source_type and source_id=p_source_id) then return false;end if;

 for kv in select key,value from jsonb_each_text(coalesce(p_rule.effects->'metrics','{}'::jsonb))
 order by case when key='legitimacy' then 1 else 0 end,key
 loop
   delta:=kv.value::numeric;
   select * into m from public.state_metrics where game_id=p_game and metric_key=kv.key for update;
   if m.id is not null and delta<>0 then
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
 v_actual_effects:=jsonb_build_object('metrics',v_actual_metrics);
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
CREATE OR REPLACE FUNCTION private.apply_post_effects(p_post uuid, p_actor uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  p public.political_posts%rowtype;
  kv record;
  m public.state_metrics%rowtype;
  party_kv record;
  party_row public.game_parties%rowtype;
  v_old numeric;
  v_new numeric;
  v_trust_actual numeric:=0;v_elite_actual numeric:=0;
begin
 select * into p from public.political_posts where id=p_post for update;
 if p.id is null or p.effects_applied then return;end if;

 for kv in select key,value from jsonb_each_text(coalesce(p.impact_plan->'metrics','{}'::jsonb))
 order by case when key='legitimacy' then 1 else 0 end,key
 loop
   select * into m from public.state_metrics where game_id=p.game_id and metric_key=kv.key for update;
   if m.id is not null then
     v_old:=m.value;
     v_new:=greatest(coalesce(m.min_value,-1e12),least(coalesce(m.max_value,1e12),m.value+(kv.value::numeric)));
     perform private.record_metric_change(p.game_id,kv.key,v_new,'decision',p.id::text,p_actor,'Политический процесс: '||p.title);
     IF kv.key='public_trust' THEN v_trust_actual:=v_trust_actual+v_new-v_old;
     ELSIF kv.key='elite_support' THEN v_elite_actual:=v_elite_actual+v_new-v_old;
     END IF;
   end if;
 end loop;
 -- One derived write after all primary effects: stable lock order E,T,L.
 PERFORM private.write_weighted_legitimacy(p.game_id,
  0.18*v_trust_actual+0.12*v_elite_actual,p.id::text,p_actor,
  'Политический процесс: влияние доверия и элит · '||p.title);

 for party_kv in select key,value from jsonb_each_text(coalesce(p.impact_plan->'party_support','{}'::jsonb))
 order by key
 loop
   select * into party_row from public.game_parties where id=party_kv.key::uuid and game_id=p.game_id for update;
   if party_row.id is not null then
     v_old:=party_row.support;
     v_new:=least(100,greatest(0,v_old+(party_kv.value::numeric)));
     update public.game_parties set support=v_new where id=party_row.id;
     insert into public.party_support_history(game_id,party_id,value,previous_value,delta,source_type,source_id)
     values(p.game_id,party_row.id,v_new,v_old,v_new-v_old,'decision',p.id::text);
   end if;
 end loop;

 update public.political_posts set effects_applied=true,updated_at=now() where id=p.id;
end;
$function$;
CREATE OR REPLACE FUNCTION public.revert_impact_entry(p_ledger_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare l public.impact_ledger%rowtype;kv record;m public.state_metrics%rowtype;party public.game_parties%rowtype;delta numeric;v_old numeric;v_new numeric;
begin
 select * into l from public.impact_ledger where id=p_ledger_id for update;
 if l.id is null then raise exception 'Impact entry not found';end if;
 if not private.is_game_teacher(l.game_id) then raise exception 'Teacher access required';end if;
 if l.status='reverted' then return;end if;

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
 update public.impact_ledger set status='reverted',reverted_at=now() where id=l.id;
end;
$function$;
