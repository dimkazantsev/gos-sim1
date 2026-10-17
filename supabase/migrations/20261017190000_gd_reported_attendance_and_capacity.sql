
-- Central source of GD voting capacity, shared by attendance and votes.
-- Before party mandates are first distributed, divide all 450 seats equally
-- between active students; remainder follows stable joined_at/user_id order.
-- Once any party mandates have been distributed, use stored effective seats:
-- ghost voting and representation penalties can reduce capacity to zero.
CREATE OR REPLACE FUNCTION private.gd_member_capacity(p_game uuid,p_user uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,private,pg_temp
AS $capacity$
WITH ranked AS (
 SELECT user_id,row_number() OVER (ORDER BY joined_at,user_id) rn,
        count(*) OVER () n
 FROM public.game_members
 WHERE game_id=p_game AND kind='student' AND roster_archived_at IS NULL
), allocated AS (
 SELECT coalesce(sum(base_mandates),0)::integer all_base
 FROM public.party_member_mandates WHERE game_id=p_game
)
SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM ranked WHERE user_id=p_user) THEN 0
 WHEN (SELECT all_base FROM allocated)>0 THEN
  coalesce((SELECT sum(effective_mandates)::integer FROM public.party_member_mandates
    WHERE game_id=p_game AND user_id=p_user),0)
 ELSE (
  SELECT (450/n + CASE WHEN rn<=450%n THEN 1 ELSE 0 END)::integer
  FROM ranked WHERE user_id=p_user
 ) END;
$capacity$;
REVOKE ALL ON FUNCTION private.gd_member_capacity(uuid,uuid) FROM PUBLIC,anon,authenticated;

ALTER TABLE public.institution_session_registrations
 ADD COLUMN IF NOT EXISTS present_mandates integer;
ALTER TABLE public.institution_session_registrations
 ADD COLUMN IF NOT EXISTS presence_updated_at timestamptz;
DO $check$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='gd_reported_attendance_nonnegative'
 AND conrelid='public.institution_session_registrations'::regclass) THEN
 ALTER TABLE public.institution_session_registrations
  ADD CONSTRAINT gd_reported_attendance_nonnegative
  CHECK (present_mandates IS NULL OR present_mandates>=0);
 END IF;
END $check$;

-- Returns each registered participant's verified attendance and current limit.
-- Requires membership; direct UPDATE is denied by existing read-only RLS.
CREATE OR REPLACE FUNCTION public.get_gd_session_attendance(
 p_game_id uuid,p_stage_no integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,private,pg_temp
AS $attendance$
DECLARE v_uid uuid:=(select auth.uid());v_rows jsonb;
BEGIN
 IF v_uid IS NULL OR NOT private.is_game_member(p_game_id) THEN
  RAISE EXCEPTION 'Нет доступа к сведениям о заседании';
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'user_id',r.user_id,
  'capacity',private.gd_member_capacity(p_game_id,r.user_id),
  'declared',r.present_mandates,
  'present',least(coalesce(r.present_mandates,0),private.gd_member_capacity(p_game_id,r.user_id))
 ) ORDER BY r.registered_at,r.user_id),'[]'::jsonb) INTO v_rows
 FROM public.institution_session_registrations r
 WHERE r.game_id=p_game_id AND r.stage_no=p_stage_no AND r.institution_key='gd';
 RETURN jsonb_build_object('my_capacity',private.gd_member_capacity(p_game_id,v_uid),
  'registered',v_rows);
END;
$attendance$;
REVOKE ALL ON FUNCTION public.get_gd_session_attendance(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_gd_session_attendance(uuid,integer) TO authenticated;

-- Atomic and repeatable attendance declaration. No invented presence, even
-- for registrations saved before this migration. Client cannot claim seats
-- for another member or exceed their current (GV-adjusted) representation.
CREATE OR REPLACE FUNCTION public.set_gd_session_attendance(
 p_game_id uuid,p_stage_no integer,p_present integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,private,pg_temp
AS $register$
DECLARE v_uid uuid:=(select auth.uid());v_cap integer;
BEGIN
 IF v_uid IS NULL OR NOT private.is_game_member(p_game_id) THEN
  RAISE EXCEPTION 'Нет доступа к игре';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.game_stages
  WHERE game_id=p_game_id AND stage_no=p_stage_no AND status='open') THEN
  RAISE EXCEPTION 'Этап не открыт';
 END IF;
 -- Serialise simultaneous requests from the same participant.
 PERFORM 1 FROM public.game_members WHERE game_id=p_game_id
  AND user_id=v_uid AND kind='student' AND roster_archived_at IS NULL FOR UPDATE;
 IF NOT FOUND OR NOT private.vote_member_has_office(p_game_id,v_uid,'gd') THEN
  RAISE EXCEPTION 'Нет полномочий депутата Государственной Думы';
 END IF;
 v_cap:=private.gd_member_capacity(p_game_id,v_uid);
 IF p_present IS NULL OR p_present<0 OR p_present>v_cap THEN
  RAISE EXCEPTION 'Укажите присутствующих депутатов от 0 до %',v_cap;
 END IF;
 PERFORM public.register_institution_session_at_stage(p_game_id,'gd',p_stage_no);
 UPDATE public.institution_session_registrations
 SET present_mandates=p_present,presence_updated_at=now()
 WHERE game_id=p_game_id AND stage_no=p_stage_no
  AND institution_key='gd' AND user_id=v_uid;
 RETURN jsonb_build_object('capacity',v_cap,'present',p_present);
END;
$register$;
REVOKE ALL ON FUNCTION public.set_gd_session_attendance(uuid,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_gd_session_attendance(uuid,integer,integer) TO authenticated;

CREATE OR REPLACE FUNCTION private.vote_member_has_office(p_game uuid, p_user uuid, p_institution text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
select private.vote_member_matches(p_game,p_user,p_institution) or exists(
 select 1 from public.game_office_assignments o join public.game_members gm on gm.game_id=o.game_id and gm.user_id=o.user_id
 where o.game_id=p_game and o.user_id=p_user and o.status='active' and gm.kind='student'
 and private.role_is_available(p_game,p_user) and private.role_matches_voting_body(o.role_title,p_institution))
 or (p_institution='gd' and private.role_is_available(p_game,p_user)
  and private.gd_member_capacity(p_game,p_user)>0)
 or (p_institution='gd' and private.role_is_available(p_game,p_user) and exists(
 select 1 from public.party_member_mandates pm join public.game_members gm on gm.game_id=pm.game_id and gm.user_id=pm.user_id
 where pm.game_id=p_game and pm.user_id=p_user and pm.base_mandates>0 and gm.kind='student' and gm.roster_archived_at is null));
$function$;

CREATE OR REPLACE FUNCTION private.snapshot_vote_electorate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare roster jsonb;total numeric;label text;selected_group text;
begin
 selected_group:=nullif(current_setting('app.vote_group',true),'');
 if selected_group is not null and not exists(select 1 from public.game_members where game_id=new.game_id and kind='student' and group_name=selected_group) then raise exception 'Учебная группа не найдена';end if;
 if new.institution_key not in ('all','factions','ksrf','gd','government','municipality','sf','committee','region','cec','ks','vs','central_bank','accounts')
 and not exists(select 1 from public.institution_units u where u.game_id=new.game_id and 'unit:'||u.id::text=new.institution_key) then raise exception 'Орган не найден';end if;
 if new.institution_key='gd' then new.voting_mode:='mandate';end if;
 if new.institution_key not in ('gd','all','factions','ksrf') then new.voting_mode:='member';end if;
 if new.institution_key='gd' and (new.quorum_kind<>'fraction' or new.quorum_value<0.5) then raise exception 'Кворум Государственной Думы не может быть ниже 226 из 450';end if;
 if new.institution_key in ('gd','sf','committee','region','cec','government','municipality') and (new.quorum_kind<>'fraction' or new.quorum_value<0.5) then raise exception 'Кворум органа не может быть ниже установленного минимума';end if;
 if new.institution_key in ('vs','accounts') and (new.quorum_kind<>'fraction' or new.quorum_value<0.666666) then raise exception 'Требуется кворум не менее двух третей учебного состава';end if;
 if new.institution_key='ks' and (new.quorum_kind<>'fraction' or new.quorum_value<0.545454) then raise exception 'Учебный кворум КС масштабируется от шести из одиннадцати судей';end if;
 if new.quorum_value<0 or new.quorum_value>1 or new.majority_value<0 or new.majority_value>1 then raise exception 'Некорректный порог голосования';end if;
 select coalesce(jsonb_object_agg(x.user_id::text,x.weight),'{}'::jsonb) into roster from (
  select gm.user_id,case new.voting_mode
   when 'mandate' then case when new.institution_key='gd'
    then private.gd_member_capacity(new.game_id,gm.user_id)
    else coalesce((select a.effective_mandates from public.party_member_mandates a where a.game_id=new.game_id and a.user_id=gm.user_id limit 1),0) end
   when 'faction' then case when exists(select 1 from public.game_parties p where p.game_id=new.game_id and p.leader_user_id=gm.user_id) then 1 else 0 end
   else 1 end as weight
  from public.game_members gm where gm.game_id=new.game_id and gm.kind<>'observer' and (selected_group is null or gm.group_name=selected_group)
   and private.vote_member_has_office(new.game_id,gm.user_id,new.institution_key)
 ) x where x.weight>0;
 if new.institution_key='gd' then total:=450;
 elsif new.institution_key='government' then
  select coalesce(sum(value::numeric),0) into total from jsonb_each_text(roster);
 elsif new.institution_key='municipality' then
  select count(*) into total from public.game_members where game_id=new.game_id and kind='student' and (selected_group is null or group_name=selected_group);
 elsif new.institution_key like 'unit:%' then
  select mandate_capacity into total from public.institution_units where game_id=new.game_id and 'unit:'||id::text=new.institution_key;
 else select coalesce(sum(value::numeric),0) into total from jsonb_each_text(roster);end if;
 select title into label from public.institution_units where game_id=new.game_id and 'unit:'||id::text=new.institution_key;
 if new.institution_key='ksrf' then label:='КСРФ';end if;
 new.group_name:=selected_group;
 new.electorate_snapshot:=jsonb_build_object('weights',roster,'eligible',total,'group_name',selected_group,'institution_label',label,'attendance_required',new.institution_key not in ('all','factions'),'captured_at',now());
 return new;
end;$function$;

CREATE OR REPLACE FUNCTION private.vote_eligible_weight(p_vote game_votes, p_user uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare w numeric;
begin
 if not private.vote_member_has_office(p_vote.game_id,p_user,p_vote.institution_key) then return 0;end if;

 if (
   coalesce((p_vote.electorate_snapshot->>'attendance_required')::boolean,false)
   or p_vote.procedure_key in ('registered_session','presidential_system','sf_resolution','government_nomination')
 )
 and p_vote.institution_key not in ('all','factions')
 and not exists(
   select 1
   from public.institution_session_registrations r
   where r.game_id=p_vote.game_id
     and r.stage_no=p_vote.stage_no
     and r.institution_key=p_vote.institution_key
     and r.user_id=p_user
 ) then return 0;end if;

 if p_vote.institution_key='gd' and p_vote.status='open' then
   -- A registered deputy may cast no more than the deputies who are actually
   -- present, and cannot exceed the original electorate frozen at vote opening.
   select coalesce(r.present_mandates,0) into w
   from public.institution_session_registrations r
   where r.game_id=p_vote.game_id and r.stage_no=p_vote.stage_no
    and r.institution_key='gd' and r.user_id=p_user;
   return least(
      greatest(0,coalesce(w,0)),
      private.gd_member_capacity(p_vote.game_id,p_user),
      coalesce((p_vote.electorate_snapshot->'weights'->>p_user::text)::numeric,0)
   );
 end if;
 if p_vote.electorate_snapshot is not null then
   return coalesce((p_vote.electorate_snapshot->'weights'->>p_user::text)::numeric,0);
 end if;

 if p_vote.voting_mode='faction' then
   return case when exists(
     select 1 from public.game_parties
     where game_id=p_vote.game_id and leader_user_id=p_user
   ) then 1 else 0 end;
 end if;

 if p_vote.voting_mode='mandate' then
   select case when p_vote.institution_key='gd' then private.gd_member_capacity(p_vote.game_id,p_user)
         else (select effective_mandates from public.party_member_mandates where game_id=p_vote.game_id and user_id=p_user limit 1) end into w;
   return coalesce(w,0);
 end if;

 return 1;
end;
$function$;

CREATE OR REPLACE FUNCTION private.vote_present_weight(p_vote game_votes)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
select case
 when p_vote.institution_key='gd' and coalesce((p_vote.electorate_snapshot->>'attendance_required')::boolean,false) then (
  select coalesce(sum(least(
    greatest(0,coalesce(r.present_mandates,0)),
    coalesce((p_vote.electorate_snapshot->'weights'->>r.user_id::text)::numeric,0),
    private.gd_member_capacity(p_vote.game_id,r.user_id)
  )),0)
  from public.institution_session_registrations r
  where r.game_id=p_vote.game_id and r.stage_no=p_vote.stage_no and r.institution_key='gd'
 )
 when coalesce((p_vote.electorate_snapshot->>'attendance_required')::boolean,false) then (
 select coalesce(sum(s.value::numeric),0) from jsonb_each_text(p_vote.electorate_snapshot->'weights') s
 where exists(select 1 from public.institution_session_registrations r where r.game_id=p_vote.game_id and r.stage_no=p_vote.stage_no and r.institution_key=p_vote.institution_key and r.user_id::text=s.key))
 else (select coalesce(sum(weight),0) from public.game_ballots where vote_id=p_vote.id) end;
$function$;

CREATE OR REPLACE FUNCTION public.cast_personal_office_ballot(p_election_id uuid, p_candidate_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
 e public.office_elections%rowtype;
 uid uuid:=(select auth.uid());
 party uuid;
 capacity integer;
begin
 if uid is null then raise exception 'Необходимо войти в игру';end if;
 select * into e from public.office_elections where id=p_election_id for update;
 if e.id is null or e.status<>'open' or e.ballot_mode<>'personal' then
  raise exception 'Персональное голосование сейчас не открыто';
 end if;
 perform private.require_game_meeting_registration(e.game_id,uid,e.stage_no,'gd');
 select gp.id,least(private.gd_member_capacity(e.game_id,uid),coalesce(r.present_mandates,0))
 into party,capacity
 from public.game_members gm
 join public.game_parties gp on gp.game_id=gm.game_id and gp.name=gm.team
 join public.institution_session_registrations r on r.game_id=gm.game_id and r.user_id=gm.user_id
  and r.stage_no=e.stage_no and r.institution_key='gd'
 where gm.game_id=e.game_id and gm.user_id=uid and gm.kind='student'
  and gm.roster_archived_at is null
 limit 1;
 if party is null or capacity<=0 then raise exception 'У вас нет действующих депутатских мандатов';end if;
 if not exists(select 1 from public.office_candidates c where c.id=p_candidate_id and c.election_id=e.id and c.game_id=e.game_id)
 then raise exception 'Кандидат не относится к этому голосованию';end if;
 insert into public.office_personal_ballots(election_id,game_id,voter_id,party_id,candidate_id)
 values(e.id,e.game_id,uid,party,p_candidate_id)
 on conflict(election_id,voter_id) do update set
   party_id=excluded.party_id,candidate_id=excluded.candidate_id,updated_at=now();
end $function$;

CREATE OR REPLACE FUNCTION private.office_candidate_vote_weight(p_election uuid, p_candidate uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare e public.office_elections%rowtype;v_result integer;
begin
 select * into e from public.office_elections where id=p_election;
 if e.id is null then return 0;end if;
 if e.ballot_mode='personal' then
  select coalesce(sum(least(private.gd_member_capacity(e.game_id,b.voter_id),
                                    coalesce(r.present_mandates,0))),0)::integer into v_result
  from public.office_personal_ballots b
  join public.game_members gm on gm.game_id=b.game_id and gm.user_id=b.voter_id
    and gm.kind='student' and gm.roster_archived_at is null
  join public.game_parties gp on gp.game_id=b.game_id and gp.id=b.party_id and gp.name=gm.team
  join public.institution_session_registrations r
    on r.game_id=e.game_id and r.stage_no=e.stage_no and r.user_id=b.voter_id and r.institution_key='gd'
  where b.election_id=p_election and b.candidate_id=p_candidate;
 else
  select coalesce(sum(b.votes),0)::integer into v_result from public.office_ballots b
  where b.election_id=p_election and b.candidate_id=p_candidate;
 end if;
 return greatest(0,coalesce(v_result,0));
end $function$;
