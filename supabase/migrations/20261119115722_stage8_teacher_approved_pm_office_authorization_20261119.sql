-- Stage 8: an appointed Prime Minister may hold a separate active,
-- teacher-approved office assignment while their primary role remains Deputy.
-- Preserve nomination/vote results and the teacher's approved office authority.
-- No client fetches, broad role grants, or changes to visual identity.
CREATE OR REPLACE FUNCTION private.is_appointed_pm(p_game uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
 select private.is_game_teacher(p_game)
 or (
  private.role_is_available(p_game,p_user) and (
   exists(select 1 from public.government_nominations where game_id=p_game and office_kind='prime_minister' and candidate_user_id=p_user and status='appointed')
   or private.game_role(p_game,p_user) like '%председател%правительств%'
   -- A participant may simultaneously be a Duma deputy and Prime Minister.
   -- The primary game_members.role_title can then remain "Deputy", while the
   -- separate, teacher-approved active office assignment is authoritative.
   or (
      exists(select 1 from public.government_nominations n
        where n.game_id=p_game and n.office_kind='prime_minister' and n.status='appointed')
      and exists(select 1 from public.game_members m
        where m.game_id=p_game and m.user_id=p_user and m.kind='student'
          and m.roster_archived_at is null)
      and exists(select 1 from public.game_office_assignments a
        join public.games g on g.id=a.game_id
        where a.game_id=p_game and a.user_id=p_user and a.status='active'
          and lower(trim(a.role_title))='председатель правительства российской федерации'
          and a.approved_by=g.owner_id)
   )
  )
 );
$function$
;
