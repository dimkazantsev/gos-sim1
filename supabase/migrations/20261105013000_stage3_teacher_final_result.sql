-- ГОС.ID. One teacher decision replaces a deadlocked Stage 3 method vote.
-- Do not represent the teacher's decision as a passed KSRF vote.
-- Exactly one RPC: calculation, 89-region ledger, accepted protocol, news.
CREATE UNIQUE INDEX IF NOT EXISTS formal_stage3_teacher_result_protocol_uq
 ON public.formal_documents(game_id)
 WHERE stage_no=3 AND metadata->>'document_kind'='stage3_teacher_result_protocol';

CREATE OR REPLACE FUNCTION public.finalize_teacher_regional_stage_result(
 p_game_id uuid,p_method text,p_inputs jsonb,p_result jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $$
DECLARE
 v_uid uuid := auth.uid();
 v_existing_doc uuid;
 v_existing_calculation uuid;
 v_prior public.regional_calculator_results%ROWTYPE;
 v_rule uuid;
 v_calculation uuid;
 v_document uuid;
 v_method_label text;
 v_party_summary text;
 v_body text;
 v_closed_vote_ids uuid[];
BEGIN
 IF v_uid IS NULL OR NOT private.is_game_teacher(p_game_id) THEN
  RAISE EXCEPTION 'Утвердить итог этапа может только преподаватель' USING ERRCODE='42501';
 END IF;
 IF p_method IS NULL OR p_method NOT IN ('random','proportional','agreement') THEN
  RAISE EXCEPTION 'Неизвестный способ распределения';
 END IF;
 -- Serialize all teachers' confirmation attempts for this game.
 PERFORM 1 FROM public.games WHERE id=p_game_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Игра не найдена'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.game_stages WHERE game_id=p_game_id AND stage_no=3) THEN
  RAISE EXCEPTION 'Третий этап игры отсутствует';
 END IF;

 SELECT d.id,(d.metadata->>'source_calculation_id')::uuid
 INTO v_existing_doc,v_existing_calculation
 FROM public.formal_documents d
 WHERE d.game_id=p_game_id AND d.stage_no=3
 AND d.metadata->>'document_kind'='stage3_teacher_result_protocol'
 LIMIT 1;
 IF v_existing_doc IS NOT NULL THEN
  SELECT * INTO v_prior FROM public.regional_calculator_results
  WHERE id=v_existing_calculation AND game_id=p_game_id;
  IF FOUND AND v_prior.method=p_method
    AND v_prior.inputs=p_inputs AND v_prior.result=p_result THEN
   RETURN v_prior.id; -- Idempotent: no extra news, documents or effects.
  END IF;
  RAISE EXCEPTION 'Итог этапа уже утверждён. Для изменения требуется отдельная процедура исправления';
 END IF;

 -- Retain the historical student ballots and proposals, but stop an undecided
 -- regional vote from taking precedence after a teacher has finalized the stage.
 SELECT array_agg(id) INTO v_closed_vote_ids
 FROM public.game_votes
 WHERE game_id=p_game_id AND stage_no=3
 AND procedure_key='regional_system' AND status='open';
 UPDATE public.regional_election_rules
 SET status='superseded',queued_at=NULL,updated_at=now(),
     rejection_reason=CASE WHEN status IN ('draft','vote_open')
       THEN 'Рассмотрение завершено итоговым решением преподавателя'
       ELSE rejection_reason END
 WHERE game_id=p_game_id AND status IN ('draft','vote_open','adopted','allocated');

 -- No fabricated majority, quorum or vote counts: result_code stays NULL.
 UPDATE public.game_votes
 SET status='closed',closed_at=now(),result_code=NULL,
     result_label='Завершено без решения фракций',
     decision_note='Голосование завершено. Итог распределения 89 субъектов утверждается отдельным решением преподавателя'
 WHERE game_id=p_game_id AND stage_no=3
 AND procedure_key='regional_system' AND status='open';

 -- The existing vote-close trigger can mark the linked proposal rejected.
 -- Restore its precise historical classification as superseded.
 IF v_closed_vote_ids IS NOT NULL THEN
  UPDATE public.regional_election_rules
  SET status='superseded',queued_at=NULL,updated_at=now(),
      rejection_reason='Голосование завершено без решения; итог утверждает преподаватель'
  WHERE game_id=p_game_id AND vote_id=ANY(v_closed_vote_ids);
 END IF;

 INSERT INTO public.regional_election_rules
 (game_id,method,rationale,status,vote_id,proposed_by)
 VALUES(p_game_id,p_method,
  'Итоговый способ распределения утверждён преподавателем. Не является решением голосования КСРФ.',
  'allocated',NULL,v_uid)
 RETURNING id INTO v_rule;

 -- Reuse the authoritative validations and region-transfer machinery, not a
 -- second quota calculator. All writes share this one database transaction.
 v_calculation:=public.publish_regional_calculator_result(
  p_game_id,p_method,p_inputs,p_result);
 UPDATE public.game_region_party_control
 SET election_rule_id=v_rule
 WHERE game_id=p_game_id AND election_rule_id IS DISTINCT FROM v_rule;
 IF (SELECT count(*) FROM public.game_region_party_control WHERE game_id=p_game_id)<>89 THEN
  RAISE EXCEPTION 'Нельзя утвердить неполное закрепление 89 субъектов';
 END IF;

 v_method_label:=CASE p_method
  WHEN 'random' THEN 'жеребьёвка'
  WHEN 'proportional' THEN 'пропорционально мандатам Государственной Думы'
  ELSE 'распределение, установленное преподавателем' END;
 SELECT string_agg(format('«%s» — %s субъектов',p.name,
   (p_result->>p.id::text)::integer),'; ' ORDER BY p.name)
 INTO v_party_summary FROM public.game_parties p WHERE p.game_id=p_game_id;

 v_body:='ПРОТОКОЛ УТВЕРЖДЕНИЯ ИТОГОВ ТРЕТЬЕГО ЭТАПА'
  ||E'\nГОС.ID · Распределение 89 субъектов Российской Федерации'
  ||E'\nОснование: решение преподавателя об утверждении итогового распределения.'
  ||E'\nМетод: '||v_method_label||'.'
  ||E'\n\nРЕЗУЛЬТАТЫ\n'||v_party_summary
  ||E'\n\nВсего распределено 89 субъектов.'
  ||E'\nРезультат зафиксирован в реестре партий и территориальных назначений.'
  ||E'\nПротокол удостоверяет решение преподавателя, а не принятие предложения КСРФ голосованием.'
  ||E'\nРанее поданные голоса не изменены. Документ автоматически опубликован системой ГОС.ID.';
 v_document:=gen_random_uuid();
 INSERT INTO public.formal_documents
 (id,game_id,stage_no,registry_no,title,doc_type,subject_key,subject_label,
  author_id,body_text,workflow_key,workflow_steps,current_step,status_code,
  status_label,current_owner_key,metadata)
 VALUES(v_document,p_game_id,3,
   'ИГРА-ПР-'||lpad(nextval('public.formal_registry_seq')::text,6,'0'),
   'Протокол утверждения преподавателем итогов распределения 89 субъектов',
   'other','teacher','Преподаватель ГОС.ID',
   v_uid,v_body,'generic',private.formal_workflow('generic'),0,'draft',
   'Протокол подготовлен','teacher',
   jsonb_build_object('document_kind','stage3_teacher_result_protocol',
    'stage_no',3,'source_calculation_id',v_calculation::text,
    'source_regional_rule_id',v_rule::text,
    'approval_source','teacher','automatic_attestation',true,
    'signed_role','Преподаватель ГОС.ID',
    'signed_on',now()));
 UPDATE public.formal_documents
 SET current_step=2,status_code='published',
     status_label='Протокол утверждён преподавателем',
     current_owner_key='system',updated_at=now()
 WHERE id=v_document AND game_id=p_game_id;
 INSERT INTO public.formal_document_history
 (document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
 VALUES(v_document,p_game_id,v_uid,'Утверждение итогов распределения преподавателем',
   'draft','published','teacher','system',
   'Итог этапа 3 утверждён преподавателем, без изменения бюллетеней и числовых результатов голосования');

 INSERT INTO public.game_events
 (game_id,round_no,category,severity,title,body,created_by)
 VALUES(p_game_id,3,'Региональные выборы','notice',
  'ГОС.ID: утверждены итоги распределения 89 субъектов',
  'Преподаватель утвердил итог третьего этапа. Способ: '||v_method_label||'.'
  ||E'\n\n'||v_party_summary||'. Всего — 89 субъектов.'
  ||E'\n\nЭто итоговое решение преподавателя, а не результат голосования фракций.'
  ||E'\n\n[Протокол утверждения](gos:documents?id='||v_document::text||')'
  ||E'\n[Результаты этапа](gos:stages?stage=3)',v_uid);
 RETURN v_calculation;
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_teacher_regional_stage_result(uuid,text,jsonb,jsonb)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.finalize_teacher_regional_stage_result(uuid,text,jsonb,jsonb)
 TO authenticated;