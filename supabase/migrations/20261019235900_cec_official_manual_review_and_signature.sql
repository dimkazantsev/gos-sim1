-- ГОС.ID. Официальные решения ЦИК: только ручные замечания и подпись председателя.
-- Поле reasoning хранит снимок на дату решения; OCR и автоматическая проверка не публикуются.
-- Никаких изменений существующих оценок, партий и файлов кандидатов.
DO $migration$
DECLARE source_sql text;
BEGIN
 source_sql:=pg_get_functiondef('public.record_presidential_cec_decision(uuid,text,integer,numeric,text,text)'::regprocedure);
 IF strpos(source_sql,'v_reasoning:=private.presidential_submission_review_json(c.id);')=0
    OR strpos(source_sql,'elsif p_status in (''revision'',''rejected'') then')=0
    OR strpos(source_sql,'insert into public.presidential_cec_decisions(game_id,candidate_id,decision_type,decision_number,public_summary,created_by,reasoning)')=0 THEN
  RAISE EXCEPTION 'Функция принятия решения ЦИК изменена: требуется согласование миграции';
 END IF;

 source_sql:=replace(source_sql,
  'v_reasoning:=private.presidential_submission_review_json(c.id);',
  $replacement$
  -- Закрепить только реальные замечания, которые внесли проверяющие ЦИК.
  v_reasoning:=jsonb_build_object(
    'manual_remarks',coalesce(
      (SELECT jsonb_agg(jsonb_build_object('title',d.title,'note',btrim(d.note),'status',d.status)
                        ORDER BY d.doc_kind)
       FROM public.presidential_candidate_documents d
       WHERE d.candidate_id=c.id AND d.is_submitted AND d.archived_at IS NULL
         AND d.reviewed_by IS NOT NULL AND nullif(btrim(coalesce(d.note,'')),'') IS NOT NULL),
      '[]'::jsonb),
    'chair_signature_path',(
       SELECT p.signature_path FROM public.game_profiles p
       WHERE p.game_id=c.game_id AND p.user_id=v_uid
       LIMIT 1
    ),
    'chair_name',(
       SELECT gm.full_name FROM public.game_members gm
       WHERE gm.game_id=c.game_id AND gm.user_id=v_uid AND gm.kind='teacher'
       LIMIT 1
    )
  );
  $replacement$);

 -- В окончательной резолюции фиксируется принятый факт, а не рекомендация алгоритма.
 source_sql:=replace(source_sql,
  'insert into public.presidential_cec_decisions(game_id,candidate_id,decision_type,decision_number,public_summary,created_by,reasoning)',
  $replacement$
  IF p_status='registered' THEN
   v_public:='Зарегистрирован кандидат '||c.display_name||
     ' на должность Президента Российской Федерации.';
  ELSIF p_status='revision' THEN
   v_public:='Документы кандидата '||c.display_name||
     ' возвращены на доработку по замечаниям Центральной избирательной комиссии Российской Федерации.';
  END IF;
  insert into public.presidential_cec_decisions(game_id,candidate_id,decision_type,decision_number,public_summary,created_by,reasoning)
  $replacement$);

 -- Не превращать обнаруженные алгоритмом признаки в официальные замечания.
 source_sql:=regexp_replace(source_sql,
  'elsif p_status in \(''revision'',''rejected''\) then[\s\S]*?\n end if;\n\n update public.presidential_candidates',
  E'elsif p_status in (''revision'',''rejected'') then\n  -- Ручная проверка завершена: существующие замечания остаются без изменений.\n  null;\n end if;\n\n update public.presidential_candidates',
  'g');
 IF strpos(source_sql,'Требуется устранить замечания автоматической предварительной проверки.')>0 THEN
  RAISE EXCEPTION 'Не удалось исключить автоматические замечания из решения ЦИК';
 END IF;
 EXECUTE source_sql;
END
$migration$;


-- Техническая предварительная проверка — только для роли преподавателя.
-- Результат не выдаётся студентам даже через прямой вызов RPC.
DO $scope$
DECLARE source_sql text;
BEGIN
 source_sql:=pg_get_functiondef('public.get_presidential_cec_auto_review(uuid)'::regprocedure);
 IF strpos(source_sql,'if not private.can_manage_presidential_candidate(c.id,v_uid) and not (c.cec_submitted_at is not null and private.is_game_teacher(c.game_id))')=0 THEN
  RAISE EXCEPTION 'Полномочия RPC предварительной проверки ЦИК изменены';
 END IF;
 source_sql:=replace(source_sql,
  'if not private.can_manage_presidential_candidate(c.id,v_uid) and not (c.cec_submitted_at is not null and private.is_game_teacher(c.game_id))',
  'if not private.is_game_teacher(c.game_id)'
 );
 EXECUTE source_sql;
END
$scope$;
