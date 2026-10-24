-- Role input is enforced by the database, never inferred from a secret
-- that belongs to another role. No platform admin or teacher password is copied
-- or disclosed through game invitations.
CREATE OR REPLACE FUNCTION public.join_game_as_role(
 p_game_code text,p_invite_code text,p_full_name text,
 p_group_name text,p_expected_kind public.member_kind
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
 v_uid uuid := (select auth.uid());
 g uuid;k public.member_kind;v_invite uuid;v_group text;
 v_name text:=btrim(coalesce(p_full_name,''));
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Сначала авторизуйтесь'; END IF;
 IF p_expected_kind NOT IN ('student','teacher','observer') OR p_expected_kind IS NULL
 THEN RAISE EXCEPTION 'Неверная роль';END IF;
 IF length(v_name)<2 THEN RAISE EXCEPTION 'Введите ФИО';END IF;
 SELECT ga.id,ic.kind,ic.id INTO g,k,v_invite
 FROM public.games ga JOIN public.invite_codes ic ON ic.game_id=ga.id
 WHERE ga.game_code=upper(btrim(p_game_code)) AND ic.active
  AND ic.kind=p_expected_kind
  AND ic.code_hash=extensions.crypt(p_invite_code,ic.code_hash)
 LIMIT 1;
 IF g IS NULL THEN RAISE EXCEPTION 'Код игры и приглашение не соответствуют выбранной роли';END IF;
 IF k<>p_expected_kind THEN RAISE EXCEPTION 'Приглашение не соответствует роли';END IF;
 IF p_expected_kind='teacher' AND (
   coalesce((auth.jwt()->>'is_anonymous')::boolean,true)
   OR NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=v_uid AND u.email_confirmed_at IS NOT NULL)
 ) THEN RAISE EXCEPTION 'Преподаватель входит только по подтверждённой почте и личному паролю' USING errcode='42501';
 END IF;
 IF p_expected_kind<>'teacher' AND (
   EXISTS(SELECT 1 FROM public.platform_admins pa WHERE pa.user_id=v_uid)
   OR EXISTS(SELECT 1 FROM public.teacher_profiles tp WHERE tp.user_id=v_uid)
 ) THEN RAISE EXCEPTION 'Учётная запись преподавателя не может входить участником или гостем' USING errcode='42501';
 END IF;
 IF EXISTS(SELECT 1 FROM public.game_members gm
           WHERE gm.game_id=g AND gm.user_id=v_uid AND gm.kind<>p_expected_kind)
 THEN RAISE EXCEPTION 'Нельзя менять роль существующей учётной записи' USING errcode='42501';
 END IF;
 IF p_expected_kind='student' THEN
  SELECT a.group_name INTO v_group FROM private.game_group_access_codes a
  WHERE a.game_id=g AND a.invite_id=v_invite;
  v_group:=coalesce(v_group,nullif(btrim(p_group_name),''));
  IF v_group IS NULL THEN RAISE EXCEPTION 'Укажите учебную группу';END IF;
 END IF;
 INSERT INTO public.game_members(game_id,user_id,full_name,group_name,kind)
 VALUES(g,v_uid,v_name,v_group,p_expected_kind)
 ON CONFLICT(game_id,user_id) DO UPDATE
 SET full_name=EXCLUDED.full_name,group_name=EXCLUDED.group_name
 WHERE game_members.kind=EXCLUDED.kind;
 INSERT INTO public.audit_log(game_id,actor_id,action,entity_type,payload)
 VALUES(g,v_uid,'member_joined','member',
   jsonb_build_object('kind',p_expected_kind,'full_name',v_name));
 RETURN g;
END;
$function$;
REVOKE ALL ON FUNCTION public.join_game_as_role(text,text,text,text,public.member_kind) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.join_game_as_role(text,text,text,text,public.member_kind) TO authenticated;

-- Existing four-argument endpoint must not bypass the expected-role check.
REVOKE ALL ON FUNCTION public.join_game_with_code(text,text,text,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.resume_member_game_as_role(
 p_game_code text,p_expected_kind public.member_kind
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_game uuid;
BEGIN
 IF auth.uid() IS NULL OR coalesce((auth.jwt()->>'is_anonymous')::boolean,true)
 THEN RAISE EXCEPTION 'Войдите с подтверждённой почтой и паролем';END IF;
 IF p_expected_kind NOT IN ('student','observer') THEN
  RAISE EXCEPTION 'Откройте кабинет преподавателя через личный вход';END IF;
 SELECT g.id INTO v_game FROM public.games g
 JOIN public.game_members gm ON gm.game_id=g.id
 WHERE g.game_code=upper(btrim(p_game_code))
 AND gm.user_id=auth.uid() AND gm.kind=p_expected_kind
 AND gm.roster_archived_at IS NULL;
 IF v_game IS NULL THEN RAISE EXCEPTION 'Для этой учётной записи нет доступа с выбранной ролью';END IF;
 RETURN v_game;
END;$function$;
REVOKE ALL ON FUNCTION public.resume_member_game_as_role(text,public.member_kind) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.resume_member_game_as_role(text,public.member_kind) TO authenticated;

-- Only an authenticated game owner / platform admin can read or rotate the
-- full list of codes. A second invited teacher cannot see these secrets.
CREATE OR REPLACE FUNCTION private.is_game_code_owner(p_game uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
 SELECT auth.uid() IS NOT NULL
  AND NOT coalesce((auth.jwt()->>'is_anonymous')::boolean,true)
  AND EXISTS(SELECT 1 FROM public.games g WHERE g.id=p_game AND
    (g.owner_id=auth.uid() OR private.is_platform_admin()));
$function$;
REVOKE ALL ON FUNCTION private.is_game_code_owner(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.owner_rotate_invitation(p_game_id uuid,p_kind public.member_kind)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_code text;v_invite uuid;v_vault uuid;
BEGIN
 IF NOT private.is_game_code_owner(p_game_id) THEN
   RAISE EXCEPTION 'Генерация кодов доступна только владельцу игры' USING errcode='42501';
 END IF;
 IF p_kind NOT IN ('student','teacher','observer') OR p_kind IS NULL THEN
  RAISE EXCEPTION 'Неверный тип приглашения';END IF;
 PERFORM 1 FROM public.games WHERE id=p_game_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Игра не найдена';END IF;
 v_code:=(case p_kind when 'student' then 'STD-'
                      when 'teacher' then 'TCH-' else 'GST-' end)
   ||upper(encode(extensions.gen_random_bytes(12),'hex'));
 UPDATE public.invite_codes SET active=false
 WHERE game_id=p_game_id AND kind=p_kind AND active
   AND (p_kind<>'student' OR NOT EXISTS(
    SELECT 1 FROM private.game_group_access_codes x WHERE x.game_id=p_game_id AND x.invite_id=invite_codes.id
   ));
 INSERT INTO public.invite_codes(game_id,kind,code_hash,active)
 VALUES(p_game_id,p_kind,extensions.crypt(v_code,extensions.gen_salt('bf')),true)
 RETURNING id INTO v_invite;
 SELECT vault.create_secret(v_code,null,'ГОС.ID invitation code',null) INTO v_vault;
 INSERT INTO private.game_invitation_secrets(game_id,invite_id,vault_secret_id)
 VALUES(p_game_id,v_invite,v_vault);
 RETURN v_code;
END;$function$;
REVOKE ALL ON FUNCTION public.owner_rotate_invitation(uuid,public.member_kind) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.owner_rotate_invitation(uuid,public.member_kind) TO authenticated;

-- Initial codes created together with a new game are kept in Vault and
-- remain recoverable by the owner without exposing password credentials.
CREATE OR REPLACE FUNCTION public.create_teacher_game_session(
 p_title text,p_game_code text,p_teacher_code text,p_student_code text,p_teacher_name text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_game uuid;v_teacher uuid;v_student uuid;v_vault uuid;
BEGIN
 IF auth.uid() IS NULL OR coalesce((auth.jwt()->>'is_anonymous')::boolean,true)
 THEN RAISE EXCEPTION 'Войдите по почте и паролю' USING errcode='42501';END IF;
 IF NOT private.is_platform_admin()
    AND NOT EXISTS(SELECT 1 FROM public.teacher_profiles t WHERE t.user_id=auth.uid())
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

CREATE OR REPLACE FUNCTION public.teacher_saved_invitation_list(p_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE result jsonb;
BEGIN
 IF NOT private.is_game_code_owner(p_game_id) THEN
  RAISE EXCEPTION 'Просмотр приглашений доступен только владельцу игры' USING errcode='42501';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
 'id',i.id,
 'scope',case when i.kind='teacher' then 'teacher'
          when i.kind='observer' then 'guest'
          when gm.invite_id is not null then 'group' else 'participant' end,
 'group_name',gm.group_name,'active',i.active,'created_at',i.created_at,
 'code',s.decrypted_secret
 ) ORDER BY i.created_at DESC),'[]'::jsonb) INTO result
 FROM public.invite_codes i
 LEFT JOIN private.game_group_access_codes gm ON gm.invite_id=i.id AND gm.game_id=i.game_id
 LEFT JOIN private.game_invitation_secrets m ON m.invite_id=i.id AND m.game_id=i.game_id
 LEFT JOIN vault.decrypted_secrets s ON s.id=m.vault_secret_id
 WHERE i.game_id=p_game_id;
 RETURN result;
END;$function$;
