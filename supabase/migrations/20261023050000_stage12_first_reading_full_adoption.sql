-- Этап 12. Статья 119 Регламента ГД: отдельный вариант принятия закона в целом в I чтении.
-- Старые заседания и все прежние бюллетени сохраняют прежний порядок.
ALTER TABLE public.duma_agenda_items ADD COLUMN IF NOT EXISTS first_reading_route text NOT NULL DEFAULT 'continue'
  CHECK(first_reading_route IN ('continue','adopt_in_full'));
ALTER TABLE public.duma_agenda_items ADD COLUMN IF NOT EXISTS first_reading_legal_note text;

CREATE OR REPLACE FUNCTION public.set_duma_first_reading_route(
 p_item_id uuid,p_route text,p_legal_note text DEFAULT NULL,p_not_joint boolean DEFAULT false
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,private,pg_temp AS $$
DECLARE a public.duma_agenda_items%rowtype;s public.duma_sessions%rowtype;
 d public.formal_documents%rowtype;u uuid:=auth.uid();
BEGIN
 SELECT * INTO a FROM public.duma_agenda_items WHERE id=p_item_id FOR UPDATE;
 IF a.id IS NULL THEN RAISE EXCEPTION 'Вопрос повестки не найден';END IF;
 SELECT * INTO s FROM public.duma_sessions WHERE id=a.session_id;
 SELECT * INTO d FROM public.formal_documents WHERE id=a.formal_document_id;
 IF u IS NULL OR NOT private.can_manage_duma_session(a.game_id,u) THEN RAISE EXCEPTION 'Выбор процедуры делает председательствующий Государственной Думы' USING ERRCODE='42501';END IF;
 PERFORM private.require_duma_stage_open(a.game_id,12);
 IF NOT private.is_game_teacher(a.game_id) THEN PERFORM private.require_game_meeting_registration(a.game_id,u,12,'gd');END IF;
 IF s.game_id IS DISTINCT FROM a.game_id OR s.stage_no<>12 OR NOT s.reading_protocol OR s.reading_no<>1
  OR s.status<>'open' OR a.status<>'in_progress'
  OR a.discussion_phase NOT IN ('report','committee','questions','debate')
  OR a.opened_document_step<>'reading1'
  OR d.game_id IS DISTINCT FROM a.game_id OR d.workflow_key<>'bill'
  OR d.doc_type NOT IN ('fz_bill','fkz_bill') OR d.status_code<>'reading1'
  THEN RAISE EXCEPTION 'Выбрать решение можно только до голосования в первом чтении' USING ERRCODE='23514';END IF;
 IF p_route NOT IN ('continue','adopt_in_full') OR p_route IS NULL THEN RAISE EXCEPTION 'Недопустимый порядок рассмотрения';END IF;
 IF EXISTS(SELECT 1 FROM public.game_votes v WHERE v.formal_document_id=d.id AND v.formal_step_code='reading1')
  THEN RAISE EXCEPTION 'Решение зафиксировано: голосование по этому чтению уже создавалось' USING ERRCODE='23514';END IF;
 IF p_route='adopt_in_full' AND
  (NOT p_not_joint OR length(btrim(coalesce(p_legal_note,'')))<25
   OR lower(coalesce(d.metadata->>'joint_jurisdiction','false')) IN ('true','1','yes'))
 THEN RAISE EXCEPTION 'Принятие в целом в I чтении запрещено по предметам совместного ведения; требуется правовое обоснование' USING ERRCODE='23514';END IF;
 UPDATE public.duma_agenda_items SET first_reading_route=p_route,
  first_reading_legal_note=CASE WHEN p_route='adopt_in_full' THEN left(btrim(p_legal_note),2000) ELSE NULL END
 WHERE id=a.id;
 INSERT INTO public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,note)
 VALUES(d.id,d.game_id,u,'Подготовка голосования первого чтения','reading1','reading1',
  CASE WHEN p_route='adopt_in_full' THEN 'Постановка вопроса о принятии закона в целом: '||left(btrim(p_legal_note),2000)
   ELSE 'Постановка вопроса о принятии законопроекта в первом чтении с дальнейшими поправками' END);
END;$$;
REVOKE ALL ON FUNCTION public.set_duma_first_reading_route(uuid,text,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_duma_first_reading_route(uuid,text,text,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION private.stage12_first_reading_ballot_route()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,private,pg_temp AS $$
DECLARE d public.formal_documents%rowtype;v_route text;v_note text;
BEGIN
 IF NEW.formal_document_id IS NULL OR NEW.formal_step_code<>'reading1' OR NEW.status<>'open'
   THEN RETURN NEW;END IF;
 SELECT * INTO d FROM public.formal_documents WHERE id=NEW.formal_document_id;
 IF d.id IS NULL OR d.game_id IS DISTINCT FROM NEW.game_id
  OR d.stage_no<>12 OR d.status_code<>'reading1' OR d.workflow_key<>'bill'
  OR d.doc_type NOT IN ('fz_bill','fkz_bill') THEN RETURN NEW;END IF;
 SELECT a.first_reading_route,a.first_reading_legal_note INTO v_route,v_note
 FROM public.duma_agenda_items a JOIN public.duma_sessions s ON s.id=a.session_id
 WHERE a.game_id=NEW.game_id AND a.formal_document_id=d.id AND a.status='in_progress'
  AND a.opened_document_step='reading1' AND a.discussion_phase='vote'
  AND s.game_id=NEW.game_id AND s.stage_no=12 AND s.reading_no=1
  AND s.reading_protocol AND s.status='open'
 ORDER BY a.started_at DESC NULLS LAST LIMIT 1;
 IF v_route<>'adopt_in_full' THEN RETURN NEW;END IF;
 IF length(btrim(coalesce(v_note,'')))<25
  OR lower(coalesce(d.metadata->>'joint_jurisdiction','false')) IN ('true','1','yes')
 THEN RAISE EXCEPTION 'Законопроект не может быть принят в целом в I чтении без проверки предмета ведения' USING ERRCODE='23514';END IF;
 IF NEW.institution_key<>'gd' OR NEW.voting_mode<>'mandate'
  OR NEW.quorum_kind<>'fraction' OR coalesce(NEW.quorum_value,0)<0.5
  OR NEW.pass_transition<>'advance' OR NEW.fail_transition<>'reject'
  OR (d.doc_type='fkz_bill' AND (NEW.majority_kind<>'eligible_fraction' OR coalesce(NEW.majority_value,0)<(2.0/3.0-0.000001)))
  OR (d.doc_type='fz_bill' AND (NEW.majority_kind NOT IN ('eligible_majority','eligible_fraction')
   OR NEW.majority_kind='eligible_fraction' AND coalesce(NEW.majority_value,0)<0.5))
 THEN RAISE EXCEPTION 'Запрещено снижать большинство, необходимое для принятия закона' USING ERRCODE='23514';END IF;
 NEW.procedure_key:='bill_reading1_full';
 NEW.title:='I чтение · Принять закон в целом: '||d.title;
 NEW.body:='Принятие закона сразу в целом без второго и третьего чтений по статье 119 Регламента Государственной Думы (исключая предметы совместного ведения)';
 RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION private.stage12_first_reading_ballot_route() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS stage12_first_reading_ballot_route ON public.game_votes;
CREATE TRIGGER stage12_first_reading_ballot_route BEFORE INSERT ON public.game_votes
FOR EACH ROW EXECUTE FUNCTION private.stage12_first_reading_ballot_route();

CREATE OR REPLACE FUNCTION private.stage12_first_reading_full_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,private,pg_temp AS $$
DECLARE v_min integer;
BEGIN
 IF OLD.stage_no<>12 OR OLD.workflow_key<>'bill'
  OR OLD.doc_type NOT IN ('fz_bill','fkz_bill')
  OR OLD.status_code<>'reading1' OR NEW.status_code<>'amendments'
  THEN RETURN NEW; END IF;
 v_min:=CASE WHEN OLD.doc_type='fkz_bill' THEN 300 ELSE 226 END;
 IF EXISTS(SELECT 1 FROM public.game_votes v
   WHERE v.game_id=OLD.game_id AND v.formal_document_id=OLD.id
     AND v.formal_step_code='reading1' AND v.procedure_key='bill_reading1_full'
     AND v.status='closed' AND v.result_code='passed' AND v.result_quorum_met
     AND v.result_yes>=v_min)
 THEN
  NEW.current_step:=9;
  NEW.status_code:='president';
  NEW.status_label:='Принят в целом в I чтении; Совет Федерации одобрил (правило игры); передан Президенту';
  NEW.current_owner_key:='president';
 END IF;
 RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION private.stage12_first_reading_full_transition() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS stage12_first_reading_full_transition ON public.formal_documents;
CREATE TRIGGER stage12_first_reading_full_transition
BEFORE UPDATE OF status_code ON public.formal_documents
FOR EACH ROW EXECUTE FUNCTION private.stage12_first_reading_full_transition();
