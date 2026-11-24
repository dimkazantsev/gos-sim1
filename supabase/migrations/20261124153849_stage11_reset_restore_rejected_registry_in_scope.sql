CREATE OR REPLACE FUNCTION private.guard_formal_document_kind_route()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE v_expected text;v_kind text;
BEGIN
 v_expected:=CASE NEW.doc_type
  WHEN 'fz_bill' THEN 'bill' WHEN 'fkz_bill' THEN 'bill'
  WHEN 'federal_budget' THEN 'budget'
  WHEN 'president_decree' THEN 'president_act'
  WHEN 'president_order' THEN 'president_act'
  WHEN 'government_resolution' THEN 'government_act'
  WHEN 'government_order' THEN 'government_act'
  WHEN 'state_program' THEN 'government_act'
  WHEN 'gd_resolution' THEN 'gd_resolution'
  WHEN 'sf_resolution' THEN 'sf_resolution'
  WHEN 'ministry_order' THEN 'ministry_act'
  WHEN 'municipal_act' THEN 'municipal_act'
  WHEN 'bank_rate_decision' THEN 'bank_rate'
  WHEN 'other' THEN 'generic'
  WHEN 'justice_response' THEN 'official_correspondence'
  WHEN 'party_certificate' THEN 'official_correspondence'
  ELSE NULL
 END;
 v_kind:=coalesce(NEW.metadata->>'document_kind','');
 IF v_expected IS NOT NULL AND NEW.workflow_key IS DISTINCT FROM v_expected THEN
  RAISE EXCEPTION 'Вид документа не соответствует установленному маршруту рассмотрения'
    USING ERRCODE='23514';
 END IF;
 -- Institution-generated agendas and minutes use the dedicated meeting RPC.
 IF NEW.doc_type IN ('meeting_agenda','minutes') THEN
  IF v_kind NOT IN ('institution_meeting_agenda','duma_session_agenda','institution_meeting_minutes','government_session_agenda')
    OR NEW.workflow_key NOT IN ('gd_resolution','government_act')
    OR (v_kind='government_session_agenda' AND NOT (
       NEW.doc_type='meeting_agenda' AND NEW.workflow_key='government_act'
       AND NEW.subject_key='government' AND NEW.stage_no=11
       AND NEW.metadata->>'government_session_id'=nullif(current_setting('app.gos_government_agenda_session',true),'')
       AND EXISTS (select 1 from public.government_sessions s
        where s.id=(NEW.metadata->>'government_session_id')::uuid and s.game_id=NEW.game_id)
    ))
  THEN
   RAISE EXCEPTION 'Документы заседания оформляются только установленной процедурой'
     USING ERRCODE='23514';
  END IF;
 END IF;
 -- The old technical type "bill" may appear in history but must not be
 -- used to introduce a NEW legislative document.
 IF NEW.workflow_key='bill' AND NEW.doc_type NOT IN ('fz_bill','fkz_bill') THEN
  IF NOT (TG_OP='UPDATE' AND OLD.doc_type='bill'
   AND NEW.doc_type='bill' AND NEW.metadata->>'purpose'='presidential_electoral_system') THEN
   RAISE EXCEPTION 'Законодательный маршрут доступен только для ФЗ и ФКЗ'
     USING ERRCODE='23514';
  END IF;
 END IF;
 IF TG_OP='UPDATE' AND OLD.status_code IN ('rejected','superseded','withdrawn')
   AND auth.uid() IS NOT NULL
   AND (NEW.status_code IS DISTINCT FROM OLD.status_code
     OR NEW.current_step IS DISTINCT FROM OLD.current_step
     OR NEW.current_owner_key IS DISTINCT FROM OLD.current_owner_key
     OR NEW.doc_type IS DISTINCT FROM OLD.doc_type
     OR NEW.workflow_key IS DISTINCT FROM OLD.workflow_key
     OR NEW.workflow_steps IS DISTINCT FROM OLD.workflow_steps)
 THEN
  IF OLD.doc_type='state_program' AND OLD.stage_no=10 AND OLD.status_code='rejected'
    AND NEW.status_code='agenda' AND OLD.metadata->>'auto_synced'='true'
    AND private.is_game_teacher(OLD.game_id)
    AND current_setting('app.gos_stage11_reset_scope',true)=OLD.game_id::text
    AND current_setting('app.gos_stage11_registry_status_id',true)=OLD.id::text
    AND (to_jsonb(NEW)-ARRAY['status_code','status_label','current_owner_key','current_step','updated_at']) IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['status_code','status_label','current_owner_key','current_step','updated_at'])
    AND EXISTS(SELECT 1 FROM public.state_programs p WHERE p.game_id=OLD.game_id AND p.id::text=OLD.metadata->>'state_program_id' AND p.status='ready' AND p.government_vote_id IS NULL AND p.signed_at IS NULL)
  THEN RETURN NEW;END IF;
  RAISE EXCEPTION 'Отклонённый документ окончателен. Возобновление процедуры запрещено'
    USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END;$function$
;
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
 v_impact_id bigint;v_party_id uuid;v_metric record;v_value numeric;v_reverted integer:=0;
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
 FROM public.formal_documents WHERE game_id=p_game_id AND stage_no=p_stage_no
  AND coalesce(metadata->>'registry_independent','false')<>'true';
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
 IF p_stage_no=11 THEN PERFORM set_config('app.gos_stage11_reset_scope',p_game_id::text,true);END IF;
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

 IF p_stage_no=6 THEN
   DELETE FROM public.presidential_election_schedule WHERE game_id=p_game_id
      AND appointment_document_id=ANY(v_doc_ids);
 END IF;
 -- Undo references which would otherwise retain a cancelled vote.
 UPDATE public.bill_amendment_packs SET vote_id=NULL WHERE game_id=p_game_id AND vote_id=ANY(v_vote_ids);
 UPDATE public.bill_amendments SET vote_id=NULL WHERE game_id=p_game_id AND vote_id=ANY(v_vote_ids);
 UPDATE public.budget_law_amendment_packs SET vote_id=NULL WHERE game_id=p_game_id AND vote_id=ANY(v_vote_ids);
 UPDATE public.budget_law_amendments SET vote_id=NULL WHERE game_id=p_game_id AND vote_id=ANY(v_vote_ids);
 UPDATE public.budget_faction_amendments SET vote_id=NULL WHERE game_id=p_game_id AND vote_id=ANY(v_vote_ids);
 DELETE FROM public.game_votes WHERE game_id=p_game_id AND stage_no=p_stage_no;
 -- The ballot rows follow the vote's ON DELETE CASCADE foreign key.
 -- Remove votes before documents, so their protected reference links are never rewritten by FK cleanup.
 DELETE FROM public.formal_documents WHERE game_id=p_game_id AND stage_no=p_stage_no
  AND coalesce(metadata->>'registry_independent','false')<>'true';
 


 -- Stage-specific registries without a stage_no column.
 IF p_stage_no=2 THEN
   DELETE FROM public.parliamentary_election_rules WHERE game_id=p_game_id;
   DELETE FROM public.electoral_calculator_results WHERE game_id=p_game_id;
 ELSIF p_stage_no=3 THEN
   DELETE FROM public.game_region_party_control WHERE game_id=p_game_id;
   DELETE FROM public.regional_allocations WHERE game_id=p_game_id;
   DELETE FROM public.regional_election_rules WHERE game_id=p_game_id;
   DELETE FROM public.regional_calculator_results WHERE game_id=p_game_id;
   UPDATE public.game_parties SET regions=0,regional_seats_awarded=0
     WHERE game_id=p_game_id;
 ELSIF p_stage_no=4 THEN
   DELETE FROM public.committee_mandate_allocations WHERE game_id=p_game_id;
   DELETE FROM public.institution_assignments WHERE game_id=p_game_id
     AND unit_kind='committee';
 ELSIF p_stage_no=5 THEN
   DELETE FROM public.ghost_voting_policies WHERE game_id=p_game_id;
   UPDATE public.game_parties SET ghost_loss_current=0,ghost_active=false,
     ghost_started_at=NULL WHERE game_id=p_game_id AND
     (ghost_loss_current<>0 OR ghost_active OR ghost_started_at IS NOT NULL);
   FOR v_party_id IN SELECT id FROM public.game_parties WHERE game_id=p_game_id LOOP
     PERFORM private.rebalance_party_mandates(v_party_id);
   END LOOP;
 ELSIF p_stage_no=7 THEN
   DELETE FROM public.presidential_inauguration WHERE game_id=p_game_id;
 ELSIF p_stage_no=8 THEN
   DELETE FROM public.government_structures WHERE game_id=p_game_id;
 END IF;
 DELETE FROM public.office_elections WHERE game_id=p_game_id AND stage_no=p_stage_no;
 
 DELETE FROM public.government_nominations WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.state_programs WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.municipal_projects WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.presidential_addresses WHERE game_id=p_game_id AND stage_no=p_stage_no;

 DELETE FROM public.ghost_voting_rounds WHERE game_id=p_game_id AND stage_no=p_stage_no;

 IF p_stage_no=7 THEN
  PERFORM set_config('gos.stage_reset_game',p_game_id::text,true);
  UPDATE public.presidential_election_settings
   SET status='setup',result='{}'::jsonb,updated_at=now(),updated_by=auth.uid()
   WHERE game_id=p_game_id;
  DELETE FROM public.presidential_scorecards WHERE game_id=p_game_id;
  DELETE FROM public.presidential_teacher_ballots WHERE game_id=p_game_id;
  DELETE FROM public.presidential_public_polls WHERE game_id=p_game_id;
  DELETE FROM public.presidential_poll_decision_votes
  WHERE game_id=p_game_id;
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
 IF p_stage_no=11 THEN
  PERFORM set_config('app.gos_stage11_reset_scope','',true);
  PERFORM private.ensure_stage11_government_agenda(p_game_id);
  PERFORM set_config('app.gos_stage11_reset_scope',p_game_id::text,true);
  PERFORM private.sync_stage11_program_registry_status(p.id) FROM public.state_programs p WHERE p.game_id=p_game_id AND p.stage_no=10 AND p.status='ready';
  PERFORM set_config('app.gos_stage11_reset_scope','',true);
 END IF;
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
;
CREATE OR REPLACE FUNCTION private.stage11_government_agenda_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF current_setting('app.gos_stage11_reset_scope',true)=NEW.game_id::text THEN RETURN NEW;END IF;
 IF TG_TABLE_NAME='state_programs' THEN
   IF TG_OP='UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status
     AND OLD.signed_at IS NOT DISTINCT FROM NEW.signed_at THEN RETURN NEW; END IF;
   IF NEW.status='revision' AND NEW.signed_at IS NULL AND NEW.government_vote_id IS NULL THEN
     UPDATE public.government_program_agenda a SET status='pending',started_at=NULL,qa_closed_at=NULL,
        result_note=coalesce(NEW.pm_revision_reason,'Программа на доработке')
     FROM public.government_sessions s WHERE s.id=a.session_id AND s.status='open' AND a.program_id=NEW.id AND a.status='presenting' AND a.vote_id IS NULL;
   END IF;
   IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND
      (NEW.status='ready' OR OLD.status='ready')) THEN
     PERFORM private.ensure_stage11_government_agenda(NEW.game_id);
   END IF;
   PERFORM private.sync_stage11_program_registry_status(NEW.id);
 ELSE
   IF NEW.stage_no=11 AND NEW.status='open' THEN
     PERFORM private.ensure_stage11_government_agenda(NEW.game_id);
   END IF;
 END IF;
 RETURN NEW;
END;
$function$
;