-- Municipal mayor elections: finish only when every currently active eligible
-- resident submitted a ballot. Preserve the existing tie and winner rules.
-- Public poll tokens, jury votes and parliamentary mandate sessions are distinct.
CREATE OR REPLACE FUNCTION private.finish_municipal_mayor_election_locked(p_election_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO 'public','private','pg_temp'
AS $mayor$
declare e public.municipal_mayor_elections%rowtype;v_max integer;v_count integer;v_winner_candidate uuid;v_winner_user uuid;v_result jsonb;
begin
 select * into e from public.municipal_mayor_elections where id=p_election_id for update;
 if e.id is null or e.status<>'open' then raise exception 'Election is not open';end if;
 select coalesce(max(votes),0) into v_max from (
   select c.id,count(b.id)::integer votes from public.municipal_mayor_candidates c
   left join public.municipal_mayor_ballots b on b.candidate_id=c.id
   where c.election_id=e.id group by c.id
 ) q;
 select count(*)::integer,min(id) into v_count,v_winner_candidate from (
   select c.id,count(b.id)::integer votes from public.municipal_mayor_candidates c
   left join public.municipal_mayor_ballots b on b.candidate_id=c.id
   where c.election_id=e.id group by c.id
 ) q where votes=v_max;
 if v_max=0 or v_count<>1 then
  update public.municipal_mayor_elections set status='tie',closed_at=now() where id=e.id;
 else
  select user_id into v_winner_user from public.municipal_mayor_candidates where id=v_winner_candidate;
  update public.municipal_mayor_elections set status='finished',winner_user_id=v_winner_user,closed_at=now() where id=e.id;
  update public.game_members set role_title='Глава города Барнаула' where game_id=e.game_id and user_id=v_winner_user;
 end if;
 select jsonb_build_object(
  'status',case when v_max=0 or v_count<>1 then 'tie' else 'finished' end,
  'winner_user_id',v_winner_user,
  'turnout',(select count(*) from public.municipal_mayor_ballots where election_id=e.id),
  'results',coalesce((
    select jsonb_agg(jsonb_build_object('candidate_id',c.id,'user_id',c.user_id,'votes',count(b.id)) order by count(b.id) desc)
    from public.municipal_mayor_candidates c left join public.municipal_mayor_ballots b on b.candidate_id=c.id
    where c.election_id=e.id group by c.election_id
  ),'[]'::jsonb)
 ) into v_result;
 return v_result;
end;
$mayor$;
REVOKE ALL ON FUNCTION private.finish_municipal_mayor_election_locked(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.close_municipal_mayor_election(p_election_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare e public.municipal_mayor_elections%rowtype;v_max integer;v_count integer;v_winner_candidate uuid;v_winner_user uuid;v_result jsonb;
begin
 select * into e from public.municipal_mayor_elections where id=p_election_id for update;
 if e.id is null then raise exception 'Election not found'; end if;
 if not private.is_game_teacher(e.game_id) then raise exception 'Teacher access required'; end if;
 if e.status<>'open' then raise exception 'Election is not open'; end if;
 return private.finish_municipal_mayor_election_locked(p_election_id);
end;$function$

CREATE OR REPLACE FUNCTION public.cast_municipal_mayor_ballot(p_election_id uuid, p_candidate_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare e public.municipal_mayor_elections%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into e from public.municipal_mayor_elections where id=p_election_id for update;
 if e.id is null or e.status<>'open' then raise exception 'Mayor election is not open'; end if;
 if not private.is_game_member(e.game_id) then raise exception 'Game access required'; end if;
 if not exists(select 1 from public.game_members where game_id=e.game_id and user_id=v_uid and kind='student' and roster_archived_at is null) then raise exception 'Only students vote in this municipal election'; end if;
 if not exists(select 1 from public.municipal_mayor_candidates where id=p_candidate_id and election_id=e.id) then raise exception 'Candidate not found'; end if;
 insert into public.municipal_mayor_ballots(election_id,game_id,voter_user_id,candidate_id)
 values(e.id,e.game_id,v_uid,p_candidate_id)
 on conflict(election_id,voter_user_id) do update set candidate_id=excluded.candidate_id,created_at=now();
 -- Municipal residents have one indivisible vote. A full active electorate
 -- (100% turnout) satisfies any quorum not greater than the electorate.
 -- No quorum threshold or winner formula is invented or modified.
 if (select count(*) from public.game_members gm
       where gm.game_id=e.game_id and gm.kind='student' and gm.roster_archived_at is null)>0
   and not exists(
     select 1 from public.game_members gm
     where gm.game_id=e.game_id and gm.kind='student' and gm.roster_archived_at is null
       and not exists(
         select 1 from public.municipal_mayor_ballots b
         where b.election_id=e.id and b.game_id=e.game_id and b.voter_user_id=gm.user_id
       )
   )
 then perform private.finish_municipal_mayor_election_locked(e.id);end if;
end;$function$

