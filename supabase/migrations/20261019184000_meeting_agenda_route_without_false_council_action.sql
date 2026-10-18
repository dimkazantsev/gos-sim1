-- ГОС.ID: служебные повестки заседаний не являются проектами постановлений ГД.
-- Исправляем ложное действие «Внести в Совет ГД» и номер текущей стадии.
-- Подписанные постановления, законопроекты и настоящие постановления ГД не затрагиваются.

CREATE OR REPLACE FUNCTION private.normalize_institution_meeting_document_route()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $fn$
DECLARE v_kind text;v_title text;
BEGIN
 v_kind:=NEW.metadata->>'document_kind';
 IF NOT (
   (NEW.doc_type='meeting_agenda' AND v_kind IN ('institution_meeting_agenda','duma_session_agenda'))
   OR (NEW.doc_type='minutes' AND v_kind='institution_meeting_minutes')
 ) THEN RETURN NEW; END IF;

 IF NEW.doc_type='meeting_agenda' THEN
   v_title:='Повестка утверждена';
 ELSE
   v_title:='Протокол утверждён';
 END IF;

 -- Это отдельная служебная процедура заседания. Её утверждают специализированные
 -- серверные RPC, а не действия маршрута проекта постановления ГД.
 NEW.workflow_steps:=jsonb_build_array(
   jsonb_build_object('code','draft','label',
     CASE WHEN NEW.doc_type='meeting_agenda' THEN 'Подготовка повестки' ELSE 'Подготовка протокола' END,
     'owner',NEW.subject_key,'action',NULL),
   jsonb_build_object('code','published','label',v_title,'owner','system','action',NULL)
 );
 NEW.current_step:=CASE WHEN NEW.status_code='published' THEN 1 ELSE 0 END;
 RETURN NEW;
END;$fn$;

REVOKE ALL ON FUNCTION private.normalize_institution_meeting_document_route()
 FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS zzy_normalize_institution_meeting_document_route ON public.formal_documents;
CREATE TRIGGER zzy_normalize_institution_meeting_document_route
 BEFORE INSERT OR UPDATE OF doc_type,metadata,status_code,status_label,current_step,workflow_steps
 ON public.formal_documents
 FOR EACH ROW EXECUTE FUNCTION private.normalize_institution_meeting_document_route();

-- Исправляем существующие только пять документов-повесток, не меняя их содержание,
-- номер реестра, статус принятия, дату, подписантов или историю.
UPDATE public.formal_documents d
SET current_step=d.current_step
WHERE d.doc_type='meeting_agenda'
 AND d.metadata->>'document_kind' IN ('institution_meeting_agenda','duma_session_agenda')
 AND (
  d.current_step IS DISTINCT FROM (CASE WHEN d.status_code='published' THEN 1 ELSE 0 END)
  OR jsonb_array_length(d.workflow_steps)<>2
  OR d.workflow_steps->0->>'action' IS NOT NULL
 );

-- Действие generic advance допустимо для настоящих проектов постановлений,
-- но служебные повестки/протоколы идут только через управление заседанием.
DO $patch$
DECLARE v_def text;v_old text;v_new text;
BEGIN
 SELECT pg_get_functiondef('public.advance_formal_document(uuid,text,text)'::regprocedure)
 INTO v_def;
 v_old:='if d.id is null then raise exception ''Document not found''; end if;';
 v_new:=v_old||E'\n '||
 'if d.doc_type in (''meeting_agenda'',''minutes'') and '||
 'd.metadata->>''document_kind'' in (''institution_meeting_agenda'',''duma_session_agenda'',''institution_meeting_minutes'') '||
 'then raise exception ''Повестка или протокол утверждается в разделе заседания, а не через маршрут постановления'' '||
 'using errcode=''42501'';end if;';
 IF position(v_old in v_def)=0 THEN
  RAISE EXCEPTION 'advance_formal_document changed; refusing to modify an unknown version';
 END IF;
 EXECUTE replace(v_def,v_old,v_new);
END;$patch$;
