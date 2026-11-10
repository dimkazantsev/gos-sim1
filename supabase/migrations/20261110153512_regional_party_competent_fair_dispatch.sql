-- 2026-11-10 · Regional authorities are controlled by the winning party under
-- approved ГОС.ID game convention (including the governor's office).
-- Keep existing 12-hour, one-situation/game limit and hourly pg_cron schedule.
-- No new cron jobs, polls, client subscriptions or external requests.
SET LOCAL statement_timeout='20s';
ALTER TABLE public.event_auto_settings
  ADD COLUMN IF NOT EXISTS last_regional_party_id uuid;

-- Existing RPC, unchanged signature, private schema and security boundary.
-- Regional selection follows the fixed Stage 03 party control, not a
-- separate governor appointment. Federal cases keep their own role gates.
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
  insert into public.event_assignments(case_id,game_id,recipient_id,created_by)
  select c.id,p_game,unnest(chosen),null;
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
end $function$;

-- The already frozen map of 89 regional party victories is the **only**
-- source of the simulated regional-government mandate. This function cannot
-- grant any authority for federal or non-regional events.
CREATE OR REPLACE FUNCTION private.event_party_controls_region(p_case uuid,p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
 SELECT EXISTS (
  SELECT 1 FROM public.event_case_routing r
  JOIN public.game_region_party_control rc
    ON rc.game_id=r.game_id AND rc.region_code=r.region_code
   AND rc.party_id IS NOT NULL AND rc.fixed_at IS NOT NULL
  JOIN public.game_members m
    ON m.game_id=r.game_id AND m.user_id=p_user
   AND m.kind='student' AND m.roster_archived_at IS NULL
  JOIN public.game_parties party
    ON party.game_id=m.game_id AND party.id=rc.party_id AND party.name=m.team
  WHERE r.case_id=p_case
    AND r.destination IN ('regional','regional_joint')
    AND r.region_code IS NOT NULL
 );
$function$;
REVOKE ALL ON FUNCTION private.event_party_controls_region(uuid,uuid)
 FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.record_event_authority()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare c public.event_cases%rowtype;d record;o jsonb;qualified uuid[];ok boolean;lawful boolean;v_stage integer;violations int:=0;legal_delta numeric;v_authority_delta numeric;old_value numeric;new_value numeric;m public.state_metrics%rowtype;
begin
 select * into c from public.event_cases where id=new.case_id;
 select stage_no into v_stage from public.game_stages where game_id=c.game_id and status='open' order by stage_no desc limit 1;
 v_stage:=coalesce(v_stage,1);
 for d in select * from public.event_decisions where case_id=c.id loop
  o:=c.effect_plan->'options'->(substring(d.choice from 8)::int-1);
  select array_agg(distinct x.actor_id) into qualified from public.event_decisions x where x.case_id=c.id and x.choice=d.choice and (private.event_role_matches(x.role_snapshot,o->'authorized_roles') OR private.event_party_controls_region(c.id,x.actor_id)) and (x.actor_id=d.actor_id or exists(select 1 from public.event_collaboration_invites i where i.case_id=c.id and i.inviter_id=d.actor_id and i.recipient_id=x.actor_id and i.status='accepted'));
  ok:=coalesce(cardinality(qualified),0)>0;
  lawful:=coalesce((o->>'lawful')::boolean,false);
  insert into public.event_authority_evidence(decision_id,case_id,game_id,actor_id,stage_no,authority_ok,lawful,strategy_point,role_snapshot,legal_basis,coalition_ids,delegated_ok,best_option)
  values(d.id,c.id,c.game_id,d.actor_id,v_stage,ok,lawful,ok and lawful and coalesce((o->>'protects_role_interest')::boolean,false),d.role_snapshot,coalesce(o->>'legal_basis','Правовая разметка варианта отсутствует'),coalesce(qualified,'{}'),not (private.event_role_matches(d.role_snapshot,o->'authorized_roles') OR private.event_party_controls_region(c.id,d.actor_id)) and ok,coalesce(o->>'public_interest','')='beneficial' and lawful and d.choice=new.winner) on conflict do nothing;
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
end;$function$;

CREATE OR REPLACE FUNCTION private.ensure_event_case_routing(p_game uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
 v_stage_codes constant text:='eaae9999eeeaa989eaeaf9aa9a9aa849aa59eaaf9fa99aa4e99e5999a5e9ae998ae99959e9eee99e999ee99e9e9e9eae998e89ee9eee99e9a94ea98affaae86efd44e6d8a695de9aadddddddddddddddddddgdddddddddddddgdddddddddddgddddddgddddddddgddddddddddddddddgdddddddgddcc4ccccc1177ccccccbabbaaaaaaaagbbbddcbccbcbbcccceacb1bccbbcbbad4e4dddddddddddddddddddddddddddddd';
 v_org_codes constant text:='56857777575897g77g58d46g9g79bg83g95986gd4867a6b1gd3514ba8d5gb5dbg857gb1h5g555g7555g557g5g575g59577g5g7757555775797g59g68949d5bb54bg857b68g4gb5468eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeifiii0ffff22fffffffffffffffffffffffffffffiffiiiiffff0fiifffff8bg57eeeeeeeeeeeeeeeeeeeeeeeecccccc';
 v_total int;v_known int;v_existing int;v_added int:=0;v_regional int;
BEGIN
 SELECT count(*),count(*) FILTER (WHERE EXISTS(
   SELECT 1 FROM private.authored_event_catalog cat WHERE cat.case_key=ec.case_key
 )) INTO v_total,v_known
 FROM public.event_cases ec WHERE ec.game_id=p_game AND ec.status='ready';
 IF v_total<>330 OR v_known<>330 THEN RETURN 0; END IF;
 SELECT count(*) INTO v_existing FROM public.event_case_routing WHERE game_id=p_game;
 IF v_existing=330 THEN RETURN 0; END IF;
 IF length(v_stage_codes)<>330 OR length(v_org_codes)<>330
 THEN RAISE EXCEPTION 'Утверждённая матрица игровых ситуаций повреждена'; END IF;
 WITH numbered AS(
  SELECT ec.game_id,ec.id,ec.case_key,ec.audience,
   row_number() over(order by ec.case_key) rn
  FROM public.event_cases ec WHERE ec.game_id=p_game AND ec.status='ready'
 ),mapped AS(
  SELECT n.*,
   strpos('0123456789abcdefghijklmnopqrstuv',substr(v_stage_codes,n.rn::int,1))-1 early,
   strpos('0123456789abcdefghijklmnopqrstuv',substr(v_org_codes,n.rn::int,1))-1 org_idx,
   CASE WHEN n.case_key LIKE 'bank-legal-2026-%'
          AND substring(n.case_key from '[0-9]+$')::int BETWEEN 1 AND 89
     THEN (SELECT code FROM public.fiscal_region_reference ORDER BY code
       OFFSET (substring(n.case_key from '[0-9]+$')::int-1) LIMIT 1)
    WHEN n.case_key ~ '^budget-region-2026-[0-9]{2}-'
     THEN substring(n.case_key from '^budget-region-2026-([0-9]{2})-')
    ELSE NULL END region
  FROM numbered n
 ),orgs AS(
  SELECT arr,(ordinality-1) idx FROM unnest(array[
  'Государственная Дума / депутат',
  'Депутат ГД / комиссия (уточнить)',
  'Избирательная комиссия',
  'МИД / Правительство РФ',
  'МЧС / региональные службы (совместно)',
  'Местное самоуправление / профильная администрация',
  'Минздрав / региональный орган здравоохранения',
  'Минкультуры / муниципальные учреждения',
  'Минобрнауки / Минпросвещения; региональный профильный орган',
  'Минприроды / профильный природоохранный орган',
  'Минтранс / региональные транспортные органы',
  'Минфин / Минэкономразвития / Минтруд (по сфере)',
  'Минфин РФ / Правительство РФ',
  'Минцифры / оператор системы',
  'Победившая региональная партия / губернатор; финансовый орган региона',
  'Правительство / Минюст (уточнить компетенцию)',
  'Профильное федеральное министерство (уточнить)',
  'Профильный компетентный орган (ручное сопоставление)',
  'Судебные органы; правовая служба (по полномочию)'
  ]) WITH ORDINALITY AS t(arr,ordinality)
 )
 INSERT INTO public.event_case_routing(game_id,case_id,earliest_stage,latest_stage,
   region_code,destination,requires_office,competent_org)
 SELECT m.game_id,m.id,
  CASE
   WHEN m.region IS NOT NULL AND m.early=13
    AND m.case_key ~ '^bank-legal-2026-[0-9]{3}$'
    THEN 4 + ((substring(m.case_key from '[0-9]+$')::integer-1) % 8)
   WHEN m.region IS NOT NULL AND m.early=13
    AND m.case_key LIKE 'budget-region-2026-%'
    THEN 9 + ((m.rn::int-1) % 4)
   ELSE greatest(1,m.early)
  END,
  greatest(15,m.early),m.region,
  CASE WHEN m.region IS NOT NULL AND m.audience='group' THEN 'regional_joint'
       WHEN m.region IS NOT NULL THEN 'regional'
       WHEN m.audience='all' THEN 'federal_collective'
       WHEN m.audience='group' THEN 'federal_joint'
       ELSE 'individual' END,
  true,o.arr
 FROM mapped m JOIN orgs o ON o.idx=m.org_idx
 WHERE m.early BETWEEN 1 AND 16
 ON CONFLICT(game_id,case_id) DO NOTHING;
 GET DIAGNOSTICS v_added=ROW_COUNT;
 SELECT count(*),count(*) FILTER(WHERE region_code IS NOT NULL)
  INTO v_existing,v_regional FROM public.event_case_routing WHERE game_id=p_game;
 IF v_existing<>330 OR v_regional<>113
 THEN RAISE EXCEPTION 'Маршрутизация неполна: всего %, региональных %',v_existing,v_regional; END IF;
 RETURN v_added;
END;
$function$;

-- Existing game: release only unused/unresolved regional source cases.
-- No game UUIDs: route against the existing verified Stage 03 fixed ownership.
-- Previously assigned cases, outcomes, votes and scoring are untouched.
WITH numbered AS (
  SELECT ec.id,ec.game_id,ec.case_key,
    row_number() OVER (PARTITION BY ec.game_id ORDER BY ec.case_key) AS rn
  FROM public.event_cases ec
), eligible AS (
 SELECT n.id,n.game_id,
  CASE
    WHEN n.case_key ~ '^bank-legal-2026-[0-9]{3}$'
     THEN 4+((substring(n.case_key from '[0-9]+$')::integer-1) % 8)
    WHEN n.case_key LIKE 'budget-region-2026-%'
     THEN 9+((n.rn::int-1) % 4)
    ELSE NULL
  END AS new_start
 FROM numbered n
)
UPDATE public.event_case_routing r
 SET earliest_stage=x.new_start
 FROM eligible x
 WHERE r.case_id=x.id AND r.game_id=x.game_id
  AND r.earliest_stage=13 AND x.new_start BETWEEN 4 AND 12
  AND r.region_code IS NOT NULL
  AND EXISTS (
   SELECT 1 FROM public.game_region_party_control rc
    WHERE rc.game_id=r.game_id AND rc.region_code=r.region_code
     AND rc.party_id IS NOT NULL AND rc.fixed_at IS NOT NULL
  )
  AND NOT EXISTS(SELECT 1 FROM public.event_assignments ea WHERE ea.case_id=r.case_id)
  AND NOT EXISTS(SELECT 1 FROM public.event_case_outcomes eo WHERE eo.case_id=r.case_id);
