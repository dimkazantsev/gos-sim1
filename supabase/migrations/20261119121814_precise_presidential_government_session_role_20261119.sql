-- Presidential control requires the valid President's exact active office; a generic title containing 'Президент' must not grant power.
CREATE OR REPLACE FUNCTION private.can_manage_government_session(p_game uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
 select p_user is not null and private.is_game_member(p_game) and (
  private.is_game_teacher(p_game)
  or (private.role_is_available(p_game,p_user) and (
   private.game_role(p_game,p_user) like '%председател%правительств%'
   or private.can_manage_presidential_policy(p_game,p_user)
   or exists(select 1 from public.game_office_assignments a
     where a.game_id=p_game and a.user_id=p_user and a.status='active'
       and lower(a.role_title) like '%председател%правительств%')
  ))
 );
$function$
;
