
-- A reference is an advisory attachment, never a substitute for a legal reading.
CREATE OR REPLACE FUNCTION private.can_reference_vote_document(p_doc public.formal_documents,p_game uuid,p_stage integer)
RETURNS boolean LANGUAGE sql STABLE SET search_path=''
AS $f$
 SELECT coalesce(p_doc.game_id=p_game AND p_doc.doc_type IN
 ('fz_bill','fkz_bill','government_resolution','government_order','president_decree','president_order','gd_resolution','sf_resolution','ministry_order','municipal_act','other')
 AND p_doc.status_code NOT IN ('rejected','superseded','withdrawn','president_veto','sf_veto','sf_fkz_blocked')
 AND NOT coalesce(p_doc.metadata ? 'party_id',false)
 AND (p_doc.stage_no=p_stage OR p_doc.status_code='published'),false)
$f$;
REVOKE ALL ON FUNCTION private.can_reference_vote_document(public.formal_documents,uuid,integer) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.attach_vote_reference_document(p_vote_id uuid,p_document_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
DECLARE v public.game_votes%rowtype;d public.formal_documents%rowtype;u uuid:=auth.uid();
BEGIN
 SELECT * INTO v FROM public.game_votes WHERE id=p_vote_id FOR UPDATE;
 IF u IS NULL OR v.id IS NULL OR NOT private.is_game_teacher(v.game_id) THEN
  RAISE EXCEPTION 'Прикрепить документ может только преподаватель' USING ERRCODE='42501'; END IF;
 IF v.status<>'open' OR v.procedure_key NOT IN ('manual','registered_session')
 OR v.source_post_id IS NOT NULL OR v.pass_transition<>'none' OR v.fail_transition<>'none'
 OR v.formal_document_id IS NOT NULL OR v.formal_step_code IS NOT NULL THEN
  RAISE EXCEPTION 'Прикрепление доступно только к открытому самостоятельному голосованию без НПА' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.game_ballots b WHERE b.vote_id=v.id) THEN
  RAISE EXCEPTION 'После первого голоса привязка документа не меняется' USING ERRCODE='42501'; END IF;
 SELECT * INTO d FROM public.formal_documents WHERE id=p_document_id AND game_id=v.game_id FOR UPDATE;
 IF d.id IS NULL OR NOT private.can_reference_vote_document(d,v.game_id,v.stage_no) THEN
  RAISE EXCEPTION 'Документ недоступен для ознакомительного голосования этого этапа' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.game_votes q WHERE q.formal_document_id=d.id AND q.status='open') THEN
  RAISE EXCEPTION 'По этому документу уже идёт голосование'; END IF;
 UPDATE public.game_votes SET formal_document_id=d.id,formal_step_code='reference' WHERE id=v.id;
END;
$f$;
REVOKE ALL ON FUNCTION public.attach_vote_reference_document(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.attach_vote_reference_document(uuid,uuid) TO authenticated;

-- Prevent direct client writes bypassing the attachment RPC. Special system links
-- (for example a verified Stage 5 decision) keep their own established procedures.
CREATE OR REPLACE FUNCTION private.guard_manual_vote_document_link()
RETURNS trigger LANGUAGE plpgsql SET search_path=''
AS $f$
BEGIN
 IF TG_OP='INSERT' THEN
  IF current_user IN ('authenticated','anon') AND NEW.formal_document_id IS NOT NULL
   AND NEW.procedure_key IN ('manual','registered_session') THEN
   RAISE EXCEPTION 'Выберите документ через форму создания голосования' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
 END IF;
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
$f$;
REVOKE ALL ON FUNCTION private.guard_manual_vote_document_link() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS guard_manual_vote_document_link ON public.game_votes;
CREATE TRIGGER guard_manual_vote_document_link BEFORE INSERT OR UPDATE OF formal_document_id,formal_step_code,pass_transition,fail_transition,procedure_key ON public.game_votes
FOR EACH ROW EXECUTE FUNCTION private.guard_manual_vote_document_link();

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
