-- Standalone NPA registry documents are independent of the game stage lifecycle.
-- Stage forms, institutional meeting documents, mandatory final documents,
-- identity/role authorisation and formal legal workflow remain unchanged.
-- Guard marker creation through authorized RPC; do not permit client-side spoofing.
-- Independent documents are excluded from stage obligations and stage resets.
CREATE OR REPLACE FUNCTION public.create_formal_document(p_game_id uuid, p_stage_no integer, p_title text, p_doc_type text, p_subject_key text, p_subject_label text, p_body_text text, p_file_path text, p_file_name text, p_mime text, p_workflow_key text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
 v_id uuid:=gen_random_uuid();v_uid uuid:=(select auth.uid());v_steps jsonb;
 v_prefix text;v_no bigint;v_registry text;
begin
 if v_uid is null or not private.is_game_member(p_game_id) then raise exception 'Game access required';end if;
 if not private.can_create_formal_subject(p_game_id,v_uid,p_subject_key) then raise exception 'Your game role cannot create a document for this subject';end if;
 if length(trim(coalesce(p_title,'')))<3 then raise exception 'Document title is required';end if;

 -- A document's legal route is determined by its kind, never by a client-supplied workflow.
 IF p_workflow_key IS DISTINCT FROM (
  CASE p_doc_type
   WHEN 'fz_bill' THEN 'bill' WHEN 'fkz_bill' THEN 'bill'
   WHEN 'federal_budget' THEN 'budget'
   WHEN 'president_decree' THEN 'president_act' WHEN 'president_order' THEN 'president_act'
   WHEN 'government_resolution' THEN 'government_act' WHEN 'government_order' THEN 'government_act'
   WHEN 'state_program' THEN 'government_act'
   WHEN 'gd_resolution' THEN 'gd_resolution' WHEN 'sf_resolution' THEN 'sf_resolution'
   WHEN 'ministry_order' THEN 'ministry_act'
   WHEN 'municipal_act' THEN 'municipal_act'
   WHEN 'other' THEN 'generic'
   ELSE NULL
  END
 ) THEN
  RAISE EXCEPTION 'Вид документа не соответствует правовой процедуре' USING ERRCODE='23514';
 END IF;
 v_steps:=private.formal_workflow(p_workflow_key);
 v_prefix:=case p_doc_type
  when 'fz_bill' then 'ЗП-ФЗ' when 'fkz_bill' then 'ЗП-ФКЗ'
  when 'federal_budget' then 'ФБ'
  when 'president_decree' then 'УК' when 'president_order' then 'РП'
  when 'government_resolution' then 'ПП' when 'government_order' then 'РПР'
  when 'gd_resolution' then 'ПГД' when 'sf_resolution' then 'ПСФ'
  when 'ministry_order' then 'ПР' when 'state_program' then 'ГП'
  when 'municipal_act' then 'МСУ' else 'НПА' end;
 v_no:=nextval('public.formal_registry_seq');
 v_registry:='ГОС.ID-'||v_prefix||'-'||lpad(v_no::text,4,'0');
 -- Only the authorized registry RPC can attest a standalone document.
 if p_metadata->>'registry_independent'='true' then
   if p_metadata->>'stage_form'='true'
      or nullif(p_metadata->>'document_kind','') is not null
      or p_metadata->>'auto_generated'='true'
   then raise exception 'Документы процедур этапов нельзя регистрировать как самостоятельные'
      using errcode='42501';end if;
   perform set_config('app.gos_registry_independent_id',v_id::text,true);
 end if;
 insert into public.formal_documents(
  id,game_id,stage_no,registry_no,title,doc_type,subject_key,subject_label,author_id,
  body_text,source_file_path,source_file_name,source_mime_type,workflow_key,workflow_steps,
  current_step,status_code,status_label,current_owner_key,metadata
 ) values(
  v_id,p_game_id,p_stage_no,v_registry,trim(p_title),p_doc_type,p_subject_key,p_subject_label,v_uid,
  nullif(p_body_text,''),p_file_path,p_file_name,p_mime,p_workflow_key,v_steps,
  0,v_steps->0->>'code',v_steps->0->>'label',v_steps->0->>'owner',coalesce(p_metadata,'{}'::jsonb)
 );
 insert into public.formal_document_history(document_id,game_id,actor_id,action,to_status,to_owner,note)
 values(v_id,p_game_id,v_uid,'Создан документ',v_steps->0->>'code',v_steps->0->>'owner','Черновик создан в системе');
 return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.guard_stage_submission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
 v_game uuid:=case when tg_op='DELETE' then old.game_id else new.game_id end;
 v_stage integer;
begin
 if auth.uid() is null or private.is_game_teacher(v_game) then
  if tg_op='DELETE' then return old;end if;
  return new;
 end if;
 if tg_table_name='party_documents' or tg_table_name='party_invitations' then
  v_stage:=1;
 elsif tg_table_name='formal_documents' then
  v_stage:=case when tg_op='DELETE' then old.stage_no else new.stage_no end;
 else
  raise exception 'Unsupported stage guard' using errcode='22023';
 end if;
 -- Party documents are drafts permitted before chair election.
 -- Membership and open-stage checks remain enforced below.
 if not exists(select 1 from public.game_members gm
     where gm.game_id=v_game and gm.user_id=auth.uid() and gm.kind='student'
      and gm.roster_archived_at is null) then
  raise exception 'Student membership required' using errcode='42501';
 end if;
 -- A standalone registry document does not require an active stage.
 -- Keep membership and all document workflow/owner checks unchanged.
 if tg_table_name='formal_documents' and tg_op<>'DELETE'
   and new.metadata->>'registry_independent'='true'
 then
   if (tg_op='INSERT' and current_setting('app.gos_registry_independent_id',true)=new.id::text)
      or (tg_op='UPDATE' and old.metadata->>'registry_independent'='true')
   then return new;end if;
   raise exception 'Недопустимая отметка самостоятельного документа' using errcode='42501';
 end if;
 -- Meeting preparation is separate from stage work. Only an authorized
 -- save_institution_meeting_document RPC sets the transaction-local scope.
 if tg_table_name='formal_documents' and tg_op<>'DELETE' then
  if new.doc_type='meeting_agenda'
     and new.metadata->>'document_kind'='institution_meeting_agenda'
     and current_setting('app.gos_meeting_document_scope',true)
       =concat(new.game_id,':',new.stage_no,':',new.metadata->>'institution_key',':agenda')
  then return new;end if;
  if new.doc_type='minutes'
     and new.metadata->>'document_kind'='institution_meeting_minutes'
     and current_setting('app.gos_meeting_document_scope',true)
       =concat(new.game_id,':',new.stage_no,':',new.metadata->>'institution_key',':minutes')
  then return new;end if;
 end if;
 if tg_table_name='formal_documents' and tg_op<>'DELETE' then
  if (tg_op='INSERT' or (old.game_id=new.game_id and old.stage_no=new.stage_no
   and old.doc_type=new.doc_type and old.subject_key=new.subject_key
   and old.metadata->>'template_key'=new.metadata->>'template_key'))
   and private.can_remediate_stage_final_document(
     new.game_id,new.stage_no,auth.uid(),new.doc_type,new.subject_key,new.metadata) then
   return new;
  end if;
 end if;
 -- Typed row helpers must only be planned for formal_documents UPDATEs.
 if tg_table_name='formal_documents' and tg_op='UPDATE' then
  if private.stage4_legal_act_can_finalize(old,new,auth.uid()) then return new;end if;
  if private.can_reapprove_returned_gd_minutes(old,new,auth.uid()) then return new;end if;
 end if;
  if not exists(select 1 from public.game_stages st
   where st.game_id=v_game and st.stage_no=v_stage and st.status='open'
    and (st.deadline is null or st.deadline>clock_timestamp())) then
  raise exception 'Этап завершён или ещё не открыт. Изменения недоступны.' using errcode='42501';
 end if;
 if tg_op='DELETE' then return old;end if;
 return new;
end; $function$
;

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
 v_game:=NEW.game_id;v_stage:=NEW.stage_no;
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
END;$function$
;

CREATE OR REPLACE FUNCTION private.stage_required_final_documents(p_game uuid, p_stage integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
WITH policy(stage_no,template_key,label,doc_type,subject_key) AS (
 VALUES
 (2,'minutes','Протокол заседания КСРФ','other','ksrf'),
 (3,'minutes','Протокол заседания КСРФ','other','ksrf'),
 (4,'gd_chair_resolution','Постановление об избрании Председателя Государственной Думы','gd_resolution','gd'),
 (4,'gd_deputies_resolution','Постановление об избрании заместителей Председателя ГД','gd_resolution','gd'),
 (4,'gd_committees_resolution','Постановление об избрании председателей пяти комитетов ГД','gd_resolution','gd'),
 (4,'minutes','Протокол заседания Государственной Думы','other','gd'),
 (5,'gd_resolution','Постановление Государственной Думы','gd_resolution','gd'),
 (5,'minutes','Протокол заседания Государственной Думы','other','gd'),
 (6,'sf_resolution','Постановление Совета Федерации о назначении выборов','sf_resolution','sf'),
 (8,'president_decree','Указ Президента Российской Федерации','president_decree','president'),
 (8,'gd_resolution','Постановление Государственной Думы','gd_resolution','gd'),
 (9,'president_decree','Указ Президента о назначении','president_decree','president'),
 (9,'gd_resolution','Постановление Государственной Думы','gd_resolution','gd'),
 (10,'state_program','Государственная программа в реестре','state_program','government'),
 
 (11,'minutes','Протокол заседания Правительства','other','government'),
 (14,'municipal_act','Муниципальный правовой акт','municipal_act','municipality'),
 (15,'crisis_act','Правовой акт о реагировании на кризис','any','any')
), matches AS (
 SELECT x.*,
 EXISTS(
 SELECT 1 FROM public.formal_documents d
 WHERE d.game_id=p_game AND d.stage_no=p_stage
   AND coalesce(d.metadata->>'registry_independent','false')<>'true'
   AND (d.status_code='published' OR
       (p_stage=10 AND x.template_key = 'state_program'
        AND d.status_code IN ('draft','submitted','under_review','review')))
   AND (CASE WHEN x.doc_type='any'
      THEN d.doc_type IN ('president_decree','government_resolution','ministry_order','municipal_act')
      WHEN x.template_key IN ('gd_chair_resolution','gd_deputies_resolution','gd_committees_resolution')
      THEN d.doc_type='gd_resolution' AND d.subject_key='gd'
        AND d.metadata->>'document_kind'='stage4_office_result'
        AND d.metadata->>'source_result_key'=CASE x.template_key
         WHEN 'gd_chair_resolution' THEN 'gd_chair'
         WHEN 'gd_deputies_resolution' THEN 'gd_deputies'
         ELSE 'gd_committees' END
      WHEN x.template_key='minutes'
      THEN ((d.doc_type IN ('meeting_minutes','minutes')
          OR d.metadata->>'template_key'='minutes'
          OR (d.doc_type='other' AND d.title ILIKE 'Протокол заседания%'))
          AND (d.subject_key=x.subject_key OR d.subject_key IS NULL))
      WHEN x.template_key='state_program'
      THEN d.doc_type='state_program' AND d.metadata->>'auto_synced'='true'
       AND EXISTS (
         SELECT 1 FROM public.state_programs p
         WHERE p.game_id=d.game_id
          AND p.id::text=d.metadata->>'state_program_id'
          AND (
           p.status IN ('ready','government_vote','adopted')
           OR (
             p.status='rejected'
             -- A final rejection at Stage 11 cannot erase Stage 10's
             -- already prepared programme. Admission to a programme vote
             -- proves it passed Stage 10 and was presented to Government.
             AND EXISTS (
              SELECT 1
              FROM public.government_program_agenda a
              JOIN public.game_votes v ON v.id=a.vote_id AND v.game_id=a.game_id
              WHERE a.game_id=p.game_id AND a.program_id=p.id
               AND v.stage_no=11 AND v.procedure_key='state_program'
             )
           )
          )
       ) WHEN x.template_key='financial_economic'
      THEN d.metadata->>'template_key'='financial_economic'
      ELSE d.doc_type=x.doc_type AND
        (d.subject_key=x.subject_key OR d.subject_key IS NULL)
   END)
 ) AS fulfilled
 FROM policy x WHERE x.stage_no=p_stage
)
SELECT coalesce(jsonb_agg(jsonb_build_object(
 'template_key',template_key,'title',label,'subject_key',subject_key,'fulfilled',fulfilled,'evidence_state',case when stage_no=10 then 'prepared' else 'published' end)
 ORDER BY template_key),'[]'::jsonb)
FROM matches;
$function$
;

CREATE OR REPLACE FUNCTION public.reset_game_stage_progress(p_game_id uuid, p_stage_no integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
 v_count integer:=0; v_target_id uuid; v_game_round integer; v_was_open boolean:=false;
 v_vote_ids uuid[]:='{}'::uuid[];v_doc_ids uuid[]:='{}'::uuid[];
 v_post_ids uuid[]:='{}'::uuid[];v_election_ids uuid[]:='{}'::uuid[];
 v_impact_id bigint;v_party_id uuid;v_metric record;v_value numeric;v_reverted integer:=0;
BEGIN
 IF p_game_id IS NULL OR NOT private.is_game_teacher(p_game_id) THEN
  RAISE EXCEPTION 'Teacher access required' USING ERRCODE='42501';
 END IF;
 IF p_stage_no IS NOT NULL AND p_stage_no NOT BETWEEN 1 AND 16 THEN
  RAISE EXCEPTION 'Stage must be between 1 and 16' USING ERRCODE='22023';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('stage-control:'||p_game_id::text,0));
 SELECT current_round INTO v_game_round FROM public.games WHERE id=p_game_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Game does not exist'; END IF;
 IF p_stage_no IS NULL THEN
  UPDATE public.game_stages SET status='locked',opened_at=NULL,completed_at=NULL,
   deadline=NULL,score_closed_at=NULL WHERE game_id=p_game_id;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  DELETE FROM public.stage_deadline_rules WHERE game_id=p_game_id;
  UPDATE public.games SET current_round=1,turn_open=false,turn_ends_at=NULL,status='paused' WHERE id=p_game_id;
  INSERT INTO public.audit_log(game_id,actor_id,action,entity_type,payload)
  VALUES(p_game_id,auth.uid(),'all_stage_progress_reset','game_stages',
    jsonb_build_object('stage_no',NULL,'affected_stages',v_count,'preserves_work',true));
  RETURN v_count;
 END IF;
 SELECT id,status='open' INTO v_target_id,v_was_open
 FROM public.game_stages WHERE game_id=p_game_id AND stage_no=p_stage_no FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Stage does not exist'; END IF;
 SELECT COALESCE(array_agg(id),'{}'::uuid[]) INTO v_vote_ids
 FROM public.game_votes WHERE game_id=p_game_id AND stage_no=p_stage_no;
 SELECT COALESCE(array_agg(id),'{}'::uuid[]) INTO v_doc_ids
 FROM public.formal_documents WHERE game_id=p_game_id AND stage_no=p_stage_no
  AND coalesce(metadata->>'registry_independent','false')<>'true';
 SELECT COALESCE(array_agg(id),'{}'::uuid[]) INTO v_post_ids
 FROM public.political_posts WHERE game_id=p_game_id AND context->>'stage_no'=p_stage_no::text;
 SELECT COALESCE(array_agg(id),'{}'::uuid[]) INTO v_election_ids
 FROM public.office_elections WHERE game_id=p_game_id AND stage_no=p_stage_no;
 -- Reverse linked impacts before deleting their parent records.
 FOR v_impact_id IN
  SELECT l.id FROM public.impact_ledger l
  WHERE l.game_id=p_game_id AND l.status IS DISTINCT FROM 'reverted'
   AND ((l.source_type='vote' AND l.source_id=ANY(SELECT unnest(v_vote_ids)::text))
    OR (l.source_type='political_post' AND l.source_id=ANY(SELECT unnest(v_post_ids)::text))
    OR (l.source_type='formal_history' AND EXISTS(
      SELECT 1 FROM public.formal_document_history h
       WHERE h.game_id=p_game_id AND h.document_id=ANY(v_doc_ids)
       AND h.id::text=l.source_id)))
  ORDER BY l.id DESC
 LOOP
  PERFORM public.revert_impact_entry(v_impact_id);
  v_reverted:=v_reverted+1;
 END LOOP;
 -- Authority-evidence metric changes are outside impact_ledger.
 FOR v_metric IN
  SELECT h.metric_key,SUM(h.delta) AS amount FROM public.state_metric_history h
  WHERE h.game_id=p_game_id AND h.source_type='event_authority'
    AND EXISTS(SELECT 1 FROM public.event_authority_evidence e
      WHERE e.game_id=p_game_id AND e.stage_no=p_stage_no AND h.source_id=e.decision_id::text)
  GROUP BY h.metric_key
 LOOP
  SELECT value INTO v_value FROM public.state_metrics
    WHERE game_id=p_game_id AND metric_key=v_metric.metric_key FOR UPDATE;
  IF FOUND AND v_metric.amount<>0 THEN
   PERFORM private.record_metric_change(p_game_id,v_metric.metric_key,
    v_value-v_metric.amount,'stage_reset',v_target_id::text,auth.uid(),
    'Отмена эффекта решения этапа '||p_stage_no);
  END IF;
 END LOOP;
 -- State programs from the previous stage survive, but their approval does not.
 UPDATE public.state_program_budget_commitments c SET status='planned'
 WHERE c.game_id=p_game_id AND c.program_id IN (
  SELECT id FROM public.state_programs WHERE game_id=p_game_id
  AND stage_no<>p_stage_no AND government_vote_id=ANY(v_vote_ids));
 UPDATE public.state_programs SET status='ready',government_vote_id=NULL,
  signed_by=NULL,signed_at=NULL,publication_post_id=NULL
 WHERE game_id=p_game_id AND stage_no<>p_stage_no AND government_vote_id=ANY(v_vote_ids);
 -- Remove office roles created by completed elections belonging to this stage.
 DELETE FROM public.game_office_assignments a USING public.office_elections e,public.office_candidates c
 WHERE e.id=ANY(v_election_ids) AND e.game_id=p_game_id
  AND c.id=e.winner_candidate_id AND c.election_id=e.id
  AND a.game_id=p_game_id AND a.user_id=c.user_id
  AND a.legal_basis='Избран решением Государственной Думы'
  AND a.role_title=(CASE e.office_key
   WHEN 'gd_chair' THEN 'Председатель Государственной Думы'
   WHEN 'gd_deputy_1' THEN 'Заместитель Председателя Государственной Думы №1'
   WHEN 'gd_deputy_2' THEN 'Заместитель Председателя Государственной Думы №2'
   ELSE e.office_title END);
 UPDATE public.game_members m SET role_title=NULL FROM public.government_nominations n
 WHERE n.game_id=p_game_id AND n.stage_no=p_stage_no AND n.office_kind='central_bank_chair'
  AND n.status='appointed' AND n.candidate_user_id=m.user_id
  AND m.game_id=p_game_id AND m.role_title=n.office_title;
 -- Remove stage documents and their dependent amendments.
 DELETE FROM public.political_decisions WHERE game_id=p_game_id AND vote_id=ANY(v_vote_ids);
 DELETE FROM public.bill_amendment_packs WHERE game_id=p_game_id AND document_id=ANY(v_doc_ids);
 DELETE FROM public.bill_amendments WHERE game_id=p_game_id AND document_id=ANY(v_doc_ids);
 DELETE FROM public.budget_law_amendment_packs WHERE game_id=p_game_id AND document_id=ANY(v_doc_ids);
 DELETE FROM public.budget_law_amendments WHERE game_id=p_game_id AND document_id=ANY(v_doc_ids);
 DELETE FROM public.duma_sessions WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.government_sessions WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.institution_session_registrations WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.institution_meeting_records WHERE game_id=p_game_id AND stage_no=p_stage_no;

 IF p_stage_no=6 THEN
   DELETE FROM public.presidential_election_schedule WHERE game_id=p_game_id
      AND appointment_document_id=ANY(v_doc_ids);
 END IF;
 DELETE FROM public.formal_documents WHERE game_id=p_game_id AND stage_no=p_stage_no
  AND coalesce(metadata->>'registry_independent','false')<>'true';
 
 -- Undo references which would otherwise retain a cancelled vote.
 UPDATE public.bill_amendment_packs SET vote_id=NULL WHERE game_id=p_game_id AND vote_id=ANY(v_vote_ids);
 UPDATE public.bill_amendments SET vote_id=NULL WHERE game_id=p_game_id AND vote_id=ANY(v_vote_ids);
 UPDATE public.budget_law_amendment_packs SET vote_id=NULL WHERE game_id=p_game_id AND vote_id=ANY(v_vote_ids);
 UPDATE public.budget_law_amendments SET vote_id=NULL WHERE game_id=p_game_id AND vote_id=ANY(v_vote_ids);
 UPDATE public.budget_faction_amendments SET vote_id=NULL WHERE game_id=p_game_id AND vote_id=ANY(v_vote_ids);
 DELETE FROM public.game_votes WHERE game_id=p_game_id AND stage_no=p_stage_no;
 -- The ballot rows follow the vote's ON DELETE CASCADE foreign key.

 -- Stage-specific registries without a stage_no column.
 IF p_stage_no=2 THEN
   DELETE FROM public.parliamentary_election_rules WHERE game_id=p_game_id;
   DELETE FROM public.electoral_calculator_results WHERE game_id=p_game_id;
 ELSIF p_stage_no=3 THEN
   DELETE FROM public.game_region_party_control WHERE game_id=p_game_id;
   DELETE FROM public.regional_allocations WHERE game_id=p_game_id;
   DELETE FROM public.regional_election_rules WHERE game_id=p_game_id;
   DELETE FROM public.regional_calculator_results WHERE game_id=p_game_id;
   UPDATE public.game_parties SET regions=0,regional_seats_awarded=0
     WHERE game_id=p_game_id;
 ELSIF p_stage_no=4 THEN
   DELETE FROM public.committee_mandate_allocations WHERE game_id=p_game_id;
   DELETE FROM public.institution_assignments WHERE game_id=p_game_id
     AND unit_kind='committee';
 ELSIF p_stage_no=5 THEN
   DELETE FROM public.ghost_voting_policies WHERE game_id=p_game_id;
   UPDATE public.game_parties SET ghost_loss_current=0,ghost_active=false,
     ghost_started_at=NULL WHERE game_id=p_game_id AND
     (ghost_loss_current<>0 OR ghost_active OR ghost_started_at IS NOT NULL);
   FOR v_party_id IN SELECT id FROM public.game_parties WHERE game_id=p_game_id LOOP
     PERFORM private.rebalance_party_mandates(v_party_id);
   END LOOP;
 ELSIF p_stage_no=7 THEN
   DELETE FROM public.presidential_inauguration WHERE game_id=p_game_id;
 ELSIF p_stage_no=8 THEN
   DELETE FROM public.government_structures WHERE game_id=p_game_id;
 END IF;
 DELETE FROM public.office_elections WHERE game_id=p_game_id AND stage_no=p_stage_no;
 
 DELETE FROM public.government_nominations WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.state_programs WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.municipal_projects WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.presidential_addresses WHERE game_id=p_game_id AND stage_no=p_stage_no;

 DELETE FROM public.ghost_voting_rounds WHERE game_id=p_game_id AND stage_no=p_stage_no;

 IF p_stage_no=7 THEN
  PERFORM set_config('gos.stage_reset_game',p_game_id::text,true);
  UPDATE public.presidential_election_settings
   SET status='setup',result='{}'::jsonb,updated_at=now(),updated_by=auth.uid()
   WHERE game_id=p_game_id;
  DELETE FROM public.presidential_scorecards WHERE game_id=p_game_id;
  DELETE FROM public.presidential_teacher_ballots WHERE game_id=p_game_id;
  DELETE FROM public.presidential_public_polls WHERE game_id=p_game_id;
  DELETE FROM public.presidential_poll_decision_votes
  WHERE game_id=p_game_id;
  DELETE FROM public.presidential_poll_decision WHERE game_id=p_game_id;
  DELETE FROM public.presidential_student_system_votes WHERE game_id=p_game_id;
  DELETE FROM public.presidential_student_system_result WHERE game_id=p_game_id;
  DELETE FROM public.presidential_teacher_jury_scores WHERE game_id=p_game_id;
 ELSIF p_stage_no=14 THEN
  DELETE FROM public.municipal_mayor_elections WHERE game_id=p_game_id;
 END IF;
 DELETE FROM public.game_crises WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.event_authority_evidence WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.budget_scenarios WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.stage_assessments WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.game_evaluations WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.stage_debriefs WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.stage_final_document_obligations WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.stage_deadline_incidents WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.stage_deadline_rules WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.stage_readiness_overrides WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.blitz_assignments WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.blitz_daily_plans WHERE game_id=p_game_id AND stage_no=p_stage_no;
 DELETE FROM public.player_actions WHERE game_id=p_game_id AND round_no=p_stage_no;
 DELETE FROM public.missions WHERE game_id=p_game_id AND round_no=p_stage_no;
 DELETE FROM public.rounds WHERE game_id=p_game_id AND round_no=p_stage_no;
 DELETE FROM public.game_events WHERE game_id=p_game_id AND round_no=p_stage_no;
 DELETE FROM public.republic_comic_chapters WHERE game_id=p_game_id AND stage_no=p_stage_no;

 -- Remove stage storyline releases and unlink external references before deleting posts.
 DELETE FROM private.story_episode_releases r WHERE r.game_id=p_game_id
  AND EXISTS(SELECT 1 FROM private.story_episode_drafts d
    WHERE d.episode_no=r.episode_no AND d.stage_no=p_stage_no);
 UPDATE private.story_branch_reviews SET published_post_id=NULL,published_at=NULL
  WHERE game_id=p_game_id AND published_post_id=ANY(v_post_ids);
 UPDATE private.story_supplement_releases SET published_post_id=NULL,
   published_at=NULL,published_by=NULL
  WHERE game_id=p_game_id AND published_post_id=ANY(v_post_ids);
 UPDATE private.story_episode_releases SET published_post_id=NULL,
   published_at=NULL,published_by=NULL
  WHERE game_id=p_game_id AND published_post_id=ANY(v_post_ids);
 UPDATE public.media_news_proposals SET post_id=NULL
  WHERE game_id=p_game_id AND post_id=ANY(v_post_ids);
 DELETE FROM public.political_posts p WHERE
  p.game_id=p_game_id
  AND p.context->>'source_table'='rating_history'
  AND EXISTS(SELECT 1 FROM unnest(v_vote_ids) v(id)
   WHERE p.source_key LIKE 'rating-batch:%:'||v.id::text);
 DELETE FROM public.political_posts WHERE game_id=p_game_id
  AND context->>'stage_no'=p_stage_no::text;
 UPDATE public.game_stages SET status='locked',opened_at=NULL,completed_at=NULL,
  deadline=NULL,score_closed_at=NULL WHERE id=v_target_id;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 -- Recompute clock when another stage is open; never stop its timer.
 UPDATE public.games g SET
  turn_open=EXISTS(SELECT 1 FROM public.game_stages s WHERE s.game_id=p_game_id AND s.status='open'),
  turn_ends_at=(SELECT MIN(deadline) FROM public.game_stages s WHERE s.game_id=p_game_id AND s.status='open'),
  status=CASE WHEN EXISTS(SELECT 1 FROM public.game_stages s WHERE s.game_id=p_game_id AND s.status='open')
   THEN 'running' ELSE 'paused' END WHERE g.id=p_game_id;
 INSERT INTO public.audit_log(game_id,actor_id,action,entity_type,entity_id,payload)
 VALUES(p_game_id,auth.uid(),'stage_content_reset','game_stages',v_target_id,
  jsonb_build_object('stage_no',p_stage_no,'affected_stages',v_count,
   'votes_deleted',cardinality(v_vote_ids),'documents_deleted',cardinality(v_doc_ids),
   'impacts_reverted',v_reverted,'preserves_work',false));
 RETURN v_count;
END;
$function$
;
