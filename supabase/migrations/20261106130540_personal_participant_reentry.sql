-- ГОС.ID: private one-use participant recovery token, 24h, SHA-256 hash.
CREATE TABLE IF NOT EXISTS private.participant_reentry_links(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 game_id uuid NOT NULL,
 former_user_id uuid NOT NULL,
 created_by uuid NOT NULL,
 token_hash text NOT NULL UNIQUE,
 full_name text NOT NULL,
 group_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT(now()+interval '24 hours'),
 used_at timestamptz,
 claimed_by uuid,
 revoked_at timestamptz,
 CONSTRAINT participant_reentry_original_member_fk FOREIGN KEY(game_id,former_user_id) REFERENCES public.game_members(game_id,user_id) ON DELETE CASCADE,
 CONSTRAINT participant_reentry_name_len CHECK(char_length(full_name) BETWEEN 5 AND 200),
 CONSTRAINT participant_reentry_group_len CHECK(char_length(group_name) BETWEEN 1 AND 120)
);
ALTER TABLE private.participant_reentry_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.participant_reentry_links FROM PUBLIC,anon,authenticated;
COMMENT ON TABLE private.participant_reentry_links IS 'Одноразовые персональные ссылки: SHA-256 хеш, блокированная запись, 24 часа.';
-- redeem_participant_reentry
CREATE OR REPLACE FUNCTION public.redeem_participant_reentry(p_token text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_actor uuid:=auth.uid();
 v_grant private.participant_reentry_links%rowtype;
 v_old public.game_members%rowtype;
BEGIN
 IF v_actor IS NULL THEN RAISE EXCEPTION 'Авторизация обязательна.' USING errcode='42501'; END IF;
 IF p_token IS NULL OR p_token !~ '^[0-9a-f]{48}$' THEN
  RAISE EXCEPTION 'Недействительная ссылка восстановления.' USING errcode='42501';
 END IF;
 -- SERIALIZE concurrent redemption: only first valid transaction can consume it.
 SELECT * INTO v_grant FROM private.participant_reentry_links
 WHERE token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
 FOR UPDATE;
 IF NOT FOUND OR v_grant.used_at IS NOT NULL OR v_grant.revoked_at IS NOT NULL
  OR v_grant.expires_at<=now() THEN
  RAISE EXCEPTION 'Ссылка недействительна, уже использована или срок её действия истёк.' USING errcode='42501';
 END IF;
 IF EXISTS(SELECT 1 FROM public.teacher_profiles WHERE user_id=v_actor)
  OR EXISTS(SELECT 1 FROM public.platform_admins WHERE user_id=v_actor) THEN
  RAISE EXCEPTION 'Преподаватель не может использовать ссылку участника.' USING errcode='42501';
 END IF;
 SELECT * INTO v_old FROM public.game_members
 WHERE game_id=v_grant.game_id AND user_id=v_grant.former_user_id FOR UPDATE;
 IF NOT FOUND OR v_old.kind<>'student' OR v_old.roster_archived_at IS NULL
   OR NOT EXISTS(SELECT 1 FROM public.game_member_access_blocks
     WHERE game_id=v_grant.game_id AND user_id=v_grant.former_user_id) THEN
  RAISE EXCEPTION 'Учётная запись уже восстановлена или недоступна для восстановления.' USING errcode='42501';
 END IF;

 IF v_actor=v_grant.former_user_id THEN
  -- The participant still holds the old authenticated identity:
  -- restores the SAME member/score/history (no new membership).
  DELETE FROM public.game_member_access_blocks
   WHERE game_id=v_grant.game_id AND user_id=v_actor;
  UPDATE public.game_members SET
   roster_archived_at=NULL,
   full_name=v_grant.full_name,
   group_name=v_grant.group_name
  WHERE game_id=v_grant.game_id AND user_id=v_actor;
 ELSE
  -- A lost anonymous session cannot be recovered cryptographically.
  -- Create ONE clean student membership; keep the old record archived and blocked.
  IF EXISTS(SELECT 1 FROM public.game_members
    WHERE game_id=v_grant.game_id AND user_id=v_actor)
    OR EXISTS(SELECT 1 FROM public.game_member_access_blocks
      WHERE game_id=v_grant.game_id AND user_id=v_actor) THEN
   RAISE EXCEPTION 'Этот аккаунт уже связан с игрой. Для восстановления откройте ссылку в отдельном браузере участника.' USING errcode='42501';
  END IF;
  INSERT INTO public.game_members(game_id,user_id,full_name,group_name,kind)
  VALUES(v_grant.game_id,v_actor,v_grant.full_name,v_grant.group_name,'student');
 END IF;
 UPDATE private.participant_reentry_links
 SET used_at=now(),claimed_by=v_actor WHERE id=v_grant.id;
 INSERT INTO public.audit_log(game_id,actor_id,action,entity_type,payload)
 VALUES(v_grant.game_id,v_actor,'participant_reentry_redeemed','member',
 jsonb_build_object('former_user_id',v_grant.former_user_id,
  'new_user_id',v_actor,'mode',
  CASE WHEN v_actor=v_grant.former_user_id THEN 'same_identity' ELSE 'new_identity' END));
 RETURN v_grant.game_id;
END;
$function$
;

-- teacher_issue_participant_reentry
CREATE OR REPLACE FUNCTION public.teacher_issue_participant_reentry(p_game_id uuid, p_former_user_id uuid, p_full_name text, p_group_name text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_actor uuid := auth.uid();
 v_member public.game_members%rowtype;
 v_name text:=btrim(regexp_replace(coalesce(p_full_name,''),'[[:space:]]+',' ','g'));
 v_group text:=btrim(coalesce(p_group_name,''));
 v_token text;
BEGIN
 IF v_actor IS NULL OR NOT private.is_game_teacher(p_game_id) THEN
  RAISE EXCEPTION 'Ссылку восстановления может выдать только преподаватель.' USING errcode='42501';
 END IF;
 SELECT * INTO v_member FROM public.game_members
 WHERE game_id=p_game_id AND user_id=p_former_user_id FOR UPDATE;
 IF NOT FOUND OR v_member.kind<>'student' OR v_member.roster_archived_at IS NULL
   OR NOT EXISTS (
    SELECT 1 FROM public.game_member_access_blocks
    WHERE game_id=p_game_id AND user_id=p_former_user_id
   ) THEN
  RAISE EXCEPTION 'Выберите исключённого участника этой игры.' USING errcode='42501';
 END IF;
 IF char_length(v_name) NOT BETWEEN 5 AND 200 OR char_length(v_group) NOT BETWEEN 1 AND 120 THEN
  RAISE EXCEPTION 'Укажите ФИО и учебную группу участника.' USING errcode='22023';
 END IF;
 UPDATE private.participant_reentry_links SET revoked_at=now()
 WHERE game_id=p_game_id AND former_user_id=p_former_user_id
  AND used_at IS NULL AND revoked_at IS NULL;
 v_token:=encode(extensions.gen_random_bytes(24),'hex');
 INSERT INTO private.participant_reentry_links(game_id,former_user_id,created_by,token_hash,full_name,group_name)
 VALUES(p_game_id,p_former_user_id,v_actor,encode(extensions.digest(v_token,'sha256'),'hex'),v_name,v_group);
 INSERT INTO public.audit_log(game_id,actor_id,action,entity_type,payload)
 VALUES(p_game_id,v_actor,'teacher_reentry_link_issued','member',
 jsonb_build_object('target_user_id',p_former_user_id,'expires_in_hours',24));
 RETURN v_token;
END;
$function$
;
REVOKE ALL ON FUNCTION public.teacher_issue_participant_reentry(uuid,uuid,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.redeem_participant_reentry(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.teacher_issue_participant_reentry(uuid,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_participant_reentry(text) TO authenticated;
