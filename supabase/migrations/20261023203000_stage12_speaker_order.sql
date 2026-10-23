-- Этап 12: сохраняемый порядок выступающих для каждого вопроса без создания отдельного канала подписок.
-- Исторические заседания, состав повестки и уже состоявшиеся выступления не изменяются.
ALTER TABLE public.duma_agenda_items ADD COLUMN IF NOT EXISTS speaker_order uuid[] NOT NULL DEFAULT ARRAY[]::uuid[];
CREATE OR REPLACE FUNCTION public.set_stage12_speaker_order(p_item_id uuid,p_speakers uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO pg_catalog,public,private,pg_temp AS $$
DECLARE v_item public.duma_agenda_items%rowtype; v_session public.duma_sessions%rowtype;
 v_user uuid:=auth.uid();v_role text;v_count integer;
BEGIN
 SELECT * INTO v_item FROM public.duma_agenda_items WHERE id=p_item_id FOR UPDATE;
 SELECT * INTO v_session FROM public.duma_sessions WHERE id=v_item.session_id FOR UPDATE;
 IF v_item.id IS NULL OR v_session.id IS NULL OR v_item.game_id IS DISTINCT FROM v_session.game_id
  OR v_session.stage_no<>12 OR v_session.status NOT IN ('draft','open')
  OR v_item.status NOT IN ('pending','in_progress')
  OR v_user IS NULL OR NOT private.is_game_member(v_session.game_id)
 THEN RAISE EXCEPTION 'Недоступный вопрос или завершённое заседание' USING ERRCODE='42501';END IF;
 v_role:=lower(coalesce(private.game_role(v_session.game_id,v_user),''));
 IF NOT (private.is_game_teacher(v_session.game_id) OR (
    private.role_is_available(v_session.game_id,v_user) AND (
     (v_role LIKE '%председател%' AND v_role LIKE '%дум%')
     OR EXISTS(SELECT 1 FROM public.game_office_assignments a
      WHERE a.game_id=v_session.game_id AND a.user_id=v_user AND a.status='active'
       AND lower(a.role_title) LIKE '%председател%' AND lower(a.role_title) LIKE '%дум%')
    ))) THEN RAISE EXCEPTION 'Очерёдность выступлений изменяет только председатель ГД или его заместитель' USING ERRCODE='42501';END IF;
 PERFORM private.require_duma_stage_open(v_session.game_id,12);
 IF v_session.status='open' AND NOT private.is_game_teacher(v_session.game_id) THEN
  PERFORM private.require_game_meeting_registration(v_session.game_id,v_user,12,'gd');
 END IF;
 IF p_speakers IS NULL OR cardinality(p_speakers)>40
  OR (SELECT count(DISTINCT speaker) FROM unnest(p_speakers) AS speaker)<>cardinality(p_speakers)
  OR EXISTS(SELECT 1 FROM unnest(p_speakers) AS speaker WHERE speaker IS NULL)
 THEN RAISE EXCEPTION 'Очерёдность может содержать до 40 разных участников' USING ERRCODE='23514';END IF;
 SELECT count(*) INTO v_count FROM public.game_members m
 WHERE m.game_id=v_session.game_id AND m.user_id=ANY(p_speakers)
  AND m.kind IN ('student','teacher') AND m.roster_archived_at IS NULL;
 IF v_count<>cardinality(p_speakers)
 THEN RAISE EXCEPTION 'В списке есть недействующий или посторонний участник' USING ERRCODE='23514';END IF;
 IF v_item.speaker_order IS NOT DISTINCT FROM p_speakers THEN RETURN;END IF;
 UPDATE public.duma_agenda_items SET speaker_order=p_speakers WHERE id=v_item.id;
 INSERT INTO public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,note)
 VALUES(v_item.formal_document_id,v_session.game_id,v_user,'Изменена очерёдность выступающих',
  v_item.opened_document_step,v_item.opened_document_step,
  'Вопрос повестки № '||v_item.agenda_no||'. Утверждённая очерёдность: '||cardinality(p_speakers)||' участников');
END;
$$;
REVOKE ALL ON FUNCTION public.set_stage12_speaker_order(uuid,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_stage12_speaker_order(uuid,uuid[]) TO authenticated;
