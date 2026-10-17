-- Extension for legacy mandate-package office elections; ordinary personal
-- office votes and procedural votes already auto-close on full registered turnout.
CREATE OR REPLACE FUNCTION private.auto_finish_faction_office_election_locked(p_election_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO 'public','private','pg_temp'
AS $faction$
declare
 e public.office_elections%rowtype;
 eligible_parties integer;
 complete_parties integer;
 present_mandates integer;
 submitted_mandates integer;
begin
 select * into e from public.office_elections where id=p_election_id for update;
 if e.id is null or e.stage_no<>4 or e.ballot_mode<>'faction' or e.status<>'open' then return false;end if;
 with electorate as materialized (
   select gp.id party_id,
    coalesce((select sum(pm.effective_mandates)::integer
      from public.party_member_mandates pm where pm.game_id=e.game_id and pm.party_id=gp.id),0) capacity
   from public.game_parties gp
   join public.game_members gm on gm.game_id=gp.game_id and gm.user_id=gp.leader_user_id
     and gm.team=gp.name and gm.kind='student' and gm.roster_archived_at is null
   join public.institution_session_registrations r
    on r.game_id=gp.game_id and r.user_id=gm.user_id and r.stage_no=e.stage_no and r.institution_key='gd'
   where gp.game_id=e.game_id and gp.registration_status='registered'
 ), roster as (
   select el.capacity,
     coalesce((select sum(b.votes)::integer from public.office_ballots b
      where b.game_id=e.game_id and b.election_id=e.id and b.party_id=el.party_id),0) submitted
   from electorate el where el.capacity>0
 )
 select count(*)::integer,count(*) filter(where submitted=capacity)::integer,
   coalesce(sum(capacity),0)::integer,coalesce(sum(submitted),0)::integer
 into eligible_parties,complete_parties,present_mandates,submitted_mandates
 from roster;
 -- No partial ballot closure: faction leaders may distribute their mandate package
 -- over multiple candidates. Closing after the first submission would lose votes.
 if eligible_parties=0 or eligible_parties<>complete_parties
   or present_mandates<226 or submitted_mandates<226 then return false;end if;
 perform private.finish_office_election_locked(e.id);
 return true;
end;
$faction$;
REVOKE ALL ON FUNCTION private.auto_finish_faction_office_election_locked(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.set_office_ballot(p_election_id uuid, p_candidate_id uuid, p_votes integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare e public.office_elections%rowtype;v_uid uuid:=(select auth.uid());v_party uuid;v_capacity integer;v_other integer;
begin
 select * into e from public.office_elections where id=p_election_id for update;
 if e.id is null then raise exception 'Election not found'; end if;
 if e.status<>'open' then raise exception 'Election is not open'; end if;
 if e.ballot_mode<>'faction' then raise exception 'Используйте персональный бюллетень депутата';end if;
 if p_votes<0 then raise exception 'Votes cannot be negative'; end if;
 if not exists(select 1 from public.office_candidates where id=p_candidate_id and election_id=e.id)
 then raise exception 'Candidate not found in this election'; end if;

 v_party:=private.party_led_by(e.game_id,v_uid);
 if v_party is null then raise exception 'Only faction leaders submit faction ballots'; end if;
 if e.stage_no=4 then
  -- Match the live mandate electorate rather than counting outsiders.
  perform private.require_game_meeting_registration(e.game_id,v_uid,e.stage_no,'gd');
  if not exists(
    select 1 from public.game_parties gp
    join public.game_members gm on gm.game_id=gp.game_id
      and gm.user_id=gp.leader_user_id and gm.team=gp.name
      and gm.kind='student' and gm.roster_archived_at is null
    where gp.id=v_party and gp.game_id=e.game_id
      and gp.registration_status='registered'
  ) then raise exception 'Голосовать мандатами вправе руководитель зарегистрированной фракции';end if;
 end if;
 select coalesce(sum(effective_mandates),0)::integer into v_capacity
 from public.party_member_mandates where game_id=e.game_id and party_id=v_party;
 select coalesce(sum(votes),0)::integer into v_other
 from public.office_ballots where election_id=e.id and party_id=v_party and candidate_id<>p_candidate_id;
 if v_other+p_votes>v_capacity then raise exception 'Faction ballot exceeds current effective mandates'; end if;

 insert into public.office_ballots(election_id,game_id,party_id,candidate_id,votes,submitted_by)
 values(e.id,e.game_id,v_party,p_candidate_id,p_votes,v_uid)
 on conflict(election_id,party_id,candidate_id)
 do update set votes=excluded.votes,submitted_by=v_uid,updated_at=now();
 if e.stage_no=4 then
  perform private.auto_finish_faction_office_election_locked(e.id);
 end if;
end;
$function$

