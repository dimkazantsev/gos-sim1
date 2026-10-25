-- Teacher authorization: platform admin or game owner or active teacher.
-- Archived teachers keep profile assets, but not gameplay/creation privileges.
-- Bodies start from current installed functions; no game data or scoring changes.

CREATE OR REPLACE FUNCTION private.is_game_teacher(g uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return false;
  end if;

  if exists (
    select 1
    from public.game_members gm
    where gm.game_id = g
      and gm.user_id = v_uid
      and gm.kind = 'teacher'
      and gm.roster_archived_at IS NULL
  ) then
    return true;
  end if;

  return exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = v_uid
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_my_teacher_games()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_user uuid := (select auth.uid());v_admin boolean;v_allowed boolean;v_games jsonb;
BEGIN
 IF v_user IS NULL OR coalesce((auth.jwt()->>'is_anonymous')::boolean,true)
 THEN RAISE EXCEPTION 'Войдите с подтверждённой почтой и личным паролем';END IF;
 v_admin:=private.is_platform_admin();
 v_allowed:=v_admin
  OR EXISTS(SELECT 1 FROM public.games g WHERE g.owner_id=v_user)
  OR EXISTS(SELECT 1 FROM public.game_members gm WHERE gm.user_id=v_user
     AND gm.kind='teacher' AND gm.roster_archived_at IS NULL);
 IF NOT v_allowed THEN RAISE EXCEPTION 'Доступ только преподавателю';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id',g.id,'title',g.title,'status',g.status,'created_at',g.created_at,
  'is_owner',g.owner_id=v_user
 ) ORDER BY g.created_at DESC,g.id DESC),'[]'::jsonb) INTO v_games
 FROM public.games g WHERE v_admin OR g.owner_id=v_user OR EXISTS(
  SELECT 1 FROM public.game_members gm WHERE gm.game_id=g.id
   AND gm.user_id=v_user AND gm.kind='teacher' AND gm.roster_archived_at IS NULL);
 RETURN jsonb_build_object('is_admin',v_admin,'games',v_games);
END;$function$;

CREATE OR REPLACE FUNCTION public.create_teacher_game_session(p_title text, p_game_code text, p_teacher_code text, p_student_code text, p_teacher_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_game uuid;v_teacher uuid;v_student uuid;v_vault uuid;
BEGIN
 IF auth.uid() IS NULL OR coalesce((auth.jwt()->>'is_anonymous')::boolean,true)
 THEN RAISE EXCEPTION 'Войдите по почте и паролю' USING errcode='42501';END IF;
 IF NOT private.is_platform_admin()
    AND NOT EXISTS(SELECT 1 FROM public.games g WHERE g.owner_id=auth.uid())
    AND NOT EXISTS(SELECT 1 FROM public.game_members gm WHERE gm.user_id=auth.uid()
      AND gm.kind='teacher' AND gm.roster_archived_at IS NULL)
 THEN RAISE EXCEPTION 'Создание игр доступно преподавателю' USING errcode='42501';END IF;
 v_game:=public.create_game_session(p_title,p_game_code,p_teacher_code,p_student_code,p_teacher_name);
 SELECT id INTO v_teacher FROM public.invite_codes WHERE game_id=v_game AND kind='teacher';
 SELECT id INTO v_student FROM public.invite_codes WHERE game_id=v_game AND kind='student';
 IF v_teacher IS NULL OR v_student IS NULL THEN RAISE EXCEPTION 'Начальные приглашения не созданы';END IF;
 SELECT vault.create_secret(p_teacher_code,null,'ГОС.ID дополнительный преподаватель',null) INTO v_vault;
 INSERT INTO private.game_invitation_secrets(game_id,invite_id,vault_secret_id) VALUES(v_game,v_teacher,v_vault);
 SELECT vault.create_secret(p_student_code,null,'ГОС.ID участники',null) INTO v_vault;
 INSERT INTO private.game_invitation_secrets(game_id,invite_id,vault_secret_id) VALUES(v_game,v_student,v_vault);
 PERFORM public.owner_rotate_invitation(v_game,'observer');
 RETURN v_game;
END;$function$;

ALTER POLICY teacher_profile_authorized_insert ON public.teacher_profiles
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND NOT COALESCE((auth.jwt()->>'is_anonymous')::boolean, false)
  AND (
    private.is_platform_admin()
    OR EXISTS (SELECT 1 FROM public.games g WHERE g.owner_id=(SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM public.game_members m
               WHERE m.user_id=(SELECT auth.uid())
                 AND m.kind='teacher'
                 AND m.roster_archived_at IS NULL)
  )
);
