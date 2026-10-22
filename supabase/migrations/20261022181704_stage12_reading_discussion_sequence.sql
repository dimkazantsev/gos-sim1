-- Stage 12: each reading has its own meeting; votes follow discussion.
ALTER TABLE public.duma_sessions ADD COLUMN reading_no smallint NOT NULL DEFAULT 1 CHECK(reading_no BETWEEN 1 AND 3);
ALTER TABLE public.duma_sessions ADD COLUMN reading_protocol boolean NOT NULL DEFAULT false;
ALTER TABLE public.duma_sessions ALTER COLUMN reading_protocol SET DEFAULT true;
ALTER TABLE public.duma_agenda_items
 ADD COLUMN discussion_phase text NOT NULL DEFAULT 'report' CHECK(discussion_phase IN ('report','committee','questions','debate','amendments','vote')),
 ADD COLUMN speaker_user_id uuid,
 ADD COLUMN speech_ends_at timestamptz;

CREATE OR REPLACE FUNCTION private.stage12_agenda_ready(p_session uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.duma_agenda_items WHERE session_id=p_session AND status='pending')
 AND NOT EXISTS(
  SELECT 1 FROM public.duma_agenda_items a JOIN public.duma_sessions s ON s.id=a.session_id
  LEFT JOIN public.formal_documents d ON d.id=a.formal_document_id AND d.game_id=s.game_id
  WHERE a.session_id=p_session AND a.status IN ('pending','in_progress')
   AND (d.id IS NULL OR (d.workflow_key='bill' AND (
    d.status_code<>'reading'||s.reading_no OR NOT EXISTS(
     SELECT 1 FROM public.bill_committee_conclusions c WHERE c.document_id=d.id AND c.game_id=d.game_id AND c.finalized
    ))))
 );
$$;

CREATE OR REPLACE FUNCTION private.stage12_quorum(p_game uuid,p_since timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
 SELECT coalesce(sum(least(coalesce(r.present_mandates,0),private.gd_member_capacity(p_game,r.user_id))),0)>=226
 FROM public.institution_session_registrations r
 WHERE r.game_id=p_game AND r.stage_no=12 AND r.institution_key='gd'
  AND r.presence_updated_at>=p_since;
$$;

CREATE OR REPLACE FUNCTION private.stage12_registration_fresh(p_game uuid,p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
 SELECT NOT EXISTS(SELECT 1 FROM public.duma_sessions WHERE game_id=p_game AND stage_no=12 AND reading_protocol AND status='open')
 OR EXISTS(
  SELECT 1 FROM public.institution_session_registrations r
  JOIN public.institution_meeting_records m ON m.game_id=r.game_id AND m.stage_no=12 AND m.institution_key='gd'
  JOIN public.duma_sessions s ON s.game_id=m.game_id AND s.agenda_document_id=m.agenda_document_id AND s.status='open' AND s.reading_protocol
  WHERE r.game_id=p_game AND r.stage_no=12 AND r.institution_key='gd' AND r.user_id=p_user AND r.presence_updated_at>=m.agenda_approved_at
 );
$$;
REVOKE ALL ON FUNCTION private.stage12_registration_fresh(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.complete_decided_duma_questions(p_session uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
BEGIN
 UPDATE public.duma_agenda_items a SET status='completed',completed_at=now(),
  result_note=coalesce(nullif(a.result_note,''),'Решение по чтению зафиксировано в НПА: '||d.status_label)
 FROM public.formal_documents d,public.duma_sessions s
 WHERE a.session_id=p_session AND s.id=a.session_id AND s.stage_no=12 AND s.reading_protocol
  AND a.status='in_progress' AND d.id=a.formal_document_id AND d.game_id=a.game_id
  AND a.opened_document_step IS NOT NULL AND d.status_code<>a.opened_document_step
  AND NOT EXISTS(SELECT 1 FROM public.game_votes WHERE formal_document_id=d.id AND status='open')
  AND NOT EXISTS(SELECT 1 FROM public.bill_amendment_packs WHERE document_id=d.id AND status IN ('opening','voting'));
END;$$;
REVOKE ALL ON FUNCTION private.complete_decided_duma_questions(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.try_open_stage12_session(p_game uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
DECLARE s public.duma_sessions%rowtype;m public.institution_meeting_records%rowtype;
BEGIN
 SELECT * INTO s FROM public.duma_sessions WHERE game_id=p_game AND stage_no=12 AND reading_protocol AND status='draft' ORDER BY session_no DESC LIMIT 1 FOR UPDATE;
 IF s.id IS NULL OR EXISTS(SELECT 1 FROM public.duma_sessions WHERE game_id=p_game AND status='open') THEN RETURN;END IF;
 SELECT * INTO m FROM public.institution_meeting_records WHERE game_id=p_game AND stage_no=12 AND institution_key='gd';
 IF m.agenda_document_id IS DISTINCT FROM s.agenda_document_id OR m.agenda_approved_at IS NULL
  OR NOT private.stage12_agenda_ready(s.id) OR NOT private.stage12_quorum(p_game,m.agenda_approved_at)
  OR NOT EXISTS(SELECT 1 FROM public.game_stages WHERE game_id=p_game AND stage_no=12 AND status='open')
  OR s.scheduled_end<=now() THEN RETURN;END IF;
 UPDATE public.duma_sessions SET status='open',opened_at=now() WHERE id=s.id AND status='draft';
END;$$;

CREATE OR REPLACE FUNCTION private.stage12_registration_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
BEGIN
 IF NEW.stage_no=12 AND NEW.institution_key='gd' THEN PERFORM private.try_open_stage12_session(NEW.game_id);END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER stage12_registration_opens_meeting AFTER INSERT OR UPDATE ON public.institution_session_registrations
FOR EACH ROW EXECUTE FUNCTION private.stage12_registration_changed();

CREATE OR REPLACE FUNCTION private.stage12_meeting_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
DECLARE m public.institution_meeting_records%rowtype;
BEGIN
 IF NEW.stage_no=12 AND NEW.reading_protocol AND NEW.status='open' AND OLD.status IS DISTINCT FROM 'open' THEN
  SELECT * INTO m FROM public.institution_meeting_records WHERE game_id=NEW.game_id AND stage_no=12 AND institution_key='gd';
  IF m.agenda_document_id IS DISTINCT FROM NEW.agenda_document_id OR m.agenda_approved_at IS NULL
   OR NOT private.stage12_agenda_ready(NEW.id) OR NOT private.stage12_quorum(NEW.game_id,m.agenda_approved_at)
  THEN RAISE EXCEPTION 'Заседание ожидает готовности всех пакетов, утверждённой повестки и кворума 226 из 450' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER stage12_meeting_open_guard BEFORE UPDATE OF status ON public.duma_sessions
FOR EACH ROW EXECUTE FUNCTION private.stage12_meeting_guard();

CREATE OR REPLACE FUNCTION private.stage12_agenda_approval_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
DECLARE s uuid;
BEGIN
 IF NEW.stage_no=12 AND NEW.institution_key='gd' AND NEW.agenda_approved_at IS NOT NULL
  AND (NEW.agenda_approved_at IS DISTINCT FROM OLD.agenda_approved_at OR NEW.agenda_document_id IS DISTINCT FROM OLD.agenda_document_id) THEN
  SELECT id INTO s FROM public.duma_sessions WHERE game_id=NEW.game_id AND stage_no=12 AND reading_protocol AND agenda_document_id=NEW.agenda_document_id AND status='draft';
  IF s IS NOT NULL AND NOT private.stage12_agenda_ready(s) THEN RAISE EXCEPTION 'Сначала профильный комитет и Совет ГД должны передать все пакеты на соответствующее чтение' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER stage12_agenda_approval_guard BEFORE UPDATE ON public.institution_meeting_records
FOR EACH ROW EXECUTE FUNCTION private.stage12_agenda_approval_guard();
CREATE TRIGGER stage12_approval_opens_meeting AFTER UPDATE ON public.institution_meeting_records
FOR EACH ROW WHEN(NEW.stage_no=12 AND NEW.institution_key='gd' AND NEW.agenda_approved_at IS DISTINCT FROM OLD.agenda_approved_at)
EXECUTE FUNCTION private.stage12_registration_changed();

CREATE OR REPLACE FUNCTION public.create_duma_reading_session(p_game_id uuid,p_reading integer,p_title text,p_scheduled_start timestamptz DEFAULT NULL,p_scheduled_end timestamptz DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
DECLARE u uuid:=auth.uid();v_id uuid;v_no integer;v_tz text;v_date date;v_start timestamptz;v_end timestamptz;
BEGIN
 IF u IS NULL OR NOT private.can_manage_duma_session(p_game_id,u) THEN RAISE EXCEPTION 'Нет полномочий на подготовку заседания';END IF;
 PERFORM private.require_duma_stage_open(p_game_id,12);
 IF p_reading IS NULL OR p_reading NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION 'Выберите чтение от 1 до 3';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('duma-session:'||p_game_id,0));
 IF EXISTS(SELECT 1 FROM public.duma_sessions WHERE game_id=p_game_id AND stage_no=12 AND status IN ('draft','open')) THEN RAISE EXCEPTION 'Сначала завершите подготовленное или открытое заседание';END IF;
 SELECT coalesce(settings->>'evaluation_timezone','Asia/Barnaul') INTO v_tz FROM public.games WHERE id=p_game_id;
 v_date:=(now() AT TIME ZONE v_tz)::date;
 v_start:=coalesce(p_scheduled_start,(v_date+time '20:00') AT TIME ZONE v_tz);
 v_end:=coalesce(p_scheduled_end,((v_date+1)+time '00:00') AT TIME ZONE v_tz);
 IF v_end<=v_start OR v_end<=now() THEN RAISE EXCEPTION 'Укажите актуальный срок окончания после начала заседания';END IF;
 SELECT coalesce(max(session_no),0)+1 INTO v_no FROM public.duma_sessions WHERE game_id=p_game_id;
 INSERT INTO public.duma_sessions(game_id,stage_no,reading_no,session_no,title,scheduled_start,scheduled_end,chair_user_id,created_by)
 VALUES(p_game_id,12,p_reading,v_no,coalesce(nullif(btrim(p_title),''),'Государственная Дума · '||p_reading||' чтение'),v_start,v_end,u,u) RETURNING id INTO v_id;
 RETURN v_id;
END;$$;

CREATE OR REPLACE FUNCTION public.set_duma_discussion_phase(p_item_id uuid,p_phase text,p_speaker uuid DEFAULT NULL,p_seconds integer DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
DECLARE a public.duma_agenda_items%rowtype;s public.duma_sessions%rowtype;u uuid:=auth.uid();v_next text;v_max integer;
BEGIN
 SELECT session_id INTO a.session_id FROM public.duma_agenda_items WHERE id=p_item_id;
 SELECT * INTO s FROM public.duma_sessions WHERE id=a.session_id FOR UPDATE;
 SELECT * INTO a FROM public.duma_agenda_items WHERE id=p_item_id FOR UPDATE;
 IF u IS NULL OR s.stage_no IS DISTINCT FROM 12 OR NOT s.reading_protocol OR NOT private.can_manage_duma_session(s.game_id,u) THEN RAISE EXCEPTION 'Обсуждением руководит председатель ГД';END IF;
 PERFORM private.require_duma_stage_open(s.game_id,12);
 IF NOT private.is_game_teacher(s.game_id) THEN PERFORM private.require_game_meeting_registration(s.game_id,u,12,'gd');END IF;
 IF s.status<>'open' OR a.status<>'in_progress' OR a.opened_document_step NOT IN ('reading1','reading2','reading3') THEN RAISE EXCEPTION 'Сначала начните вопрос соответствующего чтения';END IF;
 IF p_speaker IS NOT NULL THEN
  IF p_phase IS DISTINCT FROM a.discussion_phase OR p_phase IN ('amendments','vote') THEN RAISE EXCEPTION 'Недоступная стадия выступления';END IF;
  IF a.speech_ends_at>now() THEN RAISE EXCEPTION 'Сначала завершите текущее выступление';END IF;
  v_max:=CASE WHEN p_phase='questions' THEN 1200 WHEN p_phase='report' AND s.reading_no=2 THEN 420 WHEN p_phase='report' THEN 180 ELSE 86400 END;
  IF p_seconds IS NULL OR p_seconds<1 OR p_seconds>v_max THEN RAISE EXCEPTION 'Нарушен регламент выступления';END IF;
  IF NOT EXISTS(SELECT 1 FROM public.game_members WHERE game_id=s.game_id AND user_id=p_speaker AND kind<>'observer' AND roster_archived_at IS NULL) THEN RAISE EXCEPTION 'Выступающий не участвует в игре';END IF;
  UPDATE public.duma_agenda_items SET speaker_user_id=p_speaker,speech_ends_at=now()+make_interval(secs=>p_seconds) WHERE id=a.id;
 ELSE
  v_next:=CASE a.discussion_phase WHEN 'report' THEN CASE WHEN s.reading_no=1 THEN 'committee' ELSE 'debate' END WHEN 'committee' THEN 'questions' WHEN 'questions' THEN 'debate' WHEN 'debate' THEN CASE WHEN s.reading_no=2 THEN 'amendments' ELSE 'vote' END WHEN 'amendments' THEN 'vote' END;
  IF p_phase IS DISTINCT FROM v_next OR (a.discussion_phase<>'amendments' AND a.speech_ends_at IS NULL) THEN RAISE EXCEPTION 'Пройдите выступления и обсуждение последовательно';END IF;
  IF p_phase='vote' AND EXISTS(SELECT 1 FROM public.bill_amendments WHERE document_id=a.formal_document_id AND status IN ('submitted','voting')) THEN RAISE EXCEPTION 'Сначала рассмотрите все поправки';END IF;
  UPDATE public.duma_agenda_items SET discussion_phase=p_phase,speaker_user_id=NULL,speech_ends_at=NULL WHERE id=a.id;
 END IF;
 INSERT INTO public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,note)
 VALUES(a.formal_document_id,s.game_id,u,'Регламент обсуждения',a.opened_document_step,a.opened_document_step,
  CASE WHEN p_speaker IS NULL THEN 'Переход: '||p_phase ELSE 'Выступление: '||p_phase||', секунд: '||p_seconds END);
END;$$;

CREATE OR REPLACE FUNCTION private.stage12_vote_discussion_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
DECLARE v_doc uuid;v_amend boolean:=false;
BEGIN
 IF NEW.stage_no<>12 OR NEW.status<>'open' THEN RETURN NEW;END IF;
 IF EXISTS(SELECT 1 FROM public.duma_sessions WHERE game_id=NEW.game_id AND stage_no=12 AND status='open' AND NOT reading_protocol) AND NOT EXISTS(SELECT 1 FROM public.duma_sessions WHERE game_id=NEW.game_id AND stage_no=12 AND status='open' AND reading_protocol) THEN RETURN NEW;END IF;
 IF NEW.procedure_key='bill_amendments' THEN
  SELECT document_id INTO v_doc FROM public.bill_amendment_packs WHERE game_id=NEW.game_id AND vote_title=NEW.title AND status IN ('opening','voting') ORDER BY created_at DESC LIMIT 1;
  v_amend:=true;
 ELSIF NEW.formal_step_code IN ('reading1','reading2','reading3') THEN
  SELECT id INTO v_doc FROM public.formal_documents WHERE id=NEW.formal_document_id AND workflow_key='bill';
 END IF;
 IF v_doc IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM public.duma_agenda_items a JOIN public.duma_sessions s ON s.id=a.session_id
  WHERE a.formal_document_id=v_doc AND a.game_id=NEW.game_id AND s.game_id=NEW.game_id AND s.stage_no=12 AND s.status='open' AND a.status='in_progress'
   AND a.opened_document_step='reading'||s.reading_no
   AND a.discussion_phase=CASE WHEN v_amend THEN 'amendments' ELSE 'vote' END
 ) THEN RAISE EXCEPTION 'Голосование откроется после выступлений и обсуждения соответствующего чтения' USING ERRCODE='42501';END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER stage12_vote_discussion_guard BEFORE INSERT OR UPDATE OF status ON public.game_votes FOR EACH ROW EXECUTE FUNCTION private.stage12_vote_discussion_guard();

CREATE OR REPLACE FUNCTION private.stage12_ballot_discussion_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
DECLARE v public.game_votes%rowtype;v_doc uuid;v_amend boolean:=false;
BEGIN
 SELECT * INTO v FROM public.game_votes WHERE id=NEW.vote_id;
 IF v.stage_no IS DISTINCT FROM 12 OR v.status<>'open' THEN RETURN NEW;END IF;
 IF EXISTS(SELECT 1 FROM public.duma_sessions WHERE game_id=v.game_id AND stage_no=12 AND status='open' AND NOT reading_protocol) AND NOT EXISTS(SELECT 1 FROM public.duma_sessions WHERE game_id=v.game_id AND stage_no=12 AND status='open' AND reading_protocol) THEN RETURN NEW;END IF;
 IF v.procedure_key='bill_amendments' THEN
  SELECT document_id INTO v_doc FROM public.bill_amendment_packs WHERE vote_id=v.id;v_amend:=true;
 ELSIF v.formal_step_code IN ('reading1','reading2','reading3') THEN
  SELECT id INTO v_doc FROM public.formal_documents WHERE id=v.formal_document_id AND workflow_key='bill';
 END IF;
 IF v_doc IS NOT NULL AND NOT private.stage12_registration_fresh(v.game_id,NEW.voter_id) THEN RAISE EXCEPTION 'Сначала подтвердите явку на текущее заседание' USING ERRCODE='42501';END IF;
 IF v_doc IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.duma_agenda_items a JOIN public.duma_sessions s ON s.id=a.session_id
  WHERE a.formal_document_id=v_doc AND a.game_id=v.game_id AND s.game_id=v.game_id AND s.stage_no=12 AND s.status='open' AND a.status='in_progress'
   AND a.opened_document_step='reading'||s.reading_no AND a.discussion_phase=CASE WHEN v_amend THEN 'amendments' ELSE 'vote' END)
 THEN RAISE EXCEPTION 'Бюллетень недоступен до завершения обсуждения на заседании' USING ERRCODE='42501';END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER stage12_ballot_discussion_guard BEFORE INSERT OR UPDATE ON public.game_ballots FOR EACH ROW EXECUTE FUNCTION private.stage12_ballot_discussion_guard();
REVOKE ALL ON FUNCTION private.stage12_ballot_discussion_guard() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.stage12_question_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
DECLARE s public.duma_sessions%rowtype;
BEGIN
 SELECT * INTO s FROM public.duma_sessions WHERE id=NEW.session_id FOR UPDATE;
 IF s.stage_no=12 AND s.reading_protocol AND NEW.status='in_progress' AND OLD.status<>'in_progress' THEN
  IF NOT private.stage12_agenda_ready(s.id) THEN RAISE EXCEPTION 'Рассмотрение ожидает готовности всех законопроектов повестки';END IF;
  IF EXISTS(SELECT 1 FROM public.formal_documents d WHERE d.id=NEW.formal_document_id AND d.game_id=s.game_id AND d.workflow_key='bill' AND d.status_code<>'reading'||s.reading_no) THEN RAISE EXCEPTION 'Пакет не передан на соответствующее чтение';END IF;
  NEW.discussion_phase:='report';NEW.speaker_user_id:=NULL;NEW.speech_ends_at:=NULL;
 END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER stage12_question_guard BEFORE UPDATE OF status ON public.duma_agenda_items FOR EACH ROW EXECUTE FUNCTION private.stage12_question_guard();

CREATE OR REPLACE FUNCTION private.stage12_bill_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
BEGIN
 IF NEW.stage_no=12 AND NEW.workflow_key='bill' AND NEW.status_code IS DISTINCT FROM OLD.status_code THEN
  IF NEW.status_code IN ('rejected','published') THEN
   UPDATE public.duma_agenda_items a SET status='withdrawn',completed_at=now(),result_note='Документ завершил движение до чтения: '||NEW.status_label
   FROM public.duma_sessions s WHERE s.id=a.session_id AND s.game_id=NEW.game_id AND s.stage_no=12 AND s.reading_protocol AND s.status='draft' AND a.formal_document_id=NEW.id AND a.status='pending';
  END IF;
  PERFORM private.stage12_new_bill_to_duma_agenda_refresh(NEW.game_id,NEW.id);
 END IF;
 RETURN NEW;
END;$$;

CREATE OR REPLACE FUNCTION private.stage12_new_bill_to_duma_agenda_refresh(p_game uuid,p_document uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
DECLARE v_session uuid;
BEGIN
 SELECT id INTO v_session FROM public.duma_sessions WHERE game_id=p_game AND stage_no=12 AND status='draft' ORDER BY session_no DESC LIMIT 1;
 IF v_session IS NOT NULL THEN PERFORM private.sync_stage12_draft_bill_agenda(v_session,p_document);END IF;
 PERFORM private.try_open_stage12_session(p_game);
END;$$;
CREATE TRIGGER stage12_bill_readiness_changed AFTER UPDATE OF status_code ON public.formal_documents
FOR EACH ROW EXECUTE FUNCTION private.stage12_bill_changed();

CREATE OR REPLACE FUNCTION private.stage12_rebase_independent_amendments()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
DECLARE a public.bill_amendments%rowtype;p public.bill_amendment_packs%rowtype;v_pos integer;v_count integer:=0;
BEGIN
 IF NEW.stage_no<>12 OR NEW.workflow_key<>'bill' OR NEW.body_text IS NOT DISTINCT FROM OLD.body_text
  OR NEW.metadata->>'bill_amendment_pack_id' IS NOT DISTINCT FROM OLD.metadata->>'bill_amendment_pack_id' THEN RETURN NEW;END IF;
 SELECT * INTO p FROM public.bill_amendment_packs WHERE id=(NEW.metadata->>'bill_amendment_pack_id')::uuid AND document_id=NEW.id AND status='accepted';
 IF p.id IS NULL THEN RETURN NEW;END IF;
 FOR a IN SELECT * FROM public.bill_amendments WHERE document_id=NEW.id AND game_id=NEW.game_id AND status='submitted' AND source_body_text=OLD.body_text FOR UPDATE LOOP
  IF EXISTS(SELECT 1 FROM public.bill_amendments changed WHERE changed.id=ANY(p.amendment_ids)
   AND int4range(changed.quote_start,changed.quote_start+length(changed.old_text)) && int4range(a.quote_start,a.quote_start+length(a.old_text))) THEN CONTINUE;END IF;
  v_pos:=strpos(NEW.body_text,a.old_text);
  IF v_pos=0 OR strpos(substring(NEW.body_text FROM v_pos+1),a.old_text)>0 THEN CONTINUE;END IF;
  UPDATE public.bill_amendments SET source_body_text=NEW.body_text,quote_start=v_pos,updated_at=now() WHERE id=a.id;
  v_count:=v_count+1;
 END LOOP;
 IF v_count>0 THEN
  INSERT INTO public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,note)
  VALUES(NEW.id,NEW.game_id,auth.uid(),'Независимые поправки сохранены для рассмотрения',NEW.status_code,NEW.status_code,'Проверены неизменность и уникальность цитат. Поправок: '||v_count);
 END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER stage12_rebase_independent_amendments AFTER UPDATE OF body_text ON public.formal_documents
FOR EACH ROW EXECUTE FUNCTION private.stage12_rebase_independent_amendments();
REVOKE ALL ON FUNCTION private.stage12_bill_changed(),private.stage12_new_bill_to_duma_agenda_refresh(uuid,uuid),private.stage12_rebase_independent_amendments() FROM PUBLIC,anon,authenticated;

-- Use the existing game WebSocket. Only phase changes are sent, never timer ticks.
DO $publication$
DECLARE v_table text;
BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
  FOREACH v_table IN ARRAY ARRAY['duma_sessions','duma_agenda_items','bill_amendments','bill_amendment_packs'] LOOP
   IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=v_table) THEN
    EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',v_table);
   END IF;
  END LOOP;
 END IF;
END;$publication$;

-- No historical meeting, document or vote is rewritten by this migration.
CREATE OR REPLACE FUNCTION public.get_stage12_bill_review_subjects(p_document_id uuid)
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
DECLARE d public.formal_documents%rowtype;u uuid:=auth.uid();v_subject text;v_result text[]:='{}';
BEGIN
 SELECT * INTO d FROM public.formal_documents WHERE id=p_document_id;
 IF d.id IS NULL OR d.stage_no<>12 OR d.workflow_key<>'bill' OR u IS NULL
  OR d.status_code NOT IN ('registered','committee','council','reading1','amendments','reading2','reading3')
  OR NOT private.bill_amendment_actor_available(d.game_id,u) THEN RETURN v_result;END IF;
 FOREACH v_subject IN ARRAY ARRAY['president','gd_deputy','sf','sf_member','government','region','ks','vs'] LOOP
  IF private.can_create_formal_subject(d.game_id,u,v_subject) THEN v_result:=array_append(v_result,v_subject);END IF;
 END LOOP;
 RETURN v_result;
END;$$;
CREATE OR REPLACE FUNCTION public.submit_stage12_bill_review(p_document_id uuid,p_subject_key text,p_review text,p_competence text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
DECLARE d public.formal_documents%rowtype;u uuid:=auth.uid();v_id uuid;v_subject text;v_review text:=btrim(coalesce(p_review,''));
BEGIN
 SELECT * INTO d FROM public.formal_documents WHERE id=p_document_id FOR UPDATE;
 IF u IS NULL OR p_subject_key IS NULL OR NOT(p_subject_key=ANY(public.get_stage12_bill_review_subjects(p_document_id))) THEN RAISE EXCEPTION 'Нет полномочий субъекта инициативы для отзыва по этому законопроекту' USING ERRCODE='42501';END IF;
 PERFORM private.require_duma_stage_open(d.game_id,12);
 IF length(v_review) NOT BETWEEN 30 AND 8000 OR length(coalesce(p_competence,''))>2000 THEN RAISE EXCEPTION 'Отзыв должен содержать от 30 до 8000 символов';END IF;
 IF p_subject_key IN ('ks','vs') AND length(btrim(coalesce(p_competence,'')))<10 THEN RAISE EXCEPTION 'Укажите связь отзыва с вопросами ведения суда';END IF;
 v_subject:=CASE p_subject_key WHEN 'president' THEN 'Президент РФ' WHEN 'gd_deputy' THEN 'Депутат ГД' WHEN 'sf' THEN 'Совет Федерации' WHEN 'sf_member' THEN 'Сенатор РФ' WHEN 'government' THEN 'Правительство РФ' WHEN 'region' THEN 'Законодательный орган субъекта РФ' WHEN 'ks' THEN 'Конституционный Суд РФ' ELSE 'Верховный Суд РФ' END;
 INSERT INTO public.formal_support_documents(document_id,game_id,stage_code,category,title,note,created_by)
 VALUES(d.id,d.game_id,d.status_code,'review','Отзыв · '||v_subject,v_review||CASE WHEN p_subject_key IN ('ks','vs') THEN E'\nВопросы ведения суда: '||btrim(p_competence) ELSE '' END,u) RETURNING id INTO v_id;
 INSERT INTO public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,note)
 VALUES(d.id,d.game_id,u,'Субъект инициативы направил отзыв',d.status_code,d.status_code,v_subject);
 RETURN v_id;
END;$$;
REVOKE ALL ON FUNCTION public.get_stage12_bill_review_subjects(uuid),public.submit_stage12_bill_review(uuid,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_stage12_bill_review_subjects(uuid),public.submit_stage12_bill_review(uuid,text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION private.stage12_agenda_ready(uuid),private.stage12_quorum(uuid,timestamptz),private.try_open_stage12_session(uuid),private.stage12_registration_changed(),private.stage12_meeting_guard(),private.stage12_agenda_approval_guard(),private.stage12_vote_discussion_guard(),private.stage12_question_guard() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_duma_reading_session(uuid,integer,text,timestamptz,timestamptz),public.set_duma_discussion_phase(uuid,text,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_duma_reading_session(uuid,integer,text,timestamptz,timestamptz),public.set_duma_discussion_phase(uuid,text,uuid,integer) TO authenticated;

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
   AND CASE v_session.reading_no WHEN 1 THEN d.status_code IN ('draft','revision','registered','committee','council','reading1') WHEN 2 THEN d.status_code IN ('amendments','reading2') ELSE d.status_code='reading3' END
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
     AND (previous.status='withdrawn' OR (previous.status='completed' AND previous.opened_document_step=d.status_code))
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
CREATE OR REPLACE FUNCTION private.start_bill_ballot_at_agenda()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $open$
DECLARE s public.duma_sessions%rowtype;d public.formal_documents%rowtype;
 v_label text;v_vote uuid;
BEGIN
 SELECT * INTO s FROM public.duma_sessions WHERE id=NEW.session_id;
 IF NEW.status<>'in_progress' THEN RETURN NEW;END IF;
 IF s.stage_no=12 AND s.reading_protocol THEN
  IF NEW.discussion_phase<>'vote' OR (TG_OP='UPDATE' AND OLD.discussion_phase='vote') THEN RETURN NEW;END IF;
 ELSIF TG_OP='UPDATE' AND OLD.status='in_progress' THEN RETURN NEW;END IF;
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
DROP TRIGGER IF EXISTS zzz_start_bill_ballot_at_agenda ON public.duma_agenda_items;
CREATE TRIGGER zzz_start_bill_ballot_at_agenda AFTER UPDATE OF status,discussion_phase ON public.duma_agenda_items
FOR EACH ROW EXECUTE FUNCTION private.start_bill_ballot_at_agenda();
create or replace function public.get_bill_amendments(p_document_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare d public.formal_documents%rowtype;uid uuid:=auth.uid();subjects jsonb:='[]';subject text;available boolean;
begin
 select * into d from public.formal_documents where id=p_document_id;
 if d.id is null or d.workflow_key<>'bill' or uid is null or (not private.is_platform_admin() and not exists(
  select 1 from public.game_members m where m.game_id=d.game_id and m.user_id=uid and m.roster_archived_at is null
 )) then raise exception 'Нет доступа к поправкам этого законопроекта';end if;
 available:=private.bill_amendment_actor_available(d.game_id,uid);
 if available then
  foreach subject in array array['president','gd_deputy','sf','sf_member','government','region','ks','vs'] loop
   if private.can_create_formal_subject(d.game_id,uid,subject) then subjects:=subjects||jsonb_build_array(subject);end if;
  end loop;
 end if;
 return jsonb_build_object('document_id',d.id,'body_text',coalesce(d.body_text,''),'status_code',d.status_code,
  'can_manage',private.can_manage_bill_amendments(d.id,uid),'subjects',subjects,
  'hearing_ready',d.stage_no<>12 OR EXISTS(SELECT 1 FROM public.duma_agenda_items a JOIN public.duma_sessions s ON s.id=a.session_id WHERE a.formal_document_id=d.id AND a.game_id=d.game_id AND s.game_id=d.game_id AND s.stage_no=12 AND s.status='open' AND a.status='in_progress' AND (NOT s.reading_protocol OR (s.reading_no=2 AND a.discussion_phase='amendments'))),
  'can_submit',available and jsonb_array_length(subjects)>0 and d.status_code in ('amendments','reading2')
   and not exists(select 1 from public.game_votes v where v.formal_document_id=d.id and v.status='open'),
  'pending_count',(select count(*) from public.bill_amendments a where a.document_id=d.id and a.status in ('submitted','voting')),
  'open_vote_id',(select vote_id from public.bill_amendment_packs where document_id=d.id and status='voting'),
  'amendments',(select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('can_withdraw',available and a.author_id=uid and a.status='submitted','stale',a.source_body_text is distinct from coalesce(d.body_text,'')) order by a.created_at,a.id),'[]'::jsonb) from public.bill_amendments a where a.document_id=d.id),
  'packs',(select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('result_code',v.result_code,'result_label',v.result_label) order by p.created_at desc,p.id),'[]'::jsonb) from public.bill_amendment_packs p left join public.game_votes v on v.id=p.vote_id where p.document_id=d.id));
end;$$;

CREATE OR REPLACE FUNCTION public.close_duma_session(p_session_id uuid, p_create_next boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare s public.duma_sessions%rowtype;v_uid uuid:=(select auth.uid());v_next uuid;v_next_no integer;v_carried integer;
begin
 select * into s from public.duma_sessions where id=p_session_id for update;
 if s.id is null then raise exception 'Session not found'; end if;
 if not private.can_manage_duma_session(s.game_id,v_uid) then raise exception 'State Duma chair / teacher access required'; end if;
 perform private.require_duma_stage_open(s.game_id,s.stage_no);
 if s.status<>'open' then raise exception 'Session is not open'; end if;

 perform private.complete_decided_duma_questions(s.id);
 update public.duma_sessions set status='closed',closed_at=now() where id=s.id;
 select count(*)::integer into v_carried from public.duma_agenda_items where session_id=s.id and status in ('pending','in_progress');
 update public.duma_agenda_items set status='carried_over' where session_id=s.id and status in ('pending','in_progress');

 if p_create_next and v_carried>0 then
   select coalesce(max(session_no),0)+1 into v_next_no from public.duma_sessions where game_id=s.game_id;
   insert into public.duma_sessions(game_id,reading_no,reading_protocol,session_no,title,status,chair_user_id,created_by)
   values(s.game_id,s.reading_no,s.reading_protocol,v_next_no,'Заседание Государственной Думы №'||v_next_no,'draft',v_uid,v_uid)
   returning id into v_next;

   insert into public.duma_agenda_items(session_id,game_id,formal_document_id,agenda_no,status)
   select v_next,s.game_id,formal_document_id,(select coalesce(max(agenda_no),0) from public.duma_agenda_items where session_id=v_next)+row_number() over(order by agenda_no),'pending'
   from public.duma_agenda_items
   where session_id=s.id and status='carried_over'
   and not exists(select 1 from public.duma_agenda_items present where present.session_id=v_next and present.formal_document_id=duma_agenda_items.formal_document_id)
   order by agenda_no;
 end if;

 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(s.game_id,12,'Заседание ГД','notice','Заседание Государственной Думы закрыто',
   'Рассмотрено: '||(select count(*) from public.duma_agenda_items where session_id=s.id and status='completed')||
   '; перенесено: '||v_carried,v_uid);

 return jsonb_build_object('carried_over',v_carried,'next_session_id',v_next);
end;$function$;

create or replace function private.auto_close_expired_duma_sessions()
returns integer
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare s public.duma_sessions%rowtype;v_next uuid;v_next_no integer;v_carried integer;v_closed integer:=0;
begin
 for s in
  select * from public.duma_sessions
  where status='open' and scheduled_end is not null and scheduled_end<=now()
  order by scheduled_end
  for update skip locked
 loop
  perform private.complete_decided_duma_questions(s.id);
 update public.duma_sessions set status='closed',closed_at=now() where id=s.id;
  select count(*)::integer into v_carried
  from public.duma_agenda_items where session_id=s.id and status in ('pending','in_progress');
  update public.duma_agenda_items set status='carried_over'
  where session_id=s.id and status in ('pending','in_progress');

  if v_carried>0 then
   select coalesce(max(session_no),0)+1 into v_next_no from public.duma_sessions where game_id=s.game_id;
   insert into public.duma_sessions(game_id,stage_no,reading_no,reading_protocol,session_no,title,status,chair_user_id,created_by)
   values(s.game_id,s.stage_no,s.reading_no,s.reading_protocol,v_next_no,'Заседание Государственной Думы №'||v_next_no,'draft',s.chair_user_id,s.created_by)
   returning id into v_next;
   insert into public.duma_agenda_items(session_id,game_id,formal_document_id,agenda_no,status)
   select v_next,s.game_id,formal_document_id,(select coalesce(max(agenda_no),0) from public.duma_agenda_items where session_id=v_next)+row_number() over(order by agenda_no),'pending'
   from public.duma_agenda_items
   where session_id=s.id and status='carried_over'
   and not exists(select 1 from public.duma_agenda_items present where present.session_id=v_next and present.formal_document_id=duma_agenda_items.formal_document_id)
   order by agenda_no;
  else v_next:=null; end if;

  insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
  values(
   s.game_id,s.stage_no,'Заседание ГД','notice','Заседание Государственной Думы завершено по регламенту',
   'Срок заседания истёк автоматически. Рассмотрено: '||
   (select count(*) from public.duma_agenda_items where session_id=s.id and status='completed')||
   '; перенесено: '||v_carried,
   s.created_by
  );
  v_closed:=v_closed+1;
 end loop;
 return v_closed;
end;$$;

CREATE OR REPLACE FUNCTION private.vote_present_weight(p_vote game_votes)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
select case
 when p_vote.institution_key='gd' and coalesce((p_vote.electorate_snapshot->>'attendance_required')::boolean,false) then (
  select coalesce(sum(least(
    private.gd_effective_present(p_vote.game_id,r.user_id,r.present_mandates),
    coalesce((p_vote.electorate_snapshot->'weights'->>r.user_id::text)::numeric,0),
    private.gd_member_capacity(p_vote.game_id,r.user_id)
  )),0)
  from public.institution_session_registrations r
  where r.game_id=p_vote.game_id and r.stage_no=p_vote.stage_no and r.institution_key='gd'
   and (p_vote.stage_no<>12 or p_vote.status<>'open' or private.stage12_registration_fresh(p_vote.game_id,r.user_id))
 )
 when coalesce((p_vote.electorate_snapshot->>'attendance_required')::boolean,false) then (
 select coalesce(sum(s.value::numeric),0) from jsonb_each_text(p_vote.electorate_snapshot->'weights') s
 where exists(select 1 from public.institution_session_registrations r where r.game_id=p_vote.game_id and r.stage_no=p_vote.stage_no and r.institution_key=p_vote.institution_key and r.user_id::text=s.key))
 else (select coalesce(sum(weight),0) from public.game_ballots where vote_id=p_vote.id) end;
$function$;
CREATE OR REPLACE FUNCTION private.require_game_meeting_registration(p_game uuid, p_user uuid, p_stage integer, p_institution text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
begin
 if p_user is null or not exists (
  select 1 from public.game_members m where m.game_id=p_game and m.user_id=p_user
    and m.kind='student' and m.roster_archived_at is null
 ) then
  if p_user=(select auth.uid()) and private.is_game_teacher(p_game) then return;end if;
  raise exception 'Требуются полномочия действующего участника';
 end if;
 if not private.vote_member_has_office(p_game,p_user,p_institution) then
   raise exception 'Для этого органа отсутствуют полномочия';
 end if;
 -- The old games may contain attendance records created without any agenda.
 -- Attendance alone must never unlock KSRF proceedings on stages 2 or 3.
 if p_institution='ksrf' and p_stage in (2,3) and not exists(
   select 1 from public.institution_meeting_records m
   join public.formal_documents d on d.game_id=m.game_id and d.id=m.agenda_document_id
   where m.game_id=p_game and m.stage_no=p_stage and m.institution_key='ksrf'
     and m.agenda_approved_at is not null and d.status_code='published'
     and length(btrim(coalesce(m.agenda_body,'')))>=30
 ) then
   raise exception 'Сначала составьте и утвердите повестку заседания КСРФ';
 end if;
 -- A registered chair cannot resume substantive work in an officially
 -- completed/paused stage. Agenda preparation and check-in are separate RPCs.
 if p_institution='ksrf' and p_stage in (2,3) and not exists(
   select 1 from public.game_stages s join public.games g on g.id=s.game_id
   where s.game_id=p_game and s.stage_no=p_stage and s.status='open'
     and g.status='running' and g.turn_open
     and (s.deadline is null or s.deadline>clock_timestamp())
     and (g.turn_ends_at is null or g.turn_ends_at>clock_timestamp())
 ) then
   raise exception 'Этап завершён или ещё не открыт. Для работы требуется открытый этап КСРФ.';
 end if;
 if not exists (
  select 1 from public.institution_session_registrations r
  where r.game_id=p_game and r.user_id=p_user and r.stage_no=p_stage and r.institution_key=p_institution
 ) then
   raise exception 'Сначала зарегистрируйтесь на заседание органа: %',p_institution;
 end if;
 if p_stage=12 and p_institution='gd' and not private.stage12_registration_fresh(p_game,p_user) then
  raise exception 'Сначала подтвердите явку на текущее заседание Государственной Думы';
 end if;
end $function$;
