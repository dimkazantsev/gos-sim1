-- Stage 4 office votes: close automatically only after every currently registered
-- eligible deputy voted AND the counted deputies supply quorum (226/450).
-- Reuses the existing manual close's winner/runoff logic and trigger side effects.
-- All operations occur under the office_elections FOR UPDATE lock.
CREATE OR REPLACE FUNCTION private.finish_office_election_locked(p_election_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public','private','pg_temp'
AS $finish$
declare
 e public.office_elections%rowtype;
 winner record;
 c_count integer;
 v_runoff uuid;
 out_json jsonb;
begin
 select * into e from public.office_elections where id=p_election_id for update;
 if e.id is null or e.status<>'open' then
  raise exception 'Election is not open';
 end if;
 select c.id,c.user_id,private.office_candidate_vote_weight(e.id,c.id) votes
 into winner
 from public.office_candidates c
 where c.election_id=e.id
 
 order by votes desc,c.created_at
 limit 1;
 select count(*)::integer into c_count from public.office_candidates where election_id=e.id;

 update public.office_elections set status='closed',closed_at=now() where id=e.id;

 if winner.id is not null and winner.votes>225 then
  update public.office_elections set status='finished',winner_candidate_id=winner.id where id=e.id;
  out_json:=jsonb_build_object('status','finished','winner_candidate_id',winner.id,'winner_user_id',winner.user_id,'votes',winner.votes);
  return out_json;
 end if;

 if e.round_no=1 and c_count>2 then
  insert into public.office_elections(game_id,stage_no,office_key,office_title,round_no,vote_mode,status,parent_election_id,created_by,ballot_mode)
  values(e.game_id,e.stage_no,e.office_key,e.office_title,2,e.vote_mode,'nomination',e.id,(select auth.uid()),e.ballot_mode)
  returning id into v_runoff;

  insert into public.office_candidates(election_id,game_id,user_id,party_id,nominated_by)
  select v_runoff,e.game_id,c.user_id,c.party_id,(select auth.uid())
  from public.office_candidates c
  
  where c.election_id=e.id
  
  order by private.office_candidate_vote_weight(e.id,c.id) desc,c.created_at
  limit 2;

  update public.office_elections set status='open',opened_at=now() where id=v_runoff;
  out_json:=jsonb_build_object('status','runoff','runoff_election_id',v_runoff);
 else
  out_json:=jsonb_build_object('status','no_winner','leader_candidate_id',winner.id,'leader_votes',coalesce(winner.votes,0));
 end if;
 return out_json;
end;
$finish$;
REVOKE ALL ON FUNCTION private.finish_office_election_locked(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.auto_finish_personal_office_election_locked(p_election_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public','private','pg_temp'
AS $auto$
declare
 e public.office_elections%rowtype;
 eligible_count integer;
 cast_count integer;
 quorum_mandates integer;
 cast_mandates integer;
begin
 select * into e from public.office_elections where id=p_election_id for update;
 if e.id is null or e.stage_no<>4 or e.ballot_mode<>'personal' or e.status<>'open'
 then return false;end if;
 with eligible as materialized (
  select r.user_id,gp.id party_id,
     private.gd_effective_present(e.game_id,r.user_id,r.present_mandates) mandates
  from public.institution_session_registrations r
  join public.game_members gm on gm.game_id=r.game_id and gm.user_id=r.user_id
    and gm.kind='student' and gm.roster_archived_at is null
  join public.game_parties gp on gp.game_id=gm.game_id and gp.name=gm.team
  where r.game_id=e.game_id and r.stage_no=e.stage_no and r.institution_key='gd'
    and private.role_is_available(e.game_id,r.user_id)
    and private.vote_member_has_office(e.game_id,r.user_id,'gd')
    and private.gd_effective_present(e.game_id,r.user_id,r.present_mandates)>0
 )
 select count(*)::int,
    count(b.voter_id)::int,
    coalesce(sum(eligible.mandates),0)::int,
    coalesce(sum(case when b.voter_id is not null then eligible.mandates else 0 end),0)::int
 into eligible_count,cast_count,quorum_mandates,cast_mandates
 from eligible
 left join public.office_personal_ballots b
  on b.election_id=e.id and b.game_id=e.game_id
     and b.voter_id=eligible.user_id and b.party_id=eligible.party_id;
 if eligible_count=0 or cast_count<>eligible_count
    or quorum_mandates<226 or cast_mandates<226 then return false;end if;
 perform private.finish_office_election_locked(e.id);
 return true;
end;
$auto$;
REVOKE ALL ON FUNCTION private.auto_finish_personal_office_election_locked(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.close_office_election(p_election_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare e public.office_elections%rowtype;winner record;c_count integer;v_runoff uuid;out_json jsonb;v_uid uuid:=(select auth.uid());v_cast integer;
begin
 select * into e from public.office_elections where id=p_election_id for update;
 if e.id is null then raise exception 'Election not found'; end if;
 if e.stage_no=4 THEN
  IF NOT private.gd_stage4_can_manage(e.game_id,v_uid,e.office_key) THEN
   raise exception 'Закрыть голосование вправе председатель заседания или преподаватель';END IF;
  IF NOT private.is_game_teacher(e.game_id) AND e.ballot_mode='personal' THEN
   SELECT coalesce(sum(private.gd_effective_present(e.game_id,b.voter_id,r.present_mandates)),0)::int
   INTO v_cast FROM public.office_personal_ballots b
    JOIN public.institution_session_registrations r ON r.game_id=e.game_id
     AND r.user_id=b.voter_id AND r.stage_no=4 AND r.institution_key='gd'
   WHERE b.election_id=e.id;
   IF v_cast<226 THEN raise exception
    'Для завершения голосования необходимо не менее 226 голосов депутатов';END IF;
  END IF;
 ELSIF NOT private.is_game_teacher(e.game_id) THEN
  raise exception 'Teacher access required';
 END IF;
 if e.status<>'open' then raise exception 'Election is not open'; end if;

 return private.finish_office_election_locked(p_election_id);
end;
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
 -- The election row is already locked; the final eligible ballot
 -- closes this one election atomically and cannot race another ballot.
 perform private.auto_finish_personal_office_election_locked(e.id);
end $function$

