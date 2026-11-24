-- Author's rule: Federation Council is modeled by the teacher.
CREATE OR REPLACE FUNCTION public.confirm_budget_sf_review(p_document_id uuid, p_approved boolean, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE d public.formal_documents%rowtype;uid uuid:=auth.uid();v_next integer;v_step jsonb;v_status text;
BEGIN
 SELECT * INTO d FROM public.formal_documents WHERE id=p_document_id FOR UPDATE;
 IF uid IS NULL OR d.id IS NULL OR NOT private.is_game_teacher(d.game_id)
  OR d.workflow_key IS DISTINCT FROM 'budget' OR d.doc_type IS DISTINCT FROM 'federal_budget'
  OR d.status_code IS DISTINCT FROM 'sf' OR d.current_owner_key IS DISTINCT FROM 'sf'
  OR NOT (d.metadata ? 'budget_simulator_plan_id') OR p_approved IS NULL
 THEN RAISE EXCEPTION 'Подтверждение решения Совета Федерации по бюджету недоступно.' USING errcode='42501';END IF;
 PERFORM private.lock_budget_actor(d.game_id);
 -- Federation Council is always modeled by the teacher.

 IF length(btrim(coalesce(p_note,''))) NOT BETWEEN 8 AND 1500 THEN
  RAISE EXCEPTION 'Укажите основание решения Совета Федерации (8–1500 символов).';END IF;
 IF EXISTS(SELECT 1 FROM public.game_votes WHERE formal_document_id=d.id AND status='open') THEN
  RAISE EXCEPTION 'Сначала завершите открытое голосование.';END IF;
 IF (SELECT count(DISTINCT formal_step_code) FROM public.game_votes
  WHERE game_id=d.game_id AND formal_document_id=d.id AND formal_step_code IN ('reading1','reading2','reading3')
   AND procedure_key='budget_'||formal_step_code AND status='closed' AND result_code='passed'
   AND result_quorum_met AND result_yes>=226)<>3 THEN
  RAISE EXCEPTION 'Бюджет не прошёл три чтения Государственной Думы.' USING errcode='42501';END IF;
 v_next:=d.current_step+1;v_step:=d.workflow_steps->v_next;
 IF v_step->>'code' IS DISTINCT FROM 'president' THEN RAISE EXCEPTION 'Нарушен маршрут бюджета.';END IF;
 IF p_approved THEN
  IF coalesce((SELECT value FROM public.state_metrics WHERE game_id=d.game_id AND metric_key='lawfulness'),100)<30 THEN
   RAISE EXCEPTION 'При правовой устойчивости ниже 30%% применяется предусмотренное игрой отклонение Совета Федерации.';END IF;
  UPDATE public.formal_documents SET current_step=v_next,status_code='president',
   status_label=v_step->>'label',current_owner_key='president',updated_at=now()
   WHERE id=d.id RETURNING status_code INTO v_status;
  IF v_status<>'president' THEN RAISE EXCEPTION 'Игровые условия рассмотрения изменились.';END IF;
 ELSE
  UPDATE public.formal_documents SET status_code='sf_veto',
   status_label='Совет Федерации отклонил бюджет: повторное принятие в ГД не менее чем 2/3 голосов',
   current_owner_key='gd_council',metadata=metadata||jsonb_build_object('budget_sf_rejected_by_teacher',true),updated_at=now()
   WHERE id=d.id;
 END IF;
 INSERT INTO public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
 VALUES(d.id,d.game_id,uid,CASE WHEN p_approved THEN 'Подтверждено одобрение бюджета Советом Федерации'
   ELSE 'Подтверждено отклонение бюджета Советом Федерации' END,'sf',
   CASE WHEN p_approved THEN 'president' ELSE 'sf_veto' END,'sf',
   CASE WHEN p_approved THEN 'president' ELSE 'gd_council' END,
   btrim(p_note)||' · Решение Совета Федерации принято преподавателем по правилам игры');
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_cutoff_sf_review(p_document_id uuid, p_approved boolean, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_uid uuid:=auth.uid();d public.formal_documents%rowtype;v_next integer;v_step jsonb;v_status text;
BEGIN
 SELECT * INTO d FROM public.formal_documents WHERE id=p_document_id FOR UPDATE;
 IF d.id IS NULL OR v_uid IS NULL OR NOT private.is_game_teacher(d.game_id)
   OR d.workflow_key<>'bill' OR d.doc_type<>'fz_bill'
   OR (d.metadata->>'cutoff_price_proposal') IS DISTINCT FROM 'true' OR d.status_code<>'sf'
   OR d.current_owner_key IS DISTINCT FROM 'sf' OR p_approved IS NULL
 THEN RAISE EXCEPTION 'Решение Совета Федерации недоступно для подтверждения.' USING errcode='42501';END IF;
 IF p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 8 AND 1500
 THEN RAISE EXCEPTION 'Обоснование решения Совета Федерации: от 8 до 1500 символов.';END IF;
 IF EXISTS(SELECT 1 FROM public.game_votes v WHERE
  v.formal_document_id=d.id AND v.status='open')
 THEN RAISE EXCEPTION 'Завершите открытое голосование Совета Федерации.';END IF;
 IF p_approved THEN
  v_next:=d.current_step+1;v_step:=d.workflow_steps->v_next;
  IF v_step->>'code'<>'president' THEN RAISE EXCEPTION 'Нарушен маршрут законопроекта.';END IF;
  UPDATE public.formal_documents SET current_step=v_next,status_code='president',
   status_label=v_step->>'label',current_owner_key='president',updated_at=now()
  WHERE id=d.id RETURNING status_code INTO v_status;
  IF v_status IS DISTINCT FROM 'president' THEN RAISE EXCEPTION 'Игровые условия рассмотрения изменились.';END IF;
  UPDATE private.cutoff_price_law_proposals SET sf_confirmed_by=v_uid,sf_confirmed_at=now()
  WHERE document_id=d.id;
 ELSE
  UPDATE public.formal_documents SET status_code='rejected',status_label='Отклонён Советом Федерации',
   current_owner_key='system',updated_at=now() WHERE id=d.id;
 END IF;
 INSERT INTO public.formal_document_history(document_id,game_id,actor_id,action,
  from_status,to_status,from_owner,to_owner,note)
 VALUES(d.id,d.game_id,v_uid,CASE WHEN p_approved
  THEN 'Подтверждено одобрение Совета Федерации'
  ELSE 'Подтверждено отклонение Совета Федерации' END,
  'sf',CASE WHEN p_approved THEN 'president' ELSE 'rejected' END,
  'sf',CASE WHEN p_approved THEN 'president' ELSE 'system' END,
  btrim(p_note)||' · Решение подтверждено преподавателем по правилам игровой редукции');
END $function$;

CREATE OR REPLACE FUNCTION public.advance_formal_document(p_document_id uuid, p_action text DEFAULT 'advance'::text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
 d public.formal_documents%rowtype;
 v_uid uuid:=(select auth.uid());
 v_next integer;
 v_step jsonb;
 v_from_status text;
 v_from_owner text;
 v_ready jsonb;
begin
 if p_action not in ('advance','return','reject') then raise exception 'Неизвестное действие';end if;
 select * into d from public.formal_documents where id=p_document_id for update;
 if d.id is null then raise exception 'Document not found'; end if;
 if d.doc_type='bank_rate_decision' then raise exception 'Решение Банка России уже принято. Для подписания используйте карточку НПА.' using errcode='42501';end if;
 if d.status_code in ('rejected','superseded','withdrawn') then raise exception 'Документ отклонён или прекращён. Продолжение процедуры недоступно' using errcode='42501'; end if;
 if d.doc_type in ('meeting_agenda','minutes') and d.metadata->>'document_kind' in ('institution_meeting_agenda','duma_session_agenda','institution_meeting_minutes') then raise exception 'Повестка или протокол утверждается в разделе заседания, а не через маршрут постановления' using errcode='42501';end if;
 if v_uid is null or not private.is_game_member(d.game_id) then raise exception 'Game access required'; end if;
 if d.workflow_key in ('bill','budget') and d.doc_type in ('fz_bill','fkz_bill','federal_budget') and d.status_code='sf' and d.current_owner_key='sf' then
  raise exception 'Совет Федерации моделирует преподаватель. Используйте установленное подтверждение решения.' using errcode='42501';end if;
 if not private.matches_formal_owner(d.game_id,v_uid,d.current_owner_key,d.author_id) then raise exception 'Current stage belongs to another institution'; end if;

 v_from_status:=d.status_code; v_from_owner:=d.current_owner_key;

 if p_action='return' then
  if d.workflow_key='budget' and d.status_code in ('budget_committee','budget_council') then
   v_next:=1;
   update public.formal_documents
   set current_step=v_next,status_code='revision',
       status_label='Возвращён Правительству на доработку',
       current_owner_key='government',updated_at=now()
   where id=d.id;
   insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
   values(d.id,d.game_id,v_uid,'Проект бюджета возвращён Правительству на доработку',v_from_status,'revision',v_from_owner,'government',p_note);
  else
   v_next:=0;v_step:=d.workflow_steps->v_next;
   update public.formal_documents set current_step=v_next,status_code='revision',status_label='Возвращён на доработку',current_owner_key='author',updated_at=now() where id=d.id;
   insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
   values(d.id,d.game_id,v_uid,'Возвращён на доработку',v_from_status,'revision',v_from_owner,'author',p_note);
  end if;
 elsif p_action='reject' then
  update public.formal_documents set status_code='rejected',status_label='Отклонён',current_owner_key='system',updated_at=now() where id=d.id;
  insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
  values(d.id,d.game_id,v_uid,'Отклонён',v_from_status,'rejected',v_from_owner,'system',p_note);
 else
  if d.workflow_key='bill' AND d.doc_type NOT IN ('fz_bill','fkz_bill')
     AND NOT (d.doc_type='bill' AND d.metadata->>'purpose'='presidential_electoral_system')
  THEN RAISE EXCEPTION 'Полная законодательная процедура предусмотрена только для ФЗ и ФКЗ' USING ERRCODE='42501'; END IF;
  if d.current_owner_key='president'
    and d.workflow_key in ('bill','budget','president_act')
    and not exists(
      select 1 from public.game_profiles gp where gp.game_id=d.game_id
       and gp.user_id=v_uid and nullif(gp.signature_path,'') is not null
    )
  then raise exception 'Президенту необходимо загрузить личную подпись в профиль перед подписанием' using errcode='23514';end if;
  if private.formal_vote_required(d) then raise exception 'Эта стадия завершается результатом голосования';end if;
  if exists(select 1 from public.game_votes where formal_document_id=d.id and status='open') then raise exception 'Сначала завершите открытое голосование';end if;
  if d.workflow_key='bill' and d.status_code in ('draft','revision') then
   v_ready:=private.bill_dossier_readiness_json(d.id);
   if not coalesce((v_ready->>'submission_ready')::boolean,false)
   then raise exception 'Bill submission package is incomplete: %',array_to_string(array(select jsonb_array_elements_text(v_ready->'issues')),'; '); end if;
  end if;
  if d.workflow_key='bill' and d.status_code='committee' then
   v_ready:=private.bill_dossier_readiness_json(d.id);
   if not coalesce((v_ready->>'committee_ready')::boolean,false)
   then raise exception 'Committee review is incomplete: %',array_to_string(array(select jsonb_array_elements_text(v_ready->'review_issues')),'; '); end if;
  end if;
  if d.workflow_key='budget' and d.status_code='budget_committee'
     and not private.budget_preliminary_ready(d.id)
  then raise exception 'Complete the Budget Committee preliminary review before sending the project to the State Duma Council'; end if;

  v_next:=d.current_step+1;
  if v_next>=jsonb_array_length(d.workflow_steps) then raise exception 'Workflow already completed'; end if;
  v_step:=d.workflow_steps->v_next;
  update public.formal_documents
  set current_step=v_next,status_code=v_step->>'code',status_label=v_step->>'label',
      current_owner_key=v_step->>'owner',updated_at=now()
  where id=d.id;
  insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
  values(d.id,d.game_id,v_uid,coalesce(d.workflow_steps->d.current_step->>'action','Передан далее'),v_from_status,v_step->>'code',v_from_owner,v_step->>'owner',p_note);
 end if;
end;$function$;

CREATE OR REPLACE FUNCTION public.create_procedural_vote(p_game_id uuid, p_title text, p_body text, p_voting_mode text, p_institution_key text, p_procedure_key text, p_quorum_kind text DEFAULT 'fraction'::text, p_quorum_value numeric DEFAULT 0.6666667, p_majority_kind text DEFAULT 'yes_no_simple'::text, p_majority_value numeric DEFAULT 0.5, p_allow_abstain boolean DEFAULT true, p_tie_breaker_chair boolean DEFAULT false, p_formal_document_id uuid DEFAULT NULL::uuid, p_pass_transition text DEFAULT 'none'::text, p_fail_transition text DEFAULT 'none'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_uid uuid:=(select auth.uid());
  v_id uuid:=gen_random_uuid();
  d public.formal_documents%rowtype;
  v_step_code text;
  v_existing uuid;
begin
  if v_uid is null or not private.is_game_member(p_game_id) then
    raise exception 'Game access required';
  end if;
  if p_voting_mode not in ('member','faction','mandate') then
    raise exception 'Unsupported voting mode';
  end if;
  if length(trim(coalesce(p_title,'')))<3 then
    raise exception 'Vote title is required';
  end if;

  if p_formal_document_id is not null then
    select * into d from public.formal_documents where id=p_formal_document_id for update;
    if d.id is null or d.game_id<>p_game_id then raise exception 'Formal document not found'; end if;
    if d.workflow_key in ('bill','budget') and d.doc_type in ('fz_bill','fkz_bill','federal_budget') and d.status_code='sf' and d.current_owner_key='sf'
      and p_procedure_key not in ('manual','registered_session') then
      raise exception 'Совет Федерации моделирует преподаватель. Отдельное процедурное голосование сенаторов не проводится.' using errcode='42501';end if;
    if not (
      private.is_game_teacher(p_game_id)
      or private.matches_formal_owner(d.game_id,v_uid,d.current_owner_key,d.author_id)
    ) then raise exception 'Current institution cannot open this vote'; end if;
    if p_procedure_key in ('manual','registered_session') then
      if not private.is_game_teacher(p_game_id) or p_pass_transition<>'none' or p_fail_transition<>'none'
        or not private.can_reference_vote_document(d,p_game_id,(select current_round from public.games where id=p_game_id)) then
        raise exception 'Самостоятельное голосование с НПА допускается только как ознакомительное' using errcode='42501';end if;
      if exists(select 1 from public.game_votes q where q.formal_document_id=d.id and q.status='open') then raise exception 'По этому документу уже идёт голосование';end if;
      v_step_code:='reference';
    else
      v_step_code:=d.status_code;
    end if;
    select id into v_existing from public.game_votes where formal_document_id=d.id and formal_step_code=v_step_code and status='open' order by opened_at limit 1;
    if v_existing is not null then return v_existing; end if;
  else
    if not private.is_game_teacher(p_game_id) then
      raise exception 'Only teacher can open an unlinked vote';
    end if;
  end if;

  insert into public.game_votes(
    id,game_id,stage_no,title,body,voting_mode,created_by,
    formal_document_id,formal_step_code,institution_key,procedure_key,
    quorum_kind,quorum_value,majority_kind,majority_value,allow_abstain,tie_breaker_chair,
    pass_transition,fail_transition
  )
  values(
    v_id,p_game_id,case when v_step_code='reference' then (select current_round from public.games where id=p_game_id) else coalesce(d.stage_no,(select current_round from public.games where id=p_game_id)) end,trim(p_title),nullif(trim(coalesce(p_body,'')),''),
    p_voting_mode,v_uid,p_formal_document_id,v_step_code,p_institution_key,p_procedure_key,
    p_quorum_kind,p_quorum_value,p_majority_kind,p_majority_value,p_allow_abstain,p_tie_breaker_chair,
    p_pass_transition,p_fail_transition
  );
  return v_id;
end;
$function$;
