-- GD default attendance for existing and future sessions. Preserve
-- the official quorum of 226/450, submitted overrides, role permissions,
-- ballot snapshots and the existing stages / registration links.
-- A NULL attendance is not zero. It means that a registered deputy
-- has not entered a personal correction and all of their currently effective
-- seats attend by default. An explicit 0 is a valid absence declaration.
-- Recompute the default dynamically as allocations/GV penalties change;
-- never overwrite explicit declarations or create phantom registrations.
CREATE OR REPLACE FUNCTION private.gd_effective_present(
 p_game uuid,p_user uuid,p_declared integer
) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,private,pg_temp
AS $effective$
 SELECT greatest(0,least(
  private.gd_member_capacity(p_game,p_user),
  coalesce(p_declared,private.gd_member_capacity(p_game,p_user))
 ))::integer;
$effective$;
REVOKE ALL ON FUNCTION private.gd_effective_present(uuid,uuid,integer)
 FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_gd_session_attendance(p_game_id uuid, p_stage_no integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE v_uid uuid:=(select auth.uid());v_rows jsonb;
BEGIN
 IF v_uid IS NULL OR NOT private.is_game_member(p_game_id) THEN
  RAISE EXCEPTION 'Нет доступа к сведениям о заседании';
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'user_id',r.user_id,
  'capacity',private.gd_member_capacity(p_game_id,r.user_id),
  'declared',r.present_mandates,
  'present',private.gd_effective_present(p_game_id,r.user_id,r.present_mandates)
 ) ORDER BY r.registered_at,r.user_id),'[]'::jsonb) INTO v_rows
 FROM public.institution_session_registrations r
 WHERE r.game_id=p_game_id AND r.stage_no=p_stage_no AND r.institution_key='gd';
 RETURN jsonb_build_object('my_capacity',private.gd_member_capacity(p_game_id,v_uid),
  'registered',v_rows);
END;
$function$;

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
   select private.gd_effective_present(p_vote.game_id,r.user_id,r.present_mandates) into w
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
    private.gd_effective_present(p_vote.game_id,r.user_id,r.present_mandates),
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
  select coalesce(sum(private.gd_effective_present(e.game_id,b.voter_id,r.present_mandates)),0)::integer into v_result
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
 select gp.id,private.gd_effective_present(e.game_id,uid,r.present_mandates)
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
