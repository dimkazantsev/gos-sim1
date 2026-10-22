-- Submitted amendments travel with the bill into its second-reading meeting.
CREATE OR REPLACE FUNCTION private.guard_bill_amendment_document()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM public.games WHERE id=OLD.game_id)
   AND EXISTS(SELECT 1 FROM public.bill_amendments WHERE document_id=OLD.id)
  THEN RAISE EXCEPTION 'Законопроект с историей поправок сохраняется в реестре до удаления игры';END IF;
  RETURN OLD;
 END IF;
 IF EXISTS(SELECT 1 FROM public.bill_amendments WHERE document_id=OLD.id AND status IN ('submitted','voting'))
  AND (NEW.status_code IS DISTINCT FROM OLD.status_code OR NEW.current_step IS DISTINCT FROM OLD.current_step
   OR NEW.current_owner_key IS DISTINCT FROM OLD.current_owner_key OR NEW.workflow_steps IS DISTINCT FROM OLD.workflow_steps
   OR NEW.doc_type IS DISTINCT FROM OLD.doc_type OR NEW.workflow_key IS DISTINCT FROM OLD.workflow_key OR NEW.game_id IS DISTINCT FROM OLD.game_id)
  AND NOT coalesce((OLD.stage_no=12 AND NEW.stage_no=12 AND OLD.workflow_key='bill' AND NEW.workflow_key='bill'
   AND OLD.status_code='amendments' AND NEW.status_code='reading2' AND NEW.current_step=OLD.current_step+1 AND NEW.current_owner_key='gd'
   AND NEW.workflow_steps IS NOT DISTINCT FROM OLD.workflow_steps AND NEW.doc_type IS NOT DISTINCT FROM OLD.doc_type AND NEW.game_id IS NOT DISTINCT FROM OLD.game_id
   AND NOT EXISTS(SELECT 1 FROM public.bill_amendment_packs WHERE document_id=OLD.id AND status IN ('opening','voting'))),false)
 THEN RAISE EXCEPTION 'Сначала рассмотрите или отзовите все поправки ко II чтению';END IF;
 IF (NEW.body_text IS DISTINCT FROM OLD.body_text OR NEW.title IS DISTINCT FROM OLD.title OR NEW.metadata->>'revision' IS DISTINCT FROM OLD.metadata->>'revision')
  AND EXISTS(SELECT 1 FROM public.bill_amendment_packs WHERE document_id=OLD.id AND status IN ('opening','voting'))
 THEN RAISE EXCEPTION 'Текст законопроекта зафиксирован до завершения голосования по поправкам';END IF;
 RETURN NEW;
END;$$;
