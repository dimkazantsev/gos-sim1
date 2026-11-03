-- Teacher-only factual summary is returned in the existing manual preview RPC.
-- No cron, triggers, new sockets, extra HTTP requests, metric/grade effects.
CREATE OR REPLACE FUNCTION public.get_story_episode_preview_teacher(p_game_id uuid,p_episode_no integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_preview jsonb;v_evidence jsonb:='{}'::jsonb;v_records jsonb:='[]'::jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT private.is_game_teacher(p_game_id) THEN
  RAISE EXCEPTION 'Доступ разрешён только преподавателю игры.' USING ERRCODE='42501';
 END IF;
 IF p_episode_no=15 THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object(
   'vote_status',x.vote_status,'vote_result',x.vote_result,'program_status',x.program_status)
   ORDER BY x.vote_status),'[]'::jsonb) INTO v_records
  FROM (
   SELECT a.status program_status,v.status vote_status,coalesce(v.result_label,'Результат не указан') vote_result
   FROM public.government_program_agenda a
   JOIN public.game_votes v ON v.id=a.vote_id AND v.game_id=a.game_id
   WHERE a.game_id=p_game_id ORDER BY a.created_at DESC LIMIT 20
  ) x;
  v_evidence:=jsonb_build_object('kind','government_program','records',v_records,
   'warning','Отображаются только голосования, связанные с повесткой государственных программ. Без подписанного решения нельзя утверждать принятие ГП.');
 ELSIF p_episode_no=21 THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object(
   'document_status',x.doc_status,'vote_status',x.vote_status,'vote_result',x.vote_result)
   ORDER BY x.vote_status),'[]'::jsonb) INTO v_records
  FROM (
   SELECT d.status_code doc_status,v.status vote_status,
    coalesce(v.result_label,'Результат не указан') vote_result
   FROM public.game_votes v
   JOIN public.formal_documents d ON d.id=v.formal_document_id
   WHERE v.game_id=p_game_id AND v.stage_no=13 AND d.game_id=p_game_id
    AND d.doc_type='federal_budget'
   ORDER BY v.created_at DESC LIMIT 10
  ) x;
  v_evidence:=jsonb_build_object('kind','federal_budget','records',v_records,
    'warning','Показаны только голоса по официальному документу бюджета. Закрытие голосования само по себе не равно вступившему в силу закону.');
 ELSIF p_episode_no=24 THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object(
   'project_status',x.project_status,'vote_status',x.vote_status,'vote_result',x.vote_result)
   ORDER BY x.project_status),'[]'::jsonb) INTO v_records
  FROM (
   SELECT p.status project_status,coalesce(v.status,'Не проводилось') vote_status,
    coalesce(v.result_label,'Результат не указан') vote_result
   FROM public.municipal_projects p
   LEFT JOIN public.game_votes v ON v.id=p.vote_id AND v.game_id=p.game_id
   WHERE p.game_id=p_game_id AND p.stage_no=14
   ORDER BY p.created_at DESC LIMIT 10
  ) x;
  v_evidence:=jsonb_build_object('kind','municipal','records',v_records,
   'warning','Финал А, Б или В возможен только по подтверждённым документам ОГВ. Если данных недостаточно, выбирается нейтральный финал Г.');
 END IF;
 SELECT jsonb_build_object('episode_no',e.episode_no,'stage_no',e.stage_no,
   'title',coalesce(r.draft_title,e.draft->>'title'),
   'body',coalesce(r.draft_body,e.draft->>'body'),
   'editor_note',coalesce(e.draft->>'editor_note',''),
   'evidence_rule',coalesce(e.draft->>'evidence_rule',''),
   'variants',coalesce(e.draft->'variants','[]'::jsonb),
   'evidence',v_evidence,
   'approved',r.approved_at IS NOT NULL,'published',r.published_at IS NOT NULL)
 INTO v_preview FROM private.story_episode_drafts e
 LEFT JOIN private.story_episode_releases r
  ON r.game_id=p_game_id AND r.episode_no=e.episode_no
 WHERE e.episode_no=p_episode_no;
 RETURN v_preview;
END $fn$;
REVOKE ALL ON FUNCTION public.get_story_episode_preview_teacher(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_story_episode_preview_teacher(uuid,integer) TO authenticated;

-- Keep the teacher's edited headline in the compact episode index.
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
 SELECT coalesce(jsonb_agg(jsonb_build_object('episode_no',e.episode_no,
  'stage_no',e.stage_no,'title',coalesce(rel.draft_title,e.draft->>'title'),
  'loaded',(length(btrim(e.draft->>'body'))>0),'approved',rel.approved_at IS NOT NULL,
  'published',rel.published_at IS NOT NULL) ORDER BY e.episode_no),'[]'::jsonb)
 INTO v_items FROM private.story_episode_drafts e
 LEFT JOIN private.story_episode_releases rel
  ON rel.game_id=p_game_id AND rel.episode_no=e.episode_no;
 RETURN jsonb_build_object('prepared',r.game_id IS NOT NULL,'enabled',coalesce(r.enabled,false),
  'current_episode',coalesce(r.current_episode,0),'approved_episodes',a,
  'published_episodes',pub,'loaded_episodes',n,'total_episodes',24,
  'metrics_enabled',false,'publication_enabled',coalesce(r.enabled,false),'episodes',v_items);
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
  'stage_no',e.stage_no,'title',coalesce(r.draft_title,e.draft->>'title'),
  'loaded',(length(btrim(e.draft->>'body'))>0),'approved',r.approved_at IS NOT NULL,
  'published',r.published_at IS NOT NULL,'published_post_id',r.published_post_id)
  ORDER BY e.episode_no),'[]'::jsonb) INTO items
 FROM private.story_episode_drafts e
 LEFT JOIN private.story_episode_releases r
  ON r.game_id=p_game_id AND r.episode_no=e.episode_no;
 RETURN items;
END $fn$;

