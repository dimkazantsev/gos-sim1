-- Teacher-only, transaction-scoped selective stage reset.
-- Preserve legacy all-stage status-only reset; never change data in other games.
CREATE OR REPLACE FUNCTION public.reset_game_stage_progress(p_game_id uuid, p_stage_no integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
 v_count integer:=0; v_target_id uuid; v_game_round integer; v_was_open boolean:=false;
 v_vote_ids uuid[]:='{}'::uuid[];v_doc_ids uuid[]:='{}'::uuid[];
 v_post_ids uuid[]:='{}'::uuid[];v_election_ids uuid[]:='{}'::uuid[];
 v_impact_id bigint;v_metric record;v_value numeric;v_reverted integer:=0;
BEGIN
 IF p_game_id IS NULL OR NOT private.is_game_teacher(p_game_id) THEN
  RAISE EXCEPTION 'Teacher access required' USING ERRCODE='42501';
 END IF;
 IF p_stage_no IS NOT NULL AND p_stage_no NOT BETWEEN 1 AND 16 THEN
  RAISE EXCEPTION 'Stage must be between 1 and 16' USING ERRCODE='22023';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('stage-control:'||p_game_id::text,0));
 SELECT current_round INTO v_game_round FROM public.games WHERE id=p_game_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Game does not exist'; END IF;
 IF p_stage_no IS NULL THEN
  UPDATE public.game_stages SET status='locked',opened_at=NULL,completed_at=NULL,
   deadline=NULL,score_closed_at=NULL WHERE game_id=p_game_id;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  DELETE FROM public.stage_deadline_rules WHERE game_id=p_game_id;
  UPDATE public.games SET current_round=1,turn_open=false,turn_ends_at=NULL,status='paused' WHERE id=p_game_id;
  INSERT INTO public.audit_log(game_id,actor_id,action,entity_type,payload)
  VALUES(p_game_id,auth.uid(),'all_stage_progress_reset','game_stages',
    jsonb_build_object('stage_no',NULL,'affected_stages',v_count,'preserves_work',true));
  RETURN v_count;
 END IF;
 SELECT id,status='open' INTO v_target_id,v_was_open
 FROM public.game_stages WHERE game_id=p_game_id AND stage_no=p_stage_no FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Stage does not exist'; END IF;
 SELECT COALESCE(array_agg(id),'{}'::uuid[]) INTO v_vote_ids
 FROM public.game_votes WHERE game_id=p_game_id AND stage_no=p_stage_no;
 SELECT COALESCE(array_agg(id),'{}'::uuid[]) INTO v_doc_ids
 FROM public.formal_documents WHERE game_id=p_game_id AND stage_no=p_stage_no;
 SELECT COALESCE(array_agg(id),'{}'::uuid[]) INTO v_post_ids
 FROM public.political_posts WHERE game_id=p_game_id AND context->>'stage_no'=p_stage_no::text;
 SELECT COALESCE(array_agg(id),'{}'::uuid[]) INTO v_election_ids
 FROM public.office_elections WHERE game_id=p_game_id AND stage_no=p_stage_no;
 -- Reverse linked impacts before deleting their parent records.
 FOR v_impact_id IN
  SELECT l.id FROM public.impact_ledger l
  WHERE l.game_id=p_game_id AND l.status IS DISTINCT FROM 'reverted'
   AND ((l.source_type='vote' AND l.source_id=ANY(SELECT unnest(v_vote_ids)::text))
    OR (l.source_type='political_post' AND l.source_id=ANY(SELECT unnest(v_post_ids)::text))
    OR (l.source_type='formal_history' AND EXISTS(
      SELECT 1 FROM public.formal_document_history h
       WHERE h.game_id=p_game_id AND h.document_id=ANY(v_doc_ids)
       AND h.id::text=l.source_id)))
  ORDER BY l.id DESC
 LOOP
  PERFORM public.revert_impact_entry(v_impact_id);
  v_reverted:=v_reverted+1;
 END LOOP;
 -- Authority-evidence metric changes are outside impact_ledger.
 FOR v_metric IN
  SELECT h.metric_key,SUM(h.delta) AS amount FROM public.state_metric_history h
  WHERE h.game_id=p_game_id AND h.source_type='event_authority'
    AND EXISTS(SELECT 1 FROM public.event_authority_evidence e
      WHERE e.game_id=p_game_id AND e.stage_no=p_stage_no AND h.source_id=e.decision_id::text)
  GROUP BY h.metric_key
 LOOP
  SELECT value INTO v_value FROM public.state_metrics
    WHERE game_id=p_game_id AND metric_key=v_metric.metric_key FOR UPDATE;
  IF FOUND AND v_metric.amount<>0 THEN
   PERFORM private.record_metric_change(p_game_id,v_metric.metric_key,
    v_value-v_metric.amount,'stage_reset',v_target_id::text,auth.uid(),
    'Отмена эффекта решения этапа '||p_stage_no);
  END IF;
 END LOOP;
 -- State programs from the previous stage survive, but their approval does not.
 UPDATE public.state_program_budget_commitments c SET status='planned'
 WHERE c.game_id=p_game_id AND c.program_id IN (
  SELECT id FROM public.state_programs WHERE game_id=p_game_id
  AND stage_no<>p_stage_no AND government_vote_id=ANY(v_vote_ids));
 UPDATE public.state_programs SET status='ready',government_vote_id=NULL,
  signed_by=NULL,signed_at=NULL,publication_post_id=NULL
 WHERE game_id=p_game_id AND stage_no<>p_stage_no AND government_vote_id=ANY(v_vote_ids);
 -- Remove office roles created by completed elections belonging to this stage.
 DELETE FROM public.game_office_assignments a USING public.office_elections e,public.office_candidates c
 WHERE e.id=ANY(v_election_ids) AND e.game_id=p_game_id
  AND c.id=e.winner_candidate_id AND c.election_id=e.id
  AND a.game_id=p_game_id AND a.user_id=c.user_id
  AND a.legal_basis='Избран решением Государственной Думы'
  AND a.role_title=(CASE e.office_key
   WHEN 'gd_chair' THEN 'Председатель Государственной Думы'
   WHEN 'gd_deputy_1' THEN 'Заместитель Председателя Государственной Думы №1'
   WHEN 'gd_deputy_2' THEN 'Заместитель Председателя Государственной Думы №2'
   ELSE e.office_title END);
 UPDATE public.game_members m SET role_title=NULL FROM public.government_nominations n
 WHERE n.game_id=p_game_id AND n.stage_no=p_stage_no AND n.office_kind='central_bank_chair'
  AND n.status='appointed' AND n.candidate_user_id=m.user_id
  AND m.game_id=p_game_id AND m.role_title=n.office_title;
 -- Remove stage documents and their dependent amendments.
 DELETE FROM public.political_decisions WHERE game_id=p_game_id AND vote_id=ANY(v_vote_ids);
 DELETE FROM public.bill_amendment_packs WHERE game_id=p_game_id AND document_id=ANY(v_doc_ids);
 DELETE FROM public.bill_amendments WHERE game_id=p_game_id AND document_id=ANY(v_doc_ids);
 DELETE FROM public.budget_law_amendment_packs WHERE game_id=p_game_id AND document_id=ANY(v_doc_ids);
 DELETE FROM public.budget_law_amendments WHERE game_id=p_game_id AND document_id=ANY(v_doc_ids);
 DELETE FROM public.duma_sessions WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.government_sessions WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.institution_session_registrations WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.institution_meeting_records WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.formal_documents WHERE game_id=p_game_id AND stage_no=p_stage_no;
 -- Undo references which would otherwise retain a cancelled vote.
 UPDATE public.bill_amendment_packs SET vote_id=NULL WHERE game_id=p_game_id AND vote_id=ANY(v_vote_ids);
 UPDATE public.bill_amendments SET vote_id=NULL WHERE game_id=p_game_id AND vote_id=ANY(v_vote_ids);
 UPDATE public.budget_law_amendment_packs SET vote_id=NULL WHERE game_id=p_game_id AND vote_id=ANY(v_vote_ids);
 UPDATE public.budget_law_amendments SET vote_id=NULL WHERE game_id=p_game_id AND vote_id=ANY(v_vote_ids);
 UPDATE public.budget_faction_amendments SET vote_id=NULL WHERE game_id=p_game_id AND vote_id=ANY(v_vote_ids);
 DELETE FROM public.game_votes WHERE game_id=p_game_id AND stage_no=p_stage_no;
 -- The ballot rows follow the vote's ON DELETE CASCADE foreign key.
 DELETE FROM public.office_elections WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.government_nominations WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.state_programs WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.municipal_projects WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.presidential_addresses WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.presidential_public_polls WHERE game_id=p_game_id AND round_no=p_stage_no;
 DELETE FROM public.presidential_scorecards WHERE game_id=p_game_id AND round_no=p_stage_no;
 DELETE FROM public.presidential_teacher_ballots WHERE game_id=p_game_id AND round_no=p_stage_no;
 DELETE FROM public.ghost_voting_rounds WHERE game_id=p_game_id AND stage_no=p_stage_no;
 IF p_stage_no=7 THEN
  DELETE FROM public.presidential_poll_decision_votes WHERE game_id=p_game_id;
  DELETE FROM public.presidential_poll_decision WHERE game_id=p_game_id;
  DELETE FROM public.presidential_student_system_votes WHERE game_id=p_game_id;
  DELETE FROM public.presidential_student_system_result WHERE game_id=p_game_id;
  DELETE FROM public.presidential_teacher_jury_scores WHERE game_id=p_game_id;
 ELSIF p_stage_no=14 THEN
  DELETE FROM public.municipal_mayor_elections WHERE game_id=p_game_id;
 END IF;
 DELETE FROM public.game_crises WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.event_authority_evidence WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.budget_scenarios WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.stage_assessments WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.game_evaluations WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.stage_debriefs WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.stage_final_document_obligations WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.stage_deadline_incidents WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.stage_deadline_rules WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.stage_readiness_overrides WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.blitz_assignments WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.blitz_daily_plans WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.player_actions WHERE game_id=p_game_id AND round_no=p_stage_no;
 DELETE FROM public.missions WHERE game_id=p_game_id AND round_no=p_stage_no;
 DELETE FROM public.rounds WHERE game_id=p_game_id AND round_no=p_stage_no;
 DELETE FROM public.game_events WHERE game_id=p_game_id AND round_no=p_stage_no;
 DELETE FROM public.republic_comic_chapters WHERE game_id=p_game_id AND stage_no=p_stage_no;

 -- Remove stage storyline releases and unlink external references before deleting posts.
 DELETE FROM private.story_episode_releases r WHERE r.game_id=p_game_id
  AND EXISTS(SELECT 1 FROM private.story_episode_drafts d
    WHERE d.episode_no=r.episode_no AND d.stage_no=p_stage_no);
 UPDATE private.story_branch_reviews SET published_post_id=NULL,published_at=NULL
  WHERE game_id=p_game_id AND published_post_id=ANY(v_post_ids);
 UPDATE private.story_supplement_releases SET published_post_id=NULL,
   published_at=NULL,published_by=NULL
  WHERE game_id=p_game_id AND published_post_id=ANY(v_post_ids);
 UPDATE private.story_episode_releases SET published_post_id=NULL,
   published_at=NULL,published_by=NULL
  WHERE game_id=p_game_id AND published_post_id=ANY(v_post_ids);
 UPDATE public.media_news_proposals SET post_id=NULL
  WHERE game_id=p_game_id AND post_id=ANY(v_post_ids);
 DELETE FROM public.political_posts p WHERE
  p.game_id=p_game_id
  AND p.context->>'source_table'='rating_history'
  AND EXISTS(SELECT 1 FROM unnest(v_vote_ids) v(id)
   WHERE p.source_key LIKE 'rating-batch:%:'||v.id::text);
 DELETE FROM public.political_posts WHERE game_id=p_game_id
  AND context->>'stage_no'=p_stage_no::text;
 UPDATE public.game_stages SET status='locked',opened_at=NULL,completed_at=NULL,
  deadline=NULL,score_closed_at=NULL WHERE id=v_target_id;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 -- Recompute clock when another stage is open; never stop its timer.
 UPDATE public.games g SET
  turn_open=EXISTS(SELECT 1 FROM public.game_stages s WHERE s.game_id=p_game_id AND s.status='open'),
  turn_ends_at=(SELECT MIN(deadline) FROM public.game_stages s WHERE s.game_id=p_game_id AND s.status='open'),
  status=CASE WHEN EXISTS(SELECT 1 FROM public.game_stages s WHERE s.game_id=p_game_id AND s.status='open')
   THEN 'running' ELSE 'paused' END WHERE g.id=p_game_id;
 INSERT INTO public.audit_log(game_id,actor_id,action,entity_type,entity_id,payload)
 VALUES(p_game_id,auth.uid(),'stage_content_reset','game_stages',v_target_id,
  jsonb_build_object('stage_no',p_stage_no,'affected_stages',v_count,
   'votes_deleted',cardinality(v_vote_ids),'documents_deleted',cardinality(v_doc_ids),
   'impacts_reverted',v_reverted,'preserves_work',false));
 RETURN v_count;
END;
$function$

REVOKE ALL ON FUNCTION public.reset_game_stage_progress(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reset_game_stage_progress(uuid,integer) TO authenticated;
