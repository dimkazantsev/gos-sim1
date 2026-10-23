-- Chair self-voting: allow enrolled members to vote, even if the party
-- has not yet reached its two-member quorum. The election still cannot
-- finalize with fewer than two active members or pending invitations.
-- Preserve party membership checks, stage/mandate restrictions and one ballot per voter.
CREATE OR REPLACE FUNCTION public.vote_for_party_chair(p_party_id uuid, p_candidate_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare p public.game_parties%rowtype;v_uid uuid:=auth.uid();v_votes integer;v_members integer;v_max integer;v_winner uuid;v_tied integer;
begin
 select * into p from public.game_parties where id=p_party_id for update;
 if not found then raise exception 'Party not found';end if;
 if not private.stage_one_party_active(p.game_id) then raise exception 'Первый этап ещё не открыт.' using errcode='42501';end if;

 if p.leader_user_id is not null then raise exception 'Chair election already completed' using errcode='23505';end if;
 if private.has_open_duma_mandate_vote(p.game_id) then raise exception 'Chair election is frozen during a Duma mandate vote' using errcode='42501';end if;
 if not exists(select 1 from public.game_members where game_id=p.game_id and user_id=v_uid and kind='student' and team=p.name and roster_archived_at is null)
 or not exists(select 1 from public.game_members where game_id=p.game_id and user_id=p_candidate_id and kind='student' and team=p.name and roster_archived_at is null)
 then raise exception 'Both voter and candidate must be party members' using errcode='42501';end if;
 -- Casting an early ballot is allowed, including self-voting for a single
 -- enrolled member. A chair can only be elected after the full quorum.
 insert into public.party_chair_ballots(game_id,party_id,voter_id,candidate_id)
 values(p.game_id,p.id,v_uid,p_candidate_id)
 on conflict(party_id,voter_id) do update set candidate_id=excluded.candidate_id,voted_at=clock_timestamp();
 select count(*) into v_members from public.game_members where game_id=p.game_id and kind='student' and team=p.name and roster_archived_at is null;
 select count(*) into v_votes from public.party_chair_ballots b
  join public.game_members voter on voter.game_id=p.game_id and voter.user_id=b.voter_id
   and voter.kind='student' and voter.team=p.name and voter.roster_archived_at is null
  join public.game_members candidate on candidate.game_id=p.game_id and candidate.user_id=b.candidate_id
   and candidate.kind='student' and candidate.team=p.name and candidate.roster_archived_at is null
  where b.party_id=p.id;
 if v_members>=2 and v_votes>=v_members and not exists(select 1 from public.party_invitations pi where pi.party_id=p.id and pi.status='pending') then
  select max(n) into v_max from (select b.candidate_id,count(*) n from public.party_chair_ballots b
    join public.game_members voter on voter.game_id=p.game_id and voter.user_id=b.voter_id
     and voter.kind='student' and voter.team=p.name and voter.roster_archived_at is null
    join public.game_members candidate on candidate.game_id=p.game_id and candidate.user_id=b.candidate_id
     and candidate.kind='student' and candidate.team=p.name and candidate.roster_archived_at is null
    where b.party_id=p.id group by b.candidate_id) c;
  select count(*),(array_agg(candidate_id order by candidate_id))[1] into v_tied,v_winner
   from (select b.candidate_id,count(*) n from public.party_chair_ballots b
    join public.game_members voter on voter.game_id=p.game_id and voter.user_id=b.voter_id
     and voter.kind='student' and voter.team=p.name and voter.roster_archived_at is null
    join public.game_members candidate on candidate.game_id=p.game_id and candidate.user_id=b.candidate_id
     and candidate.kind='student' and candidate.team=p.name and candidate.roster_archived_at is null
    where b.party_id=p.id group by b.candidate_id) c
   where c.n=v_max;
  if v_tied=1 then
   update public.game_parties set leader_user_id=v_winner where id=p.id;
  end if;
 end if;
 return jsonb_build_object('votes',v_votes,'members',v_members,'leader_id',case when v_tied=1 then v_winner else null end,
 'tied',coalesce(v_tied,0)>1);
end $function$
;
