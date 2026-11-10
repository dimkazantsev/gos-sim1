-- GOС.ID 2026-11-10: spread 330 verified situations by meaningful competencies
-- while reducing dispatch work and preserving all earlier votes, cases and scoring.
-- Schema: one timestamp in the existing settings row, no new client RPCs or
-- subscriptions. This replaces, not duplicates, the existing hourly dispatcher.
-- Earlier migration fixes 330 approved source cases and their individual roles.
-- The six purpose-built crisis cases remain first available at stage 15.
SET LOCAL statement_timeout = '15s';

DO $verify$
DECLARE
  v_count int; v_hash text;
BEGIN
  SELECT count(*),md5(string_agg(ec.case_key||':'||r.earliest_stage,',' ORDER BY ec.case_key))
   INTO v_count,v_hash
  FROM public.event_case_routing r JOIN public.event_cases ec ON ec.id=r.case_id
  WHERE r.game_id='068dac89-00ea-447a-96bf-0cb11d85014a';
  IF v_count<>330 OR v_hash<>'81daae4aa7dbe53df45311c9cd34c0a4' THEN
    RAISE EXCEPTION 'Routing changed since review; abort, expected 330 unchanged source cases';
  END IF;
  IF (SELECT count(*) FROM public.event_cases WHERE game_id='068dac89-00ea-447a-96bf-0cb11d85014a')<>330
  THEN RAISE EXCEPTION 'Case bank changed; refuse incomplete rebalancing'; END IF;
END $verify$;

ALTER TABLE public.event_auto_settings
 ADD COLUMN IF NOT EXISTS last_dispatched_at timestamptz;

-- A single one-time backfill from the retained assignment history. Subsequent
-- hourly checks read this timestamp from the already locked settings row.
UPDATE public.event_auto_settings s
 SET last_dispatched_at=(SELECT max(a.created_at) FROM public.event_assignments a WHERE a.game_id=s.game_id)
WHERE s.last_dispatched_at IS NULL
 AND EXISTS(SELECT 1 FROM public.event_assignments a WHERE a.game_id=s.game_id);

-- New games reuse the identical 330-case and 113-regional routing rules.
-- Only the approved stage encoding and stage 16 upper bound are changed;
-- no extra query is added to the initial routing procedure.
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
 SELECT m.game_id,m.id,greatest(1,m.early),greatest(15,m.early),m.region,
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


-- Existing run_game_autopilot RPC, executed by the SAME hourly pg_cron job:
-- bounded to at most one situation per whole-game interval (12h currently).
-- Existing per-user daily caps, roles, regional eligibility, invitations and
-- outcomes remain unchanged. The previously permitted 45 cases per tick and
-- 500 recipients per collective case cannot multiply into a mass burst.
CREATE OR REPLACE FUNCTION private.run_game_autopilot(p_game uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare s public.event_auto_settings%rowtype;
 c record; chosen uuid[]; v_people uuid[]; v_leader uuid; n int; dispatched int:=0;
 v_now timestamptz:=now(); v_round int; v_count int;
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
      and gm.roster_archived_at is null
      and (c.region_code is null or private.member_party_id(p_game,gm.user_id)=c.party_id)
      and (c.region_code is not null or
          c.destination='federal_collective' or
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
      and coalesce((select max(created_at) from public.event_assignments ea
             where ea.game_id=p_game and ea.recipient_id=gm.user_id),'-infinity'::timestamptz) <
             v_now-(greatest(4,s.interval_hours/(1+s.activity_weight*least(2,
               least(120,greatest(0,extract(epoch from(v_now-coalesce(pr.last_seen_at,v_now-interval '72 hours')))/3600))/48)))*interval '1 hour')
    order by random()
    limit case when c.destination='regional_joint' then 1
               when c.destination='federal_joint' then 3
               when c.destination in('regional','federal_collective') then 500
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
  exit; -- at most one case per dispatch interval, group size stays unchanged
 end loop;
 update public.event_auto_settings
 set last_run_at=v_now,
     last_dispatched_at=case when dispatched>0 then v_now else last_dispatched_at end
 where game_id=p_game;
 perform private.apply_event_trust(p_game);
 return jsonb_build_object('sent',dispatched,'checked_at',v_now);
end $function$;


-- Update only as-yet-unissued, validated cases in the active game.
-- All already assigned, resolved or historically documented cases are immutable.
-- One previously assigned document/protocol case remains on its old stage 09 in
-- the current game, but new games use the approved earlier stage 04.
WITH numbered AS (
 SELECT ec.game_id,ec.id,ec.case_key,
        row_number() OVER (PARTITION BY ec.game_id ORDER BY ec.case_key) AS rn
 FROM public.event_cases ec
 WHERE ec.game_id='068dac89-00ea-447a-96bf-0cb11d85014a'
), proposals AS (
 SELECT n.game_id,n.id,
  strpos('0123456789abcdefghijklmnopqrstuv',substr('eaae9999eeeaa989eaeaf9aa9a9aa849aa59eaaf9fa99aa4e99e5999a5e9ae998ae99959e9eee99e999ee99e9e9e9eae998e89ee9eee99e9a94ea98affaae86efd44e6d8a695de9aadddddddddddddddddddgdddddddddddddgdddddddddddgddddddgddddddddgddddddddddddddddgdddddddgddcc4ccccc1177ccccccbabbaaaaaaaagbbbddcbccbcbbcccceacb1bccbbcbbad4e4dddddddddddddddddddddddddddddd',n.rn::int,1))-1 AS new_stage
 FROM numbered n
)
UPDATE public.event_case_routing r
 SET earliest_stage=p.new_stage,
     latest_stage=greatest(r.latest_stage,p.new_stage)
FROM proposals p
WHERE r.game_id=p.game_id AND r.case_id=p.id
 AND p.new_stage BETWEEN 1 AND 16 AND r.earliest_stage<>p.new_stage
 AND NOT EXISTS (SELECT 1 FROM public.event_assignments a WHERE a.case_id=r.case_id)
 AND NOT EXISTS (SELECT 1 FROM public.event_case_outcomes o WHERE o.case_id=r.case_id);

DO $postcheck$
DECLARE v_count int;v_changed int;v_audit int; v_assigned int;
BEGIN
 SELECT count(*),count(*) FILTER(WHERE earliest_stage<=5)
 INTO v_count,v_changed FROM public.event_case_routing
 WHERE game_id='068dac89-00ea-447a-96bf-0cb11d85014a';
 -- An already assigned case (bank-records) retains its historical stage 09.
 IF v_count<>330 OR v_changed<>15 THEN
  RAISE EXCEPTION 'Route verification failed: count %, early %',v_count,v_changed;
 END IF;
 SELECT count(*) INTO v_audit FROM public.event_case_routing
 WHERE game_id='068dac89-00ea-447a-96bf-0cb11d85014a' AND earliest_stage=16 AND latest_stage=16;
 IF v_audit<>8 THEN RAISE EXCEPTION 'Final audit cases lost: %',v_audit; END IF;
 SELECT count(*) INTO v_assigned FROM public.event_assignments a
 JOIN public.event_case_routing r ON r.case_id=a.case_id AND r.game_id=a.game_id
 WHERE a.game_id='068dac89-00ea-447a-96bf-0cb11d85014a'
  AND r.earliest_stage IN(4,5,6,16);
 IF v_assigned<>0 THEN
  RAISE EXCEPTION 'Historical case was rescheduled: %',v_assigned;
 END IF;
END $postcheck$;
