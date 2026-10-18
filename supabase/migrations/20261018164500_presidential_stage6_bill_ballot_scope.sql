-- ГОС.ID. Специальное голосование по избирательной системе Президента на этапе 6
-- не является чтением законопроекта этапа 12. Остальные защиты I-III чтений сохранены.
CREATE OR REPLACE FUNCTION private.guard_bill_session_ballot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE v_doc public.formal_documents%rowtype;
BEGIN
 IF NEW.formal_document_id IS NULL OR NEW.status<>'open' THEN RETURN NEW; END IF;
 SELECT * INTO v_doc FROM public.formal_documents WHERE id=NEW.formal_document_id;
 IF v_doc.id IS NULL OR v_doc.workflow_key<>'bill' THEN RETURN NEW; END IF;
 IF NEW.procedure_key='presidential_system' THEN
   IF NEW.stage_no<>6 OR NEW.institution_key<>'gd'
      OR NEW.formal_step_code IS NOT NULL
      OR v_doc.game_id IS DISTINCT FROM NEW.game_id
      OR v_doc.stage_no<>6
      OR v_doc.status_code<>'draft'
      OR v_doc.metadata->>'purpose'<>'presidential_electoral_system'
      OR NOT EXISTS(
         SELECT 1 FROM public.duma_agenda_items i
         JOIN public.duma_sessions s ON s.id=i.session_id AND s.game_id=i.game_id
         WHERE i.formal_document_id=v_doc.id AND i.game_id=v_doc.game_id
           AND i.status='in_progress' AND s.status='open' AND s.stage_no=6)
   THEN RAISE EXCEPTION 'Поправка к системе выборов Президента должна быть связана с открытым заседанием ГД шестого этапа'
     USING ERRCODE='42501'; END IF;
   RETURN NEW;
 END IF;
 IF NEW.formal_step_code NOT IN ('reading1','reading2','reading3') THEN RETURN NEW; END IF;
 IF v_doc.game_id IS DISTINCT FROM NEW.game_id
   OR v_doc.status_code IS DISTINCT FROM NEW.formal_step_code
   OR NEW.institution_key<>'gd' OR NEW.procedure_key<>'bill_'||NEW.formal_step_code
 THEN RAISE EXCEPTION 'Голосование должно соответствовать стадии законопроекта и органу'
   USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(
  SELECT 1 FROM public.duma_agenda_items i
  JOIN public.duma_sessions s ON s.id=i.session_id AND s.game_id=i.game_id
  WHERE i.formal_document_id=v_doc.id AND i.game_id=v_doc.game_id
    AND i.status='in_progress' AND s.status='open'
    AND s.stage_no=NEW.stage_no
 ) THEN RAISE EXCEPTION
  'Голосование по законопроекту закрыто до начала рассмотрения вопроса на заседании Государственной Думы'
  USING ERRCODE='42501'; END IF;
 RETURN NEW;
END;$function$;
