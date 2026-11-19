-- No direct client text edits: use the revision-tracked update_formal_draft RPC,
-- which serializes with ballot submission and checks the first actual ballot.
-- System-generated texts and other non-text document updates remain unaffected.
CREATE OR REPLACE FUNCTION private.guard_direct_formal_text_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
BEGIN
  IF current_user IN ('authenticated','anon')
     AND (NEW.title IS DISTINCT FROM OLD.title OR NEW.body_text IS DISTINCT FROM OLD.body_text)
  THEN RAISE EXCEPTION 'Текст НПА редактируется только через редактор с проверкой голосов'
    USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END
$function$
;
CREATE TRIGGER guard_direct_formal_text_write
 BEFORE UPDATE OF title, body_text ON public.formal_documents
 FOR EACH ROW EXECUTE FUNCTION private.guard_direct_formal_text_write();
REVOKE ALL ON FUNCTION private.guard_direct_formal_text_write() FROM PUBLIC,anon,authenticated;
