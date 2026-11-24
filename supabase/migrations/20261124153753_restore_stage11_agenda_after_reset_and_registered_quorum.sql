CREATE OR REPLACE FUNCTION private.open_government_agenda_vote_internal(p_session uuid, p_registered_only boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE s public.government_sessions%rowtype;d public.formal_documents%rowtype;v_id uuid;u uuid:=auth.uid();
BEGIN
 SELECT * INTO s FROM public.government_sessions WHERE id=p_session FOR UPDATE;
 IF s.id IS NULL OR u IS NULL OR NOT private.is_game_member(s.game_id) OR private.is_game_observer(s.game_id)
    OR s.status<>'open' OR s.agenda_approved_at IS NULL THEN RETURN NULL;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.game_stages st WHERE st.game_id=s.game_id AND st.stage_no=11 AND st.status='open'
 AND (st.deadline IS NULL OR st.deadline>clock_timestamp())) THEN RETURN NULL;END IF;
 IF s.agenda_vote_id IS NOT NULL THEN RETURN s.agenda_vote_id;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.institution_meeting_records m WHERE m.game_id=s.game_id AND m.stage_no=11
 AND m.institution_key='government' AND m.agenda_document_id=s.agenda_document_id AND m.agenda_approved_at IS NOT NULL) THEN RETURN NULL;END IF;
 SELECT * INTO d FROM public.formal_documents WHERE id=s.agenda_document_id AND game_id=s.game_id AND status_code='published';
 IF d.id IS NULL OR NOT private.agenda_approved_or_signed(d.id) THEN RETURN NULL;END IF;
 -- Automatic opening still waits for all members. An authorised chair may
 -- explicitly close check-in at quorum and start with those actually present.
 IF NOT EXISTS(SELECT 1 FROM public.game_members m WHERE m.game_id=s.game_id
  AND private.government_office_vote_weight(s.game_id,m.user_id)>0) THEN RETURN NULL;END IF;
 IF p_registered_only THEN
  IF NOT private.can_approve_government_agenda(s.game_id,u) THEN RETURN NULL;END IF;
  IF NOT EXISTS(SELECT 1 FROM public.institution_session_registrations r WHERE r.game_id=s.game_id AND r.stage_no=11 AND r.institution_key='government' AND r.government_session_id=s.id AND private.government_office_vote_weight(s.game_id,r.user_id)>0) OR
   (SELECT coalesce(sum(private.government_office_vote_weight(s.game_id,r.user_id)),0) FROM public.institution_session_registrations r WHERE r.game_id=s.game_id AND r.stage_no=11 AND r.institution_key='government' AND r.government_session_id=s.id) <
   ceil((SELECT coalesce(sum(private.government_office_vote_weight(s.game_id,m.user_id)),0) FROM public.game_members m WHERE m.game_id=s.game_id)*0.5-0.000001)
  THEN RETURN NULL;END IF;
 ELSIF EXISTS(
 SELECT 1 FROM public.game_members m WHERE m.game_id=s.game_id AND private.government_office_vote_weight(s.game_id,m.user_id)>0
 AND NOT EXISTS(SELECT 1 FROM public.institution_session_registrations r WHERE r.game_id=s.game_id AND r.stage_no=11
 AND r.institution_key='government' AND r.user_id=m.user_id AND r.government_session_id=s.id)) THEN RETURN NULL;END IF;
 IF EXISTS(SELECT 1 FROM public.government_program_agenda a WHERE a.session_id=s.id AND a.status IN ('presenting','decision')) THEN RETURN NULL;END IF;
 PERFORM set_config('app.vote_group','',true);
 INSERT INTO public.game_votes(game_id,stage_no,title,body,voting_mode,status,created_by,formal_document_id,formal_step_code,institution_key,procedure_key,
 quorum_kind,quorum_value,majority_kind,majority_value,allow_abstain,tie_breaker_chair,pass_transition,fail_transition)
 VALUES(s.game_id,11,'Утверждение повестки заседания Правительства',d.body_text,'member','open',case when private.is_game_teacher(s.game_id) then u else coalesce(s.chair_user_id,s.agenda_approved_by,u) end,
 d.id,'reference','government','government_agenda','fraction',0.5,'present_majority',0.5,false,false,'none','none') RETURNING id INTO v_id;
 UPDATE public.government_sessions SET agenda_vote_id=v_id WHERE id=s.id;
 RETURN v_id;
END;$function$
;
REVOKE ALL ON FUNCTION private.open_government_agenda_vote_internal(uuid,boolean) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION private.ensure_stage11_government_agenda(p_game uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_pm uuid;
 v_session uuid;
 v_next_no integer;
 v_existing integer;
BEGIN
 IF p_game IS NULL OR current_setting('app.gos_stage11_reset_scope',true)=p_game::text THEN RETURN; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('gos-stage11-auto-agenda:'||p_game::text,0));
 IF NOT EXISTS (
   SELECT 1 FROM public.game_stages s
   WHERE s.game_id=p_game AND (s.stage_no IN (10,11) AND s.status='open'
      OR s.stage_no=10 AND s.status='completed' AND EXISTS(SELECT 1 FROM public.game_stages n WHERE n.game_id=p_game AND n.stage_no=11 AND n.status='locked'))
 ) THEN RETURN; END IF;
 IF NOT EXISTS (
   SELECT 1 FROM public.state_programs p
   WHERE p.game_id=p_game AND p.stage_no=10 AND p.status='ready'
     AND p.signed_at IS NULL
 ) THEN RETURN; END IF;

 SELECT a.user_id INTO v_pm
 FROM public.game_office_assignments a
 JOIN public.game_members m ON m.game_id=a.game_id AND m.user_id=a.user_id
 WHERE a.game_id=p_game AND a.status='active'
   AND a.role_title ~* '^[[:space:]]*председатель[[:space:]]+правительства([[:space:]]|$)'
   AND m.kind='student' AND m.roster_archived_at IS NULL
 ORDER BY a.created_at DESC LIMIT 1;
 IF v_pm IS NULL AND NOT private.is_game_teacher(p_game) THEN RETURN; END IF;

 -- Never alter a meeting after the chair approved its agenda or opened it.
 SELECT s.id INTO v_session
 FROM public.government_sessions s
 WHERE s.game_id=p_game AND s.stage_no=11
   AND s.status='draft' AND s.agenda_approved_at IS NULL
 ORDER BY s.session_no DESC LIMIT 1 FOR UPDATE;
 IF v_session IS NULL THEN
   -- Late or returned programmes receive a NEW unsigned agenda, never rewrite a signed one.
   IF NOT EXISTS(SELECT 1 FROM public.state_programs p WHERE p.game_id=p_game AND p.stage_no=10 AND p.status='ready' AND p.signed_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM public.government_program_agenda a JOIN public.government_sessions s ON s.id=a.session_id
        WHERE a.program_id=p.id AND s.status<>'closed' AND a.status IN ('pending','presenting','decision'))) THEN RETURN;END IF;
   SELECT coalesce(max(s.session_no),0)+1 INTO v_next_no
   FROM public.government_sessions s WHERE s.game_id=p_game;
   INSERT INTO public.government_sessions
     (game_id,stage_no,session_no,title,time_limit_minutes,status,chair_user_id,created_by)
   VALUES(p_game,11,v_next_no,'Заседание Правительства Российской Федерации',60,'draft',v_pm,coalesce(v_pm,auth.uid()))
   RETURNING id INTO v_session;
 END IF;

 SELECT count(*)::integer INTO v_existing
 FROM public.government_program_agenda a WHERE a.session_id=v_session;
 IF v_existing>=30 THEN RETURN; END IF;

 -- Existing agenda trigger refreshes the SAME official draft document.
 -- Existing matches remain intact, keeping manual additions and numbering.
 INSERT INTO public.government_program_agenda
   (session_id,game_id,program_id,agenda_no,report_minutes)
 SELECT v_session,p_game,p.id,
     (v_existing+row_number() OVER (ORDER BY p.responsible_ministry,p.title,p.id))::integer,7
 FROM public.state_programs p
 WHERE p.game_id=p_game AND p.stage_no=10 AND p.status='ready'
   AND p.signed_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.government_program_agenda a JOIN public.government_sessions s ON s.id=a.session_id
     WHERE a.program_id=p.id AND s.status<>'closed' AND a.status IN ('pending','presenting','decision')
   )
 ORDER BY p.responsible_ministry,p.title,p.id
 LIMIT greatest(0,30-v_existing);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.open_government_agenda_vote(p_session_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE s public.government_sessions%rowtype;v_id uuid;
BEGIN
 SELECT * INTO s FROM public.government_sessions WHERE id=p_session_id;
 IF s.id IS NULL OR NOT private.can_approve_government_agenda(s.game_id,auth.uid()) THEN RAISE EXCEPTION 'Голосование по повестке открывает Председатель Правительства';END IF;
 v_id:=private.open_government_agenda_vote_internal(s.id,true);
 IF v_id IS NULL THEN RAISE EXCEPTION 'Сначала утвердите повестку и зарегистрируйте присутствующих членов Правительства. Для открытия голосования необходим кворум';END IF;
 RETURN v_id;
END;$function$
;
CREATE OR REPLACE FUNCTION private.open_government_agenda_vote_internal(p_session uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $$ SELECT private.open_government_agenda_vote_internal(p_session,false); $$;
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
  PERFORM private.sync_stage11_program_registry_status(p.id) FROM public.state_programs p WHERE p.game_id=p_game_id AND p.stage_no=10 AND p.status='ready';
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
CREATE OR REPLACE FUNCTION private.sync_stage11_program_registry_status(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE p public.state_programs%rowtype;d record;item_status text;code text;label text;owner text;step integer;actor uuid;
BEGIN
 SELECT * INTO p FROM public.state_programs WHERE id=p_id;
 IF p.id IS NULL OR p.stage_no<>10 OR NOT EXISTS(SELECT 1 FROM public.game_stages s WHERE s.game_id=p.game_id AND (s.stage_no IN (10,11) AND s.status='open' OR s.stage_no=10 AND s.status='completed' AND EXISTS(SELECT 1 FROM public.game_stages n WHERE n.game_id=p.game_id AND n.stage_no=11 AND n.status='locked'))) THEN RETURN;END IF;
 SELECT a.status INTO item_status FROM public.government_program_agenda a JOIN public.government_sessions s ON s.id=a.session_id AND s.game_id=a.game_id
 WHERE a.program_id=p.id AND a.status<>'withdrawn' ORDER BY s.session_no DESC,a.created_at DESC LIMIT 1;
 IF item_status IS NULL AND p.status NOT IN ('adopted','government_vote','rejected') THEN RETURN;END IF;
 IF p.status='revision' THEN code:='revision';label:='На доработке';owner:='ministry';step:=0;
 ELSIF p.status IN ('draft','minister_review','pm_review') AND item_status IS NOT NULL THEN code:='revision';label:=CASE WHEN p.status='draft' THEN 'На доработке' ELSE 'На повторном согласовании' END;owner:=CASE WHEN p.status='pm_review' THEN 'government' ELSE 'ministry' END;step:=0;
 ELSIF p.status='adopted' AND p.signed_at IS NOT NULL THEN code:='published';label:='Подписана и опубликована';owner:='system';step:=3;
 ELSIF p.status='adopted' THEN code:='adopted';label:='Принята — ожидает подписи';owner:='government';step:=2;
 ELSIF p.status='rejected' THEN code:='rejected';label:='Отклонена голосованием';owner:='system';step:=1;
 ELSIF p.status='government_vote' THEN code:='agenda';label:='На голосовании';owner:='government';step:=1;
 ELSIF p.status='ready' AND item_status IS NOT NULL THEN code:='agenda';label:=CASE WHEN item_status='presenting' THEN 'На рассмотрении' ELSE 'В повестке Правительства' END;owner:='government';step:=1;
 ELSE RETURN;END IF;
 actor:=coalesce(auth.uid(),p.created_by);
 FOR d IN SELECT x.id,x.status_code,x.status_label,x.current_owner_key,x.current_step FROM public.formal_documents x
 WHERE x.game_id=p.game_id AND x.stage_no=10 AND x.doc_type='state_program'
 AND x.metadata->>'state_program_id'=p.id::text AND x.metadata->>'auto_synced'='true'
 AND x.status_code NOT IN ('superseded','withdrawn')
 AND (x.status_code,x.status_label,x.current_owner_key,x.current_step) IS DISTINCT FROM (code,label,owner,step)
 LOOP
  PERFORM set_config('app.gos_stage11_registry_status_id',d.id::text,true);
  UPDATE public.formal_documents SET status_code=code,status_label=label,current_owner_key=owner,current_step=step,updated_at=now() WHERE id=d.id;
  PERFORM set_config('app.gos_stage11_registry_status_id','',true);
  INSERT INTO public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
  VALUES(d.id,p.game_id,actor,
   CASE WHEN code='published' AND p.signed_by=auth.uid() AND EXISTS(SELECT 1 FROM public.game_profiles gp WHERE gp.game_id=p.game_id AND gp.user_id=actor AND nullif(gp.signature_path,'') IS NOT NULL) THEN 'Подписан документ уполномоченным лицом'
        WHEN code='published' THEN 'ГП опубликована по итогам подписания' ELSE label END,
   d.status_code,code,d.current_owner_key,owner,CASE WHEN p.government_vote_id IS NOT NULL THEN 'Голосование '||p.government_vote_id::text ELSE p.pm_revision_reason END);
 END LOOP;
END;$function$
;