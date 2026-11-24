CREATE OR REPLACE FUNCTION private.can_submit_government_program(p_game uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT p_user IS NOT NULL AND private.is_game_member(p_game) AND NOT private.is_game_observer(p_game)
 AND (private.is_game_teacher(p_game) OR (private.role_is_available(p_game,p_user) AND EXISTS(
 SELECT 1 FROM private.formal_user_roles(p_game,p_user) r
 WHERE r ~* '^(председатель|заместитель[[:space:]]+председателя)[[:space:]]+правительства([[:space:]]|$)')));
$function$;
