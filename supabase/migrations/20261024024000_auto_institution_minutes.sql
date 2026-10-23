-- ГОС.ID: one-click publication of a meeting record; no file upload or extra stage task.
-- The coordinator confirms the end of the meeting; the system signs the generated record as itself.
CREATE OR REPLACE FUNCTION public.publish_institution_meeting_minutes_automatically(
 p_game_id uuid, p_stage_no integer, p_institution text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,private,pg_temp AS $$
DECLARE
 v_uid uuid:=auth.uid();
 v_m public.institution_meeting_records%rowtype;
 v_doc uuid; v_subject text; v_workflow text; v_org text;
 v_results text; v_body text; v_attendance integer; v_steps jsonb;
BEGIN
 IF v_uid IS NULL OR NOT private.is_game_member(p_game_id)
   OR NOT private.can_coordinate_stage_meeting(p_game_id,p_stage_no,p_institution,v_uid)
 THEN RAISE EXCEPTION 'Завершить заседание может только уполномоченный председатель'; END IF;
 -- Dedicated Duma and Government session close handlers publish their own session-specific records.
 IF (p_stage_no=12 AND p_institution='gd')
   OR (p_stage_no=11 AND p_institution='government') THEN
   RAISE EXCEPTION 'Этот протокол выпускается автоматически при закрытии заседания'; END IF;
 SELECT * INTO v_m FROM public.institution_meeting_records
 WHERE game_id=p_game_id AND stage_no=p_stage_no AND institution_key=p_institution FOR UPDATE;
 IF NOT FOUND OR v_m.agenda_approved_at IS NULL THEN
  RAISE EXCEPTION 'Перед завершением заседания необходимо утвердить повестку'; END IF;
 IF EXISTS(SELECT 1 FROM public.game_votes
  WHERE game_id=p_game_id AND stage_no=p_stage_no
    AND institution_key=p_institution AND status='open') THEN
  RAISE EXCEPTION 'Сначала завершите все открытые голосования органа'; END IF;
 SELECT count(*)::integer INTO v_attendance
 FROM public.institution_session_registrations
 WHERE game_id=p_game_id AND stage_no=p_stage_no AND institution_key=p_institution;
 IF v_attendance<1 THEN RAISE EXCEPTION 'Не зарегистрированы участники заседания'; END IF;
 IF v_m.minutes_approved_at IS NOT NULL AND v_m.minutes_document_id IS NOT NULL THEN
  RETURN v_m.minutes_document_id;
 END IF;
 -- Never rewrite any previously published protocol, including historical approvals.
 IF v_m.minutes_document_id IS NOT NULL AND EXISTS(
  SELECT 1 FROM public.formal_documents d
  WHERE d.id=v_m.minutes_document_id AND d.game_id=p_game_id AND d.status_code='published'
 ) THEN RETURN v_m.minutes_document_id; END IF;
 v_doc:=coalesce(v_m.minutes_document_id,gen_random_uuid());
 -- Match the approved document-creation scope enforced by server triggers.
 PERFORM set_config('app.gos_meeting_document_scope',
  concat(p_game_id,':',p_stage_no,':',p_institution,':minutes'),true);
 SELECT coalesce(string_agg(
   row_numbered.n::text||'. '||row_numbered.title||
   E'\nГолосование: за — '||coalesce(row_numbered.result_yes,0)::text
   ||', против — '||coalesce(row_numbered.result_no,0)::text
   ||', воздержались — '||coalesce(row_numbered.result_abstain,0)::text
   ||'. '||CASE
     WHEN row_numbered.result_code IN ('passed','approved','accepted','adopted') THEN 'Решение принято.'
     WHEN row_numbered.result_code IN ('failed','rejected','declined') THEN 'Решение не принято.'
     ELSE 'Результат зафиксирован в системе.' END,
   E'\n\n' ORDER BY row_numbered.n),'Голосования на этом заседании не проводились.')
 INTO v_results
 FROM (
  SELECT row_number() over(order by closed_at,id) AS n,
   coalesce(nullif(title,''),'Вопрос голосования') AS title,
   result_yes,result_no,result_abstain,result_code
  FROM public.game_votes
  WHERE game_id=p_game_id AND stage_no=p_stage_no AND institution_key=p_institution
    AND status='closed'
 ) row_numbered;
 v_org:=CASE p_institution
  WHEN 'gd' THEN 'Государственной Думы Федерального Собрания Российской Федерации'
  WHEN 'government' THEN 'Правительства Российской Федерации'
  WHEN 'ksrf' THEN 'Координационного совета регионов и фракций'
  WHEN 'sf' THEN 'Совета Федерации Федерального Собрания Российской Федерации'
  WHEN 'cec' THEN 'Центральной избирательной комиссии'
  WHEN 'municipality' THEN 'органа местного самоуправления'
  WHEN 'committee' THEN 'комитета'
  WHEN 'region' THEN 'регионального органа'
  WHEN 'central_bank' THEN 'Банка России'
  WHEN 'ks' THEN 'Конституционного Суда Российской Федерации'
  WHEN 'vs' THEN 'Верховного Суда Российской Федерации'
  WHEN 'accounts' THEN 'Счётной палаты Российской Федерации'
  ELSE coalesce((SELECT title FROM public.institution_units
   WHERE game_id=p_game_id AND 'unit:'||id::text=p_institution),'уполномоченного органа') END;
 v_subject:=CASE WHEN p_institution='government' THEN 'government'
  WHEN p_institution LIKE 'unit:%' THEN 'gd' ELSE p_institution END;
 v_workflow:=CASE WHEN p_institution='government' THEN 'government_act' ELSE 'gd_resolution' END;
 v_body:=coalesce(nullif(btrim(v_m.minutes_body),''),'ПРОТОКОЛ заседания '||v_org
  ||E'\nЭтап '||p_stage_no::text
  ||E'\nЗарегистрировано участников: '||v_attendance::text
  ||E'\n\nПОВЕСТКА\n'||coalesce(v_m.agenda_body,'Повестка утверждена')
  ||E'\n\nИТОГИ ГОЛОСОВАНИЙ\n'||v_results
  ||E'\n\nДокумент автоматически удостоверен системой ГОС.ID. Личная электронная подпись должностного лица не применялась.');
 IF v_m.minutes_document_id IS NULL THEN
  v_steps:=private.formal_workflow(v_workflow);
  INSERT INTO public.formal_documents
   (id,game_id,stage_no,registry_no,title,doc_type,subject_key,subject_label,
    author_id,body_text,workflow_key,workflow_steps,current_step,status_code,
    status_label,current_owner_key,metadata)
  VALUES
   (v_doc,p_game_id,p_stage_no,'ИГРА-ПР-'||lpad(nextval('public.formal_registry_seq')::text,6,'0'),
    'Протокол заседания '||v_org,'minutes',v_subject,v_org,v_uid,v_body,
    v_workflow,v_steps,0,'draft','Протокол подготовлен',v_subject,
    jsonb_build_object('document_kind','institution_meeting_minutes',
     'institution_key',p_institution,'stage_no',p_stage_no));
 ELSE
  UPDATE public.formal_documents
    SET body_text=v_body,updated_at=now()
   WHERE id=v_doc AND game_id=p_game_id AND doc_type='minutes';
  IF NOT FOUND THEN RAISE EXCEPTION 'Протокол заседания отсутствует в реестре'; END IF;
 END IF;
 UPDATE public.formal_documents SET
   status_code='published',status_label='Протокол опубликован системой ГОС.ID',
   current_owner_key='system',updated_at=now(),
   metadata=coalesce(metadata,'{}'::jsonb)||
    jsonb_build_object('automatic_attestation',true,'signed_name','Система ГОС.ID',
     'signed_role','Автоматическое удостоверение игровой записи','signed_on',now())
 WHERE id=v_doc;
 UPDATE public.institution_meeting_records
 SET minutes_document_id=v_doc,minutes_body=v_body,minutes_prepared_by=coalesce(minutes_prepared_by,v_uid),
     minutes_saved_at=coalesce(minutes_saved_at,now()),minutes_approved_by=v_uid,
     minutes_approved_at=now(),updated_at=now()
 WHERE game_id=p_game_id AND stage_no=p_stage_no AND institution_key=p_institution;
 INSERT INTO public.formal_document_history
  (document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
 VALUES(v_doc,p_game_id,v_uid,'Протокол сформирован и автоматически опубликован',
   'draft','published',v_subject,'system',
   'Закрытие заседания подтверждено уполномоченным участником. Системное удостоверение, не личная подпись.');
 RETURN v_doc;
END; $$;
REVOKE ALL ON FUNCTION public.publish_institution_meeting_minutes_automatically(uuid,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.publish_institution_meeting_minutes_automatically(uuid,integer,text) TO authenticated;
