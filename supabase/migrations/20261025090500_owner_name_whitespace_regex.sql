-- Correct name canonicalization in the existing protected-platform-admin
-- join guard. Use a POSIX whitespace class, which is independent of
-- SQL-standard string escape settings. No role/code/data changes.
CREATE OR REPLACE FUNCTION public.join_game_as_role(p_game_code text, p_invite_code text, p_full_name text, p_group_name text, p_expected_kind member_kind)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
 IF EXISTS(SELECT 1 FROM public.teacher_profiles tp
   JOIN public.platform_admins pa ON pa.user_id=tp.user_id
   WHERE tp.user_id<>v_uid
     AND lower(regexp_replace(btrim(tp.full_name),'[[:space:]]+',' ','g'))
       =lower(regexp_replace(v_name,'[[:space:]]+',' ','g'))
 ) THEN RAISE EXCEPTION 'Это ФИО принадлежит защищённой учётной записи преподавателя. Войдите под собственными данными.' USING errcode='42501';
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
