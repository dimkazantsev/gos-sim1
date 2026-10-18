-- ГОС.ID. New document identifiers use the permanent project brand.
-- Historical migrations and existing formal_documents are intentionally not modified.
-- Recompile only the 10 currently active generators that hard-code the old prefix;
-- preserve their bodies, SQL privileges, SECURITY DEFINER, RLS and legal workflows.
DO $brand_functions$
DECLARE
  current_fn record;
  body text;
  replaced integer:=0;
  expected text[]:=ARRAY[
    'private.presidential_system_vote_trigger',
    'private.refresh_government_agenda_document',
    'private.stage4_result_act',
    'private.stage8_create_formal_document',
    'private.sync_duma_session_agenda_document',
    'private.sync_reviewed_crisis_legal_act',
    'private.sync_verified_vote_decision_act',
    'public.create_formal_document',
    'public.propose_presidential_system',
    'public.save_institution_meeting_document'
  ];
BEGIN
  FOR current_fn IN
    SELECT p.oid,n.nspname,p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE p.prokind='f'
      AND (n.nspname||'.'||p.proname)=ANY(expected)
    ORDER BY n.nspname,p.proname
  LOOP
    body:=pg_get_functiondef(current_fn.oid);
    IF body IS NULL
       OR (length(body)-length(replace(body,'ИГРА-','')))/length('ИГРА-')<>1
    THEN
      RAISE EXCEPTION 'Неожиданное состояние генератора %: префикс не найден ровно один раз',
        current_fn.nspname||'.'||current_fn.proname;
    END IF;
    EXECUTE replace(body,'ИГРА-','ГОС.ID-');
    replaced:=replaced+1;
  END LOOP;
  IF replaced<>array_length(expected,1) THEN
    RAISE EXCEPTION 'Неполный набор генераторов документов: % вместо %',
      replaced,array_length(expected,1);
  END IF;
END;$brand_functions$;

-- NEW_REGISTRY_BRAND_TRIGGER
-- A future generator (or an external client) must not accidentally restore
-- the previous prefix. This hook runs on INSERT only. In particular, existing
-- registry numbers are NEVER updated, even when old documents are edited.
CREATE OR REPLACE FUNCTION private.brand_new_formal_document_registry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,private,pg_temp
AS $brand$
BEGIN
  IF NEW.registry_no IS NOT NULL
     AND lower(left(NEW.registry_no,5))='игра-'
  THEN
    NEW.registry_no:='ГОС.ID-'||substring(NEW.registry_no FROM 6);
  END IF;
  RETURN NEW;
END;$brand$;
REVOKE ALL ON FUNCTION private.brand_new_formal_document_registry()
  FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS brand_new_formal_document_registry
  ON public.formal_documents;
CREATE TRIGGER brand_new_formal_document_registry
BEFORE INSERT ON public.formal_documents
FOR EACH ROW EXECUTE FUNCTION private.brand_new_formal_document_registry();
