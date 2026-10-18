-- ГОС.ID. Stage 6 owns the Senate's election appointment, student decisions
-- and CEC candidate registration; Stage 7 owns CEC results and inauguration.
-- Change only readiness predicates and mandatory final-document stage.
-- Existing data, documents, signatures, scores and office appointments are unchanged.

DO $migration$
DECLARE v_def text;v_old text;v_start integer;v_end integer;v_required text;
BEGIN
 SELECT pg_get_functiondef('private.stage_readiness_json(uuid,integer)'::regprocedure) INTO v_def;
 v_start:=position('elsif p_stage=6 then' in v_def);
 v_end:=position('elsif p_stage=8 then' in v_def);
 IF v_def IS NULL OR v_start<1 OR v_end<=v_start THEN
  RAISE EXCEPTION 'Cannot safely locate Stage 6/7 readiness rules';
 END IF;
 v_old:=substr(v_def,v_start,v_end-v_start);
 IF position('duma_system_decision' in v_old)=0
    OR position('sf_appointment_resolution' in v_old)=0
    OR position('public.presidential_candidates' in v_old)=0 THEN
  RAISE EXCEPTION 'Current stage readiness has changed; review before applying';
 END IF;
 v_def:=replace(v_def,v_old,$newstage$
elsif p_stage=6 then
  SELECT count(*) INTO c FROM public.presidential_candidates
    WHERE game_id=p_game AND archived_at IS NULL AND registration_status='registered';
  SELECT count(*) INTO c2 FROM public.presidential_candidates
    WHERE game_id=p_game AND archived_at IS NULL AND registration_status IN ('submitted','revision');
  SELECT count(*) INTO c3 FROM public.presidential_student_system_result
    WHERE game_id=p_game;
  SELECT count(*) INTO n FROM public.presidential_election_schedule e
    JOIN public.formal_documents d ON d.id=e.appointment_document_id
    WHERE e.game_id=p_game AND d.game_id=p_game AND d.stage_no=6
      AND d.doc_type='sf_resolution' AND d.status_code='published';
  m:=jsonb_build_object('registered_candidates',c,'pending_candidates',c2,
    'student_system_decision',c3,'sf_election_appointment',n,
    'student_poll_decision_closed',(
      SELECT count(*) FROM public.presidential_poll_decision
       WHERE game_id=p_game AND status='closed'));
  IF n=0 THEN b:=b||jsonb_build_array('Совет Федерации не утвердил даты трёхдневных выборов Президента');END IF;
  IF c3=0 THEN b:=b||jsonb_build_array('Не утверждено личное решение студентов об избирательной системе');END IF;
  IF NOT EXISTS(SELECT 1 FROM public.presidential_poll_decision
      WHERE game_id=p_game AND status='closed') THEN
    b:=b||jsonb_build_array('Не завершено личное голосование студентов о социологическом опросе');
  END IF;
  IF c=0 THEN b:=b||jsonb_build_array('Нет зарегистрированных ЦИК кандидатов в Президенты');END IF;
  IF c2>0 THEN w:=w||jsonb_build_array('Есть кандидатуры на рассмотрении ЦИК или на доработке');END IF;
elsif p_stage=7 then
  SELECT status INTO s FROM public.presidential_election_settings WHERE game_id=p_game;
  SELECT count(*) INTO c FROM public.political_posts p
    WHERE p.game_id=p_game AND p.source_key='cec-presidential-results:'||p_game::text
      AND p.status='published';
  SELECT count(*) INTO c2 FROM public.political_posts p
    WHERE p.game_id=p_game AND p.source_key='cec-presidential-inauguration:'||p_game::text
      AND p.status='published';
  SELECT count(*) INTO c3 FROM public.game_office_assignments a
    JOIN public.presidential_candidates candidate
      ON candidate.game_id=a.game_id AND candidate.user_id=a.user_id
    JOIN public.presidential_election_settings e ON e.game_id=a.game_id
      AND e.result->>'winner_id'=candidate.id::text
    WHERE a.game_id=p_game AND a.status='active'
      AND private.office_family(a.role_title)='president';
  m:=jsonb_build_object('election_status',coalesce(s,'not_configured'),
    'cec_result_published',c,'inauguration_confirmed',c2,'presidential_authority',c3);
  IF s IS NULL THEN b:=b||jsonb_build_array('Не настроен расчёт выборов Президента в ЦИК');
  ELSIF s='manual_required' THEN b:=b||jsonb_build_array('Результаты выборов требуют разрешения преподавателя');
  ELSIF s<>'finished' THEN b:=b||jsonb_build_array('ЦИК ещё не завершила подсчёт результатов выборов');END IF;
  IF c=0 THEN b:=b||jsonb_build_array('ЦИК не опубликовала официальный итог выборов Президента');END IF;
  IF c2=0 THEN b:=b||jsonb_build_array('Не подтверждена инаугурация избранного Президента');END IF;
  IF c3=0 THEN b:=b||jsonb_build_array('Победителю ещё не предоставлены полномочия Президента после инаугурации');END IF;
$newstage$);
 EXECUTE v_def;

 SELECT pg_get_functiondef('private.stage_required_final_documents(uuid,integer)'::regprocedure)
 INTO v_required;
 IF v_required IS NULL OR position('(7,''sf_resolution'',''Постановление Совета Федерации'',''sf_resolution'',''sf'')' in v_required)=0 THEN
  RAISE EXCEPTION 'The required Senate final-document policy changed; abort the migration';
 END IF;
 v_required:=replace(v_required,
  '(7,''sf_resolution'',''Постановление Совета Федерации'',''sf_resolution'',''sf'')',
  '(6,''sf_resolution'',''Постановление Совета Федерации о назначении выборов'',''sf_resolution'',''sf'')');
 EXECUTE v_required;
END $migration$;
