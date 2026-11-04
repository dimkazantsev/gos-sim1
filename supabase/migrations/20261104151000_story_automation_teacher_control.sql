-- ГОС.ID: optional teacher-controlled story automation. Private drafts never exposed by direct API.
-- No scheduled jobs, no client polling, no realtime subscription. Existing stage events only.
ALTER TABLE private.story_campaigns
 ADD COLUMN IF NOT EXISTS auto_mode boolean NOT NULL DEFAULT true,
 ADD COLUMN IF NOT EXISTS automation_error text;
ALTER TABLE private.story_episode_releases
 ADD COLUMN IF NOT EXISTS automatic_publication boolean NOT NULL DEFAULT false;
ALTER TABLE private.story_branch_reviews
 ADD COLUMN IF NOT EXISTS automatic_review boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS edited_title text,
 ADD COLUMN IF NOT EXISTS edited_body text;
ALTER TABLE private.story_branch_rules
 ADD COLUMN IF NOT EXISTS recorded_title text,
 ADD COLUMN IF NOT EXISTS neutral_title text;

CREATE OR REPLACE FUNCTION public.get_story_campaign_teacher(p_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE r private.story_campaigns%rowtype; n integer; a integer; pub integer; v_items jsonb;
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
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'episode_no',e.episode_no,'stage_no',e.stage_no,
  'title',coalesce(rel.draft_title,e.draft->>'title'),
  'loaded',length(btrim(e.draft->>'body'))>0,
  'approved',rel.approved_at IS NOT NULL,
  'published',rel.published_at IS NOT NULL) ORDER BY e.episode_no),'[]'::jsonb)
 INTO v_items FROM private.story_episode_drafts e
 LEFT JOIN private.story_episode_releases rel ON rel.game_id=p_game_id AND rel.episode_no=e.episode_no;
 RETURN jsonb_build_object('prepared',r.game_id IS NOT NULL,'enabled',coalesce(r.enabled,false),
  'auto_mode',coalesce(r.auto_mode,false),'automation_error',r.automation_error,
  'current_episode',coalesce(r.current_episode,0),'approved_episodes',a,
  'published_episodes',pub,'loaded_episodes',n,'total_episodes',24,
  'metrics_enabled',false,'publication_enabled',coalesce(r.enabled,false),'episodes',v_items);
END $fn$;

-- This is the existing single lazy-loaded teacher branch RPC, not an extra network request.
CREATE OR REPLACE FUNCTION public.get_story_branches_teacher(p_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT private.is_game_teacher(p_game_id) THEN
  RAISE EXCEPTION 'Доступ разрешён только преподавателю игры.' USING ERRCODE='42501';
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'branch_no',b.branch_no,'first_episode',b.first_episode,'last_episode',b.last_episode,
  'stage_no',end_episode.stage_no,'title',b.title,
  'when_recorded',b.when_recorded,'when_absent',b.when_absent,
  'evidence_description',b.evidence_description,
  'automatic_evidence',CASE WHEN r.outcome='recorded' THEN true WHEN r.outcome='neutral' THEN false ELSE NULL END,
  'reviewed_outcome',r.outcome,'reviewed_at',r.reviewed_at,
  'automatic_review',coalesce(r.automatic_review,false),
  'evidence_kind',r.evidence_kind,'evidence_id',r.evidence_id,
  'teacher_note',r.teacher_note,'published',r.published_at IS NOT NULL,
  'response_title',coalesce(r.edited_title,CASE WHEN r.outcome='recorded' THEN coalesce(b.recorded_title,'Горизонты: '||b.title) ELSE coalesce(b.neutral_title,'Горизонты: '||b.title) END),
  'response_body',coalesce(r.edited_body,CASE WHEN r.outcome='recorded' THEN b.recorded_body ELSE b.neutral_body END),
  'ready',coalesce(s.status='completed',false)
 ) ORDER BY b.branch_no),'[]'::jsonb) INTO v_result
 FROM private.story_branch_rules b
 JOIN private.story_episode_drafts end_episode ON end_episode.episode_no=b.last_episode
 LEFT JOIN public.game_stages s ON s.game_id=p_game_id AND s.stage_no=end_episode.stage_no
 LEFT JOIN private.story_branch_reviews r ON r.game_id=p_game_id AND r.branch_no=b.branch_no;
 RETURN v_result;
END $fn$;

-- Allow corrections before AND after publication, without touching official votes or effects.
CREATE OR REPLACE FUNCTION public.edit_story_branch_text_teacher(
 p_game_id uuid,p_branch_no smallint,p_title text,p_body text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_post uuid;v_published timestamptz;v_saved boolean;
BEGIN
 IF auth.uid() IS NULL OR NOT private.is_game_teacher(p_game_id) THEN
  RAISE EXCEPTION 'Доступ разрешён только преподавателю игры.' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM private.story_campaigns WHERE game_id=p_game_id)
  OR NOT EXISTS(SELECT 1 FROM private.story_branch_rules WHERE branch_no=p_branch_no) THEN
  RAISE EXCEPTION 'Сюжетная развилка не найдена.';
 END IF;
 IF length(btrim(coalesce(p_title,''))) NOT BETWEEN 12 AND 220 OR
    length(btrim(coalesce(p_body,''))) NOT BETWEEN 80 AND 9000 OR
    p_body ~ '@[[:alpha:]0-9_]' THEN
  RAISE EXCEPTION 'Проверьте название и текст реакции.';
 END IF;
 SELECT published_post_id,published_at INTO v_post,v_published
 FROM private.story_branch_reviews WHERE game_id=p_game_id AND branch_no=p_branch_no FOR UPDATE;
 IF v_published IS NOT NULL THEN
  UPDATE public.political_posts SET title=btrim(p_title),body=btrim(p_body),updated_at=now()
  WHERE id=v_post AND game_id=p_game_id AND status='published'
   AND context->>'story_campaign'='true'
   AND source_key='story_branch:'||lpad(p_branch_no::text,2,'0');
  IF NOT FOUND THEN RAISE EXCEPTION 'Опубликованная сюжетная реакция не найдена.';END IF;
 END IF;
 INSERT INTO private.story_branch_reviews(game_id,branch_no,outcome,reviewed_by,
   teacher_note,edited_title,edited_body,automatic_review)
 VALUES(p_game_id,p_branch_no,'undetermined',auth.uid(),'',btrim(p_title),btrim(p_body),false)
 ON CONFLICT(game_id,branch_no) DO UPDATE SET
  edited_title=excluded.edited_title,edited_body=excluded.edited_body;
 RETURN jsonb_build_object('saved',true,'published',v_published IS NOT NULL,
  'title',btrim(p_title),'body',btrim(p_body));
END $fn$;

CREATE OR REPLACE FUNCTION public.edit_story_published_episode_teacher(
 p_game_id uuid,p_episode_no integer,p_title text,p_body text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_post uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT private.is_game_teacher(p_game_id) THEN
  RAISE EXCEPTION 'Доступ разрешён только преподавателю игры.' USING ERRCODE='42501';
 END IF;
 IF length(btrim(coalesce(p_title,''))) NOT BETWEEN 12 AND 220 OR
    length(btrim(coalesce(p_body,''))) NOT BETWEEN 80 AND 9000 OR
    p_body ~ '@[[:alpha:]0-9_]' THEN
  RAISE EXCEPTION 'Проверьте заголовок и содержимое новости.';
 END IF;
 SELECT published_post_id INTO v_post FROM private.story_episode_releases
 WHERE game_id=p_game_id AND episode_no=p_episode_no AND published_at IS NOT NULL FOR UPDATE;
 IF v_post IS NULL THEN RAISE EXCEPTION 'Выпуск ещё не опубликован.'; END IF;
 UPDATE public.political_posts SET title=btrim(p_title),body=btrim(p_body),updated_at=now()
 WHERE id=v_post AND game_id=p_game_id AND status='published'
  AND source_key='story_episode:'||lpad(p_episode_no::text,2,'0')
  AND context->>'story_campaign'='true';
 IF NOT FOUND THEN RAISE EXCEPTION 'Опубликованный выпуск не найден.'; END IF;
 UPDATE private.story_episode_releases
 SET draft_title=btrim(p_title),draft_body=btrim(p_body)
 WHERE game_id=p_game_id AND episode_no=p_episode_no;
 RETURN public.get_story_episode_preview_teacher(p_game_id,p_episode_no);
END $fn$;

REVOKE ALL ON FUNCTION public.get_story_branches_teacher(uuid),
 public.get_story_campaign_teacher(uuid),
 public.edit_story_branch_text_teacher(uuid,smallint,text,text),
 public.edit_story_published_episode_teacher(uuid,integer,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_story_branches_teacher(uuid),
 public.get_story_campaign_teacher(uuid),
 public.edit_story_branch_text_teacher(uuid,smallint,text,text),
 public.edit_story_published_episode_teacher(uuid,integer,text,text) TO authenticated;
