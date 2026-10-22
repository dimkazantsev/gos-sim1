-- Live migration: the first Stage 11 migration was already applied to Supabase.
-- Harden only the Chair's permission; do not replay meeting/ballot transitions.
-- The teacher continues to supervise through their own administrative interface.
CREATE OR REPLACE FUNCTION private.can_approve_government_agenda(p_game uuid,p_user uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','private','pg_temp'
AS $can$
 SELECT p_user IS NOT NULL AND private.is_game_member(p_game)
  AND private.role_is_available(p_game,p_user)
  AND (
   private.game_role(p_game,p_user) ~* 'председател.*правительств'
   OR EXISTS(
    SELECT 1 FROM public.game_office_assignments a
     WHERE a.game_id=p_game AND a.user_id=p_user AND a.status='active'
      AND a.role_title ~* 'председател.*правительств'
   )
  );
$can$;
REVOKE ALL ON FUNCTION private.can_approve_government_agenda(uuid,uuid) FROM PUBLIC,anon,authenticated;
