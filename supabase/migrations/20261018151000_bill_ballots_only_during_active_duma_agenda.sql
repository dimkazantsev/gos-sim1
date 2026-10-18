-- ГОС.ID: a submitted parliamentary bill is visible as pending;
-- the real ballot opens only while its question is being considered.
-- These safeguards deliberately do not affect the separate budget/other vote workflows.
CREATE UNIQUE INDEX IF NOT EXISTS game_vote_open_formal_step_uq
ON public.game_votes(formal_document_id,formal_step_code)
WHERE formal_document_id IS NOT NULL AND status='open';

CREATE OR REPLACE FUNCTION private.guard_bill_session_ballot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $guard$
DECLARE v_doc public.formal_documents%rowtype;
BEGIN
 IF NEW.formal_document_id IS NULL OR NEW.status<>'open' THEN RETURN NEW; END IF;
 SELECT * INTO v_doc FROM public.formal_documents WHERE id=NEW.formal_document_id;
 IF v_doc.id IS NULL OR v_doc.workflow_key<>'bill' THEN RETURN NEW; END IF;
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
END;$guard$;
REVOKE ALL ON FUNCTION private.guard_bill_session_ballot() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS guard_bill_session_ballot ON public.game_votes;
CREATE TRIGGER guard_bill_session_ballot
BEFORE INSERT OR UPDATE OF status,formal_step_code ON public.game_votes
FOR EACH ROW EXECUTE FUNCTION private.guard_bill_session_ballot();

CREATE OR REPLACE FUNCTION private.start_bill_ballot_at_agenda()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $open$
DECLARE s public.duma_sessions%rowtype;d public.formal_documents%rowtype;
 v_label text;v_vote uuid;
BEGIN
 IF NEW.status<>'in_progress' OR
   (TG_OP='UPDATE' AND OLD.status='in_progress') THEN RETURN NEW; END IF;
 SELECT * INTO s FROM public.duma_sessions WHERE id=NEW.session_id;
 IF s.status<>'open' OR s.game_id IS DISTINCT FROM NEW.game_id THEN
   RAISE EXCEPTION 'Сначала необходимо открыть заседание Государственной Думы'
     USING ERRCODE='42501';
 END IF;
 SELECT * INTO d FROM public.formal_documents WHERE id=NEW.formal_document_id;
 IF d.id IS NULL OR d.game_id IS DISTINCT FROM NEW.game_id
   OR d.workflow_key<>'bill' OR d.status_code NOT IN ('reading1','reading2','reading3')
 THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('bill-vote:'||d.id||':'||d.status_code,0));
 IF EXISTS(SELECT 1 FROM public.game_votes v WHERE v.formal_document_id=d.id
   AND v.formal_step_code=d.status_code AND v.status='open') THEN RETURN NEW; END IF;
 v_label:=CASE d.status_code WHEN 'reading1' THEN 'I чтение'
  WHEN 'reading2' THEN 'II чтение' ELSE 'III чтение' END;
 INSERT INTO public.game_votes(game_id,stage_no,title,body,voting_mode,status,created_by,
  formal_document_id,formal_step_code,institution_key,procedure_key,
  quorum_kind,quorum_value,majority_kind,majority_value,allow_abstain,tie_breaker_chair,
  pass_transition,fail_transition)
 VALUES(s.game_id,s.stage_no,v_label||': '||d.title,
  CASE WHEN d.status_code='reading2'
   THEN 'Голосование по поправкам и решению о дальнейшем движении законопроекта.'
   ELSE 'Голосование Государственной Думы по законопроекту.' END,
  'mandate','open',COALESCE(auth.uid(),s.chair_user_id,s.created_by),
  d.id,d.status_code,'gd','bill_'||d.status_code,
  'fraction',0.5,
  CASE WHEN d.doc_type='fkz_bill' THEN 'eligible_fraction' ELSE 'eligible_majority' END,
  CASE WHEN d.doc_type='fkz_bill' THEN (2.0/3.0) ELSE 0.5 END,
  true,false,'advance','reject') RETURNING id INTO v_vote;
 RETURN NEW;
END;$open$;
REVOKE ALL ON FUNCTION private.start_bill_ballot_at_agenda() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS zzz_start_bill_ballot_at_agenda ON public.duma_agenda_items;
CREATE TRIGGER zzz_start_bill_ballot_at_agenda
AFTER UPDATE OF status ON public.duma_agenda_items
FOR EACH ROW EXECUTE FUNCTION private.start_bill_ballot_at_agenda();

-- A previously opened ballot also stops accepting votes when its
-- meeting/question is closed or carried over. It resumes only during
-- another actual hearing of the same bill and document step.
CREATE OR REPLACE FUNCTION private.guard_bill_ballot_cast_session()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $cast$
DECLARE v public.game_votes%rowtype;d public.formal_documents%rowtype;
BEGIN
 SELECT * INTO v FROM public.game_votes WHERE id=NEW.vote_id;
 IF v.id IS NULL OR v.formal_document_id IS NULL OR v.status<>'open' THEN RETURN NEW; END IF;
 SELECT * INTO d FROM public.formal_documents WHERE id=v.formal_document_id;
 IF d.workflow_key<>'bill' OR v.formal_step_code NOT IN ('reading1','reading2','reading3') THEN RETURN NEW; END IF;
 IF NOT EXISTS (
  SELECT 1 FROM public.duma_agenda_items i JOIN public.duma_sessions s
    ON s.id=i.session_id AND s.game_id=i.game_id
  WHERE i.game_id=v.game_id AND i.formal_document_id=d.id
   AND i.status='in_progress' AND s.status='open' AND s.stage_no=v.stage_no
 ) THEN
  RAISE EXCEPTION 'Голосование по законопроекту недоступно вне рассмотрения вопроса на открытом заседании ГД'
    USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END;$cast$;
REVOKE ALL ON FUNCTION private.guard_bill_ballot_cast_session() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS guard_bill_ballot_cast_session ON public.game_ballots;
CREATE TRIGGER guard_bill_ballot_cast_session BEFORE INSERT OR UPDATE ON public.game_ballots
FOR EACH ROW EXECUTE FUNCTION private.guard_bill_ballot_cast_session();
