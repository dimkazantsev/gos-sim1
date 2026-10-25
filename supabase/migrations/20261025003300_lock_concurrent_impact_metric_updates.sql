-- A07: Prevent lost confirmed metrics and party-support changes when independent
-- posts, automatic impact rules or teacher reversals overlap on a single game.
-- Source: the three existing installed function bodies, changed ONLY to acquire
-- row locks BEFORE reading values; stable key order prevents inverse lock order.
-- No formulas, scoring, clamps, rights, role checks or public RPCs are changed.
-- Create-or-replace preserves dependent objects and original GRANT configuration.

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
begin
 select * into p from public.political_posts where id=p_post for update;
 if p.id is null or p.effects_applied then return;end if;

 for kv in select key,value from jsonb_each_text(coalesce(p.impact_plan->'metrics','{}'::jsonb))
 order by key
 loop
   select * into m from public.state_metrics where game_id=p.game_id and metric_key=kv.key for update;
   if m.id is not null then
     perform private.record_metric_change(p.game_id,kv.key,m.value+(kv.value::numeric),'decision',p.id::text,p_actor,'Политический процесс: '||p.title);
   end if;
 end loop;

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
$function$

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
begin
 if not p_rule.enabled or not p_rule.auto_apply then return false;end if;
 if not private.impact_condition_matches(p_rule.conditions,p_context) then return false;end if;
 if exists(select 1 from public.impact_ledger where game_id=p_game and rule_key=p_rule.rule_key and source_type=p_source_type and source_id=p_source_id) then return false;end if;

 for kv in select key,value from jsonb_each_text(coalesce(p_rule.effects->'metrics','{}'::jsonb))
 order by key
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

 v_actual_effects:=jsonb_build_object('metrics',v_actual_metrics);

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
$function$

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
 order by key
 loop
   delta:=kv.value::numeric;
   select * into m from public.state_metrics where game_id=l.game_id and metric_key=kv.key for update;
   if m.id is not null and delta<>0 then
     perform private.record_metric_change(l.game_id,kv.key,m.value-delta,'rule_revert:'||l.rule_key,l.id::text,(select auth.uid()),'Отмена автоматического эффекта: '||coalesce(l.note,l.rule_key));
   end if;
 end loop;

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
$function$
