-- Duma leadership and the Stage 6 electoral-system decision share the
-- same active, game-scoped authority, including secondary office assignments.
CREATE OR REPLACE FUNCTION private.can_manage_presidential_system_vote(p_game uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
 select private.is_game_teacher(p_game)
    or private.can_manage_duma_session(p_game,p_user);
$function$
;
CREATE OR REPLACE FUNCTION private.can_manage_duma_committees(p_game uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
 select p_user is not null and private.is_game_member(p_game) and (
  private.is_game_teacher(p_game)
  or (private.role_is_available(p_game,p_user) and (
   coalesce(private.game_role(p_game,p_user),'') like '%председател%дум%'
   or coalesce(private.game_role(p_game,p_user),'') like '%совет%дум%'
   or exists(select 1 from public.game_office_assignments a
     join public.game_members m on m.game_id=a.game_id and m.user_id=a.user_id
     where a.game_id=p_game and a.user_id=p_user and a.status='active'
       and m.kind='student' and m.roster_archived_at is null
       and (lower(a.role_title) like '%председател%дум%' or lower(a.role_title) like '%совет%дум%'))
  ))
 );
$function$
;
