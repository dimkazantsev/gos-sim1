-- ГОС.ID: enforce kind/route and terminal status on direct table writes too.
-- Valid RPCs already enforce their own permissions. Do not rewrite historical rows.

CREATE OR REPLACE FUNCTION private.guard_formal_document_kind_route()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $guard$
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
  IF v_kind NOT IN ('institution_meeting_agenda','duma_session_agenda','institution_meeting_minutes')
    OR NEW.workflow_key NOT IN ('gd_resolution','government_act')
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
  RAISE EXCEPTION 'Отклонённый документ окончателен. Возобновление процедуры запрещено'
    USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END;$guard$;
REVOKE ALL ON FUNCTION private.guard_formal_document_kind_route()
 FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS zzz_formal_document_kind_route_guard ON public.formal_documents;
CREATE TRIGGER zzz_formal_document_kind_route_guard
 BEFORE INSERT OR UPDATE OF doc_type,workflow_key,workflow_steps,status_code,current_step,current_owner_key,metadata
 ON public.formal_documents FOR EACH ROW
 EXECUTE FUNCTION private.guard_formal_document_kind_route();
