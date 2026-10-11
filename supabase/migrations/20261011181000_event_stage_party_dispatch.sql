-- Route-aware autopilot. Existing choice options, outcomes and classroom voting are unchanged.
create or replace function private.run_game_autopilot(p_game uuid)
returns jsonb language plpgsql security definer
set search_path='public','private','pg_temp'
as $$
declare s public.event_auto_settings%rowtype;
 c record; chosen uuid[]; v_people uuid[]; v_leader uuid; n int; dispatched int:=0;
 v_now timestamptz:=now(); v_round int; v_count int;
begin
 select * into s from public.event_auto_settings where game_id=p_game for update;
 if not found or not s.enabled then return jsonb_build_object('sent',0,'reason','paused');end if;
 if s.last_run_at>v_now-interval '55 minutes' then return jsonb_build_object('sent',0,'reason','already_checked');end if;
 select current_round into v_round from public.games where id=p_game;
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
  order by random() limit 45
 loop
  perform 1 from public.event_cases where id=c.id for update skip locked;
  if not found then continue;end if;
  -- Eligibility requires the member to have an actual role/appointment, never a bare substring "minister".
  select array_agg(user_id) into chosen
  from (
    select gm.user_id
    from public.game_members gm
    left join public.game_presence pr on pr.game_id=gm.game_id and pr.user_id=gm.user_id
    where gm.game_id=p_game and gm.kind='student'
      and (c.region_code is null or private.member_party_id(p_game,gm.user_id)=c.party_id)
      and (c.region_code is not null or
          exists(select 1 from unnest(c.allowed_roles) ar
          where lower(coalesce(gm.role_title,'')) like '%'||lower(ar)||'%'
          or exists(select 1 from public.game_office_assignments a
              where a.game_id=p_game and a.user_id=gm.user_id and a.status='active'
                and lower(a.role_title) like '%'||lower(ar)||'%')))
      and (not c.requires_office or c.earliest_stage<8 or c.region_code is not null
       or exists(select 1 from public.game_office_assignments o
         where o.game_id=p_game and o.user_id=gm.user_id and o.status='active'))
      and (select count(*) from public.event_assignments ea
             where ea.game_id=p_game and ea.recipient_id=gm.user_id
             and ea.created_at>=v_now-interval '24 hours')<s.max_daily
      and (select count(*) from public.event_assignments ea
             where ea.game_id=p_game and ea.recipient_id=gm.user_id and ea.status='pending')<3
      and (select max(created_at) from public.event_assignments ea
             where ea.game_id=p_game and ea.recipient_id=gm.user_id) <
             v_now-(greatest(4,s.interval_hours/(1+s.activity_weight*least(2,
               least(120,greatest(0,extract(epoch from(v_now-coalesce(pr.last_seen_at,v_now-interval '72 hours')))/3600))/48)))*interval '1 hour')
          or not exists(select 1 from public.event_assignments ea where ea.game_id=p_game and ea.recipient_id=gm.user_id)
    order by random()
    limit case when c.destination in('regional_joint','federal_joint') then 3
               when c.destination='federal_collective' then 500
               else 1 end
  ) eligible;
  n:=coalesce(cardinality(chosen),0);
  if c.destination in('regional_joint','federal_joint') and n<2 then continue;end if;
  if c.destination='federal_collective' and
    (n<>(select count(*) from public.game_members gm where gm.game_id=p_game and gm.kind='student'))
  then continue;end if;
  if n<1 then continue;end if;
  -- Regulatory guard enforces "single" and "group" capacities; regional group originally has 2-3.
  insert into public.event_assignments(case_id,game_id,recipient_id,created_by)
  select c.id,p_game,unnest(chosen),null;
  dispatched:=dispatched+n;
 end loop;
 update public.event_auto_settings set last_run_at=v_now where game_id=p_game;
 perform private.apply_event_trust(p_game);
 return jsonb_build_object('sent',dispatched,'checked_at',v_now);
end $$;
