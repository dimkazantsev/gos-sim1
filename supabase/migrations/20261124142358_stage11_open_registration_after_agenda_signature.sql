CREATE OR REPLACE FUNCTION public.sign_institution_meeting_agenda(p_document_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE d public.formal_documents%rowtype; uid uuid:=auth.uid(); v_office text;
 v_sig text; v_signed boolean; v_institution text; v_session public.government_sessions%rowtype;
BEGIN
 SELECT * INTO d FROM public.formal_documents WHERE id=p_document_id FOR UPDATE;
 IF d.id IS NULL OR uid IS NULL OR NOT private.is_game_member(d.game_id)
 THEN RAISE EXCEPTION 'Документ недоступен' USING ERRCODE='42501'; END IF;
 IF d.doc_type<>'meeting_agenda' OR d.status_code IN('rejected','superseded','withdrawn')
 THEN RAISE EXCEPTION 'Документ не является действующей повесткой' USING ERRCODE='23514'; END IF;
 IF NOT private.role_is_available(d.game_id,uid)
 THEN RAISE EXCEPTION 'Нет действующих полномочий для подписания' USING ERRCODE='42501'; END IF;
 SELECT s.office INTO v_office FROM private.agenda_required_signers(d.id) s
  WHERE s.user_id=uid LIMIT 1;
 IF v_office IS NULL THEN
  RAISE EXCEPTION 'Подписывать эту повестку вправе другое уполномоченное лицо' USING ERRCODE='42501';
 END IF;
 v_institution:=coalesce(nullif(d.metadata->>'institution_key',''),d.subject_key);
 IF NOT (v_institution='ksrf' AND d.stage_no IN (2,3))
  AND NOT EXISTS (SELECT 1 FROM public.game_stages s WHERE s.game_id=d.game_id
    AND s.stage_no=d.stage_no AND s.status='open') THEN
  RAISE EXCEPTION 'Этап завершён или ещё не открыт' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM public.duma_sessions s WHERE s.agenda_document_id=d.id AND s.status='closed')
 OR EXISTS(SELECT 1 FROM public.government_sessions s WHERE s.agenda_document_id=d.id AND s.status='closed') THEN
  RAISE EXCEPTION 'Нельзя подписать повестку завершённого заседания' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM public.formal_document_signatures sig WHERE sig.document_id=d.id
  AND sig.signer_id=uid
  AND sig.signed_at>=coalesce(nullif(d.metadata->>'revision_changed_at','')::timestamptz,'-infinity'::timestamptz)) THEN
  RAISE EXCEPTION 'Вы уже подписали текущую редакцию повестки' USING ERRCODE='23505';
 END IF;
 SELECT p.signature_path INTO v_sig FROM public.game_profiles p WHERE p.game_id=d.game_id AND p.user_id=uid;
 IF nullif(v_sig,'') IS NULL OR v_sig NOT LIKE d.game_id::text||'/profiles/'||uid::text||'/signature-%'
 THEN RAISE EXCEPTION 'Сначала сохраните личную подпись в своём профиле' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='game-assets' AND o.name=v_sig)
 THEN RAISE EXCEPTION 'Файл личной подписи отсутствует в хранилище' USING ERRCODE='23514'; END IF;
 INSERT INTO public.formal_document_history(document_id,game_id,actor_id,action,
   from_status,to_status,from_owner,to_owner,note)
 VALUES(d.id,d.game_id,uid,'Подписан документ уполномоченным лицом',
   d.status_code,d.status_code,d.current_owner_key,d.current_owner_key,v_office);
 v_signed:=private.agenda_all_signed(d.id);
 IF v_signed THEN
  IF d.metadata->>'document_kind'='government_session_agenda' THEN
   PERFORM set_config('app.gos_government_agenda_session',d.metadata->>'government_session_id',true);
  END IF;
  PERFORM set_config('app.gos_meeting_document_scope',
    d.game_id::text||':'||d.stage_no||':'||v_institution||':agenda',true);
  UPDATE public.formal_documents SET status_code='published',
   status_label='Повестка подписана всеми уполномоченными лицами',
   current_owner_key='system',updated_at=now() WHERE id=d.id;
  IF d.metadata->>'document_kind'='government_session_agenda' THEN PERFORM set_config('app.gos_government_agenda_session','',true);END IF;
  UPDATE public.institution_meeting_records SET agenda_approved_by=uid,
    agenda_approved_at=now(),agenda_body=case when d.metadata->>'document_kind'='government_session_agenda' then d.body_text else agenda_body end,updated_at=now() WHERE agenda_document_id=d.id;
  UPDATE public.government_sessions SET agenda_approved_at=now(),agenda_approved_by=uid
   WHERE agenda_document_id=d.id AND status IN ('draft','open') AND agenda_vote_id IS NULL;
  IF d.metadata->>'document_kind'='government_session_agenda' THEN
   SELECT * INTO v_session FROM public.government_sessions WHERE agenda_document_id=d.id AND game_id=d.game_id;
   IF v_session.status='draft' AND NOT EXISTS(SELECT 1 FROM public.government_sessions s WHERE s.game_id=d.game_id AND s.stage_no=11 AND s.status='open' AND s.id<>v_session.id) THEN
    PERFORM public.open_government_session(v_session.id);
   ELSIF v_session.status='open' THEN
    PERFORM private.open_government_agenda_vote_internal(v_session.id);
   END IF;
  END IF;
 ELSE
  UPDATE public.institution_meeting_records SET updated_at=now() WHERE agenda_document_id=d.id;
 END IF;
END $function$;
