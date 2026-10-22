-- Stage 12: automatic inclusion of bill packages into the latest DRAFT
-- State Duma agenda. After the meeting opens, only an explicit authorised
-- correction with a justification can change its list of questions.
-- The pre-existing agenda-document trigger regenerates the NPA document on
-- each agenda insert. Existing votes, completed meetings and bill states
-- are never touched.

CREATE OR REPLACE FUNCTION private.sync_stage12_draft_bill_agenda(
 p_session_id uuid, p_document_id uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public','private','pg_temp'
AS $sync12$
DECLARE v_session public.duma_sessions%ROWTYPE;
        v_next integer;
        v_added integer;
BEGIN
 -- Serialises concurrent inserts for one session, including manual RPC inserts.
 SELECT * INTO v_session FROM public.duma_sessions
 WHERE id=p_session_id FOR UPDATE;
 IF v_session.id IS NULL OR v_session.stage_no<>12 OR v_session.status<>'draft'
 THEN RETURN 0; END IF;
 SELECT COALESCE(MAX(agenda_no),0) INTO v_next
 FROM public.duma_agenda_items WHERE session_id=v_session.id;
 WITH candidates AS (
  SELECT d.id,d.created_at FROM public.formal_documents d
  WHERE d.game_id=v_session.game_id
   AND d.stage_no=12 AND d.workflow_key='bill'
   AND d.status_code NOT IN ('rejected','published')
   AND d.current_owner_key IS DISTINCT FROM 'system'
   AND (p_document_id IS NULL OR d.id=p_document_id)
   AND NOT EXISTS (
    SELECT 1 FROM public.duma_agenda_items a
    WHERE a.session_id=v_session.id AND a.formal_document_id=d.id
   )
   -- Never silently reintroduce a bill already decided or withdrawn at
   -- an earlier meeting. Such a decision requires an explicit new process.
   AND NOT EXISTS (
    SELECT 1 FROM public.duma_agenda_items previous
    JOIN public.duma_sessions earlier ON earlier.id=previous.session_id
    WHERE earlier.game_id=v_session.game_id AND earlier.stage_no=12
     AND earlier.id<>v_session.id AND earlier.session_no<v_session.session_no
     AND previous.formal_document_id=d.id
     AND previous.status IN ('completed','withdrawn')
   )
 ), ordered AS (
  SELECT id,ROW_NUMBER() OVER(ORDER BY created_at,id)::integer AS position
  FROM candidates
 )
 INSERT INTO public.duma_agenda_items(session_id,game_id,formal_document_id,agenda_no,status)
 SELECT v_session.id,v_session.game_id,o.id,v_next+o.position,'pending'
 FROM ordered o
 ON CONFLICT (session_id,formal_document_id) DO NOTHING;
 GET DIAGNOSTICS v_added=ROW_COUNT;
 RETURN v_added;
END;
$sync12$;
REVOKE ALL ON FUNCTION private.sync_stage12_draft_bill_agenda(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.stage12_new_bill_to_duma_agenda()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public','private','pg_temp'
AS $new12$
DECLARE v_session_id uuid;
BEGIN
 IF NEW.stage_no<>12 OR NEW.workflow_key<>'bill'
    OR NEW.status_code IN ('rejected','published')
 THEN RETURN NEW; END IF;
 SELECT s.id INTO v_session_id FROM public.duma_sessions s
 WHERE s.game_id=NEW.game_id AND s.stage_no=12 AND s.status='draft'
 ORDER BY s.session_no DESC LIMIT 1;
 IF v_session_id IS NOT NULL THEN
  PERFORM private.sync_stage12_draft_bill_agenda(v_session_id,NEW.id);
 END IF;
 RETURN NEW;
END;
$new12$;
REVOKE ALL ON FUNCTION private.stage12_new_bill_to_duma_agenda() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.stage12_new_duma_session_autofill()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public','private','pg_temp'
AS $session12$
BEGIN
 IF NEW.stage_no=12 AND NEW.status='draft' THEN
  PERFORM private.sync_stage12_draft_bill_agenda(NEW.id,NULL);
 END IF;
 RETURN NEW;
END;
$session12$;
REVOKE ALL ON FUNCTION private.stage12_new_duma_session_autofill() FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS zzz_stage12_bill_autofill_duma_agenda ON public.formal_documents;
CREATE TRIGGER zzz_stage12_bill_autofill_duma_agenda
AFTER INSERT ON public.formal_documents FOR EACH ROW
EXECUTE FUNCTION private.stage12_new_bill_to_duma_agenda();

DROP TRIGGER IF EXISTS zzz_stage12_new_session_autofill ON public.duma_sessions;
CREATE TRIGGER zzz_stage12_new_session_autofill
AFTER INSERT ON public.duma_sessions FOR EACH ROW
EXECUTE FUNCTION private.stage12_new_duma_session_autofill();

-- Controlled post-opening correction: never an automatic refresh.
CREATE OR REPLACE FUNCTION public.correct_duma_agenda_after_open(
 p_session_id uuid,p_document_id uuid,p_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public','private','pg_temp'
AS $correct12$
DECLARE v_session public.duma_sessions%ROWTYPE;
        v_document public.formal_documents%ROWTYPE;
        v_uid uuid:=auth.uid();
        v_no integer;
        v_new_id uuid;
        v_reason text:=btrim(COALESCE(p_reason,''));
BEGIN
 SELECT * INTO v_session FROM public.duma_sessions
 WHERE id=p_session_id FOR UPDATE;
 IF v_session.id IS NULL OR v_session.stage_no<>12 OR v_session.status<>'open' THEN
  RAISE EXCEPTION 'Корректировка доступна только во время открытого заседания Государственной Думы' USING ERRCODE='23514';
 END IF;
 IF v_uid IS NULL OR NOT private.can_manage_duma_session(v_session.game_id,v_uid) THEN
  RAISE EXCEPTION 'Нет полномочий на корректировку повестки' USING ERRCODE='42501';
 END IF;
 PERFORM private.require_duma_stage_open(v_session.game_id,12);
 IF NOT private.is_game_teacher(v_session.game_id) THEN
  PERFORM private.require_game_meeting_registration(v_session.game_id,v_uid,12,'gd');
 END IF;
 IF char_length(v_reason)<10 OR char_length(v_reason)>500 THEN
  RAISE EXCEPTION 'Укажите основание корректировки (от 10 до 500 символов)' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_document FROM public.formal_documents
 WHERE id=p_document_id AND game_id=v_session.game_id;
 IF v_document.id IS NULL OR v_document.stage_no<>12
    OR v_document.workflow_key<>'bill'
    OR v_document.status_code IN ('rejected','published')
    OR v_document.current_owner_key='system' THEN
  RAISE EXCEPTION 'Для корректировки нужен действующий пакет законопроекта Этапа 12' USING ERRCODE='23514';
 END IF;
 IF EXISTS (SELECT 1 FROM public.duma_agenda_items
  WHERE session_id=v_session.id AND formal_document_id=v_document.id) THEN
  RAISE EXCEPTION 'Законопроект уже присутствует в повестке' USING ERRCODE='23505';
 END IF;
 SELECT COALESCE(MAX(agenda_no),0)+1 INTO v_no
 FROM public.duma_agenda_items WHERE session_id=v_session.id;
 INSERT INTO public.duma_agenda_items(session_id,game_id,formal_document_id,agenda_no,status,result_note)
 VALUES(v_session.id,v_session.game_id,v_document.id,v_no,'pending',
        'Корректировка повестки: '||v_reason)
 RETURNING id INTO v_new_id;
 INSERT INTO public.game_events(game_id,round_no,category,severity,title,body,created_by)
 VALUES(v_session.game_id,12,'Заседание ГД','notice',
        'Повестка заседания Государственной Думы скорректирована',
        'Заседание № '||v_session.session_no||'; '||v_document.registry_no||'. Основание: '||v_reason,v_uid);
 RETURN v_new_id;
END;
$correct12$;
REVOKE ALL ON FUNCTION public.correct_duma_agenda_after_open(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.correct_duma_agenda_after_open(uuid,uuid,text) TO authenticated;

-- Reconcile only existing DRAFT Stage 12 agendas. Every inserted question
-- also refreshes the existing formal agenda document via the prior trigger.
DO $backfill12$
DECLARE s record;
BEGIN
 FOR s IN
  SELECT DISTINCT ON (game_id) id
  FROM public.duma_sessions
  WHERE stage_no=12 AND status='draft'
  ORDER BY game_id,session_no DESC
 LOOP
  PERFORM private.sync_stage12_draft_bill_agenda(s.id,NULL);
 END LOOP;
END;
$backfill12$;
