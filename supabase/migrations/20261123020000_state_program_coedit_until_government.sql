-- ГОС.ID. Совместное редактирование внутри назначенного министерства до передачи Председателю Правительства.
-- После передачи и подписания доступ закрыт, полномочия министра и других ролей неизменны.
CREATE OR REPLACE FUNCTION private.can_edit_state_program(p_program uuid,p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $fn$
 SELECT p_user=(select auth.uid())
   AND (private.is_platform_admin() OR EXISTS(
     SELECT 1 FROM public.game_members gm
     WHERE gm.game_id=p.game_id AND gm.user_id=p_user
       AND gm.kind IN ('teacher','student') AND gm.roster_archived_at IS NULL
   ))
   AND NOT private.is_game_observer(p.game_id)
   AND (private.is_game_teacher(p.game_id) OR private.role_is_available(p.game_id,p_user))
   AND p.status IN ('draft','revision','minister_review')
   AND p.signed_at IS NULL
   AND (
     private.is_game_teacher(p.game_id)
     OR p.created_by=p_user
     OR p.responsible_minister_id=p_user
     OR (
       p.status IN ('draft','revision','minister_review')
       AND EXISTS(
         SELECT 1 FROM public.institution_units u
         JOIN public.institution_assignments ia ON ia.unit_id=u.id
           AND ia.game_id=u.game_id AND ia.unit_kind='ministry'
         WHERE u.game_id=p.game_id
           AND u.unit_kind='ministry'
           AND u.head_user_id=p.responsible_minister_id
           AND ia.user_id=p_user
       )
     )
   )
 FROM public.state_programs p WHERE p.id=p_program;
$fn$;

