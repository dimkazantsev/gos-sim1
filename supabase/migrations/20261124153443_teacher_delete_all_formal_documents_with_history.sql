
ALTER TABLE public.government_sessions ADD COLUMN IF NOT EXISTS deleted_accepted_agenda_id uuid;
CREATE TABLE IF NOT EXISTS private.teacher_formal_document_deletions (
 document_id uuid PRIMARY KEY,game_id uuid NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL,deleted_at timestamptz NOT NULL DEFAULT now(),snapshot jsonb NOT NULL,
 accepted_agenda_vote_id uuid
);
ALTER TABLE private.teacher_formal_document_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.teacher_formal_document_deletions FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION private.teacher_document_delete_scope(p_doc uuid,p_game uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT p_doc IS NOT NULL AND auth.uid() IS NOT NULL
 AND current_setting('app.gos_teacher_delete_document',true)=p_doc::text
 AND private.is_game_teacher(p_game)
 AND EXISTS(SELECT 1 FROM private.teacher_formal_document_deletions a WHERE a.document_id=p_doc AND a.game_id=p_game AND a.actor_id=auth.uid());
$$;
REVOKE ALL ON FUNCTION private.teacher_document_delete_scope(uuid,uuid) FROM PUBLIC,anon,authenticated;


CREATE OR REPLACE FUNCTION private.teacher_delete_formal_document_internal(p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE d public.formal_documents%rowtype; s public.government_sessions%rowtype; u uuid:=auth.uid();v record;accepted uuid;open_votes uuid[];a jsonb;
BEGIN
 SELECT * INTO d FROM public.formal_documents WHERE id=p_document_id;
 IF d.id IS NULL OR u IS NULL OR NOT private.is_game_teacher(d.game_id) OR NOT private.is_game_member(d.game_id) OR private.is_game_observer(d.game_id)
 THEN RAISE EXCEPTION 'Удалить документ может только преподаватель этой игры' USING ERRCODE='42501';END IF;
 -- Same order as the meeting procedures: session before document.
 IF d.doc_type='meeting_agenda' AND d.subject_key='government' THEN
  SELECT * INTO s FROM public.government_sessions WHERE agenda_document_id=d.id AND game_id=d.game_id FOR UPDATE;
 END IF;
 SELECT * INTO d FROM public.formal_documents WHERE id=p_document_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('deleted',false,'id',p_document_id);END IF;
 IF s.id IS NOT NULL AND private.government_agenda_adopted(s.id) THEN accepted:=s.agenda_vote_id;END IF;
 SELECT coalesce(array_agg(DISTINCT x.id),'{}'::uuid[]) INTO open_votes FROM (
  SELECT v.id FROM public.game_votes v WHERE v.game_id=d.game_id AND v.formal_document_id=d.id AND v.status='open'
  UNION SELECT v.id FROM public.game_votes v JOIN public.bill_amendment_packs p ON p.vote_id=v.id AND p.game_id=v.game_id WHERE p.document_id=d.id AND p.game_id=d.game_id AND v.status='open'
  UNION SELECT v.id FROM public.game_votes v JOIN public.budget_law_amendment_packs p ON p.vote_id=v.id AND p.game_id=v.game_id WHERE p.document_id=d.id AND p.game_id=d.game_id AND v.status='open'
 ) x;
 -- Store the deleted record and its immutable evidence privately, not in the working registry.
 a:=jsonb_build_object('document',to_jsonb(d),
  'history',(SELECT coalesce(jsonb_agg(to_jsonb(h)),'[]') FROM public.formal_document_history h WHERE h.document_id=d.id),
  'signatures',(SELECT coalesce(jsonb_agg(to_jsonb(h)),'[]') FROM public.formal_document_signatures h WHERE h.document_id=d.id),
  'bill_amendments',(SELECT coalesce(jsonb_agg(to_jsonb(h)),'[]') FROM public.bill_amendments h WHERE h.document_id=d.id),
  'budget_amendments',(SELECT coalesce(jsonb_agg(to_jsonb(h)),'[]') FROM public.budget_law_amendments h WHERE h.document_id=d.id),
  'bill_packs',(SELECT coalesce(jsonb_agg(to_jsonb(h)),'[]') FROM public.bill_amendment_packs h WHERE h.document_id=d.id),
  'budget_packs',(SELECT coalesce(jsonb_agg(to_jsonb(h)),'[]') FROM public.budget_law_amendment_packs h WHERE h.document_id=d.id),
  'linked_votes',(SELECT coalesce(jsonb_agg(to_jsonb(h)),'[]') FROM public.game_votes h WHERE h.formal_document_id=d.id OR h.id=ANY(open_votes)),
  'cancelled_ballots',(SELECT coalesce(jsonb_agg(to_jsonb(h)),'[]') FROM public.game_ballots h WHERE h.vote_id=ANY(open_votes)));
 INSERT INTO private.teacher_formal_document_deletions(document_id,game_id,actor_id,snapshot,accepted_agenda_vote_id) VALUES(d.id,d.game_id,u,a,accepted);
 PERFORM set_config('app.gos_teacher_delete_document',d.id::text,true);
 IF s.id IS NOT NULL THEN
  UPDATE public.government_sessions SET agenda_document_id=NULL,agenda_approved_at=NULL,agenda_approved_by=NULL,
   moderator_approval_hash=NULL,moderator_approved_by=NULL,moderator_approved_at=NULL,
   deleted_accepted_agenda_id=case when accepted IS NOT NULL then d.id else NULL end,
   agenda_vote_id=case when accepted IS NOT NULL then accepted else NULL end
  WHERE id=s.id AND agenda_document_id=d.id;
 END IF;
 UPDATE public.institution_meeting_records SET agenda_approved_at=NULL,agenda_approved_by=NULL,agenda_body=NULL,agenda_document_id=NULL,updated_at=now()
 WHERE game_id=d.game_id AND agenda_document_id=d.id;
 UPDATE public.presidential_election_schedule SET appointment_document_id=NULL WHERE game_id=d.game_id AND appointment_document_id=d.id;
 -- Unlink only the amendment records being removed; keep closed votes intact.
 UPDATE public.bill_amendment_packs SET vote_id=NULL WHERE game_id=d.game_id AND document_id=d.id AND vote_id=ANY(open_votes);
 UPDATE public.bill_amendments SET vote_id=NULL WHERE game_id=d.game_id AND document_id=d.id AND vote_id=ANY(open_votes);
 UPDATE public.budget_law_amendment_packs SET vote_id=NULL WHERE game_id=d.game_id AND document_id=d.id AND vote_id=ANY(open_votes);
 UPDATE public.budget_law_amendments SET vote_id=NULL WHERE game_id=d.game_id AND document_id=d.id AND vote_id=ANY(open_votes);
 FOR v IN SELECT id,procedure_key FROM public.game_votes WHERE game_id=d.game_id AND id=ANY(open_votes) AND status='open' ORDER BY id FOR UPDATE LOOP
  IF v.procedure_key='government_agenda' THEN
   DELETE FROM public.game_votes WHERE id=v.id;
  ELSE
   PERFORM public.delete_procedural_vote(v.id);
  END IF;
 END LOOP;
 UPDATE public.budget_simulator_plans SET document_id=NULL,status=case when status='document' then 'draft' else status end WHERE game_id=d.game_id AND document_id=d.id;
 DELETE FROM public.formal_documents WHERE id=d.id AND game_id=d.game_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Документ уже изменён';END IF;
 PERFORM set_config('app.gos_teacher_delete_document','',true);
 INSERT INTO public.audit_log(game_id,actor_id,action,entity_type,entity_id,payload)
 VALUES(d.game_id,u,'teacher_formal_document_deleted','formal_documents',d.id,jsonb_build_object('registry_no',d.registry_no,'doc_type',d.doc_type,'stage_no',d.stage_no,'cancelled_open_votes',cardinality(open_votes),'preserved_accepted_agenda_vote',accepted));
 RETURN jsonb_build_object('deleted',true,'id',d.id,'registry_no',d.registry_no);
END;$$;
REVOKE ALL ON FUNCTION private.teacher_delete_formal_document_internal(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.delete_formal_document(p_document_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_uid uuid := (select auth.uid());
  d public.formal_documents%rowtype;
  v_teacher boolean;
  v_vote record;
  v_deleted boolean := false;
  v_session public.government_sessions%rowtype;
begin
  -- Lock a linked government session before the document, matching the
  -- approval/opening workflow. No locks on unrelated sessions.
  select * into d from public.formal_documents where id = p_document_id;
  if d.id is null or v_uid is null or not private.is_game_member(d.game_id) then
    raise exception 'Документ недоступен';
  end if;
  if private.is_game_teacher(d.game_id) then
    return private.teacher_delete_formal_document_internal(p_document_id);
  end if;
  if d.doc_type='meeting_agenda' and d.subject_key='government' then
    select * into v_session from public.government_sessions s
    where s.agenda_document_id=d.id and s.game_id=d.game_id
    for update;
  end if;
  select * into d
  from public.formal_documents
  where id = p_document_id
  for update;

  if d.id is null or v_uid is null or not private.is_game_member(d.game_id) then
    raise exception 'Документ недоступен';
  end if;

  IF d.metadata->>'cutoff_price_proposal'='true' AND d.status_code='published' THEN
   RAISE EXCEPTION 'Вступивший в силу закон об изменении цены отсечения нельзя удалить.' USING errcode='42501';
  END IF;
  IF d.doc_type='bank_rate_decision' THEN raise exception 'Принятое решение по ключевой ставке нельзя удалить. Измените ставку новым решением Банка России.' using errcode='42501';END IF;
  v_teacher := private.is_game_teacher(d.game_id);

  if v_session.id is not null then
    if not (v_teacher or private.can_approve_government_agenda(d.game_id,v_uid)) then
      raise exception 'Удалить повестку может только действующий Председатель Правительства или преподаватель' using errcode='42501';
    end if;
    if v_session.stage_no<>11 or v_session.status<>'draft' or v_session.opened_at is not null
       or not exists(select 1 from public.game_stages st where st.game_id=d.game_id and st.stage_no=11 and st.status='open')
       or exists(select 1 from public.government_program_agenda a
         join public.state_programs p on p.id=a.program_id
         where a.session_id=v_session.id and
          (a.status<>'pending' or a.vote_id is not null or a.started_at is not null
           or a.completed_at is not null or p.government_vote_id is not null))
       or exists(select 1 from public.government_session_questions q
         where q.session_id=v_session.id and q.status<>'pending')
       or exists(select 1 from public.game_votes v where v.formal_document_id=d.id)
    then
      raise exception 'Нельзя удалить повестку после начала заседания или рассмотрения вопросов' using errcode='42501';
    end if;
    -- Clear the approval and reference atomically before the document is
    -- deleted. Keep the session, agenda items and programme records intact.
    update public.government_sessions
    set agenda_approved_at=null,agenda_approved_by=null,agenda_document_id=null
    where id=v_session.id and agenda_document_id=d.id;
    if not found then raise exception 'Повестка уже изменена. Обновите данные.';end if;
  elsif not (v_teacher or d.author_id = v_uid) then
    raise exception 'Удалить НПА может только его автор или преподаватель';
  end if;

  if exists (
    select 1
    from public.game_votes
    where formal_document_id = d.id
      and status = 'open'
  ) and not v_teacher then
    raise exception 'Сначала завершите или удалите открытое голосование по этому НПА';
  end if;

  if v_teacher then
    for v_vote in
      select id
      from public.game_votes
      where formal_document_id = d.id
        and status = 'open'
      order by opened_at
    loop
      perform public.delete_procedural_vote(v_vote.id);
    end loop;
  end if;

  delete from public.formal_documents
  where id = d.id;

  v_deleted := found;

  return jsonb_build_object(
    'deleted', v_deleted,
    'id', d.id,
    'registry_no', d.registry_no
  );
end;
$function$;

CREATE OR REPLACE FUNCTION private.guard_manual_vote_document_link()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
 IF TG_OP='INSERT' THEN
  IF current_user IN ('authenticated','anon') AND NEW.formal_document_id IS NOT NULL
   AND NEW.procedure_key IN ('manual','registered_session') THEN
   RAISE EXCEPTION 'Выберите документ через форму создания голосования' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
 END IF;
 IF current_user NOT IN ('authenticated','anon') AND NEW.formal_document_id IS NULL AND private.teacher_document_delete_scope(OLD.formal_document_id,OLD.game_id)
  AND (to_jsonb(NEW)-'formal_document_id') IS NOT DISTINCT FROM (to_jsonb(OLD)-'formal_document_id') THEN RETURN NEW;END IF;
 IF NEW.formal_document_id IS DISTINCT FROM OLD.formal_document_id
  OR NEW.formal_step_code IS DISTINCT FROM OLD.formal_step_code THEN
  IF current_user IN ('authenticated','anon') THEN
   RAISE EXCEPTION 'Связь с НПА изменяется только установленной процедурой' USING ERRCODE='42501';
  END IF;
 END IF;
 IF OLD.formal_step_code='reference' AND
  (NEW.formal_document_id IS DISTINCT FROM OLD.formal_document_id
   OR NEW.formal_step_code IS DISTINCT FROM OLD.formal_step_code
   OR NEW.pass_transition IS DISTINCT FROM OLD.pass_transition
   OR NEW.fail_transition IS DISTINCT FROM OLD.fail_transition
   OR NEW.procedure_key IS DISTINCT FROM OLD.procedure_key) THEN
  -- FK cleanup from an authorized deletion may clear a link before any ballot.
  IF NEW.formal_document_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.game_ballots b WHERE b.vote_id=OLD.id) THEN
   RAISE EXCEPTION 'Привязка ознакомительного голосования зафиксирована' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.guard_budget_vote_direct_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare guarded boolean;
begin
 guarded:=(tg_op<>'INSERT' and (old.procedure_key in ('budget_government_submission','budget_reading1','budget_reading2','budget_reading3','budget_preparation_amendment','budget_second_reading_amendment') or private.is_budget_document(old.formal_document_id)))
  or (tg_op<>'DELETE' and (new.procedure_key in ('budget_government_submission','budget_reading1','budget_reading2','budget_reading3','budget_preparation_amendment','budget_second_reading_amendment') or private.is_budget_document(new.formal_document_id)));
 if guarded and current_user in ('anon','authenticated') then raise exception 'Правила, состав и результаты бюджетного голосования меняет защищённая процедура.';end if;
 if guarded and tg_op='UPDATE' and new.formal_document_id is null and private.teacher_document_delete_scope(old.formal_document_id,old.game_id)
  and (to_jsonb(new)-'formal_document_id') is not distinct from (to_jsonb(old)-'formal_document_id') then return new;end if;
 if guarded and tg_op<>'DELETE' and auth.uid() is not null then perform private.lock_budget_actor(new.game_id);end if;
 return case when tg_op='DELETE' then old else new end;
end;$function$;

CREATE OR REPLACE FUNCTION private.guard_bank_rate_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
BEGIN
 IF TG_OP='DELETE' THEN
  IF private.teacher_document_delete_scope(OLD.id,OLD.game_id) THEN RETURN OLD; END IF;
  IF OLD.doc_type='bank_rate_decision' THEN RAISE EXCEPTION 'Решение Банка России сохраняется в реестре; для смены ставки нужно новое решение' USING errcode='42501';END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.doc_type='bank_rate_decision'
    AND (NEW.workflow_key<>'bank_rate' OR NEW.subject_key<>'central_bank'
     OR NEW.metadata->>'bank_rate_decision'<>'true'
     OR current_setting('app.gos_bank_rate_create_id',true) IS DISTINCT FROM NEW.id::text)
  THEN RAISE EXCEPTION 'Решения Банка России создаются только через защищённую процедуру изменения ставки' USING errcode='42501';END IF;
  RETURN NEW;
 END IF;
 IF OLD.doc_type='bank_rate_decision' OR NEW.doc_type='bank_rate_decision' THEN
  IF OLD.doc_type IS DISTINCT FROM NEW.doc_type OR OLD.game_id IS DISTINCT FROM NEW.game_id
    OR OLD.stage_no IS DISTINCT FROM NEW.stage_no OR OLD.author_id IS DISTINCT FROM NEW.author_id
    OR OLD.title IS DISTINCT FROM NEW.title OR OLD.body_text IS DISTINCT FROM NEW.body_text
    OR OLD.workflow_key IS DISTINCT FROM NEW.workflow_key OR OLD.workflow_steps IS DISTINCT FROM NEW.workflow_steps
    OR OLD.subject_key IS DISTINCT FROM NEW.subject_key OR OLD.registry_no IS DISTINCT FROM NEW.registry_no
    OR OLD.metadata->>'bank_rate_request_id' IS DISTINCT FROM NEW.metadata->>'bank_rate_request_id'
    OR OLD.metadata->>'new_rate' IS DISTINCT FROM NEW.metadata->>'new_rate'
    OR OLD.metadata->>'old_rate' IS DISTINCT FROM NEW.metadata->>'old_rate'
    OR OLD.metadata->>'registry_independent' IS DISTINCT FROM NEW.metadata->>'registry_independent'
  THEN RAISE EXCEPTION 'Принятое решение Банка России нельзя переписать; примите новое решение' USING errcode='42501';END IF;
  IF NEW.status_code IS DISTINCT FROM OLD.status_code OR NEW.current_step IS DISTINCT FROM OLD.current_step
   OR NEW.current_owner_key IS DISTINCT FROM OLD.current_owner_key THEN
   IF NOT (OLD.status_code='adopted' AND NEW.status_code='published' AND NEW.current_owner_key='system'
     AND NEW.current_step=1 AND current_setting('app.gos_bank_rate_signed_id',true)=OLD.id::text)
   THEN RAISE EXCEPTION 'Опубликование решения Банка России допускается только после личного подписания' USING errcode='42501';END IF;
  END IF;
 END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION private.guard_bill_amendment_document()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
BEGIN
 IF TG_OP='DELETE' THEN
  IF private.teacher_document_delete_scope(OLD.id,OLD.game_id) THEN RETURN OLD; END IF;
  IF EXISTS(SELECT 1 FROM public.games WHERE id=OLD.game_id)
   AND EXISTS(SELECT 1 FROM public.bill_amendments WHERE document_id=OLD.id)
  THEN RAISE EXCEPTION 'Законопроект с историей поправок сохраняется в реестре до удаления игры';END IF;
  RETURN OLD;
 END IF;
 IF EXISTS(SELECT 1 FROM public.bill_amendments WHERE document_id=OLD.id AND status IN ('submitted','voting'))
  AND (NEW.status_code IS DISTINCT FROM OLD.status_code OR NEW.current_step IS DISTINCT FROM OLD.current_step
   OR NEW.current_owner_key IS DISTINCT FROM OLD.current_owner_key OR NEW.workflow_steps IS DISTINCT FROM OLD.workflow_steps
   OR NEW.doc_type IS DISTINCT FROM OLD.doc_type OR NEW.workflow_key IS DISTINCT FROM OLD.workflow_key OR NEW.game_id IS DISTINCT FROM OLD.game_id)
  AND NOT coalesce((OLD.stage_no=12 AND NEW.stage_no=12 AND OLD.workflow_key='bill' AND NEW.workflow_key='bill'
   AND OLD.status_code='amendments' AND NEW.status_code='reading2' AND NEW.current_step=OLD.current_step+1 AND NEW.current_owner_key='gd'
   AND NEW.workflow_steps IS NOT DISTINCT FROM OLD.workflow_steps AND NEW.doc_type IS NOT DISTINCT FROM OLD.doc_type AND NEW.game_id IS NOT DISTINCT FROM OLD.game_id
   AND NOT EXISTS(SELECT 1 FROM public.bill_amendment_packs WHERE document_id=OLD.id AND status IN ('opening','voting'))),false)
 THEN RAISE EXCEPTION 'Сначала рассмотрите или отзовите все поправки ко II чтению';END IF;
 IF (NEW.body_text IS DISTINCT FROM OLD.body_text OR NEW.title IS DISTINCT FROM OLD.title OR NEW.metadata->>'revision' IS DISTINCT FROM OLD.metadata->>'revision')
  AND EXISTS(SELECT 1 FROM public.bill_amendment_packs WHERE document_id=OLD.id AND status IN ('opening','voting'))
 THEN RAISE EXCEPTION 'Текст законопроекта зафиксирован до завершения голосования по поправкам';END IF;
 RETURN NEW;
END;$function$;

CREATE OR REPLACE FUNCTION private.guard_budget_law_document()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
begin
 if old.workflow_key<>'budget' or old.doc_type<>'federal_budget' then return case when tg_op='DELETE' then old else new end;end if;
 if tg_op='DELETE' then
  if private.teacher_document_delete_scope(old.id,old.game_id) then return old;end if;
  if exists(select 1 from games where id=old.game_id) and exists(select 1 from budget_law_amendments where document_id=old.id) then raise exception 'История бюджетных поправок сохраняется до удаления игры.';end if;
  return old;
 end if;
 if exists(select 1 from budget_law_amendments where document_id=old.id and status in ('submitted','voting')) and (
  new.status_code is distinct from old.status_code or new.current_step is distinct from old.current_step or new.current_owner_key is distinct from old.current_owner_key
  or new.workflow_key is distinct from old.workflow_key or new.workflow_steps is distinct from old.workflow_steps or new.doc_type is distinct from old.doc_type or new.game_id is distinct from old.game_id)
  then raise exception 'Сначала рассмотрите или отзовите все поправки ко II чтению бюджета.';end if;
 if exists(select 1 from budget_law_amendment_packs where document_id=old.id and status in ('opening','voting')) and (
  new.body_text is distinct from old.body_text or new.title is distinct from old.title or new.metadata->>'revision' is distinct from old.metadata->>'revision'
  or new.metadata->'budget_snapshot' is distinct from old.metadata->'budget_snapshot' or new.metadata->'budget_draft' is distinct from old.metadata->'budget_draft')
  then raise exception 'Редакция бюджета зафиксирована до завершения голосования по пакету.';end if;
 if old.metadata ? 'budget_first_reading_snapshot' and (
  new.metadata->'budget_snapshot' is distinct from old.metadata->'budget_snapshot' or new.metadata->'budget_draft' is distinct from old.metadata->'budget_draft') and not exists(
   select 1 from budget_law_amendment_packs p where p.document_id=old.id and p.game_id=old.game_id and p.status='accepted'
    and p.source_revision=coalesce((old.metadata->>'revision')::integer,1) and p.source_calculation=old.metadata->'budget_snapshot' and p.source_draft=old.metadata->'budget_draft' and p.source_body_text=coalesce(old.body_text,'')
    and p.result_calculation=new.metadata->'budget_snapshot' and p.result_draft=new.metadata->'budget_draft' and p.result_body_text=new.body_text and coalesce((new.metadata->>'revision')::integer,1)=p.source_revision+1)
  then raise exception 'Числовые приложения после I чтения меняются только принятыми бюджетными поправками.';end if;
 -- Prevent first reading/publication of a stale 2027 programme allocation set.
 if new.status_code is distinct from old.status_code and new.status_code in ('reading1','published')
 and new.metadata->>'budget_year'='2027' and new.metadata ? 'budget_simulator_plan_id'
 and private.budget_program_expense_keys(new.metadata->'budget_snapshot'->'expense_items') is distinct from private.budget_program_expense_keys(private.signed_program_budget_items(new.game_id)) then
 raise exception 'В проекте бюджета не учтены актуальные принятые госпрограммы. Подготовьте обновлённый расчёт.';end if;
 return new;
end;$function$;

CREATE OR REPLACE FUNCTION private.government_agenda_adopted(p_session uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 SELECT EXISTS(SELECT 1 FROM public.government_sessions s
 JOIN public.game_votes v ON v.id=s.agenda_vote_id AND v.game_id=s.game_id
 JOIN public.formal_documents d ON d.id=s.agenda_document_id AND d.game_id=s.game_id
 WHERE s.id=p_session AND s.status='open' AND s.agenda_approved_at IS NOT NULL
 AND v.stage_no=11 AND v.institution_key='government' AND v.procedure_key='government_agenda'
 AND v.status='closed' AND v.result_code='passed' AND v.result_quorum_met
 AND v.formal_document_id=d.id AND v.body=d.body_text AND d.status_code='published' AND private.agenda_approved_or_signed(d.id)) OR EXISTS(
 SELECT 1 FROM public.government_sessions s JOIN public.game_votes v ON v.id=s.agenda_vote_id AND v.game_id=s.game_id
 WHERE s.id=p_session AND s.status='open' AND s.agenda_document_id IS NULL AND s.deleted_accepted_agenda_id IS NOT NULL
 AND v.stage_no=11 AND v.institution_key='government' AND v.procedure_key='government_agenda' AND v.status='closed' AND v.result_code='passed' AND v.result_quorum_met);
$function$;

CREATE OR REPLACE FUNCTION public.sync_government_session_programmes(p_session_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE s public.government_sessions%rowtype;p record;n integer:=0;
BEGIN
 SELECT * INTO s FROM public.government_sessions WHERE id=p_session_id FOR UPDATE;
 IF s.id IS NULL OR NOT private.can_approve_government_agenda(s.game_id,auth.uid()) THEN RAISE EXCEPTION 'Недостаточно прав на повестку Правительства';END IF;
 IF private.is_game_teacher(s.game_id) AND s.status='open' AND s.agenda_document_id IS NULL AND s.deleted_accepted_agenda_id IS NULL AND s.agenda_vote_id IS NULL THEN
  PERFORM private.refresh_government_agenda_document(s.id);RETURN 0;
 END IF;
 IF s.status<>'draft' OR s.agenda_approved_at IS NOT NULL THEN RAISE EXCEPTION 'Утверждённую повестку менять нельзя';END IF;
 FOR p IN SELECT x.id FROM public.state_programs x
   WHERE x.game_id=s.game_id
   AND ( (x.status='ready' AND x.signed_at IS NULL)
     OR (x.status='government_vote' AND x.signed_at IS NOT NULL
        AND x.government_vote_id IS NOT NULL
        AND EXISTS(SELECT 1 FROM public.game_votes v WHERE v.id=x.government_vote_id
          AND v.game_id=x.game_id AND v.stage_no=11 AND v.status='open'
          AND v.institution_key='government' AND v.procedure_key='state_program')
        AND NOT EXISTS(SELECT 1 FROM public.game_ballots b WHERE b.vote_id=x.government_vote_id)))
   AND NOT EXISTS(SELECT 1 FROM public.government_program_agenda a JOIN public.government_sessions ss ON ss.id=a.session_id WHERE a.program_id=x.id AND ss.status<>'closed' AND a.status IN ('pending','presenting','decision'))
   ORDER BY x.responsible_ministry,x.title,x.id
 LOOP
  IF n+(SELECT count(*) FROM public.government_program_agenda WHERE session_id=s.id)>=30 THEN
    RAISE EXCEPTION 'Превышен предел 30 вопросов. Проведите отдельное заседание'; END IF;
  PERFORM public.add_program_to_government_agenda(s.id,p.id,7);
  n:=n+1;
 END LOOP;
 -- Recreate a deliberately removed draft document even when all five
 -- programme links already exist and no new agenda row was inserted.
 IF EXISTS(SELECT 1 FROM public.government_sessions gs
   WHERE gs.id=s.id AND gs.agenda_document_id IS NULL) THEN
  PERFORM private.refresh_government_agenda_document(s.id);
 END IF;
 RETURN n;
END $function$;

CREATE OR REPLACE FUNCTION private.refresh_government_agenda_document(p_session uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare s public.government_sessions%rowtype; v_doc uuid;v_registry text;v_steps jsonb;v_body text;v_rows text;v_actor uuid;
begin
 perform set_config('app.gos_government_agenda_session',p_session::text,true);
 select * into s from public.government_sessions where id=p_session;
 if s.id is null then return null; end if;
 -- The signed text is immutable. The session's current status is rendered separately.
 IF s.deleted_accepted_agenda_id IS NOT NULL THEN
  PERFORM set_config('app.gos_government_agenda_session','',true);RETURN NULL;
 END IF;
 IF s.agenda_document_id IS NOT NULL AND (s.status<>'draft' OR s.agenda_approved_at IS NOT NULL) THEN
  PERFORM set_config('app.gos_government_agenda_session','',true);
  RETURN s.agenda_document_id;
 END IF;
 v_actor:=coalesce((select auth.uid()),s.created_by);
 select string_agg(format('%s. %s%s%s', q.rn, q.title,
    case when q.description='' then '' else E'\n   '||q.description end,
    E'\n   Доклад: '||q.minutes||' мин.'), E'\n\n' order by q.rn) into v_rows
 from (
   select row_number() over(order by src.sort_at,src.agenda_order,src.sort_id) as rn,src.title,src.description,src.minutes
   from (
      select q.created_at as sort_at,0::integer as agenda_order,q.id as sort_id,q.title,q.description,q.duration_minutes as minutes
      from public.government_session_questions q where q.session_id=s.id
      union all
      select a.created_at,a.agenda_no,a.id,'Рассмотрение государственной программы '||case when left(btrim(p.title),1)='«' and right(btrim(p.title),1)='»' then btrim(p.title) else '«'||p.title||'»' end,
             'Ответственный исполнитель: '||p.responsible_ministry,a.report_minutes
      from public.government_program_agenda a
      join public.state_programs p on p.id=a.program_id
      where a.session_id=s.id and not exists(select 1 from public.government_session_questions q where q.program_agenda_id=a.id)
   ) src
 ) q;
 v_body:='ПОВЕСТКА ЗАСЕДАНИЯ ПРАВИТЕЛЬСТВА РОССИЙСКОЙ ФЕДЕРАЦИИ'
      ||E'\n\n'||s.title||E'\nЗаседание № '||s.session_no
      ||E'\nОбщий регламент: '||s.time_limit_minutes||' мин.'
      ||E'\nСтатус: '||case when s.status='draft' and s.agenda_approved_at is null then 'Проект' when s.status='closed' then 'Заседание завершено' else 'Утверждена' end
      ||E'\n\nВОПРОСЫ ПОВЕСТКИ\n\n'||coalesce(v_rows,'Вопросы повестки пока не внесены.');
 v_doc:=s.agenda_document_id;
 if v_doc is null then
   v_doc:=gen_random_uuid();
   v_registry:='ГОС.ID-ПОВ-'||lpad(nextval('public.formal_registry_seq')::text,4,'0');
   v_steps:=private.formal_workflow('government_act');
   insert into public.formal_documents(
     id,game_id,stage_no,registry_no,title,doc_type,subject_key,subject_label,author_id,
     body_text,workflow_key,workflow_steps,current_step,status_code,status_label,current_owner_key,metadata
   ) values(
     v_doc,s.game_id,11,v_registry,'Повестка заседания Правительства № '||s.session_no,
     'meeting_agenda','government','Правительство Российской Федерации',s.created_by,
     v_body,'government_act',v_steps,0,'draft','Проект повестки','government',
     jsonb_build_object('document_kind','government_session_agenda','government_session_id',s.id,'auto_generated',true)
   );
   update public.government_sessions set agenda_document_id=v_doc where id=s.id;
   insert into public.formal_document_history(document_id,game_id,actor_id,action,to_status,to_owner,note)
     values(v_doc,s.game_id,v_actor,'Создан проект повестки','draft','government','Связан с заседанием Правительства № '||s.session_no);
 else
   update public.formal_documents set body_text=v_body,updated_at=now(),
     status_code=case when s.status='draft' and s.agenda_approved_at is null then 'draft' else 'published' end,
     status_label=case when s.status='draft' and s.agenda_approved_at is null then 'Проект повестки' when s.status='closed' then 'Заседание завершено' else 'Утверждена Председателем Правительства' end,
     current_owner_key=case when s.status='draft' and s.agenda_approved_at is null then 'government' else 'system' end
   where id=v_doc and (body_text is distinct from v_body or status_label is distinct from
      case when s.status='draft' and s.agenda_approved_at is null then 'Проект повестки' when s.status='closed' then 'Заседание завершено' else 'Утверждена Председателем Правительства' end);
 end if;
 perform set_config('app.gos_government_agenda_session','',true);
 return v_doc;
end;$function$;