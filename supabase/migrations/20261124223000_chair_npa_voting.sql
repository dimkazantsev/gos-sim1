-- Scoped chair authority for independent registered votes and signed agendas.

CREATE OR REPLACE FUNCTION private.can_chair_reference_vote(p_game uuid,p_user uuid,p_body text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $f$
 SELECT p_user IS NOT NULL AND p_user=auth.uid() AND private.is_game_member(p_game)
 AND EXISTS(SELECT 1 FROM public.game_members m WHERE m.game_id=p_game AND m.user_id=p_user
 AND m.kind='student' AND m.roster_archived_at IS NULL)
 AND private.role_is_available(p_game,p_user)
 AND EXISTS(SELECT 1 FROM private.formal_user_roles(p_game,p_user) r WHERE
 CASE p_body WHEN 'gd' THEN r LIKE '%председател%дум%' OR r LIKE '%совет%дум%'
 WHEN 'government' THEN r ~ '(^| · )председатель[[:space:]]+правительства([[:space:]]|$)'
 ELSE false END)
$f$;
REVOKE ALL ON FUNCTION private.can_chair_reference_vote(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION private.reference_document_matches_body(d public.formal_documents,p_body text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=''
AS $f$
 SELECT coalesce(CASE
 WHEN d.doc_type='meeting_agenda' THEN coalesce(nullif(d.metadata->>'institution_key',''),d.subject_key)=p_body
 WHEN p_body='government' THEN d.subject_key IN ('government','ministry') OR d.current_owner_key='government'
 WHEN p_body='gd' THEN d.subject_key='gd' OR d.current_owner_key IN ('gd','gd_staff','gd_council','committee')
   OR (d.workflow_key='bill' AND d.status_code='published')
 ELSE false END,false)
$f$;
REVOKE ALL ON FUNCTION private.reference_document_matches_body(public.formal_documents,text) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION private.can_reference_vote_document(p_doc formal_documents, p_game uuid, p_stage integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 SELECT coalesce(p_doc.game_id=p_game AND p_doc.doc_type IN
 ('fz_bill','fkz_bill','government_resolution','government_order','president_decree','president_order','gd_resolution','sf_resolution','ministry_order','municipal_act','other','meeting_agenda')
 AND p_doc.status_code NOT IN ('rejected','superseded','withdrawn','president_veto','sf_veto','sf_fkz_blocked')
 AND NOT coalesce(p_doc.metadata ? 'party_id',false)
 AND (p_doc.doc_type<>'meeting_agenda' OR (p_doc.status_code='published' AND p_doc.metadata->>'document_kind' IN ('institution_meeting_agenda','duma_session_agenda','government_session_agenda')))
 AND (p_doc.stage_no=p_stage OR p_doc.status_code='published'),false)
$function$;

CREATE OR REPLACE FUNCTION public.attach_vote_reference_document(p_vote_id uuid, p_document_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v public.game_votes%rowtype;d public.formal_documents%rowtype;u uuid:=auth.uid();
BEGIN
 SELECT * INTO v FROM public.game_votes WHERE id=p_vote_id FOR UPDATE;
 IF u IS NULL OR v.id IS NULL OR NOT (private.is_game_teacher(v.game_id) OR private.can_chair_reference_vote(v.game_id,u,v.institution_key)) THEN
  RAISE EXCEPTION 'Прикрепить документ может преподаватель или председательствующий своего органа' USING ERRCODE='42501'; END IF;
 IF v.status<>'open' OR v.procedure_key NOT IN ('manual','registered_session')
 OR v.source_post_id IS NOT NULL OR v.pass_transition<>'none' OR v.fail_transition<>'none'
 OR v.formal_document_id IS NOT NULL OR v.formal_step_code IS NOT NULL THEN
  RAISE EXCEPTION 'Прикрепление доступно только к открытому самостоятельному голосованию без НПА' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.game_ballots b WHERE b.vote_id=v.id) THEN
  RAISE EXCEPTION 'После первого голоса привязка документа не меняется' USING ERRCODE='42501'; END IF;
 SELECT * INTO d FROM public.formal_documents WHERE id=p_document_id AND game_id=v.game_id FOR UPDATE;
 IF d.id IS NULL OR NOT private.can_reference_vote_document(d,v.game_id,v.stage_no)
 OR (NOT private.is_game_teacher(v.game_id) AND NOT private.reference_document_matches_body(d,v.institution_key)) THEN
  RAISE EXCEPTION 'Документ недоступен для ознакомительного голосования этого этапа' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.game_votes q WHERE q.formal_document_id=d.id AND q.status='open') THEN
  RAISE EXCEPTION 'По этому документу уже идёт голосование'; END IF;
 UPDATE public.game_votes SET formal_document_id=d.id,formal_step_code='reference' WHERE id=v.id;
END;
$function$;

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

  -- Independent chair votes remain full-organ registered advisory votes.
  if not private.is_game_teacher(p_game_id) and p_procedure_key in ('manual','registered_session') then
    if not private.can_chair_reference_vote(p_game_id,v_uid,p_institution_key)
       or p_procedure_key is distinct from 'registered_session'
       or p_pass_transition is distinct from 'none' or p_fail_transition is distinct from 'none'
       or nullif(current_setting('app.vote_group',true),'') is not null
       or p_voting_mode is distinct from (case when p_institution_key='gd' then 'mandate' else 'member' end)
       or p_quorum_kind is distinct from 'fraction' or p_quorum_value is distinct from .5::numeric
       or p_majority_kind is distinct from (case when p_institution_key='gd' then 'eligible_majority' else 'present_majority' end)
       or p_majority_value is distinct from .5::numeric or p_allow_abstain is distinct from true
       or p_tie_breaker_chair is distinct from (p_institution_key='government') then
      raise exception 'Председатель открывает самостоятельное голосование только своего органа по установленным правилам' using errcode='42501';
    end if;
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
      or (p_procedure_key='registered_session' and private.can_chair_reference_vote(d.game_id,v_uid,p_institution_key) and private.reference_document_matches_body(d,p_institution_key))
    ) then raise exception 'Current institution cannot open this vote'; end if;
    if p_procedure_key in ('manual','registered_session') then
      if (not private.is_game_teacher(p_game_id) and not (private.can_chair_reference_vote(p_game_id,v_uid,p_institution_key) and private.reference_document_matches_body(d,p_institution_key))) or p_pass_transition<>'none' or p_fail_transition<>'none'
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
    if not private.is_game_teacher(p_game_id) and not (p_procedure_key='registered_session' and private.can_chair_reference_vote(p_game_id,v_uid,p_institution_key)) then
      raise exception 'Открыть самостоятельное голосование может преподаватель или председатель своего органа' using errcode='42501';
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

CREATE OR REPLACE FUNCTION private.can_close_procedural_vote(p_game uuid, p_user uuid, p_institution text, p_formal uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare d public.formal_documents%rowtype;
begin
 if p_user is distinct from auth.uid() then return false; end if;
 if p_institution='government' and p_formal is not null then
  select * into d from public.formal_documents
  where id=p_formal and game_id=p_game;
  if d.doc_type='federal_budget' and d.workflow_key='budget'
    and (d.status_code='government' or
      (d.status_code='revision' and d.current_owner_key='government' and d.current_step=1)) then
   return private.active_budget_actor(p_game)
    and (private.is_game_teacher(p_game) or exists(
     select 1 from private.formal_user_roles(p_game,p_user) rr
     where rr ~ '^председатель[[:space:]]+правительства([[:space:]]|$)'));
  end if;
 end if;
 if private.is_game_teacher(p_game) then return true; end if;
 if p_formal is not null and private.can_chair_reference_vote(p_game,p_user,p_institution)
   and exists(select 1 from public.game_votes v where v.game_id=p_game and v.formal_document_id=p_formal
     and v.institution_key=p_institution and v.status='open' and v.formal_step_code='reference'
     and v.pass_transition='none' and v.fail_transition='none')
 then return true;end if;
 if p_formal is not null then
  select * into d from public.formal_documents where id=p_formal and game_id=p_game;
  if d.id is null or not private.matches_formal_owner(p_game,p_user,d.current_owner_key,d.author_id) then return false; end if;
 end if;
 if p_institution='all' then return p_formal is not null; end if;
 return exists(
  select 1 from private.formal_user_roles(p_game,p_user) r
  where case p_institution
   when 'gd' then (r like '%председател%' or r like '%совет%') and r like '%дум%'
   when 'government' then r like '%председател%' and r like '%правительств%'
   when 'sf' then r like '%председател%' and r like '%совет%' and r like '%федерац%'
   when 'committee' then r like '%председател%' and r like '%комитет%'
   when 'municipality' then r like '%глава города%' or (r like '%глава%' and r like '%муницип%')
   else false end
 );
end $function$;
