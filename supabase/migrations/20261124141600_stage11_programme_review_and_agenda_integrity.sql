
CREATE OR REPLACE FUNCTION private.can_submit_government_program(p_game uuid,p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT p_user IS NOT NULL AND private.is_game_member(p_game) AND NOT private.is_game_observer(p_game)
 AND (private.is_game_teacher(p_game) OR (private.role_is_available(p_game,p_user) AND EXISTS(
 SELECT 1 FROM private.formal_user_roles(p_game,p_user) r
 WHERE r ~* '^(заместитель[[:space:]]+)?председатель[[:space:]]+правительства([[:space:]]|$)')));
$$;
REVOKE ALL ON FUNCTION private.can_submit_government_program(uuid,uuid) FROM PUBLIC,anon,authenticated;
ALTER TABLE public.state_program_review_proposals ADD COLUMN IF NOT EXISTS incorporated_content_hash text;

CREATE OR REPLACE FUNCTION public.advance_state_program(p_program_id uuid, p_action text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare p public.state_programs%rowtype;v_uid uuid:=(select auth.uid());v_is_pm boolean;v_ready jsonb;
begin
 perform private.lock_active_program_actor((select game_id from public.state_programs where id=p_program_id));
 select * into p from public.state_programs where id=p_program_id for update;
 if p.id is null then raise exception 'Program not found'; end if;
 if v_uid is null or not private.is_game_member(p.game_id) or private.is_game_observer(p.game_id) then raise exception 'Game participant access required';end if;
 if not private.is_game_teacher(p.game_id) and not private.role_is_available(p.game_id,v_uid) then raise exception 'Участник недоступен для согласования';end if;
 PERFORM set_config('app.gos_stage11_program_edit_id',p.id::text,true);
 select exists(select 1 from private.formal_user_roles(p.game_id,v_uid) r where r ~* '^председатель[[:space:]]+правительства([[:space:]]|$)') into v_is_pm;
 if p_action='pm_ready' and p.signed_at is not null then
  if not private.can_submit_government_program(p.game_id,v_uid) then raise exception 'Недостаточно полномочий для внесения в повестку';end if;
  return;
 end if;
 if p_action='submit_minister' then
  if p.status not in ('draft','revision') then raise exception 'Program is not awaiting submission';end if;
  if not private.can_edit_state_program(p.id,v_uid) then raise exception 'Program editing access required'; end if;
  v_ready:=private.state_program_readiness_json(p.id);
  if not coalesce((v_ready->>'ready')::boolean,false) then raise exception 'Program is not ready: %',array_to_string(array(select jsonb_array_elements_text(v_ready->'issues')),'; '); end if;
  update public.state_programs set status=case when p.status='revision' and nullif(btrim(p.pm_revision_reason),'') is not null then 'pm_review' else 'minister_review' end,updated_at=now() where id=p.id;
 elsif p_action in ('minister_approve','minister_revision') then
  if p.status<>'minister_review' then raise exception 'Program is not awaiting minister review';end if;
  if not private.is_game_teacher(p.game_id) and p.responsible_minister_id is distinct from v_uid then raise exception 'Responsible minister access required'; end if;
  if p_action='minister_approve' then
   v_ready:=private.state_program_readiness_json(p.id);
   if not coalesce((v_ready->>'ready')::boolean,false) then raise exception 'Программа не готова: %',v_ready->'issues';end if;
  end if;
  update public.state_programs set status=case when p_action='minister_approve' then 'pm_review' else 'revision' end,updated_at=now() where id=p.id;
 elsif p_action in ('pm_ready','pm_revision') then
  if p_action='pm_revision' then raise exception 'Укажите причину возврата в форме Председателя Правительства';end if;
  if p.status<>'pm_review' then raise exception 'Program is not awaiting Prime Minister review';end if;
  if not private.can_submit_government_program(p.game_id,v_uid) then raise exception 'Внести программу в повестку вправе Председатель Правительства или его заместитель'; end if;
  if p_action='pm_ready' then
   v_ready:=private.state_program_readiness_json(p.id);
   if not coalesce((v_ready->>'ready')::boolean,false) then raise exception 'Программа не готова к подписи: %',v_ready->'issues';end if;
  end if;
  update public.state_programs set status=case when p_action='pm_ready' then 'ready' else 'revision' end,updated_at=now() where id=p.id;
  IF p_action='pm_ready' AND NOT EXISTS(SELECT 1 FROM public.government_program_agenda a JOIN public.government_sessions s ON s.id=a.session_id AND s.game_id=a.game_id WHERE a.program_id=p.id AND a.game_id=p.game_id AND s.status<>'closed' AND a.status IN ('pending','presenting','decision')) THEN
   RAISE EXCEPTION 'Не удалось внести ГП в повестку. Проверьте назначение Председателя Правительства и наличие места в проекте повестки';END IF;
  -- Preliminary PM approval transfers the unsigned programme to the Government agenda.
  -- The PM signs and publishes only after a passed vote.
 else raise exception 'Unsupported program action'; end if;
end;$function$;

CREATE OR REPLACE FUNCTION public.request_state_program_revision(p_program_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
 p public.state_programs%rowtype;
 v_uid uuid:=(select auth.uid());
 v_reason text:=btrim(coalesce(p_reason,''));
 v_is_pm boolean;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Войдите в игру';END IF;
 IF char_length(v_reason) NOT BETWEEN 10 AND 1500
 THEN RAISE EXCEPTION 'Укажите причину возврата (от 10 до 1500 символов)';END IF;
 PERFORM private.lock_active_program_actor((SELECT game_id FROM public.state_programs WHERE id=p_program_id));
 SELECT * INTO p FROM public.state_programs WHERE id=p_program_id FOR UPDATE;
 IF p.id IS NULL THEN RAISE EXCEPTION 'Программа не найдена';END IF;
 IF NOT private.is_game_member(p.game_id) OR private.is_game_observer(p.game_id)
    OR (NOT private.is_game_teacher(p.game_id) AND NOT private.role_is_available(p.game_id,v_uid))
 THEN RAISE EXCEPTION 'Нет доступа к программе';END IF;
 SELECT EXISTS(SELECT 1 FROM private.formal_user_roles(p.game_id,v_uid) r
    WHERE r ~* '^председатель[[:space:]]+правительства([[:space:]]|$)')
 INTO v_is_pm;
 IF NOT private.is_game_teacher(p.game_id) AND NOT v_is_pm AND NOT (p.status='pm_review' AND private.can_submit_government_program(p.game_id,v_uid))
 THEN RAISE EXCEPTION 'Вернуть программу может Председатель Правительства или его заместитель на предварительном согласовании';END IF;
 IF p.signed_at IS NOT NULL OR p.status NOT IN ('pm_review','ready')
 OR (p.status<>'pm_review' AND NOT EXISTS(SELECT 1 FROM public.game_stages s WHERE s.game_id=p.game_id AND s.stage_no=11 AND s.status='open'))
 THEN RAISE EXCEPTION 'Возврат доступен до подписания программы и вне открытого голосования';END IF;
 IF p.status='adopted' THEN
  IF NOT EXISTS(SELECT 1 FROM public.game_votes v WHERE v.id=p.government_vote_id AND v.game_id=p.game_id AND v.status='closed' AND v.result_code='passed' AND v.result_quorum_met) THEN RAISE EXCEPTION 'Нет подтверждённого решения Правительства';END IF;
  -- Preserve the previous resolution and ballot as history; no signature or budget commitment.
  INSERT INTO public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
  SELECT d.id,p.game_id,v_uid,'Принятая ГП возвращена на доработку',d.status_code,'superseded',d.current_owner_key,'system',v_reason
  FROM public.formal_documents d WHERE d.game_id=p.game_id AND d.stage_no=11 AND d.doc_type='government_resolution'
   AND d.metadata->>'state_program_id'=p.id::text AND d.metadata->>'government_vote_id'=p.government_vote_id::text AND d.status_code IN ('draft','adopted');
  UPDATE public.formal_documents d SET status_code='superseded',status_label='Возвращена на доработку; прежнее решение сохранено',current_owner_key='system',updated_at=now()
  WHERE d.game_id=p.game_id AND d.stage_no=11 AND d.doc_type='government_resolution' AND d.metadata->>'state_program_id'=p.id::text AND d.metadata->>'government_vote_id'=p.government_vote_id::text AND d.status_code IN ('draft','adopted');
  UPDATE public.government_program_agenda a SET status='pending',vote_id=NULL,started_at=NULL,completed_at=NULL,qa_closed_at=NULL,
   result_note=concat_ws(' · ',a.result_note,'Возвращена на доработку; прежнее голосование '||p.government_vote_id::text)
   FROM public.government_sessions s WHERE s.id=a.session_id AND s.game_id=p.game_id AND s.status<>'closed' AND a.program_id=p.id AND a.vote_id=p.government_vote_id;
  PERFORM set_config('app.gos_stage11_program_return_id',p.id::text,true);
 END IF;
 PERFORM set_config('app.gos_stage11_program_edit_id',p.id::text,true);
 UPDATE public.state_programs
 SET status='revision',government_vote_id=NULL,pm_revision_reason=v_reason,updated_at=now()
 WHERE id=p.id;
END;
$function$;

CREATE OR REPLACE FUNCTION private.guard_stage_document_hold_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE uid uuid:=auth.uid();v_game uuid;v_stage integer;
BEGIN
 IF uid IS NULL THEN RETURN NEW; END IF;
 -- Protect the attestation, and never let stage-final documents use it.
 IF TG_TABLE_NAME='formal_documents' THEN
   IF TG_OP='INSERT' AND NEW.metadata->>'registry_independent'='true' THEN
     IF current_setting('app.gos_registry_independent_id',true) IS DISTINCT FROM NEW.id::text
       OR NEW.metadata->>'stage_form'='true'
       OR nullif(NEW.metadata->>'document_kind','') IS NOT NULL
     THEN RAISE EXCEPTION 'Недопустимая отметка самостоятельного документа' USING ERRCODE='42501';END IF;
     RETURN NEW;
   ELSIF TG_OP='UPDATE' THEN
     IF NEW.metadata->>'registry_independent' IS DISTINCT FROM OLD.metadata->>'registry_independent'
     THEN RAISE EXCEPTION 'Нельзя изменить принадлежность документа к этапу' USING ERRCODE='42501';END IF;
     IF OLD.metadata->>'registry_independent'='true' THEN
       IF NEW.game_id IS DISTINCT FROM OLD.game_id
        OR NEW.stage_no IS DISTINCT FROM OLD.stage_no
        OR NEW.doc_type IS DISTINCT FROM OLD.doc_type
        OR NEW.subject_key IS DISTINCT FROM OLD.subject_key
       THEN RAISE EXCEPTION 'Нельзя изменять исходные реквизиты самостоятельного документа' USING ERRCODE='42501';END IF;
       RETURN NEW;
     END IF;
   END IF;
 END IF;
 IF TG_TABLE_NAME='formal_documents' THEN
  IF TG_OP='UPDATE' THEN
   IF private.stage4_legal_act_can_finalize(OLD,NEW,uid) THEN RETURN NEW; END IF;
   IF private.can_reapprove_returned_gd_minutes(OLD,NEW,uid) THEN RETURN NEW; END IF;
  END IF;
 END IF;
  IF TG_OP='UPDATE' AND TG_TABLE_NAME='formal_documents' THEN
   IF OLD.doc_type='state_program' AND OLD.stage_no=10 AND OLD.metadata->>'auto_synced'='true'
     AND current_setting('app.gos_stage11_registry_status_id',true)=OLD.id::text
     AND (to_jsonb(NEW)-ARRAY['status_code','status_label','current_owner_key','current_step','updated_at'])
       IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['status_code','status_label','current_owner_key','current_step','updated_at'])
     AND EXISTS(SELECT 1 FROM public.game_stages st WHERE st.game_id=OLD.game_id AND st.stage_no=11 AND st.status='open')
   THEN RETURN NEW;END IF;
  END IF;
 v_game:=NEW.game_id;v_stage:=NEW.stage_no;
 IF v_stage=11 AND EXISTS(SELECT 1 FROM public.game_stages st WHERE st.game_id=v_game AND st.stage_no=10 AND st.status='open') THEN
  IF TG_TABLE_NAME='government_sessions' THEN
   IF NEW.status='draft' AND NEW.agenda_approved_at IS NULL AND private.can_submit_government_program(v_game,uid) THEN v_stage:=10;END IF;
  ELSIF TG_TABLE_NAME='formal_documents' THEN
   IF NEW.doc_type='meeting_agenda' AND NEW.status_code='draft' AND NEW.metadata->>'document_kind'='government_session_agenda' AND NEW.metadata->>'government_session_id'=current_setting('app.gos_government_agenda_session',true) THEN v_stage:=10;END IF;
  END IF;
 END IF;
 IF NOT private.is_game_teacher(v_game)
    AND private.has_prior_stage_document_hold(v_game,uid,v_stage) THEN
    IF TG_TABLE_NAME='formal_documents' THEN
     IF (TG_OP='INSERT' OR (OLD.game_id=NEW.game_id AND OLD.stage_no=NEW.stage_no
          AND OLD.doc_type=NEW.doc_type AND OLD.subject_key=NEW.subject_key
          AND OLD.metadata->>'template_key'=NEW.metadata->>'template_key'))
       AND private.can_remediate_stage_final_document(
         NEW.game_id,NEW.stage_no,uid,NEW.doc_type,NEW.subject_key,NEW.metadata)
     THEN RETURN NEW; END IF;
    END IF;
    RAISE EXCEPTION 'Следующий этап недоступен: завершите обязательные итоговые документы предыдущего этапа'
      USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END;$function$;

CREATE OR REPLACE FUNCTION private.sync_stage11_program_registry_status(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE p public.state_programs%rowtype;d record;item_status text;code text;label text;owner text;step integer;actor uuid;
BEGIN
 SELECT * INTO p FROM public.state_programs WHERE id=p_id;
 IF p.id IS NULL OR p.stage_no<>10 OR NOT EXISTS(SELECT 1 FROM public.game_stages s WHERE s.game_id=p.game_id AND s.stage_no IN (10,11) AND s.status='open') THEN RETURN;END IF;
 SELECT a.status INTO item_status FROM public.government_program_agenda a JOIN public.government_sessions s ON s.id=a.session_id AND s.game_id=a.game_id
 WHERE a.program_id=p.id AND a.status<>'withdrawn' ORDER BY s.session_no DESC,a.created_at DESC LIMIT 1;
 IF item_status IS NULL AND p.status NOT IN ('adopted','government_vote','rejected') THEN RETURN;END IF;
 IF p.status='revision' THEN code:='revision';label:='На доработке';owner:='ministry';step:=0;
 ELSIF p.status IN ('draft','minister_review','pm_review') AND item_status IS NOT NULL THEN code:='revision';label:=CASE WHEN p.status='draft' THEN 'На доработке' ELSE 'На повторном согласовании' END;owner:=CASE WHEN p.status='pm_review' THEN 'government' ELSE 'ministry' END;step:=0;
 ELSIF p.status='adopted' AND p.signed_at IS NOT NULL THEN code:='published';label:='Подписана и опубликована';owner:='system';step:=3;
 ELSIF p.status='adopted' THEN code:='adopted';label:='Принята — ожидает подписи';owner:='government';step:=2;
 ELSIF p.status='rejected' THEN code:='rejected';label:='Отклонена голосованием';owner:='system';step:=1;
 ELSIF p.status='government_vote' THEN code:='agenda';label:='На голосовании';owner:='government';step:=1;
 ELSIF p.status='ready' AND item_status IS NOT NULL THEN code:='agenda';label:=CASE WHEN item_status='presenting' THEN 'На рассмотрении' ELSE 'В повестке Правительства' END;owner:='government';step:=1;
 ELSE RETURN;END IF;
 actor:=coalesce(auth.uid(),p.created_by);
 FOR d IN SELECT x.id,x.status_code,x.status_label,x.current_owner_key,x.current_step FROM public.formal_documents x
 WHERE x.game_id=p.game_id AND x.stage_no=10 AND x.doc_type='state_program'
 AND x.metadata->>'state_program_id'=p.id::text AND x.metadata->>'auto_synced'='true'
 AND x.status_code NOT IN ('superseded','withdrawn')
 AND (x.status_code,x.status_label,x.current_owner_key,x.current_step) IS DISTINCT FROM (code,label,owner,step)
 LOOP
  PERFORM set_config('app.gos_stage11_registry_status_id',d.id::text,true);
  UPDATE public.formal_documents SET status_code=code,status_label=label,current_owner_key=owner,current_step=step,updated_at=now() WHERE id=d.id;
  PERFORM set_config('app.gos_stage11_registry_status_id','',true);
  INSERT INTO public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
  VALUES(d.id,p.game_id,actor,
   CASE WHEN code='published' AND p.signed_by=auth.uid() AND EXISTS(SELECT 1 FROM public.game_profiles gp WHERE gp.game_id=p.game_id AND gp.user_id=actor AND nullif(gp.signature_path,'') IS NOT NULL) THEN 'Подписан документ уполномоченным лицом'
        WHEN code='published' THEN 'ГП опубликована по итогам подписания' ELSE label END,
   d.status_code,code,d.current_owner_key,owner,CASE WHEN p.government_vote_id IS NOT NULL THEN 'Голосование '||p.government_vote_id::text ELSE p.pm_revision_reason END);
 END LOOP;
END;$function$;

CREATE OR REPLACE FUNCTION public.sign_institution_meeting_agenda(p_document_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE d public.formal_documents%rowtype; uid uuid:=auth.uid(); v_office text;
 v_sig text; v_signed boolean; v_institution text;
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
 ELSE
  UPDATE public.institution_meeting_records SET updated_at=now() WHERE agenda_document_id=d.id;
 END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.submit_government_agenda_program_proposal(p_session_id uuid, p_program_id uuid, p_section_key text, p_original_text text, p_proposed_text text, p_justification text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare s public.government_sessions%rowtype; v_uid uuid:=(select auth.uid());v_id uuid;
begin
 select * into s from public.government_sessions where id=p_session_id;
 if s.id is null or v_uid is null or not private.is_game_member(s.game_id) then
  raise exception 'Заседание недоступно';end if;
 if not private.government_agenda_adopted(s.id) then raise exception 'Поправки доступны после принятия повестки';end if;
 perform 1 from public.government_program_agenda a where a.session_id=s.id and a.program_id=p_program_id and a.status='presenting' and a.qa_closed_at is not null and a.vote_id is null for update;
 if not found then raise exception 'Поправки вносятся после обсуждения текущей программы и до голосования';end if;
 if not private.is_game_teacher(s.game_id) and not exists(select 1 from public.institution_session_registrations r where r.game_id=s.game_id and r.stage_no=11 and r.institution_key='government' and r.user_id=v_uid and r.government_session_id=s.id and private.government_office_vote_weight(s.game_id,v_uid)>0) then raise exception 'Поправки вносят зарегистрированные члены Правительства';end if;
 if not exists(select 1 from public.game_members m where m.game_id=s.game_id and m.user_id=v_uid
  and m.kind in ('student','teacher') and m.roster_archived_at is null) then
  raise exception 'Поправки могут вносить только участники игры';end if;
 if not exists(select 1 from public.government_program_agenda a where a.session_id=s.id
   and a.game_id=s.game_id and a.program_id=p_program_id and a.status<>'withdrawn') then
  raise exception 'Государственная программа не включена в повестку выбранного заседания';end if;
 if p_section_key not in ('passport','goals','structure','expenses','other') then
  raise exception 'Выберите раздел программы';end if;
 if length(btrim(coalesce(p_proposed_text,''))) not between 5 and 6000 then
  raise exception 'Предлагаемая редакция должна содержать от 5 до 6000 символов';end if;
 insert into public.state_program_review_proposals
 (game_id,program_id,session_id,section_key,original_text,proposed_text,justification,created_by)
 values(s.game_id,p_program_id,s.id,p_section_key,left(coalesce(p_original_text,''),4000),
  btrim(p_proposed_text),left(coalesce(p_justification,''),4000),v_uid) returning id into v_id;
 return v_id;
end;$function$;

CREATE OR REPLACE FUNCTION public.review_state_program_proposal(p_proposal_id uuid, p_action text, p_note text DEFAULT ''::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare q public.state_program_review_proposals%rowtype;v_uid uuid:=(select auth.uid());p public.state_programs%rowtype;
begin
 select * into q from public.state_program_review_proposals where id=p_proposal_id for update;
 if q.id is null then raise exception 'Предложение не найдено';end if;
 select * into p from public.state_programs where id=q.program_id;
 if v_uid is null or not (private.can_manage_government_session(q.game_id,v_uid) or p.responsible_minister_id=v_uid)
 then raise exception 'Недостаточно прав для рассмотрения';end if;
 if q.session_id is not null then perform 1 from public.government_program_agenda a where a.session_id=q.session_id and a.program_id=q.program_id and a.game_id=q.game_id for update;end if;
 if q.status<>'submitted' or p_action not in ('accepted','rejected') then raise exception 'Решение недоступно';end if;
 if q.session_id is not null and (not private.can_approve_government_agenda(q.game_id,v_uid) or not private.government_agenda_adopted(q.session_id) or not exists(select 1 from public.government_program_agenda a where a.session_id=q.session_id and a.program_id=q.program_id and a.game_id=q.game_id and a.status='presenting' and a.qa_closed_at is not null and a.vote_id is null)) then raise exception 'Поправки рассматривает Председатель Правительства на этапе поправок текущей ГП';end if;
 update public.state_program_review_proposals set status=p_action,reviewed_by=v_uid,reviewed_at=now(),review_note=left(coalesce(p_note,''),4000),accepted_content_hash=case when p_action='accepted' and q.session_id is not null then private.programme_content_hash(q.program_id) else null end where id=q.id;
end;$function$;

CREATE OR REPLACE FUNCTION public.confirm_government_program_amendments(p_session_id uuid, p_program_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE s public.government_sessions%rowtype;p public.state_programs%rowtype;h text;u uuid:=auth.uid();
BEGIN
 SELECT * INTO s FROM public.government_sessions WHERE id=p_session_id FOR UPDATE;
 SELECT * INTO p FROM public.state_programs WHERE id=p_program_id AND game_id=s.game_id FOR UPDATE;
 IF s.id IS NULL OR p.id IS NULL OR NOT private.can_approve_government_agenda(s.game_id,u) OR NOT private.government_agenda_adopted(s.id)
 OR p.status<>'ready' OR p.government_vote_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.government_program_agenda a WHERE a.session_id=s.id AND a.program_id=p.id AND a.status IN ('pending','presenting'))
 THEN RAISE EXCEPTION 'Подтверждение доступно Председателю после доработки и согласования программы';END IF;
 h:=private.programme_content_hash(p.id);
 IF EXISTS(SELECT 1 FROM public.state_program_review_proposals r WHERE r.session_id=s.id AND r.program_id=p.id AND r.status='accepted' AND r.incorporated_at IS NULL AND (r.accepted_content_hash IS NULL OR r.accepted_content_hash=h))
 THEN RAISE EXCEPTION 'Паспорт программы ещё не изменён после одобрения поправок';END IF;
 UPDATE public.state_program_review_proposals SET incorporated_at=now(),incorporated_by=u,incorporated_content_hash=h
 WHERE session_id=s.id AND program_id=p.id AND status='accepted' AND (incorporated_at IS NULL OR incorporated_content_hash IS DISTINCT FROM h);
END;$function$;

CREATE OR REPLACE FUNCTION public.open_program_vote_from_agenda(p_item_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare i public.government_program_agenda%rowtype;s public.government_sessions%rowtype;p public.state_programs%rowtype;v_uid uuid:=(select auth.uid());v_vote uuid;
begin
 select * into i from public.government_program_agenda where id=p_item_id for update;
 if i.id is null then raise exception 'Agenda item not found'; end if;
 select * into s from public.government_sessions where id=i.session_id;
 if not private.can_approve_government_agenda(i.game_id,v_uid) then raise exception 'Government session management access required'; end if;
 if s.status<>'open' or i.status<>'presenting' then raise exception 'Сначала необходимо представить программу'; end if;
 if not private.government_agenda_adopted(s.id) then raise exception 'Сначала Правительство должно принять повестку голосованием';end if;
 if exists(select 1 from public.state_program_review_proposals r where r.session_id=s.id and r.program_id=i.program_id and (r.status='submitted' or (r.status='accepted' and (r.incorporated_at is null or r.incorporated_content_hash IS DISTINCT FROM private.programme_content_hash(i.program_id))))) then raise exception 'Сначала рассмотрите все поправки и подтвердите внесение одобренных изменений в паспорт ГП';end if;
 if i.qa_closed_at is null then raise exception 'Завершите ответы на вопросы к докладчику перед голосованием';end if;
 if exists(select 1 from public.government_program_speaker_questions q where q.agenda_item_id=i.id and q.answer_text is null) then raise exception 'Вопросы к докладчику должны получить ответы';end if;
 select * into p from public.state_programs where id=i.program_id and game_id=i.game_id for update;
 if p.status='government_vote' and p.signed_at is not null and p.government_vote_id is not null then
  -- Legacy signature/post must remain untouched. Reuse ONE still-empty official ballot.
  select v.id into v_vote from public.game_votes v
  where v.id=p.government_vote_id and v.game_id=i.game_id
    and v.stage_no=11 and v.institution_key='government'
    and v.procedure_key='state_program' and v.status='open'
    and not exists(select 1 from public.game_ballots b where b.vote_id=v.id)
  for update;
  if v_vote is null then raise exception 'Ранее открытое голосование уже использовано или закрыто'; end if;
 else
  perform set_config('app.gos_program_agenda_item',i.id::text,true);
  v_vote:=public.open_state_program_government_vote(i.program_id);
  perform set_config('app.gos_program_agenda_item','',true);
 end if;
 update public.government_program_agenda set status='decision',vote_id=v_vote where id=i.id;
 return v_vote;
end;$function$;

CREATE OR REPLACE FUNCTION public.open_state_program_government_vote(p_program_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare p public.state_programs%rowtype;v_uid uuid:=auth.uid();v_vote uuid;
begin
 perform private.lock_active_program_actor((select game_id from public.state_programs where id=p_program_id));
 select * into p from public.state_programs where id=p_program_id for update;
 if p.id is null then raise exception 'Program not found';end if;
 if not private.is_game_teacher(p.game_id) and not exists(
  select 1 from private.formal_user_roles(p.game_id,v_uid) r
  where r ~* '^председатель[[:space:]]+правительства([[:space:]]|$)'
 ) then raise exception 'Prime Minister access required';end if;
 if p.status<>'ready' then raise exception 'Сначала завершите согласование программы и включите её в повестку';end if;
 if p.signed_at is not null then raise exception 'Голосование проводится до подписи и публикации программы';end if;
 if not exists(select 1 from public.government_program_agenda a
   join public.government_sessions s on s.id=a.session_id and s.game_id=a.game_id
   where a.id=nullif(current_setting('app.gos_program_agenda_item',true),'')::uuid
     and a.program_id=p.id and a.game_id=p.game_id
     and a.status='presenting' and a.qa_closed_at IS NOT NULL and s.status='open' and s.stage_no=11 and private.government_agenda_adopted(s.id)
     and not exists(select 1 from public.state_program_review_proposals r where r.session_id=s.id and r.program_id=p.id and (r.status='submitted' or (r.status='accepted' and (r.incorporated_at IS NULL or r.incorporated_content_hash IS DISTINCT FROM private.programme_content_hash(p.id))))))
 then raise exception 'Сначала представьте программу на открытом заседании Правительства';end if;
 insert into public.game_votes(game_id,stage_no,title,body,voting_mode,status,created_by,institution_key,procedure_key,
  quorum_kind,quorum_value,majority_kind,majority_value,allow_abstain,tie_breaker_chair,pass_transition,fail_transition)
 values(p.game_id,11,'Государственная программа · '||p.title,
  'Варианты: принять государственную программу; окончательно отклонить; вернуть на доработку. Решение принимается большинством присутствующих. При отсутствии большинства проводится повторное голосование.',
  'member','open',v_uid,'government','state_program','fraction',0.5,'present_majority',0.5,true,false,'none','none')
 returning id into v_vote;
 PERFORM set_config('app.gos_stage11_program_vote_id',p.id::text,true);
 update public.state_programs set status='government_vote',government_vote_id=v_vote,updated_at=now() where id=p.id;
 return v_vote;
end;$function$;

CREATE OR REPLACE FUNCTION private.programme_content_hash(p_program uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 SELECT md5(jsonb_build_object(
 'passport',to_jsonb(p)-ARRAY['status','government_vote_id','signed_at','signed_by','publication_post_id','pm_revision_reason','updated_at','created_at'],
 'goals',coalesce((SELECT jsonb_agg(x ORDER BY x::text) FROM (SELECT to_jsonb(g)-ARRAY['id','created_at'] x FROM public.state_program_goals g WHERE g.program_id=p.id AND g.game_id=p.game_id) t),'[]'),
 'components',coalesce((SELECT jsonb_agg(x ORDER BY x::text) FROM (SELECT (to_jsonb(c)-ARRAY['id','created_at','target_goal_id'])||jsonb_build_object('target_goal',coalesce((select g.goal_text||' · '||g.indicator_name from public.state_program_goals g where g.id=c.target_goal_id and g.program_id=c.program_id),'')) x FROM public.state_program_components c WHERE c.program_id=p.id AND c.game_id=p.game_id) t),'[]'),
 'expenses',coalesce((SELECT jsonb_agg(x ORDER BY x::text) FROM (SELECT (to_jsonb(e)-ARRAY['id','created_at','component_id','created_by'])||jsonb_build_object('component',c.title) x FROM public.state_program_expenses e JOIN public.state_program_components c ON c.id=e.component_id AND c.program_id=e.program_id WHERE e.program_id=p.id AND e.game_id=p.game_id) t),'[]'),
 'years',coalesce((SELECT jsonb_agg(jsonb_build_array(y.budget_year,y.amount) ORDER BY y.budget_year) FROM public.state_program_budget_years y WHERE y.program_id=p.id AND y.game_id=p.game_id),'[]'))::text)
 FROM public.state_programs p WHERE p.id=p_program;
$function$;

CREATE OR REPLACE FUNCTION private.open_government_agenda_vote_internal(p_session uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE s public.government_sessions%rowtype;d public.formal_documents%rowtype;v_id uuid;u uuid:=auth.uid();
BEGIN
 SELECT * INTO s FROM public.government_sessions WHERE id=p_session FOR UPDATE;
 IF s.id IS NULL OR u IS NULL OR NOT private.is_game_member(s.game_id) OR private.is_game_observer(s.game_id)
    OR s.status<>'open' OR s.agenda_approved_at IS NULL THEN RETURN NULL;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.game_stages st WHERE st.game_id=s.game_id AND st.stage_no=11 AND st.status='open'
 AND (st.deadline IS NULL OR st.deadline>clock_timestamp())) THEN RETURN NULL;END IF;
 IF s.agenda_vote_id IS NOT NULL THEN RETURN s.agenda_vote_id;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.institution_meeting_records m WHERE m.game_id=s.game_id AND m.stage_no=11
 AND m.institution_key='government' AND m.agenda_document_id=s.agenda_document_id AND m.agenda_approved_at IS NOT NULL) THEN RETURN NULL;END IF;
 SELECT * INTO d FROM public.formal_documents WHERE id=s.agenda_document_id AND game_id=s.game_id AND status_code='published';
 IF d.id IS NULL OR NOT private.agenda_all_signed(d.id) THEN RETURN NULL;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.game_members m WHERE m.game_id=s.game_id
  AND private.government_office_vote_weight(s.game_id,m.user_id)>0) OR EXISTS(
 SELECT 1 FROM public.game_members m WHERE m.game_id=s.game_id AND private.government_office_vote_weight(s.game_id,m.user_id)>0
 AND NOT EXISTS(SELECT 1 FROM public.institution_session_registrations r WHERE r.game_id=s.game_id AND r.stage_no=11
 AND r.institution_key='government' AND r.user_id=m.user_id AND r.government_session_id=s.id)) THEN RETURN NULL;END IF;
 IF EXISTS(SELECT 1 FROM public.government_program_agenda a WHERE a.session_id=s.id AND a.status IN ('presenting','decision')) THEN RETURN NULL;END IF;
 PERFORM set_config('app.vote_group','',true);
 INSERT INTO public.game_votes(game_id,stage_no,title,body,voting_mode,status,created_by,formal_document_id,formal_step_code,institution_key,procedure_key,
 quorum_kind,quorum_value,majority_kind,majority_value,allow_abstain,tie_breaker_chair,pass_transition,fail_transition)
 VALUES(s.game_id,11,'Утверждение повестки заседания Правительства',d.body_text,'member','open',coalesce(s.chair_user_id,u),
 d.id,'reference','government','government_agenda','fraction',0.5,'present_majority',0.5,false,false,'none','none') RETURNING id INTO v_id;
 UPDATE public.government_sessions SET agenda_vote_id=v_id WHERE id=s.id;
 RETURN v_id;
END;$function$;
