-- ГОС.ID: управление составом партий преподавателем после этапа 1.
-- Одна атомарная операция, без новых таблиц, индексов и каналов связи.
-- private.enforce_party_stage_open
CREATE OR REPLACE FUNCTION private.enforce_party_stage_open()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 -- Преподаватель вправе отменить устаревшее приглашение после этапа 1;
 -- иные изменения приглашений остаются ограничены первым этапом.
 IF tg_table_name='party_invitations' AND tg_op='UPDATE'
    AND old.status='pending' AND new.status='cancelled'
    AND (new.game_id,new.party_id,new.invited_user_id,new.invited_by)
        IS NOT DISTINCT FROM (old.game_id,old.party_id,old.invited_user_id,old.invited_by)
    AND private.is_game_teacher(new.game_id) THEN
  RETURN new;
 END IF;
 IF auth.uid() IS NOT NULL AND NOT private.stage_one_party_active(new.game_id) THEN
  RAISE EXCEPTION 'Первый этап ещё не открыт.' USING errcode='42501';
 END IF;
 RETURN new;
END;
$function$
;

-- public.teacher_manage_party_membership
CREATE OR REPLACE FUNCTION public.teacher_manage_party_membership(p_party_id uuid, p_user_id uuid, p_action text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 p public.game_parties%rowtype;
 gm public.game_members%rowtype;
 old_team text;
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('enroll','remove') THEN
  RAISE EXCEPTION 'Недопустимое действие с составом партии.' USING errcode='22023';
 END IF;
 SELECT * INTO p FROM public.game_parties WHERE id=p_party_id FOR UPDATE;
 IF p.id IS NULL THEN
  RAISE EXCEPTION 'Партия не найдена.' USING errcode='22023';
 END IF;
 IF NOT private.is_game_teacher(p.game_id) THEN
  RAISE EXCEPTION 'Управлять составом партий может только преподаватель.' USING errcode='42501';
 END IF;
 IF NOT EXISTS (
  SELECT 1 FROM public.game_stages
  WHERE game_id=p.game_id AND stage_no=1 AND status='completed'
 ) THEN
  RAISE EXCEPTION 'Редактирование состава преподавателем доступно после завершения первого этапа.' USING errcode='42501';
 END IF;
 IF private.has_open_duma_mandate_vote(p.game_id) THEN
  RAISE EXCEPTION 'Во время открытого голосования Государственной Думы по мандатам менять состав партии нельзя.' USING errcode='42501';
 END IF;
 SELECT * INTO gm FROM public.game_members
 WHERE game_id=p.game_id AND user_id=p_user_id FOR UPDATE;
 IF gm.user_id IS NULL OR gm.kind<>'student' OR gm.roster_archived_at IS NOT NULL THEN
  RAISE EXCEPTION 'Выберите действующего участника этой игры.' USING errcode='42501';
 END IF;
 old_team:=gm.team;
 IF (p_action='enroll' AND old_team=p.name)
    OR (p_action='remove' AND old_team IS DISTINCT FROM p.name) THEN
  RETURN;
 END IF;

 IF p_action='enroll' THEN
  -- Перенос лидера не переносит за ним прежнее председательство.
  IF old_team IS NOT NULL THEN
   UPDATE public.game_parties
   SET leader_user_id=NULL
   WHERE game_id=p.game_id AND name=old_team AND leader_user_id=p_user_id;
   DELETE FROM public.channel_members cm USING public.chat_channels ch
   WHERE cm.channel_id=ch.id AND cm.user_id=p_user_id
      AND ch.game_id=p.game_id AND ch.kind='team'
      AND ch.name='Фракция · '||old_team;
  END IF;
  UPDATE public.game_members
  SET team=p.name,party_joined_at=now()
  WHERE game_id=p.game_id AND user_id=p_user_id;
  INSERT INTO public.channel_members(channel_id,user_id)
  SELECT ch.id,p_user_id FROM public.chat_channels ch
  WHERE ch.game_id=p.game_id AND ch.kind='team' AND ch.name='Фракция · '||p.name
  ON CONFLICT DO NOTHING;
  -- Отменяются лишь неразрешённые приглашения; историю ответов сохраняем.
  UPDATE public.party_invitations
  SET status='cancelled',responded_at=now()
  WHERE game_id=p.game_id AND invited_user_id=p_user_id AND status='pending';
 ELSE
  UPDATE public.game_parties SET leader_user_id=NULL
  WHERE id=p.id AND leader_user_id=p_user_id;
  UPDATE public.game_members SET team=NULL,party_joined_at=NULL
  WHERE game_id=p.game_id AND user_id=p_user_id AND team=p.name;
  DELETE FROM public.channel_members cm USING public.chat_channels ch
  WHERE cm.channel_id=ch.id AND cm.user_id=p_user_id
    AND ch.game_id=p.game_id AND ch.kind='team'
    AND ch.name='Фракция · '||p.name;
 END IF;

 -- Действующий AFTER UPDATE game_members пересчитывает только затронутые партии.
 INSERT INTO public.audit_log(game_id,actor_id,action,entity_type,entity_id,payload)
 VALUES(p.game_id,auth.uid(),'teacher_party_member_'||p_action,'game_parties',p.id,
        jsonb_build_object('user_id',p_user_id,'old_party',old_team,
                           'new_party',CASE WHEN p_action='enroll' THEN p.name ELSE NULL END));
 -- Только метаданные, без оценок, бюллетеней и личных сведений.
 -- Существующий приватный канал автоматически актуализирует список партии.
 PERFORM realtime.send(
  jsonb_build_object('table','game_parties','party_id',p.id,'operation','UPDATE',
                     'member_user_id',p_user_id),
  'game_parties_changed','gos-id-live:'||p.game_id::text,true
 );
END;
$function$
;
REVOKE ALL ON FUNCTION public.teacher_manage_party_membership(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.teacher_manage_party_membership(uuid,uuid,text) TO authenticated;
COMMENT ON FUNCTION public.teacher_manage_party_membership(uuid,uuid,text) IS 'Только преподаватель после этапа 1. Сохранение истории, безопасности и приватных игровых каналов.';
