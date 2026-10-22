-- Этап 12. Преодоление президентского вето не означает опубликование закона.
-- Результат ГД => подтверждение решения СФ преподавателем => обязательная подпись Президента.
-- Новые правила применяются только к будущим переходам, существующие данные не перезаписываются.

CREATE OR REPLACE FUNCTION private.stage12_veto_vote_parameters_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private,pg_temp AS $$
DECLARE d public.formal_documents%rowtype;
BEGIN
 IF NEW.formal_document_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO d FROM public.formal_documents WHERE id=NEW.formal_document_id;
 IF d.status_code IS DISTINCT FROM 'president_veto' THEN RETURN NEW; END IF;
 IF d.game_id IS DISTINCT FROM NEW.game_id OR d.workflow_key IS DISTINCT FROM 'bill'
    OR d.doc_type IS DISTINCT FROM 'fz_bill'
    OR NEW.formal_step_code IS DISTINCT FROM 'president_veto'
    OR NEW.procedure_key IS DISTINCT FROM 'presidential_veto_override'
    OR NEW.institution_key IS DISTINCT FROM 'gd'
    OR NEW.voting_mode IS DISTINCT FROM 'mandate'
    OR NEW.majority_kind IS DISTINCT FROM 'eligible_fraction'
    OR coalesce(NEW.majority_value,0) < (2.0/3.0 - 0.000001)
    OR NEW.quorum_kind IS DISTINCT FROM 'fraction'
    OR coalesce(NEW.quorum_value,0) < 0.5
    OR NEW.pass_transition IS DISTINCT FROM 'advance'
    OR NEW.fail_transition IS DISTINCT FROM 'reject'
 THEN RAISE EXCEPTION 'Для преодоления вето предусмотрено голосование не менее чем 2/3 от полного состава Государственной Думы' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION private.stage12_veto_vote_parameters_guard() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS stage12_veto_vote_parameters_guard ON public.game_votes;
CREATE TRIGGER stage12_veto_vote_parameters_guard
BEFORE INSERT ON public.game_votes FOR EACH ROW EXECUTE FUNCTION private.stage12_veto_vote_parameters_guard();

CREATE OR REPLACE FUNCTION private.stage12_veto_not_published_before_sf()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private,pg_temp AS $$
DECLARE v_yes numeric;
BEGIN
 IF OLD.workflow_key='bill' AND OLD.doc_type='fz_bill' AND OLD.status_code='president_veto'
    AND NEW.status_code='published' THEN
   SELECT MAX(v.result_yes) INTO v_yes FROM public.game_votes v
   WHERE v.game_id=OLD.game_id AND v.formal_document_id=OLD.id
     AND v.formal_step_code='president_veto' AND v.procedure_key='presidential_veto_override'
     AND v.status='closed' AND v.result_code='passed' AND v.result_quorum_met=true;
   IF coalesce(v_yes,0)<300 THEN
      NEW.status_code:='rejected';
      NEW.status_label:='Вето Президента не преодолено: менее 300 голосов депутатов ГД';
      NEW.current_owner_key:='system';
      NEW.current_step:=OLD.current_step;
   ELSE
      NEW.status_code:='veto_sf_pending';
      NEW.status_label:='Вето преодолено в ГД — требуется решение Совета Федерации';
      NEW.current_owner_key:='teacher';
      NEW.current_step:=OLD.current_step;
   END IF;
 END IF;
 IF OLD.workflow_key='bill' AND OLD.doc_type='fz_bill' AND OLD.status_code='president_veto'
    AND NEW.status_code NOT IN ('veto_sf_pending','rejected') THEN
  RAISE EXCEPTION 'Вето преодолевается только повторным голосованием, решением Совета Федерации и последующей подписью' USING ERRCODE='42501';
 END IF;
 IF OLD.workflow_key='bill' AND OLD.doc_type='fz_bill' AND OLD.status_code='president_veto'
    AND NEW.status_code='veto_sf_pending'
    AND NOT EXISTS(SELECT 1 FROM public.game_votes v WHERE v.game_id=OLD.game_id
     AND v.formal_document_id=OLD.id AND v.formal_step_code='president_veto'
     AND v.procedure_key='presidential_veto_override' AND v.status='closed'
     AND v.result_code='passed' AND v.result_quorum_met AND v.result_yes>=300)
 THEN RAISE EXCEPTION 'Нет принятого решения Государственной Думы о преодолении вето' USING ERRCODE='23514';END IF;
 IF OLD.workflow_key='bill' AND OLD.doc_type='fz_bill' AND OLD.status_code='president_veto'
    AND NEW.status_code='rejected'
    AND NOT EXISTS(SELECT 1 FROM public.game_votes v WHERE v.game_id=OLD.game_id
     AND v.formal_document_id=OLD.id AND v.formal_step_code='president_veto'
     AND v.procedure_key='presidential_veto_override' AND v.status='closed'
     AND v.result_quorum_met AND (v.result_code='rejected' OR coalesce(v.result_yes,0)<300))
 THEN RAISE EXCEPTION 'Отклонение после вето должно следовать результату повторного голосования' USING ERRCODE='23514';END IF;
 IF OLD.status_code='veto_sf_pending' AND NEW.status_code IS DISTINCT FROM OLD.status_code
  AND (NOT private.is_game_teacher(OLD.game_id)
   OR NEW.status_code NOT IN ('veto_overridden','rejected')) THEN
  RAISE EXCEPTION 'Решение Совета Федерации фиксирует только преподаватель' USING ERRCODE='42501';
 END IF;
 IF OLD.status_code='veto_overridden' AND NEW.status_code IS DISTINCT FROM OLD.status_code THEN
  IF NEW.status_code<>'published'
   OR NEW.current_step<>OLD.current_step+1
   OR NEW.current_owner_key<>'system'
   OR NOT private.matches_formal_owner(OLD.game_id,auth.uid(),'president',OLD.author_id)
   OR NOT EXISTS(SELECT 1 FROM public.game_profiles gp WHERE gp.game_id=OLD.game_id
    AND gp.user_id=auth.uid() AND nullif(gp.signature_path,'') IS NOT NULL)
  THEN RAISE EXCEPTION 'После преодоления вето закон подписывает действующий Президент своей электронной подписью' USING ERRCODE='42501';END IF;
 END IF;
 RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION private.stage12_veto_not_published_before_sf() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS stage12_veto_not_published_before_sf ON public.formal_documents;
CREATE TRIGGER stage12_veto_not_published_before_sf
BEFORE UPDATE OF status_code ON public.formal_documents
FOR EACH ROW EXECUTE FUNCTION private.stage12_veto_not_published_before_sf();

CREATE OR REPLACE FUNCTION public.confirm_fz_veto_sf_review(
 p_document_id uuid,p_approved boolean,p_note text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private,pg_temp AS $$
DECLARE d public.formal_documents%rowtype;v_uid uuid:=auth.uid();v_yes numeric;
BEGIN
 SELECT * INTO d FROM public.formal_documents WHERE id=p_document_id FOR UPDATE;
 IF d.id IS NULL OR v_uid IS NULL OR NOT private.is_game_teacher(d.game_id) THEN
  RAISE EXCEPTION 'Только преподаватель этой игры подтверждает решение Совета Федерации' USING ERRCODE='42501';
 END IF;
 IF d.workflow_key<>'bill' OR d.doc_type<>'fz_bill'
  OR d.status_code<>'veto_sf_pending' OR d.current_owner_key<>'teacher'
  OR p_approved IS NULL THEN RAISE EXCEPTION 'Законопроект не ожидает решения Совета Федерации по вето' USING ERRCODE='23514'; END IF;
 SELECT MAX(v.result_yes) INTO v_yes FROM public.game_votes v
 WHERE v.game_id=d.game_id AND v.formal_document_id=d.id AND v.formal_step_code='president_veto'
  AND v.procedure_key='presidential_veto_override' AND v.status='closed'
  AND v.result_code='passed' AND v.result_quorum_met=true;
 IF coalesce(v_yes,0)<300 THEN RAISE EXCEPTION 'Вето не преодолено в Государственной Думе: требуется не менее 300 голосов' USING ERRCODE='23514';END IF;
 IF p_approved AND nullif(btrim(coalesce(p_note,'')),'') IS NULL THEN
  RAISE EXCEPTION 'Укажите подтверждение решения Совета Федерации (не менее 2/3 сенаторов) в учебной модели' USING ERRCODE='23514';
 END IF;
 UPDATE public.formal_documents SET
  status_code=CASE WHEN p_approved THEN 'veto_overridden' ELSE 'rejected' END,
  status_label=CASE WHEN p_approved THEN 'Вето преодолено обеими палатами — обязательная подпись Президента'
    ELSE 'Вето не преодолено: Совет Федерации не подтвердил повторное одобрение' END,
  current_owner_key=CASE WHEN p_approved THEN 'president' ELSE 'system' END,
  updated_at=now()
 WHERE id=d.id;
 INSERT INTO public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
 VALUES(d.id,d.game_id,v_uid,
  CASE WHEN p_approved THEN 'Преподаватель подтвердил решение Совета Федерации о преодолении вето; Президент обязан подписать закон'
    ELSE 'Преподаватель не подтвердил преодоление вето Советом Федерации' END,
  d.status_code,CASE WHEN p_approved THEN 'veto_overridden' ELSE 'rejected' END,
  d.current_owner_key,CASE WHEN p_approved THEN 'president' ELSE 'system' END,
  left(coalesce(p_note,''),2000));
END;$$;
REVOKE ALL ON FUNCTION public.confirm_fz_veto_sf_review(uuid,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_fz_veto_sf_review(uuid,boolean,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.adjust_duma_speech_time(
 p_item_id uuid,p_expected_end timestamptz,p_delta_seconds integer
) RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private,pg_temp AS $$
DECLARE a public.duma_agenda_items%rowtype;s public.duma_sessions%rowtype;u uuid:=auth.uid();v_end timestamptz;
BEGIN
 SELECT * INTO a FROM public.duma_agenda_items WHERE id=p_item_id FOR UPDATE;
 IF a.id IS NULL THEN RAISE EXCEPTION 'Вопрос повестки не найден' USING ERRCODE='23514'; END IF;
 SELECT * INTO s FROM public.duma_sessions WHERE id=a.session_id;
 IF u IS NULL OR s.stage_no<>12 OR s.reading_protocol IS DISTINCT FROM true
    OR NOT private.can_manage_duma_session(s.game_id,u) THEN
  RAISE EXCEPTION 'Изменять регламент вправе председатель Государственной Думы или его уполномоченный заместитель' USING ERRCODE='42501';END IF;
 PERFORM private.require_duma_stage_open(s.game_id,12);
 IF NOT private.is_game_teacher(s.game_id) THEN PERFORM private.require_game_meeting_registration(s.game_id,u,12,'gd');END IF;
 IF s.status<>'open' OR a.status<>'in_progress'
  OR a.discussion_phase NOT IN ('report','committee','questions','debate')
  OR a.speaker_user_id IS NULL OR a.speech_ends_at IS NULL
  THEN RAISE EXCEPTION 'Нет текущего выступления для изменения времени' USING ERRCODE='23514';END IF;
 IF a.speech_ends_at IS DISTINCT FROM p_expected_end THEN
  RAISE EXCEPTION 'Время выступления уже изменено: обновите данные заседания' USING ERRCODE='40001';END IF;
 IF p_delta_seconds IS NULL OR p_delta_seconds=0 OR abs(p_delta_seconds)>300 THEN
  RAISE EXCEPTION 'За одно действие допускается изменить время на 1–300 секунд' USING ERRCODE='23514'; END IF;
 v_end:=greatest(now(),a.speech_ends_at+make_interval(secs=>p_delta_seconds));
 IF v_end>now()+interval '60 minutes' THEN RAISE EXCEPTION 'Предельная длительность выступления — 60 минут' USING ERRCODE='23514';END IF;
 UPDATE public.duma_agenda_items SET speech_ends_at=v_end WHERE id=a.id;
 INSERT INTO public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,note)
 VALUES(a.formal_document_id,s.game_id,u,'Изменение времени выступления',
  a.opened_document_step,a.opened_document_step,
  CASE WHEN p_delta_seconds>0 THEN 'Продлено на ' ELSE 'Сокращено на ' END||abs(p_delta_seconds)::text||' секунд');
 RETURN v_end;
END;$$;
REVOKE ALL ON FUNCTION public.adjust_duma_speech_time(uuid,timestamptz,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.adjust_duma_speech_time(uuid,timestamptz,integer) TO authenticated;
