-- Event-driven narrative. One synchronous run per stage opening/completion (never per player action).
-- All calls remain private; source evidence must refer to the exact game and an actual official result.
CREATE OR REPLACE FUNCTION private.story_automation_source(p_game uuid,p_branch smallint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $f$
DECLARE v_id uuid;v_kind text;v_note text;
BEGIN
 IF p_branch=6 THEN
  SELECT a.id,'government_program',
   'Завершённое голосование по государственной программе «'||left(sp.title,180)||'»'
  INTO v_id,v_kind,v_note
  FROM public.government_program_agenda a
  JOIN public.state_programs sp ON sp.id=a.program_id AND sp.game_id=a.game_id
  JOIN public.game_votes v ON v.id=a.vote_id AND v.game_id=a.game_id
  WHERE a.game_id=p_game AND v.status='closed' AND v.result_code='passed'
   AND (sp.title ~* '(горизонт|выставк|накопител)' OR sp.expected_results ~* '(горизонт|выставк|накопител)')
  ORDER BY a.completed_at DESC NULLS LAST,a.created_at DESC LIMIT 1;
 ELSIF p_branch=7 THEN
  SELECT d.id,'formal_document','Опубликованный документ с завершённым законодательным голосованием: '||left(d.title,180)
  INTO v_id,v_kind,v_note
  FROM public.formal_documents d
  JOIN public.game_votes v ON v.formal_document_id=d.id AND v.game_id=d.game_id
  WHERE d.game_id=p_game AND d.stage_no=12 AND d.status_code='published'
    AND v.status='closed' AND v.result_code='passed'
    AND (d.title ~* '(горизонт|выставк)' OR d.body_text ~* '(горизонт|выставк)')
  ORDER BY d.updated_at DESC LIMIT 1;
 ELSIF p_branch=8 THEN
  SELECT d.id,'formal_document','Опубликованный бюджетный документ с подтверждённым голосованием'
  INTO v_id,v_kind,v_note
  FROM public.formal_documents d
  JOIN public.game_votes v ON v.formal_document_id=d.id AND v.game_id=d.game_id
  WHERE d.game_id=p_game AND d.stage_no=13 AND d.doc_type='federal_budget'
    AND d.status_code='published' AND v.status='closed' AND v.result_code='passed'
    AND d.body_text ~* '(горизонт|выставк)'
  ORDER BY d.updated_at DESC LIMIT 1;
 ELSIF p_branch=9 THEN
  SELECT p.id,'municipal_project','Принятый по результатам голосования муниципальный проект: '||left(p.problem_title,180)
  INTO v_id,v_kind,v_note
  FROM public.municipal_projects p
  JOIN public.game_votes v ON v.id=p.vote_id AND v.game_id=p.game_id
  WHERE p.game_id=p_game AND p.stage_no=14
   AND v.status='closed' AND v.result_code='passed'
  ORDER BY p.updated_at DESC LIMIT 1;
 END IF;
 RETURN jsonb_build_object('outcome',CASE WHEN v_id IS NULL THEN 'neutral' ELSE 'recorded' END,
  'kind',v_kind,'id',v_id,'note',coalesce(v_note,'Подтверждённого решения, относящегося к данной развилке, не обнаружено.'));
END $f$;

-- One episode, from the protected text library; precise ordered stage gate + official prerequisites.
CREATE OR REPLACE FUNCTION private.story_automation_episode(p_game uuid,p_episode integer,p_stage integer,p_author uuid,p_stage_completed boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
DECLARE c private.story_campaigns%rowtype;e private.story_episode_drafts%rowtype;
 r private.story_episode_releases%rowtype;
 v_title text;v_body text;v_epilogue text;v_post uuid;v_municipal boolean;
 v_guide jsonb;
BEGIN
 SELECT * INTO c FROM private.story_campaigns WHERE game_id=p_game;
 SELECT * INTO e FROM private.story_episode_drafts WHERE episode_no=p_episode;
 IF c.game_id IS NULL OR NOT c.auto_mode OR p_author IS NULL
  OR e.episode_no IS NULL OR e.stage_no<>p_stage OR c.current_episode+1<>p_episode THEN RETURN false; END IF;
 SELECT * INTO r FROM private.story_episode_releases WHERE game_id=p_game AND episode_no=p_episode;
 IF r.published_at IS NOT NULL THEN RETURN false; END IF;
 -- Do not pre-empt government decisions on the day an institutional stage opens.
 IF p_episode IN (10,15) AND NOT p_stage_completed THEN RETURN false; END IF;
 v_title:=coalesce(r.draft_title,e.draft->>'title');
 v_body:=coalesce(r.draft_body,e.draft->>'body');
 IF p_episode=10 AND NOT EXISTS(
  SELECT 1 FROM public.game_office_assignments
  WHERE game_id=p_game AND status='active' AND role_title ILIKE '%Президент%') THEN
  v_title:=e.draft->>'auto_neutral_title';
  v_body:=e.draft->>'auto_neutral_body';
 END IF;
 IF p_episode=21 AND NOT EXISTS(
  SELECT 1 FROM public.game_votes v JOIN public.formal_documents d
  ON d.id=v.formal_document_id AND d.game_id=v.game_id
  WHERE v.game_id=p_game AND v.stage_no=13 AND v.status='closed'
  AND d.doc_type='federal_budget') THEN
  v_title:=e.draft->>'auto_neutral_title';
  v_body:=e.draft->>'auto_neutral_body';
 END IF;
 IF p_episode=24 THEN
  SELECT EXISTS(SELECT 1 FROM public.municipal_projects p
    JOIN public.game_votes v ON v.id=p.vote_id AND v.game_id=p.game_id
    WHERE p.game_id=p_game AND p.stage_no=14 AND v.status='closed' AND v.result_code='passed')
  INTO v_municipal;
  IF NOT v_municipal THEN
   -- A missing decision must never be turned into a fictional success.
   SELECT variant->>'title',variant->>'body' INTO v_title,v_body
   FROM jsonb_array_elements(coalesce(e.draft->'variants','[]'::jsonb)) variant
   WHERE variant->>'id'='Г' LIMIT 1;
   IF v_title IS NULL OR v_body IS NULL THEN RETURN false; END IF;
  END IF;
  SELECT s.draft_body INTO v_epilogue FROM private.story_supplement_releases s
  WHERE s.game_id=p_game AND s.code='К-30'
    AND s.approved_at IS NOT NULL AND s.published_at IS NULL;
  IF length(btrim(coalesce(v_epilogue,'')))>=80
    AND position(v_epilogue in v_body)=0 THEN
   v_body:=v_body||E'\n\n'||v_epilogue;
  ELSE v_epilogue:=NULL;
  END IF;
 END IF;
 IF length(btrim(coalesce(v_title,''))) NOT BETWEEN 12 AND 220
  OR length(btrim(coalesce(v_body,''))) NOT BETWEEN 80 AND 9000
  OR v_body ~ '@[[:alpha:]0-9_]' THEN RETURN false; END IF;
 v_guide:=CASE WHEN jsonb_typeof(e.draft->'student_guide')='object'
  THEN e.draft->'student_guide' ELSE '{}'::jsonb END;
 INSERT INTO public.political_posts(game_id,author_id,process_type,actor_key,actor_label,
  title,body,tags,source_key,context,status,impact_plan,effects_applied)
 VALUES(p_game,p_author,'news','system','ГОС.ID · Сюжетная хроника',
  v_title,v_body,ARRAY['Сюжет','Горизонты Республики'],
  'story_episode:'||lpad(p_episode::text,2,'0'),
  jsonb_build_object('automatic',true,'source_table','story_campaign','story_campaign',true,
   'story_episode',p_episode,'story_stage',p_stage,'story_guide',v_guide),
  'published','{"metrics":{}}'::jsonb,false)
 ON CONFLICT(game_id,source_key) WHERE source_key IS NOT NULL DO NOTHING
 RETURNING id INTO v_post;
 IF v_post IS NULL THEN RETURN false; END IF;
 INSERT INTO private.story_episode_releases(game_id,episode_no,
  approved_by,approved_at,published_by,published_at,published_post_id,automatic_publication)
 VALUES(p_game,p_episode,p_author,now(),p_author,now(),v_post,true)
 ON CONFLICT(game_id,episode_no) DO UPDATE SET
  approved_by=coalesce(private.story_episode_releases.approved_by,excluded.approved_by),
  approved_at=coalesce(private.story_episode_releases.approved_at,excluded.approved_at),
  published_by=excluded.published_by,published_at=excluded.published_at,
  published_post_id=excluded.published_post_id,automatic_publication=true
 WHERE private.story_episode_releases.published_at IS NULL;
 IF p_episode=24 AND v_epilogue IS NOT NULL THEN
  UPDATE private.story_supplement_releases SET published_post_id=v_post,
   published_at=now(),published_by=p_author
  WHERE game_id=p_game AND code='К-30' AND approved_at IS NOT NULL AND published_at IS NULL;
 END IF;
 UPDATE private.story_campaigns SET current_episode=p_episode,updated_at=now(),
  enabled=CASE WHEN p_episode=24 THEN false ELSE enabled END,
  automation_error=NULL WHERE game_id=p_game;
 RETURN true;
END $f$;

-- Verified outcome is computed automatically, no manual UUID hunting or narrative hallucination.
CREATE OR REPLACE FUNCTION private.story_automation_branch(p_game uuid,p_branch smallint,p_author uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
DECLARE v_rule private.story_branch_rules%rowtype;
 v_review private.story_branch_reviews%rowtype;v_source jsonb;v_outcome text;
 v_kind text;v_id uuid;v_note text;v_title text;v_body text;v_post uuid;
BEGIN
 SELECT * INTO v_rule FROM private.story_branch_rules WHERE branch_no=p_branch;
 IF v_rule.branch_no IS NULL OR p_author IS NULL THEN RETURN false;END IF;
 SELECT * INTO v_review FROM private.story_branch_reviews
 WHERE game_id=p_game AND branch_no=p_branch FOR UPDATE;
 IF v_review.published_at IS NOT NULL THEN RETURN true;END IF;
 v_source:=private.story_automation_source(p_game,p_branch);
 v_outcome:=v_source->>'outcome';
 v_kind:=v_source->>'kind';
 v_id:=NULLIF(v_source->>'id','')::uuid;
 v_note:=v_source->>'note';
 IF v_review.outcome='recorded' AND
  private.story_supplement_evidence_exists(p_game,v_review.evidence_kind,v_review.evidence_id) THEN
  v_outcome:='recorded';v_kind:=v_review.evidence_kind;v_id:=v_review.evidence_id;
  v_note:=v_review.teacher_note;
 ELSIF v_review.outcome='neutral' AND NOT v_review.automatic_review THEN
  v_outcome:='neutral';v_kind:=NULL;v_id:=NULL;v_note:=v_review.teacher_note;
 END IF;
 INSERT INTO private.story_branch_reviews(game_id,branch_no,outcome,
  evidence_kind,evidence_id,teacher_note,reviewed_by,reviewed_at,automatic_review)
 VALUES(p_game,p_branch,v_outcome,v_kind,v_id,coalesce(v_note,''),p_author,now(),true)
 ON CONFLICT(game_id,branch_no) DO UPDATE SET
   outcome=excluded.outcome,evidence_kind=excluded.evidence_kind,
   evidence_id=excluded.evidence_id,teacher_note=excluded.teacher_note,
   reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at,
   automatic_review=true WHERE private.story_branch_reviews.published_at IS NULL;
 SELECT * INTO v_review FROM private.story_branch_reviews WHERE game_id=p_game AND branch_no=p_branch;
 v_title:=coalesce(v_review.edited_title,'Горизонты: '||v_rule.title);
 v_body:=coalesce(v_review.edited_body,
  CASE WHEN v_review.outcome='recorded' THEN v_rule.recorded_body ELSE v_rule.neutral_body END);
 IF length(btrim(coalesce(v_title,''))) NOT BETWEEN 12 AND 220
  OR length(btrim(coalesce(v_body,''))) NOT BETWEEN 80 AND 9000
  OR v_body ~ '@[[:alpha:]0-9_]' THEN RETURN false;END IF;
 INSERT INTO public.political_posts(game_id,author_id,process_type,actor_key,actor_label,
  title,body,tags,source_key,context,status,impact_plan,effects_applied)
 VALUES(p_game,p_author,'news','system','ГОС.ID · Сюжетная хроника',
  v_title,v_body,ARRAY['Сюжет','Горизонты Республики','Реакция'],
  'story_branch:'||lpad(p_branch::text,2,'0'),
  jsonb_build_object('automatic',true,'source_table','story_campaign',
   'story_campaign',true,'story_branch',p_branch,'story_stage',
   (SELECT stage_no FROM private.story_episode_drafts WHERE episode_no=v_rule.last_episode),
   'evidence_kind',v_review.evidence_kind,'evidence_id',v_review.evidence_id),
  'published','{"metrics":{}}'::jsonb,false)
 ON CONFLICT(game_id,source_key) WHERE source_key IS NOT NULL DO NOTHING
 RETURNING id INTO v_post;
 IF v_post IS NULL THEN RETURN false;END IF;
 UPDATE private.story_branch_reviews SET published_at=now(),published_post_id=v_post
 WHERE game_id=p_game AND branch_no=p_branch AND published_at IS NULL;
 RETURN true;
END $f$;

CREATE OR REPLACE FUNCTION private.story_automation_on_stage(p_game uuid,p_stage integer,p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
DECLARE c private.story_campaigns%rowtype;
 e record;b record;v_author uuid;v_first integer;v_ok boolean;
BEGIN
 IF p_stage NOT BETWEEN 4 AND 14 OR p_status NOT IN ('open','completed') THEN RETURN;END IF;
 SELECT * INTO c FROM private.story_campaigns WHERE game_id=p_game FOR UPDATE;
 IF c.game_id IS NULL OR NOT c.auto_mode OR c.current_episode>=24 THEN RETURN;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.electoral_calculator_results
  WHERE game_id=p_game AND published IS TRUE) THEN
  UPDATE private.story_campaigns SET automation_error='Нет опубликованных результатов выборов Государственной Думы.'
  WHERE game_id=p_game;
  RETURN;
 END IF;
 SELECT owner_id INTO v_author FROM public.games WHERE id=p_game;
 IF v_author IS NULL THEN RETURN;END IF;
 UPDATE private.story_campaigns SET enabled=true WHERE game_id=p_game AND enabled=false;
 SELECT min(episode_no) INTO v_first FROM private.story_episode_drafts WHERE stage_no=p_stage;
 IF v_first IS NULL THEN RETURN;END IF;
 IF p_status='open' THEN
  -- At most one introductory news item on opening; the rest on completion.
  IF c.current_episode+1=v_first THEN
   PERFORM private.story_automation_episode(p_game,v_first,p_stage,v_author,false);
  END IF;
  RETURN;
 END IF;
 FOR e IN SELECT episode_no FROM private.story_episode_drafts
  WHERE stage_no=p_stage ORDER BY episode_no LOOP
  SELECT current_episode INTO c.current_episode FROM private.story_campaigns WHERE game_id=p_game;
  IF c.current_episode>=e.episode_no THEN CONTINUE;END IF;
  IF c.current_episode+1<>e.episode_no THEN
   UPDATE private.story_campaigns SET automation_error=
    format('Пропущен более ранний выпуск перед № %s. Проверьте хронологию.',e.episode_no)
    WHERE game_id=p_game;RETURN;
  END IF;
  v_ok:=private.story_automation_episode(p_game,e.episode_no,p_stage,v_author,true);
  IF NOT v_ok THEN
   UPDATE private.story_campaigns SET automation_error=
    format('Выпуск № %s ожидает подтверждённого решения или допустимой редакции.',e.episode_no)
    WHERE game_id=p_game;RETURN;
  END IF;
 END LOOP;
 FOR b IN SELECT rule.branch_no FROM private.story_branch_rules rule
  JOIN private.story_episode_drafts last_e ON last_e.episode_no=rule.last_episode
  WHERE last_e.stage_no=p_stage ORDER BY rule.branch_no LOOP
  v_ok:=private.story_automation_branch(p_game,b.branch_no,v_author);
  IF NOT v_ok THEN
   UPDATE private.story_campaigns SET automation_error=
    format('Сюжетная реакция № %s не опубликована: проверьте текст.',b.branch_no)
    WHERE game_id=p_game;RETURN;
  END IF;
 END LOOP;
 UPDATE private.story_campaigns SET automation_error=NULL WHERE game_id=p_game;
END $f$;

CREATE OR REPLACE FUNCTION private.story_automation_stage_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
BEGIN
 IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.stage_no NOT BETWEEN 4 AND 14
  OR NEW.status NOT IN ('open','completed') THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM private.story_campaigns
   WHERE game_id=NEW.game_id AND auto_mode=true) THEN RETURN NEW; END IF;
 BEGIN
  PERFORM private.story_automation_on_stage(NEW.game_id,NEW.stage_no,NEW.status);
 EXCEPTION WHEN OTHERS THEN
  -- Never break the official stage transition for an optional editorial feature.
  UPDATE private.story_campaigns SET automation_error=left(SQLERRM,320)
  WHERE game_id=NEW.game_id;
 END;
 RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS zz_story_automation_stage_transition ON public.game_stages;
CREATE TRIGGER zz_story_automation_stage_transition
AFTER UPDATE OF status ON public.game_stages
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.stage_no BETWEEN 4 AND 14
 AND NEW.status IN ('open','completed'))
EXECUTE FUNCTION private.story_automation_stage_trigger();

-- The only teacher toggle; enabling on an already-open stage makes one bounded catch-up attempt.
CREATE OR REPLACE FUNCTION public.set_story_automation_teacher(p_game_id uuid,p_enabled boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
DECLARE v_stage integer;
BEGIN
 IF auth.uid() IS NULL OR NOT private.is_game_teacher(p_game_id) THEN
  RAISE EXCEPTION 'Доступ разрешён только преподавателю игры.' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM private.story_campaigns WHERE game_id=p_game_id) THEN
  RAISE EXCEPTION 'Сюжетная кампания не подготовлена.';
 END IF;
 UPDATE private.story_campaigns SET auto_mode=coalesce(p_enabled,false),
  enabled=CASE WHEN p_enabled THEN enabled ELSE false END,updated_at=now(),
  automation_error=CASE WHEN p_enabled THEN NULL ELSE automation_error END
 WHERE game_id=p_game_id;
 IF p_enabled THEN
  SELECT g.current_round INTO v_stage FROM public.games g WHERE g.id=p_game_id;
  IF v_stage BETWEEN 4 AND 14 AND EXISTS(
   SELECT 1 FROM public.game_stages s WHERE s.game_id=p_game_id
    AND s.stage_no=v_stage AND s.status='open') THEN
   PERFORM private.story_automation_on_stage(p_game_id,v_stage,'open');
  END IF;
 END IF;
 RETURN public.get_story_campaign_teacher(p_game_id);
END $f$;

REVOKE ALL ON FUNCTION private.story_automation_source(uuid,smallint),
 private.story_automation_episode(uuid,integer,integer,uuid,boolean),
 private.story_automation_branch(uuid,smallint,uuid),
 private.story_automation_on_stage(uuid,integer,text),
 private.story_automation_stage_trigger() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.set_story_automation_teacher(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_story_automation_teacher(uuid,boolean) TO authenticated;
