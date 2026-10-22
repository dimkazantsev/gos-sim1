-- A confirmed Ministry appointment held by an active student is Government membership.
-- Do not grant this right to archived users, guests or students without the appointment.
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
 or (p_institution='government' and exists(
 select 1 from public.game_office_assignments o
 join public.game_members gm on gm.game_id=o.game_id and gm.user_id=o.user_id
 where o.game_id=p_game and o.user_id=p_user and o.status='active'
 and gm.kind='student' and gm.roster_archived_at is null
 and private.role_is_available(p_game,p_user)
 and o.role_title ~* '^министерство[[:space:]]+по[[:space:]]+'
 ))
 or (p_institution='gd' and private.role_is_available(p_game,p_user)
  and private.gd_member_capacity(p_game,p_user)>0)
 or (p_institution='gd' and private.role_is_available(p_game,p_user) and exists(
 select 1 from public.party_member_mandates pm join public.game_members gm on gm.game_id=pm.game_id and gm.user_id=pm.user_id
 where pm.game_id=p_game and pm.user_id=p_user and pm.base_mandates>0 and gm.kind='student' and gm.roster_archived_at is null));
$function$
;

-- Refresh only untouched open Stage 11 ballots from the old single-member snapshot.
-- No historical votes with submitted ballots, closed results, posts or scores are altered.
DO $refresh$
DECLARE old_vote record; roster jsonb; eligible numeric;
BEGIN
 FOR old_vote IN
  SELECT v.id,v.game_id,v.electorate_snapshot
  FROM public.game_votes v
  JOIN public.state_programs p ON p.government_vote_id=v.id AND p.game_id=v.game_id
  WHERE v.procedure_key='state_program' AND v.institution_key='government'
    AND v.stage_no=11 AND v.status='open'
    AND p.status='government_vote' AND p.signed_at IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM public.game_ballots b WHERE b.vote_id=v.id)
    AND NOT EXISTS(SELECT 1 FROM public.government_program_agenda a WHERE a.vote_id=v.id OR a.program_id=p.id)
    AND v.electorate_snapshot IS NOT NULL
  FOR UPDATE OF v
 LOOP
  SELECT coalesce(jsonb_object_agg(gm.user_id::text,to_jsonb(1)),'{}'::jsonb),count(*)::numeric
  INTO roster,eligible FROM public.game_members gm
  WHERE gm.game_id=old_vote.game_id AND gm.kind<>'observer'
   AND gm.roster_archived_at IS NULL
   AND private.vote_member_has_office(gm.game_id,gm.user_id,'government');
  IF eligible=0 THEN RAISE EXCEPTION 'Government electorate unexpectedly empty'; END IF;
  IF old_vote.electorate_snapshot->'weights' IS DISTINCT FROM roster
    OR (old_vote.electorate_snapshot->>'eligible')::numeric IS DISTINCT FROM eligible THEN
   UPDATE public.game_votes SET electorate_snapshot=
     jsonb_set(jsonb_set(jsonb_set(old_vote.electorate_snapshot,
       '{weights}',roster),'{eligible}',to_jsonb(eligible)),
       '{captured_at}',to_jsonb(now()))
   WHERE id=old_vote.id;
  END IF;
 END LOOP;
END $refresh$;