-- Reader guidance is copied into public post context only upon approved manual publication.
-- No table, role, trigger, balance or polling changes.
CREATE OR REPLACE FUNCTION public.publish_story_episode_teacher(
 p_game_id uuid,p_episode_no integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_campaign private.story_campaigns%rowtype; v_draft private.story_episode_drafts%rowtype;
 v_approved timestamptz;v_published uuid;v_draft_title text;v_draft_body text;v_stage integer;
 v_title text;v_body text;v_post uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT private.is_game_teacher(p_game_id) THEN
  RAISE EXCEPTION 'Доступ разрешён только преподавателю игры.' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_campaign FROM private.story_campaigns WHERE game_id=p_game_id FOR UPDATE;
 IF v_campaign.game_id IS NULL OR NOT v_campaign.enabled THEN
  RAISE EXCEPTION 'Кампания выключена или ещё не подготовлена.';
 END IF;
 SELECT * INTO v_draft FROM private.story_episode_drafts WHERE episode_no=p_episode_no;
 IF v_draft.episode_no IS NULL THEN RAISE EXCEPTION 'Эпизод не найден.'; END IF;
 SELECT approved_at,published_post_id,draft_title,draft_body INTO v_approved,v_published,v_draft_title,v_draft_body
  FROM private.story_episode_releases WHERE game_id=p_game_id AND episode_no=p_episode_no;
 IF v_published IS NOT NULL THEN
  RETURN jsonb_build_object('published',true,'post_id',v_published,'already_published',true,'campaign',public.get_story_campaign_teacher(p_game_id));
 END IF;
 IF v_approved IS NULL THEN RAISE EXCEPTION 'Сначала утвердите текст эпизода.'; END IF;
 IF v_campaign.current_episode+1<>p_episode_no THEN
  RAISE EXCEPTION 'Нарушена последовательность эпизодов. Следующий: %.',v_campaign.current_episode+1;
 END IF;
 SELECT current_round INTO v_stage FROM public.games WHERE id=p_game_id;
 IF v_stage<>v_draft.stage_no OR v_stage NOT BETWEEN 4 AND 14
  OR NOT EXISTS(SELECT 1 FROM public.game_stages
    WHERE game_id=p_game_id AND stage_no=v_stage AND status='open') THEN
  RAISE EXCEPTION 'Эпизод относится к другому или закрытому учебному этапу.';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.electoral_calculator_results
   WHERE game_id=p_game_id AND published IS TRUE) THEN
  RAISE EXCEPTION 'Выборы Государственной Думы не подтверждены.';
 END IF;
 IF p_episode_no=10 AND NOT EXISTS(
  SELECT 1 FROM public.game_office_assignments
   WHERE game_id=p_game_id AND status='active' AND role_title ILIKE '%Президент%'
 ) THEN RAISE EXCEPTION 'Полномочия Президента ещё не подтверждены.'; END IF;
 IF p_episode_no=15 AND NOT EXISTS(
  SELECT 1 FROM public.game_votes
   WHERE game_id=p_game_id AND stage_no=11 AND status='closed'
 ) THEN RAISE EXCEPTION 'Нет завершённого голосования Правительства на этапе 11.'; END IF;
 IF p_episode_no=21 AND NOT EXISTS(
  SELECT 1 FROM public.game_votes WHERE game_id=p_game_id AND stage_no=13 AND status='closed'
 ) THEN RAISE EXCEPTION 'Нет подтверждённого бюджетного голосования на этапе 13.';END IF;
 IF p_episode_no=24 AND NOT EXISTS(
  SELECT 1 FROM public.municipal_projects p
  JOIN public.game_votes v ON v.id=p.vote_id AND v.game_id=p.game_id
  WHERE p.game_id=p_game_id AND p.stage_no=14 AND v.status='closed'
 ) THEN RAISE EXCEPTION 'Нет подтверждённых результатов рассмотрения муниципальных проектов.'; END IF;
 v_title:=coalesce(v_draft_title,v_draft.draft->>'title');
 v_body:=coalesce(v_draft_body,v_draft.draft->>'body');
 IF v_body ~ '@[[:alpha:]0-9_]' THEN
  RAISE EXCEPTION 'В сюжетном выпуске нельзя упоминать пользователей через @: это создаёт отдельные уведомления.';
 END IF;
 IF length(v_title) NOT BETWEEN 12 AND 220 OR length(v_body) NOT BETWEEN 80 AND 9000 THEN
  RAISE EXCEPTION 'Проверьте заголовок и содержимое публикации.';
 END IF;
 -- Existing impact_post_insert_trigger explicitly ignores source_key and automatic.
 -- A story item is informational, not a state change, grade or vote.
 INSERT INTO public.political_posts(game_id,author_id,process_type,actor_key,actor_label,
  title,body,tags,source_key,context,status,impact_plan,effects_applied)
 VALUES(p_game_id,auth.uid(),'news','system','ГОС.ID · Сюжетная хроника',
  v_title,v_body,ARRAY['Сюжет','Горизонты Республики'],
  'story_episode:'||lpad(p_episode_no::text,2,'0'),
  jsonb_build_object('automatic',true,'source_table','story_campaign',
   'story_campaign',true,'story_episode',p_episode_no,'story_stage',v_stage,
   'story_guide',CASE WHEN jsonb_typeof(v_draft.draft->'student_guide')='object'
      THEN v_draft.draft->'student_guide' ELSE '{}'::jsonb END),
  'published','{"metrics":{}}'::jsonb,false)
 ON CONFLICT(game_id,source_key) WHERE source_key IS NOT NULL DO NOTHING
 RETURNING id INTO v_post;
 IF v_post IS NULL THEN RAISE EXCEPTION 'Публикация уже зарегистрирована в политической хронике.';END IF;
 UPDATE private.story_episode_releases SET published_at=now(),published_by=auth.uid(),
  published_post_id=v_post WHERE game_id=p_game_id AND episode_no=p_episode_no;
 UPDATE private.story_campaigns SET current_episode=p_episode_no,updated_at=now(),
  enabled=CASE WHEN p_episode_no=24 THEN false ELSE enabled END
  WHERE game_id=p_game_id;
 RETURN jsonb_build_object('published',true,'post_id',v_post,'already_published',false,
  'episode_no',p_episode_no,'closed',p_episode_no=24,'campaign',public.get_story_campaign_teacher(p_game_id));
END $fn$;
REVOKE ALL ON FUNCTION public.publish_story_episode_teacher(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.publish_story_episode_teacher(uuid,integer) TO authenticated;
