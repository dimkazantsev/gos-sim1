-- Resume password login with the membership's actual role.
-- The role selected in the previous UI screen is only a hint. Neither password
-- login nor this RPC can change roles, create a game member, or restore an
-- archived/blocked membership. Teacher accounts remain strictly separated.
DO $guard$
BEGIN
 IF md5(pg_get_functiondef('public.resume_member_game_as_role(text,member_kind)'::regprocedure))
    <> 'acdfcc4a6ffee85b88bb81d250180470' THEN
  RAISE EXCEPTION 'The login RPC changed; review before replacing it';
 END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.resume_member_game_as_role(
 p_game_code text,p_expected_kind public.member_kind
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $login$
DECLARE
 v_uid uuid := auth.uid();
 v_game uuid;
 v_actual_kind public.member_kind;
BEGIN
 IF v_uid IS NULL OR coalesce((auth.jwt()->>'is_anonymous')::boolean,true) THEN
  RAISE EXCEPTION 'Войдите с подтверждённой почтой и паролем'
   USING ERRCODE='42501';
 END IF;
 -- The teacher has a separate permanent cabinet; neither a teacher profile
 -- nor a platform administrator can enter as a participant or observer.
 IF p_expected_kind IS NULL OR p_expected_kind NOT IN ('student','observer') THEN
  RAISE EXCEPTION 'Откройте кабинет преподавателя через личный вход'
   USING ERRCODE='42501';
 END IF;
 IF EXISTS(SELECT 1 FROM public.platform_admins pa WHERE pa.user_id=v_uid)
    OR EXISTS(SELECT 1 FROM public.teacher_profiles tp WHERE tp.user_id=v_uid) THEN
  RAISE EXCEPTION 'Учётная запись преподавателя использует отдельный вход'
   USING ERRCODE='42501';
 END IF;
 SELECT g.id,gm.kind INTO v_game,v_actual_kind
 FROM public.games g
 JOIN public.game_members gm ON gm.game_id=g.id
 WHERE g.game_code=upper(btrim(p_game_code))
  AND gm.user_id=v_uid
  AND gm.kind IN ('student','observer')
  AND gm.roster_archived_at IS NULL
  AND NOT EXISTS (
   SELECT 1 FROM public.game_member_access_blocks b
   WHERE b.game_id=g.id AND b.user_id=v_uid
  )
 LIMIT 1;
 IF v_game IS NULL THEN
  RAISE EXCEPTION 'Для этой учётной записи нет активного доступа к указанной игре'
   USING ERRCODE='42501';
 END IF;
 -- Keep existing database role unchanged even if the screen remembered the
 -- opposite role. All game rights still come from game_members and RLS.
 RETURN v_game;
END;
$login$;

REVOKE ALL ON FUNCTION public.resume_member_game_as_role(text,public.member_kind)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.resume_member_game_as_role(text,public.member_kind)
 TO authenticated;
