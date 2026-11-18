-- Capture the specific stage when the teacher assigns a case, not the
-- numerically highest concurrently opened stage. No extra client reads.
ALTER TABLE public.event_assignments ADD COLUMN IF NOT EXISTS stage_no integer;
DO $guard$
BEGIN
 IF NOT EXISTS(select 1 from pg_constraint
   where conrelid='public.event_assignments'::regclass
     and conname='event_assignments_stage_no_check')
 THEN ALTER TABLE public.event_assignments ADD CONSTRAINT event_assignments_stage_no_check CHECK(stage_no between 1 and 16);
 END IF;
END $guard$;
WITH unique_stages AS (
 SELECT a.id,min(s.stage_no) stage_no
 FROM public.event_assignments a
 JOIN public.game_stages s ON s.game_id=a.game_id AND s.opened_at<=a.created_at
    AND (s.completed_at IS NULL OR s.completed_at>=a.created_at)
    AND (s.score_closed_at IS NULL OR s.score_closed_at>=a.created_at)
 GROUP BY a.id HAVING count(*)=1
)
UPDATE public.event_assignments a SET stage_no=u.stage_no
FROM unique_stages u WHERE a.id=u.id AND a.stage_no IS NULL;
UPDATE public.event_authority_evidence e SET stage_no=a.stage_no
FROM public.event_decisions d JOIN public.event_assignments a ON a.id=d.assignment_id
WHERE e.decision_id=d.id AND e.game_id=a.game_id AND a.stage_no IS NOT NULL AND e.stage_no<>a.stage_no;

CREATE OR REPLACE FUNCTION public.assign_event_case(p_case_id uuid, p_recipients uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare c public.event_cases%rowtype;recipient uuid;n integer:=0;recipients uuid[];v_stage integer;
begin
 select * into c from public.event_cases where id=p_case_id for update;
 if c.id is null or not private.is_game_teacher(c.game_id) then raise exception 'Требуются права преподавателя';end if;
 if c.status<>'ready' or exists(select 1 from public.event_case_outcomes where case_id=c.id)
 then raise exception 'Событие недоступно для назначения';end if;
 select array_agg(distinct v) into recipients from unnest(p_recipients) v where v is not null;
 if coalesce(cardinality(recipients),0)=0 then raise exception 'Выберите получателей';end if;
 if c.audience='single' and cardinality(recipients)<>1 then raise exception 'Выберите одного участника';end if;
 if c.audience='group' and cardinality(recipients) not between 2 and 3 then raise exception 'Выберите 2–3 участников';end if;
 if exists(select 1 from unnest(recipients) r where not exists(select 1 from public.game_members
  where game_id=c.game_id and user_id=r and kind='student')) then raise exception 'Получатель недоступен';end if;
 if c.audience='all' and cardinality(recipients)<>(select count(*) from public.game_members where game_id=c.game_id and kind='student')
 then raise exception 'Общее событие назначается всем участникам';end if;
 -- The stage comes from the teacher's assignment context, not the largest
 -- concurrently opened stage. Legacy clients use the explicit game round.
 v_stage:=nullif(current_setting('app.gos_event_stage',true),'')::integer;
 if v_stage is null then
   select g.current_round into v_stage from public.games g where g.id=c.game_id;
 end if;
 if v_stage not between 1 and 16 or not exists(
     select 1 from public.game_stages s
     where s.game_id=c.game_id and s.stage_no=v_stage and s.status='open')
 then raise exception 'Для назначения ситуации выберите открытый этап игры' using errcode='23514';end if;
 -- One set-based INSERT statement for all recipients: one trigger broadcast
 -- and one database round of assignment checks instead of up to 100 statements.
 INSERT INTO public.event_assignments(case_id,game_id,recipient_id,created_by,stage_no)
 SELECT c.id,c.game_id,r.user_id,auth.uid(),v_stage
 FROM unnest(recipients) AS r(user_id)
 ON CONFLICT(case_id,recipient_id) DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;
 return n;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.run_game_autopilot(p_game uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare s public.event_auto_settings%rowtype;
 c record; chosen uuid[]; v_people uuid[]; v_leader uuid; n int; dispatched int:=0;
 v_now timestamptz:=now(); v_round int; v_count int; v_sent_party uuid;
begin
 select * into s from public.event_auto_settings where game_id=p_game for update;
 if not found or not s.enabled then return jsonb_build_object('sent',0,'reason','paused');end if;
 if s.last_run_at>v_now-interval '55 minutes' then return jsonb_build_object('sent',0,'reason','already_checked');end if;
 -- One case per game-level interval; checking the settings row avoids any
 -- additional lookup or polling on the hourly cron path.
 if s.last_dispatched_at IS NOT NULL AND
    s.last_dispatched_at > v_now-(s.interval_hours*interval '1 hour') then
  update public.event_auto_settings set last_run_at=v_now where game_id=p_game;
  return jsonb_build_object('sent',0,'reason','game_cooldown');
 end if;
 select current_round into v_round from public.games where id=p_game;

 if not exists(select 1 from public.event_case_routing where game_id=p_game) then  perform private.ensure_event_case_routing(p_game);end if;
 if not exists(select 1 from public.game_stages where game_id=p_game and stage_no=v_round and status='open') then
  return jsonb_build_object('sent',0,'reason','stage_not_open');end if;
 if not exists(select 1 from public.event_case_routing where game_id=p_game) then
  return jsonb_build_object('sent',0,'reason','routing_not_configured');
 end if;
 if not exists(select 1 from public.game_members where game_id=p_game and kind='student') then
  update public.event_auto_settings set last_run_at=v_now where game_id=p_game;
  return jsonb_build_object('sent',0,'reason','no_students');
 end if;
 for c in
  select ec.id,ec.audience,ec.allowed_roles,ec.seriousness,r.destination,r.region_code,r.earliest_stage,r.requires_office,rc.party_id
  from public.event_cases ec join public.event_case_routing r on r.game_id=ec.game_id and r.case_id=ec.id
  left join public.game_region_party_control rc on rc.game_id=ec.game_id and rc.region_code=r.region_code
  where ec.game_id=p_game and ec.status='ready'
    and v_round between r.earliest_stage and r.latest_stage
    and (r.region_code is null or (rc.party_id is not null and rc.fixed_at is not null))
    and not exists(select 1 from public.event_assignments ea where ea.case_id=ec.id)
    and not exists(select 1 from public.event_case_outcomes eo where eo.case_id=ec.id)
  -- When both controlling parties have relevant officers, prefer a different
  -- party from the previous regional dispatch. No extra history scan.
  order by case when r.region_code is not null and rc.party_id=s.last_regional_party_id then 1 else 0 end,
           random() limit 45
 loop
  perform 1 from public.event_cases where id=c.id for update skip locked;
  if not found then continue;end if;
  -- Eligibility requires the member to have an actual role/appointment, never a bare substring "minister".
  select array_agg(user_id) into chosen
  from (
    select gm.user_id
    from public.game_members gm
    left join public.game_presence pr on pr.game_id=gm.game_id and pr.user_id=gm.user_id
    -- Replaces three separate correlated reads per player with one index-backed
    -- aggregate over the already indexed (game_id, recipient_id) prefix.
    left join lateral (
      select count(*) filter(where ea.created_at>=v_now-interval '24 hours')::int as recent_count,
             count(*) filter(where ea.status='pending')::int as pending_count,
             max(ea.created_at) as last_assigned
      from public.event_assignments ea
      where ea.game_id=p_game and ea.recipient_id=gm.user_id
    ) hist on true
    where gm.game_id=p_game and gm.kind='student'
      and gm.roster_archived_at is null
      and (c.region_code is null or exists(
        select 1 from public.game_parties party
        where party.game_id=gm.game_id and party.name=gm.team
          and party.id=c.party_id))
      and (c.region_code is not null or c.destination='federal_collective' or
        exists(select 1 from unnest(c.allowed_roles) ar
          where lower(coalesce(gm.role_title,'')) like '%'||lower(ar)||'%'
          or exists(select 1 from public.game_office_assignments a
              where a.game_id=p_game and a.user_id=gm.user_id and a.status='active'
                and lower(a.role_title) like '%'||lower(ar)||'%')))
      -- In this simulation the winning party exercises regional executive
      -- powers, including the governor; federal office restrictions remain.
      and (not c.requires_office or c.earliest_stage<8 or c.region_code is not null
       or exists(select 1 from public.game_office_assignments o
         where o.game_id=p_game and o.user_id=gm.user_id and o.status='active'))
      and hist.recent_count<s.max_daily
      and hist.pending_count<3
      and coalesce(hist.last_assigned,'-infinity'::timestamptz) <
             v_now-(greatest(4,s.interval_hours/(1+s.activity_weight*least(2,
               least(120,greatest(0,extract(epoch from(v_now-coalesce(pr.last_seen_at,v_now-interval '72 hours')))/3600))/48)))*interval '1 hour')
    -- Spread requests among qualified party members instead of randomly
    -- assigning the same officer again, without any additional query.
    order by hist.last_assigned nulls first, hist.recent_count, random()
    limit case when c.region_code is not null then 1
               when c.destination='federal_joint' then 3
               when c.destination='federal_collective' then 500
               else 1 end
  ) eligible;
  n:=coalesce(cardinality(chosen),0);
  if c.destination='federal_joint' and n<2 then continue;end if;
  if c.destination='federal_collective' and n<2 then continue;end if;
  if n<1 then continue;end if;
  -- Regulatory guard enforces "single" and "group" capacities; regional group originally has 2-3.
  insert into public.event_assignments(case_id,game_id,recipient_id,created_by,stage_no)
  select c.id,p_game,unnest(chosen),null,v_round;
  dispatched:=dispatched+n;
  if c.region_code is not null then v_sent_party:=c.party_id;end if;
  exit; -- one regional party representative per case; original voting remains
 end loop;
 update public.event_auto_settings
 set last_run_at=v_now,
     last_dispatched_at=case when dispatched>0 then v_now else last_dispatched_at end,
     last_regional_party_id=coalesce(v_sent_party,last_regional_party_id)
 where game_id=p_game;
 perform private.apply_event_trust(p_game);
 return jsonb_build_object('sent',dispatched,'checked_at',v_now);
end $function$
;

CREATE OR REPLACE FUNCTION private.record_event_authority()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare c public.event_cases%rowtype;d record;o jsonb;qualified uuid[];ok boolean;lawful boolean;v_stage integer;violations int:=0;legal_delta numeric;v_authority_delta numeric;old_value numeric;new_value numeric;m public.state_metrics%rowtype;
begin
 select * into c from public.event_cases where id=new.case_id;
 -- Each decision inherits its assignment's immutable stage. Parallel stages
 -- must never use the highest currently opened stage as attribution.
 for d in select * from public.event_decisions where case_id=c.id loop
  select ea.stage_no into v_stage from public.event_assignments ea
   where ea.id=d.assignment_id and ea.game_id=c.game_id;
  o:=c.effect_plan->'options'->(substring(d.choice from 8)::int-1);
  select array_agg(distinct x.actor_id) into qualified from public.event_decisions x where x.case_id=c.id and x.choice=d.choice and (private.event_role_matches(x.role_snapshot,o->'authorized_roles') OR private.event_party_controls_region(c.id,x.actor_id)) and (x.actor_id=d.actor_id or exists(select 1 from public.event_collaboration_invites i where i.case_id=c.id and i.inviter_id=d.actor_id and i.recipient_id=x.actor_id and i.status='accepted'));
  ok:=coalesce(cardinality(qualified),0)>0;
  lawful:=coalesce((o->>'lawful')::boolean,false);
  -- Unattributed legacy assignments are not guessed into another stage;
  -- case resolution, trust and legal effects continue normally.
  if v_stage is not null then
  insert into public.event_authority_evidence(decision_id,case_id,game_id,actor_id,stage_no,authority_ok,lawful,strategy_point,role_snapshot,legal_basis,coalition_ids,delegated_ok,best_option)
  values(d.id,c.id,c.game_id,d.actor_id,v_stage,ok,lawful,ok and lawful and coalesce((o->>'protects_role_interest')::boolean,false),d.role_snapshot,coalesce(o->>'legal_basis','Правовая разметка варианта отсутствует'),coalesce(qualified,'{}'),not (private.event_role_matches(d.role_snapshot,o->'authorized_roles') OR private.event_party_controls_region(c.id,d.actor_id)) and ok,coalesce(o->>'public_interest','')='beneficial' and lawful and d.choice=new.winner) on conflict do nothing;
  end if;
  if d.choice=new.winner and (not ok or not lawful) then violations:=violations+1;end if;
 end loop;
 update public.event_authority_evidence ev set score_share=case when ev.best_option and ev.authority_ok and ev.lawful then round(1.0/nullif((select count(*) from public.event_authority_evidence ec where ec.case_id=c.id and ec.best_option and ec.authority_ok and ec.lawful),0),5) else 0 end where ev.case_id=c.id; if new.winner='tie' then return new;end if;
 v_authority_delta:=case when violations>0 then -greatest(0,new.requested_trust_delta)-least(6,violations*2) else 1 end;
 legal_delta:=case when violations>0 then -least(9,violations*3) else 2 end;
 perform private.apply_event_trust_delta(c.game_id,'authority-'||c.id,v_authority_delta,'Полномочия в событии: '||c.title);
 select * into m from public.state_metrics where game_id=c.game_id and metric_key='lawfulness' for update;
 if m.id is not null then
  old_value:=m.value;new_value:=greatest(coalesce(m.min_value,-1e9),least(coalesce(m.max_value,1e9),old_value+legal_delta));
  update public.state_metrics set previous_value=old_value,value=new_value where id=m.id;
  insert into public.state_metric_history(game_id,metric_id,metric_key,value,previous_value,delta,source_type,source_id,actor_id,note)
  values(c.game_id,m.id,m.metric_key,new_value,old_value,new_value-old_value,'event_authority',c.id::text,auth.uid(),'Правовая устойчивость: проверка полномочий по событию «'||c.title||'»');
 end if;
 update public.event_case_outcomes set trust_delta=new.trust_delta+coalesce((select delta from public.event_trust_ledger where game_id=c.game_id and action_key='authority-'||c.id),0),requested_trust_delta=new.requested_trust_delta+v_authority_delta where case_id=c.id;
 update public.political_posts set body=body||E'\n\nПроверка полномочий: нарушений '||violations||'. Суммарное фактическое изменение доверия: '||(select trust_delta from public.event_case_outcomes where case_id=c.id)||' п.п.' where id=new.media_post_id;
 return new;
end;$function$
;

CREATE OR REPLACE FUNCTION public.assign_event_case_at_stage(p_case_id uuid, p_recipients uuid[], p_stage_no integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE v_game uuid;
BEGIN
 SELECT game_id INTO v_game FROM public.event_cases WHERE id=p_case_id;
 IF v_game IS NULL OR NOT private.is_game_teacher(v_game) THEN
   RAISE EXCEPTION 'Требуются права преподавателя' USING ERRCODE='42501';
 END IF;
 IF p_stage_no NOT BETWEEN 1 AND 16 OR NOT EXISTS(
   SELECT 1 FROM public.game_stages s WHERE s.game_id=v_game AND s.stage_no=p_stage_no AND s.status='open')
 THEN RAISE EXCEPTION 'Выберите открытый этап для этой ситуации' USING ERRCODE='23514';END IF;
 PERFORM set_config('app.gos_event_stage',p_stage_no::text,true);
 RETURN public.assign_event_case(p_case_id,p_recipients);
END
$function$
;
REVOKE ALL ON FUNCTION public.assign_event_case_at_stage(uuid,uuid[],integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.assign_event_case_at_stage(uuid,uuid[],integer) TO authenticated;
