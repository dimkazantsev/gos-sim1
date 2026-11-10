-- 2026-11-10 · Political responsibility without delegated government powers.
-- Keep existing 12-hour, one-situation/game limit and hourly pg_cron schedule.
-- No new cron jobs, polls, client subscriptions or external requests.
SET LOCAL statement_timeout='20s';
ALTER TABLE public.event_auto_settings
  ADD COLUMN IF NOT EXISTS last_regional_party_id uuid;

-- Existing RPC, unchanged signature, private schema and security boundary.
-- Regional selection requires both party control AND the matching official
-- office. Earlier regional-case release remains intentionally gated until a
-- competent participant can act; do not award unlawful deputy decisions.
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
    and (r.region_code is null or rc.party_id is not null)
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
      and (c.region_code is null and c.destination='federal_collective' or
        exists(select 1 from unnest(c.allowed_roles) ar
          where lower(coalesce(gm.role_title,'')) like '%'||lower(ar)||'%'
          or exists(select 1 from public.game_office_assignments a
              where a.game_id=p_game and a.user_id=gm.user_id and a.status='active'
                and lower(a.role_title) like '%'||lower(ar)||'%')))
      -- A party's political control is not an appointment as governor or
      -- finance minister. No member can exercise another office's powers.
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
  exit; -- at most one case per dispatch interval; regional starts with one responsible officer
 end loop;
 update public.event_auto_settings
 set last_run_at=v_now,
     last_dispatched_at=case when dispatched>0 then v_now else last_dispatched_at end,
     last_regional_party_id=coalesce(v_sent_party,last_regional_party_id)
 where game_id=p_game;
 perform private.apply_event_trust(p_game);
 return jsonb_build_object('sent',dispatched,'checked_at',v_now);
end $function$;
