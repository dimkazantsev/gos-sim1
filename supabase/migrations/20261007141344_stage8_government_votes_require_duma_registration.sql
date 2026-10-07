create or replace function private.vote_eligible_weight(p_vote public.game_votes,p_user uuid)
returns numeric
language plpgsql
stable
security definer
set search_path=public,private,pg_temp
as $$
declare w numeric;
begin
 if not private.vote_member_matches(p_vote.game_id,p_user,p_vote.institution_key) then return 0;end if;

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
   select effective_mandates into w
   from public.party_member_mandates
   where game_id=p_vote.game_id and user_id=p_user
   limit 1;
   return coalesce(w,0);
 end if;

 return 1;
end;
$$;
