-- ГОС.ID: storyline engine. Public Git contains *no scripts, endings or texts*.
-- All full content is uploaded separately to the protected private schema.
-- Zero database triggers, cron, extra channels, automatic polls or metric effects.
ALTER TABLE private.story_campaigns
 DROP CONSTRAINT IF EXISTS story_campaign_locked_until_approved;

CREATE TABLE IF NOT EXISTS private.story_episode_releases (
 game_id uuid NOT NULL REFERENCES private.story_campaigns(game_id) ON DELETE CASCADE,
 episode_no integer NOT NULL REFERENCES private.story_episode_drafts(episode_no),
 approved_by uuid,
 approved_at timestamptz,
 published_by uuid,
 published_at timestamptz,
 published_post_id uuid REFERENCES public.political_posts(id),
 PRIMARY KEY(game_id,episode_no),
 CONSTRAINT story_release_publisher_requires_approval
  CHECK(published_at IS NULL OR (approved_at IS NOT NULL AND published_post_id IS NOT NULL))
);
ALTER TABLE private.story_episode_releases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.story_episode_releases FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_story_campaign_teacher(p_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE r private.story_campaigns%rowtype; n integer; a integer; pub integer;
BEGIN
 IF auth.uid() IS NULL OR NOT private.is_game_teacher(p_game_id) THEN
  RAISE EXCEPTION 'Доступ разрешён только преподавателю игры.' USING ERRCODE='42501';
 END IF;
 SELECT * INTO r FROM private.story_campaigns WHERE game_id=p_game_id;
 SELECT count(*) INTO n FROM private.story_episode_drafts
  WHERE length(btrim(draft->>'title'))>0 AND length(btrim(draft->>'body'))>0;
 SELECT count(*) FILTER(WHERE approved_at IS NOT NULL),
        count(*) FILTER(WHERE published_at IS NOT NULL)
 INTO a,pub FROM private.story_episode_releases WHERE game_id=p_game_id;
 RETURN jsonb_build_object('prepared',r.game_id IS NOT NULL,'enabled',coalesce(r.enabled,false),
  'current_episode',coalesce(r.current_episode,0),'approved_episodes',a,
  'published_episodes',pub,'loaded_episodes',n,'total_episodes',24,
  'metrics_enabled',false,'publication_enabled',coalesce(r.enabled,false));
END $fn$;

CREATE OR REPLACE FUNCTION public.get_story_episode_list_teacher(p_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE items jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT private.is_game_teacher(p_game_id) THEN
  RAISE EXCEPTION 'Доступ разрешён только преподавателю игры.' USING ERRCODE='42501';
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('episode_no',e.episode_no,
  'stage_no',e.stage_no,'title',e.draft->>'title',
  'loaded',(length(btrim(e.draft->>'body'))>0),'approved',r.approved_at IS NOT NULL,
  'published',r.published_at IS NOT NULL,'published_post_id',r.published_post_id)
  ORDER BY e.episode_no),'[]'::jsonb) INTO items
 FROM private.story_episode_drafts e
 LEFT JOIN private.story_episode_releases r
  ON r.game_id=p_game_id AND r.episode_no=e.episode_no;
 RETURN items;
END $fn$;

CREATE OR REPLACE FUNCTION public.get_story_episode_preview_teacher(p_game_id uuid,p_episode_no integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE item jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT private.is_game_teacher(p_game_id) THEN
  RAISE EXCEPTION 'Доступ разрешён только преподавателю игры.' USING ERRCODE='42501';
 END IF;
 SELECT jsonb_build_object('episode_no',episode_no,'stage_no',stage_no,
   'title',draft->>'title','body',draft->>'body',
   'editor_note',coalesce(draft->>'editor_note',''),
   'evidence_rule',coalesce(draft->>'evidence_rule',''))
 INTO item FROM private.story_episode_drafts WHERE episode_no=p_episode_no;
 RETURN item;
END $fn$;

CREATE OR REPLACE FUNCTION public.set_story_campaign_enabled_teacher(p_game_id uuid,p_enabled boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_stage integer; v_loaded integer;
BEGIN
 IF auth.uid() IS NULL OR NOT private.is_game_teacher(p_game_id) THEN
  RAISE EXCEPTION 'Доступ разрешён только преподавателю игры.' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM private.story_campaigns WHERE game_id=p_game_id) THEN
  RAISE EXCEPTION 'Сначала подготовьте сюжетную кампанию.';
 END IF;
 IF p_enabled THEN
  SELECT current_round INTO v_stage FROM public.games WHERE id=p_game_id;
  IF v_stage NOT BETWEEN 4 AND 14 THEN RAISE EXCEPTION 'Сюжет разрешён только на этапах 4–14.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.electoral_calculator_results
     WHERE game_id=p_game_id AND published IS TRUE) THEN
   RAISE EXCEPTION 'Результаты выборов в Государственную Думу ещё не опубликованы.';
  END IF;
  SELECT count(*) INTO v_loaded FROM private.story_episode_drafts
    WHERE length(btrim(draft->>'title'))>0 AND length(btrim(draft->>'body'))>0;
  IF v_loaded<>24 THEN RAISE EXCEPTION 'Сценарий ещё не загружен полностью: % из 24.',v_loaded; END IF;
  IF EXISTS(SELECT 1 FROM private.story_campaigns WHERE game_id=p_game_id AND current_episode>=24) THEN
   RAISE EXCEPTION 'Кампания уже завершена.';
  END IF;
 END IF;
 UPDATE private.story_campaigns SET enabled=coalesce(p_enabled,false),updated_at=now()
  WHERE game_id=p_game_id;
 RETURN public.get_story_campaign_teacher(p_game_id);
END $fn$;

CREATE OR REPLACE FUNCTION public.approve_story_episode_teacher(p_game_id uuid,p_episode_no integer,p_approved boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_released timestamptz;
BEGIN
 IF auth.uid() IS NULL OR NOT private.is_game_teacher(p_game_id) THEN
  RAISE EXCEPTION 'Доступ разрешён только преподавателю игры.' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM private.story_campaigns WHERE game_id=p_game_id) THEN
  RAISE EXCEPTION 'Кампания не подготовлена.';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM private.story_episode_drafts WHERE episode_no=p_episode_no
  AND length(btrim(draft->>'body'))>0) THEN RAISE EXCEPTION 'Текст эпизода не найден.'; END IF;
 SELECT published_at INTO v_released FROM private.story_episode_releases
  WHERE game_id=p_game_id AND episode_no=p_episode_no;
 IF v_released IS NOT NULL THEN RAISE EXCEPTION 'Опубликованный эпизод нельзя отозвать.'; END IF;
 INSERT INTO private.story_episode_releases(game_id,episode_no,approved_by,approved_at)
 VALUES(p_game_id,p_episode_no,CASE WHEN p_approved THEN auth.uid() END,
  CASE WHEN p_approved THEN now() END)
 ON CONFLICT(game_id,episode_no) DO UPDATE SET
   approved_by=excluded.approved_by,approved_at=excluded.approved_at;
 RETURN public.get_story_campaign_teacher(p_game_id);
END $fn$;

CREATE OR REPLACE FUNCTION public.publish_story_episode_teacher(
 p_game_id uuid,p_episode_no integer,p_public_title text DEFAULT NULL,p_public_body text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_campaign private.story_campaigns%rowtype; v_draft private.story_episode_drafts%rowtype;
 v_approved timestamptz;v_published uuid;v_stage integer;
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
 SELECT approved_at,published_post_id INTO v_approved,v_published
  FROM private.story_episode_releases WHERE game_id=p_game_id AND episode_no=p_episode_no;
 IF v_published IS NOT NULL THEN
  RETURN jsonb_build_object('published',true,'post_id',v_published,'already_published',true);
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
 IF p_episode_no=24 AND NOT EXISTS(
  SELECT 1 FROM public.municipal_projects p
  JOIN public.game_votes v ON v.id=p.vote_id AND v.game_id=p.game_id
  WHERE p.game_id=p_game_id AND p.stage_no=14 AND v.status='closed'
 ) THEN RAISE EXCEPTION 'Нет подтверждённых результатов рассмотрения муниципальных проектов.'; END IF;
 v_title:=coalesce(nullif(btrim(p_public_title),''),v_draft.draft->>'title');
 v_body:=coalesce(nullif(btrim(p_public_body),''),v_draft.draft->>'body');
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
   'story_campaign',true,'story_episode',p_episode_no,'story_stage',v_stage),
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
  'episode_no',p_episode_no,'closed',p_episode_no=24);
END $fn$;

REVOKE ALL ON FUNCTION public.get_story_campaign_teacher(uuid),
 public.get_story_episode_list_teacher(uuid),
 public.get_story_episode_preview_teacher(uuid,integer),
 public.set_story_campaign_enabled_teacher(uuid,boolean),
 public.approve_story_episode_teacher(uuid,integer,boolean),
 public.publish_story_episode_teacher(uuid,integer,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_story_campaign_teacher(uuid),
 public.get_story_episode_list_teacher(uuid),
 public.get_story_episode_preview_teacher(uuid,integer),
 public.set_story_campaign_enabled_teacher(uuid,boolean),
 public.approve_story_episode_teacher(uuid,integer,boolean),
 public.publish_story_episode_teacher(uuid,integer,text,text) TO authenticated;
