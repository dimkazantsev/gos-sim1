-- Stage 10–11: official agenda ballot, session attendance and three-option programme decisions.
ALTER TABLE public.government_sessions ADD COLUMN IF NOT EXISTS agenda_vote_id uuid REFERENCES public.game_votes(id) ON DELETE RESTRICT;
ALTER TABLE public.institution_session_registrations ADD COLUMN IF NOT EXISTS government_session_id uuid REFERENCES public.government_sessions(id) ON DELETE SET NULL;
ALTER TABLE public.state_program_review_proposals ADD COLUMN IF NOT EXISTS accepted_content_hash text, ADD COLUMN IF NOT EXISTS incorporated_at timestamptz, ADD COLUMN IF NOT EXISTS incorporated_by uuid;
ALTER TABLE public.game_votes DROP CONSTRAINT game_votes_result_code_check;
ALTER TABLE public.game_votes ADD CONSTRAINT game_votes_result_code_check CHECK (result_code IS NULL OR result_code IN ('passed','rejected','no_quorum','superseded','revision','no_majority'));


CREATE OR REPLACE FUNCTION private.government_agenda_adopted(p_session uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO '' AS $$
 SELECT EXISTS(SELECT 1 FROM public.government_sessions s
 JOIN public.game_votes v ON v.id=s.agenda_vote_id AND v.game_id=s.game_id
 JOIN public.formal_documents d ON d.id=s.agenda_document_id AND d.game_id=s.game_id
 WHERE s.id=p_session AND s.status='open' AND s.agenda_approved_at IS NOT NULL
 AND v.stage_no=11 AND v.institution_key='government' AND v.procedure_key='government_agenda'
 AND v.status='closed' AND v.result_code='passed' AND v.result_quorum_met
 AND v.formal_document_id=d.id AND v.body=d.body_text AND d.status_code='published');
$$;
REVOKE ALL ON FUNCTION private.government_agenda_adopted(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.stage11_program_vote_result(p_yes numeric,p_no numeric,p_revision numeric,p_present numeric)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
 SELECT CASE WHEN p_yes>p_present/2 THEN 'passed' WHEN p_no>p_present/2 THEN 'rejected'
 WHEN p_revision>p_present/2 THEN 'revision' ELSE 'no_majority' END;
$$;
REVOKE ALL ON FUNCTION private.stage11_program_vote_result(numeric,numeric,numeric,numeric) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.open_government_agenda_vote_internal(p_session uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
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
END;$$;
REVOKE ALL ON FUNCTION private.open_government_agenda_vote_internal(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.open_government_agenda_vote(p_session_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE s public.government_sessions%rowtype;v_id uuid;
BEGIN
 SELECT * INTO s FROM public.government_sessions WHERE id=p_session_id;
 IF s.id IS NULL OR NOT private.can_approve_government_agenda(s.game_id,auth.uid()) THEN RAISE EXCEPTION 'Голосование по повестке открывает Председатель Правительства';END IF;
 v_id:=private.open_government_agenda_vote_internal(s.id);
 IF v_id IS NULL THEN RAISE EXCEPTION 'Сначала подпишите повестку, откройте заседание и дождитесь регистрации всех действующих членов Правительства';END IF;
 RETURN v_id;
END;$$;
REVOKE ALL ON FUNCTION public.open_government_agenda_vote(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.open_government_agenda_vote(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.correct_government_agenda_text(p_session_id uuid,p_body text,p_expected_body text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE s public.government_sessions%rowtype;d public.formal_documents%rowtype;v public.game_votes%rowtype;u uuid:=auth.uid();b text:=btrim(coalesce(p_body,''));rev integer;
BEGIN
 SELECT * INTO s FROM public.government_sessions WHERE id=p_session_id FOR UPDATE;
 IF s.id IS NULL OR s.status NOT IN ('draft','open') OR NOT private.can_approve_government_agenda(s.game_id,u) THEN RAISE EXCEPTION 'Недостаточно прав на корректировку повестки';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.game_stages st WHERE st.game_id=s.game_id AND st.stage_no=11 AND st.status='open') THEN RAISE EXCEPTION 'Этап 11 закрыт';END IF;
 SELECT * INTO v FROM public.game_votes WHERE id=s.agenda_vote_id AND game_id=s.game_id;
 IF v.status='open' OR v.result_code='passed' OR EXISTS(SELECT 1 FROM public.government_program_agenda a WHERE a.session_id=s.id AND a.status IN ('presenting','decision')) THEN RAISE EXCEPTION 'Принятую повестку или документ во время голосования изменять нельзя';END IF;
 SELECT * INTO d FROM public.formal_documents WHERE id=s.agenda_document_id AND game_id=s.game_id FOR UPDATE;
 IF d.id IS NULL OR d.body_text IS DISTINCT FROM p_expected_body THEN RAISE EXCEPTION 'Повестка обновилась. Откройте актуальный текст' USING ERRCODE='40001';END IF;
 IF char_length(b) NOT BETWEEN 80 AND 20000 THEN RAISE EXCEPTION 'Текст повестки: от 80 до 20000 символов';END IF;
 IF EXISTS(SELECT 1 FROM public.government_program_agenda a JOIN public.state_programs p ON p.id=a.program_id AND p.game_id=a.game_id WHERE a.session_id=s.id AND position(lower(btrim(p.title)) in lower(b))=0)
 THEN RAISE EXCEPTION 'Сохраните в тексте названия всех государственных программ из повестки';END IF;
 IF b=d.body_text THEN RAISE EXCEPTION 'Внесите изменения в текст повестки';END IF;
 SELECT coalesce(max(revision),0)+1 INTO rev FROM public.formal_document_revisions WHERE document_id=d.id;
 INSERT INTO public.formal_document_revisions(game_id,document_id,revision,title,body_text,metadata,editor_id)
 VALUES(d.game_id,d.id,rev,d.title,d.body_text,d.metadata,u);
 UPDATE public.government_sessions SET agenda_approved_at=NULL,agenda_approved_by=NULL,agenda_vote_id=NULL WHERE id=s.id;
 PERFORM set_config('app.gos_government_agenda_session',s.id::text,true);
 UPDATE public.formal_documents SET body_text=b,status_code='draft',status_label='Повестка скорректирована — ожидает подписи',current_owner_key='government',updated_at=now() WHERE id=d.id;
 PERFORM set_config('app.gos_government_agenda_session','',true);
 UPDATE public.institution_meeting_records SET agenda_body=b,agenda_approved_at=NULL,agenda_approved_by=NULL,updated_at=now()
 WHERE game_id=s.game_id AND stage_no=11 AND institution_key='government' AND agenda_document_id=d.id;
 INSERT INTO public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,note)
 VALUES(d.id,d.game_id,u,'Скорректирован текст повестки',d.status_code,'draft','Предыдущая редакция сохранена; голосование '||coalesce(v.id::text,'ещё не проводилось'));
END;$$;
REVOKE ALL ON FUNCTION public.correct_government_agenda_text(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.correct_government_agenda_text(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION private.programme_content_hash(p_program uuid)
RETURNS text LANGUAGE sql STABLE SET search_path TO '' AS $$
 SELECT md5(jsonb_build_object(
 'passport',to_jsonb(p)-ARRAY['status','government_vote_id','signed_at','signed_by','publication_post_id','pm_revision_reason','updated_at','created_at'],
 'goals',coalesce((SELECT jsonb_agg(x ORDER BY x::text) FROM (SELECT to_jsonb(g)-ARRAY['id','created_at'] x FROM public.state_program_goals g WHERE g.program_id=p.id AND g.game_id=p.game_id) t),'[]'),
 'components',coalesce((SELECT jsonb_agg(x ORDER BY x::text) FROM (SELECT to_jsonb(c)-ARRAY['id','created_at','target_goal_id'] x FROM public.state_program_components c WHERE c.program_id=p.id AND c.game_id=p.game_id) t),'[]'),
 'expenses',coalesce((SELECT jsonb_agg(x ORDER BY x::text) FROM (SELECT (to_jsonb(e)-ARRAY['id','created_at','component_id'])||jsonb_build_object('component',c.title) x FROM public.state_program_expenses e JOIN public.state_program_components c ON c.id=e.component_id AND c.program_id=e.program_id WHERE e.program_id=p.id AND e.game_id=p.game_id) t),'[]'),
 'years',coalesce((SELECT jsonb_agg(jsonb_build_array(y.budget_year,y.amount) ORDER BY y.budget_year) FROM public.state_program_budget_years y WHERE y.program_id=p.id AND y.game_id=p.game_id),'[]'))::text)
 FROM public.state_programs p WHERE p.id=p_program;
$$;
REVOKE ALL ON FUNCTION private.programme_content_hash(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.confirm_government_program_amendments(p_session_id uuid,p_program_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
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
 UPDATE public.state_program_review_proposals SET incorporated_at=now(),incorporated_by=u
 WHERE session_id=s.id AND program_id=p.id AND status='accepted' AND incorporated_at IS NULL;
END;$$;
REVOKE ALL ON FUNCTION public.confirm_government_program_amendments(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_government_program_amendments(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.ensure_stage11_government_agenda(p_game uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_pm uuid;
 v_session uuid;
 v_next_no integer;
 v_existing integer;
BEGIN
 IF p_game IS NULL THEN RETURN; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('gos-stage11-auto-agenda:'||p_game::text,0));
 IF NOT EXISTS (
   SELECT 1 FROM public.game_stages s
   WHERE s.game_id=p_game AND s.stage_no IN (10,11) AND s.status='open'
 ) THEN RETURN; END IF;
 IF NOT EXISTS (
   SELECT 1 FROM public.state_programs p
   WHERE p.game_id=p_game AND p.stage_no=10 AND p.status='ready'
     AND p.signed_at IS NULL
 ) THEN RETURN; END IF;

 SELECT a.user_id INTO v_pm
 FROM public.game_office_assignments a
 JOIN public.game_members m ON m.game_id=a.game_id AND m.user_id=a.user_id
 WHERE a.game_id=p_game AND a.status='active'
   AND a.role_title ~* '^[[:space:]]*председатель[[:space:]]+правительства([[:space:]]|$)'
   AND m.kind='student' AND m.roster_archived_at IS NULL
 ORDER BY a.created_at DESC LIMIT 1;
 IF v_pm IS NULL THEN RETURN; END IF;

 -- Never alter a meeting after the chair approved its agenda or opened it.
 SELECT s.id INTO v_session
 FROM public.government_sessions s
 WHERE s.game_id=p_game AND s.stage_no=11
   AND s.status='draft' AND s.agenda_approved_at IS NULL
 ORDER BY s.session_no DESC LIMIT 1 FOR UPDATE;
 IF v_session IS NULL THEN
   -- Late or returned programmes receive a NEW unsigned agenda, never rewrite a signed one.
   IF NOT EXISTS(SELECT 1 FROM public.state_programs p WHERE p.game_id=p_game AND p.stage_no=10 AND p.status='ready' AND p.signed_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM public.government_program_agenda a JOIN public.government_sessions s ON s.id=a.session_id
        WHERE a.program_id=p.id AND s.status<>'closed' AND a.status IN ('pending','presenting','decision'))) THEN RETURN;END IF;
   SELECT coalesce(max(s.session_no),0)+1 INTO v_next_no
   FROM public.government_sessions s WHERE s.game_id=p_game;
   INSERT INTO public.government_sessions
     (game_id,stage_no,session_no,title,time_limit_minutes,status,chair_user_id,created_by)
   VALUES(p_game,11,v_next_no,'Заседание Правительства Российской Федерации',60,'draft',v_pm,v_pm)
   RETURNING id INTO v_session;
 END IF;

 SELECT count(*)::integer INTO v_existing
 FROM public.government_program_agenda a WHERE a.session_id=v_session;
 IF v_existing>=30 THEN RETURN; END IF;

 -- Existing agenda trigger refreshes the SAME official draft document.
 -- Existing matches remain intact, keeping manual additions and numbering.
 INSERT INTO public.government_program_agenda
   (session_id,game_id,program_id,agenda_no,report_minutes)
 SELECT v_session,p_game,p.id,
     (v_existing+row_number() OVER (ORDER BY p.responsible_ministry,p.title,p.id))::integer,7
 FROM public.state_programs p
 WHERE p.game_id=p_game AND p.stage_no=10 AND p.status='ready'
   AND p.signed_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.government_program_agenda a JOIN public.government_sessions s ON s.id=a.session_id
     WHERE a.program_id=p.id AND s.status<>'closed' AND a.status IN ('pending','presenting','decision')
   )
 ORDER BY p.responsible_ministry,p.title,p.id
 LIMIT greatest(0,30-v_existing);
END;
$function$;

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
 -- Only the canonical unsigned Stage 11 agenda may be prepared during Stage 10.
 IF tg_table_name='formal_documents' AND tg_op<>'DELETE' AND new.stage_no=11 AND new.doc_type='meeting_agenda'
 AND new.status_code='draft' AND new.metadata->>'document_kind'='government_session_agenda'
 AND new.metadata->>'government_session_id'=current_setting('app.gos_government_agenda_session',true)
 AND EXISTS(SELECT 1 FROM public.government_sessions gs WHERE gs.id::text=new.metadata->>'government_session_id' AND gs.game_id=v_game AND gs.status='draft' AND gs.agenda_approved_at IS NULL)
 AND EXISTS(SELECT 1 FROM public.game_stages st WHERE st.game_id=v_game AND st.stage_no=10 AND st.status='open')
 THEN RETURN NEW;END IF;
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
  IF TG_OP='UPDATE' AND TG_TABLE_NAME='formal_documents' THEN
   IF OLD.doc_type='state_program' AND OLD.stage_no=10 AND OLD.metadata->>'auto_synced'='true'
     AND current_setting('app.gos_stage11_registry_status_id',true)=OLD.id::text
     AND (to_jsonb(NEW)-ARRAY['status_code','status_label','current_owner_key','current_step','updated_at'])
       IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['status_code','status_label','current_owner_key','current_step','updated_at'])
     AND EXISTS(SELECT 1 FROM public.game_stages st WHERE st.game_id=OLD.game_id AND st.stage_no=11 AND st.status='open')
   THEN RETURN NEW;END IF;
  END IF;
 -- A programme passport may be re-versioned on Stage 11 after the Stage 10
 -- round is completed. No other document type or stage is unlocked.
 IF tg_table_name='formal_documents' AND tg_op IN ('INSERT','UPDATE')
    AND new.stage_no=10 AND new.doc_type='state_program'
    AND new.metadata->>'auto_synced'='true'
    AND current_setting('app.gos_stage11_program_formal_id',true)=new.metadata->>'state_program_id'
    AND exists(
      select 1 from public.state_programs p
      join public.game_stages s on s.game_id=p.game_id AND s.stage_no=11 AND s.status='open'
      where p.id=(new.metadata->>'state_program_id')::uuid
        AND p.game_id=new.game_id AND p.stage_no=10
        AND p.status IN ('draft','revision','minister_review')
        AND p.signed_at IS NULL AND p.government_vote_id IS NULL
        AND NOT exists(select 1 from public.government_program_agenda a
          where a.program_id=p.id and a.vote_id IS NOT NULL and exists(select 1 from public.game_votes gv where gv.id=a.vote_id and gv.status='open'))
        AND private.can_edit_state_program(p.id,auth.uid())
    )
    AND (tg_op='INSERT' OR
         (old.game_id=new.game_id AND old.stage_no=new.stage_no
          AND old.doc_type=new.doc_type AND old.metadata->>'state_program_id'=new.metadata->>'state_program_id'
          AND new.status_code IN ('draft','revision')))
 THEN RETURN NEW; END IF;
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
end; $function$;

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
   IF NEW.status='draft' AND NEW.agenda_approved_at IS NULL AND private.can_approve_government_agenda(v_game,uid) THEN v_stage:=10;END IF;
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

CREATE OR REPLACE FUNCTION public.open_government_session(p_session_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare s public.government_sessions%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into s from public.government_sessions where id=p_session_id for update;
 if s.id is null then raise exception 'Заседание не найдено'; end if;
 if not private.can_manage_government_session(s.game_id,v_uid) then raise exception 'Недостаточно прав на открытие заседания'; end if;
 if s.status<>'draft' then raise exception 'Заседание уже открыто или завершено'; end if;
 if exists(select 1 from public.government_sessions x where x.game_id=s.game_id and x.stage_no=11 and x.status='open' and x.id<>s.id) then raise exception 'Сначала завершите текущее заседание Правительства';end if;
 if s.agenda_approved_at is null then raise exception 'Сначала Председатель Правительства должен утвердить сформированную повестку';end if;
 if not private.can_approve_government_agenda(s.game_id,v_uid) then raise exception 'Начать заседание может только Председатель Правительства';end if;
 if not exists(select 1 from public.government_session_questions where session_id=s.id)
    and not exists(select 1 from public.government_program_agenda where session_id=s.id) then
    raise exception 'Добавьте хотя бы один вопрос повестки';
 end if;
 if not exists(select 1 from public.game_stages st where st.game_id=s.game_id and st.stage_no=11 and st.status='open') then
  raise exception 'Сначала преподаватель должен открыть Этап 11';end if;
 update public.government_sessions set status='open',opened_at=now(),chair_user_id=v_uid where id=s.id;
 -- The Government session agenda is the ONE official agenda used by voting registration.
 insert into public.institution_meeting_records(
  game_id,stage_no,institution_key,agenda_document_id,agenda_body,
  agenda_prepared_by,agenda_approved_by,agenda_approved_at)
 select s.game_id,11,'government',d.id,d.body_text,v_uid,v_uid,now()
 from public.government_sessions gs
 join public.formal_documents d on d.id=gs.agenda_document_id and d.game_id=gs.game_id
 where gs.id=s.id and d.status_code='published' and length(btrim(d.body_text))>=30
 on conflict(game_id,stage_no,institution_key) do update
 set agenda_document_id=excluded.agenda_document_id, agenda_body=excluded.agenda_body,
  agenda_prepared_by=excluded.agenda_prepared_by,agenda_approved_by=excluded.agenda_approved_by,
  agenda_approved_at=excluded.agenda_approved_at,updated_at=now()
;
 -- The meeting-record trigger resets approval when the document changes. Reapply only after verified signature.
 update public.institution_meeting_records r set agenda_approved_by=v_uid,agenda_approved_at=now(),updated_at=now()
 where r.game_id=s.game_id and r.stage_no=11 and r.institution_key='government' and r.agenda_document_id=s.agenda_document_id;
 if not exists(select 1 from public.institution_meeting_records r
    join public.formal_documents d on d.id=r.agenda_document_id and d.game_id=r.game_id
    where r.game_id=s.game_id and r.stage_no=11 and r.institution_key='government'
    and r.agenda_document_id=s.agenda_document_id and r.agenda_approved_at is not null and d.status_code='published' and length(btrim(r.agenda_body))>=30) then
  raise exception 'Открытие заседания требует утверждённой повестки';end if;
end;$function$;

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
    agenda_approved_at=now(),updated_at=now() WHERE agenda_document_id=d.id;
  UPDATE public.government_sessions SET agenda_approved_at=coalesce(agenda_approved_at,now()),agenda_approved_by=uid
   WHERE agenda_document_id=d.id AND status IN ('draft','open') AND agenda_vote_id IS NULL;
 ELSE
  UPDATE public.institution_meeting_records SET updated_at=now() WHERE agenda_document_id=d.id;
 END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.register_institution_session_at_stage(p_game_id uuid, p_institution text, p_stage_no integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare uid uuid:=auth.uid();v_session public.government_sessions%rowtype;
begin
 if uid is null or not private.is_game_member(p_game_id) then raise exception 'Нет доступа к игре';end if;
 if p_stage_no is null or p_stage_no<1 or p_stage_no>16
    or not exists(select 1 from public.game_stages s where s.game_id=p_game_id and s.stage_no=p_stage_no)
 then raise exception 'Этап игры не найден';end if;
 if p_institution not in ('ksrf','gd','government','municipality','sf','committee','region',
  'cec','ks','vs','central_bank','accounts')
 and not exists(select 1 from public.institution_units u
  where u.game_id=p_game_id and 'unit:'||u.id::text=p_institution) then
  raise exception 'Орган не найден';end if;
 if not private.vote_member_has_office(p_game_id,uid,p_institution) then
  raise exception 'Должность или назначение в этот орган отсутствует';end if;
 if p_institution='government' and p_stage_no=11 then
  select * into v_session from public.government_sessions s where s.game_id=p_game_id and s.stage_no=11 and s.status='open' order by s.session_no desc limit 1 for update;
  if v_session.id is null or v_session.agenda_approved_at is null or not private.agenda_all_signed(v_session.agenda_document_id)
  or private.government_office_vote_weight(p_game_id,uid)<=0
  or not exists(select 1 from public.game_stages st where st.game_id=p_game_id and st.stage_no=11 and st.status='open' and (st.deadline is null or st.deadline>clock_timestamp()))
  or not exists(select 1 from public.institution_meeting_records m where m.game_id=p_game_id and m.stage_no=11 and m.institution_key='government' and m.agenda_document_id=v_session.agenda_document_id and m.agenda_approved_at is not null)
  then raise exception 'Регистрация доступна после подписания повестки и открытия заседания';end if;
  insert into public.institution_session_registrations(game_id,stage_no,institution_key,user_id,government_session_id,presence_updated_at)
  values(p_game_id,11,'government',uid,v_session.id,now())
  on conflict(game_id,stage_no,institution_key,user_id) do update set government_session_id=excluded.government_session_id,presence_updated_at=excluded.presence_updated_at
  where institution_session_registrations.government_session_id is distinct from excluded.government_session_id;
  perform private.open_government_agenda_vote_internal(v_session.id);
  return;
 end if;
 -- Do not revoke anyone's existing registered attendance.
 if exists(select 1 from public.institution_session_registrations where game_id=p_game_id
  and stage_no=p_stage_no and institution_key=p_institution and user_id=uid) then return;end if;
 if not exists(select 1 from public.institution_meeting_records m
  join public.formal_documents d on d.id=m.agenda_document_id and d.game_id=m.game_id
  where m.game_id=p_game_id and m.stage_no=p_stage_no and m.institution_key=p_institution
  and m.agenda_approved_at is not null and d.status_code='published'
  and length(btrim(coalesce(m.agenda_body,'')))>=30) then
  raise exception 'Регистрация откроется после подготовки и утверждения документа повестки заседания';end if;
 insert into public.institution_session_registrations(game_id,stage_no,institution_key,user_id)
 values(p_game_id,p_stage_no,p_institution,uid) on conflict do nothing;
end;$function$;

CREATE OR REPLACE FUNCTION private.vote_eligible_weight(p_vote game_votes, p_user uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare w numeric;
begin
 if not private.vote_member_has_office(p_vote.game_id,p_user,p_vote.institution_key) then return 0;end if;

 if (
   coalesce((p_vote.electorate_snapshot->>'attendance_required')::boolean,false)
   or p_vote.procedure_key in ('registered_session','presidential_system','sf_resolution','government_nomination')
 )
 and p_vote.institution_key not in ('all','factions')
 and not exists(
   select 1
   from public.institution_session_registrations r
   where r.game_id=p_vote.game_id
     and r.stage_no=p_vote.stage_no
     and r.institution_key=p_vote.institution_key
     and r.user_id=p_user
 ) then return 0;end if;

 if p_vote.status='open' and p_vote.stage_no=11 and p_vote.institution_key='government'
 and (p_vote.procedure_key='government_agenda' or (p_vote.procedure_key='state_program' and not p_vote.tie_breaker_chair))
 and not exists(select 1 from public.institution_session_registrations r join public.government_sessions s on s.id=r.government_session_id and s.game_id=r.game_id
  where r.game_id=p_vote.game_id and r.stage_no=11 and r.institution_key='government' and r.user_id=p_user and s.status='open'
  and (s.agenda_vote_id=p_vote.id or exists(select 1 from public.government_program_agenda a where a.session_id=s.id and a.vote_id=p_vote.id)))
 then return 0;end if;
 if p_vote.institution_key='gd' and p_vote.status='open' then
   -- A registered deputy may cast no more than the deputies who are actually
   -- present, and cannot exceed the original electorate frozen at vote opening.
   select private.gd_effective_present(p_vote.game_id,r.user_id,r.present_mandates) into w
   from public.institution_session_registrations r
   where r.game_id=p_vote.game_id and r.stage_no=p_vote.stage_no
    and r.institution_key='gd' and r.user_id=p_user;
   return least(
      greatest(0,coalesce(w,0)),
      private.gd_member_capacity(p_vote.game_id,p_user),
      coalesce((p_vote.electorate_snapshot->'weights'->>p_user::text)::numeric,0)
   );
 end if;
 if p_vote.electorate_snapshot is not null then
   return coalesce((p_vote.electorate_snapshot->'weights'->>p_user::text)::numeric,0);
 end if;

 if p_vote.voting_mode='faction' then
   return case when exists(
     select 1 from public.game_parties
     where game_id=p_vote.game_id and leader_user_id=p_user
   ) then 1 else 0 end;
 end if;

 if p_vote.voting_mode='mandate' then
   select case when p_vote.institution_key='gd' then private.gd_member_capacity(p_vote.game_id,p_user)
         else (select effective_mandates from public.party_member_mandates where game_id=p_vote.game_id and user_id=p_user limit 1) end into w;
   return coalesce(w,0);
 end if;

 return 1;
end;
$function$;

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
 when p_vote.status='open' and p_vote.stage_no=11 and p_vote.institution_key='government' and
 (p_vote.procedure_key='government_agenda' or (p_vote.procedure_key='state_program' and not p_vote.tie_breaker_chair)) then (
 select coalesce(sum(private.vote_eligible_weight(p_vote,s.key::uuid)),0) from jsonb_each_text(p_vote.electorate_snapshot->'weights') s)
 when coalesce((p_vote.electorate_snapshot->>'attendance_required')::boolean,false) then (
 select coalesce(sum(s.value::numeric),0) from jsonb_each_text(p_vote.electorate_snapshot->'weights') s
 where exists(select 1 from public.institution_session_registrations r where r.game_id=p_vote.game_id and r.stage_no=p_vote.stage_no and r.institution_key=p_vote.institution_key and r.user_id::text=s.key))
 else (select coalesce(sum(weight),0) from public.game_ballots where vote_id=p_vote.id) end;
$function$;

CREATE OR REPLACE FUNCTION private.finalize_procedural_vote(p_vote_id uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare uid uuid:=auth.uid();v public.game_votes%rowtype;eligible numeric;casted numeric;present numeric;y numeric;n numeric;a numeric;needed numeric;q boolean;pass boolean;result text;label text;chair text;
begin
 select * into v from public.game_votes where id=p_vote_id for update;
 if v.id is null or uid is null or not private.is_game_member(v.game_id) then raise exception 'Нет доступа к голосованию';end if;
 -- Called exclusively by the authorised public close RPC or guarded ballot trigger.
 if v.status<>'open' then return jsonb_build_object('result',v.result_code,'label',v.result_label);end if;
 eligible:=private.vote_total_eligible_weight(v);present:=private.vote_present_weight(v);
 select coalesce(sum(weight),0),coalesce(sum(coalesce(yes_weight,case when choice='yes' then weight else 0 end)),0),coalesce(sum(coalesce(no_weight,case when choice='no' then weight else 0 end)),0),coalesce(sum(coalesce(abstain_weight,case when choice='abstain' then weight else 0 end)),0)
 into casted,y,n,a from public.game_ballots where vote_id=v.id;
 needed:=case when v.quorum_kind='none' then 0 when v.institution_key in ('gd','sf','committee','region','cec') and abs(v.quorum_value-0.5)<0.000001 then floor(eligible/2)+1 else ceil(eligible*v.quorum_value-0.000001) end;
 q:=v.quorum_kind='none' or (eligible>0 and present>=needed);
 if not q then pass:=false;result:='no_quorum';label:='Нет кворума';
 elsif v.procedure_key='state_program' and v.institution_key='government' and v.stage_no=11 and not v.tie_breaker_chair then
  result:=private.stage11_program_vote_result(y,n,a,present);
  pass:=result='passed';
  label:=case result when 'passed' then 'ГП принята' when 'rejected' then 'ГП окончательно отклонена' when 'revision' then 'ГП возвращена на доработку' else 'Ни один вариант не набрал большинства — повторное голосование' end;
 else
  pass:=case v.majority_kind when 'eligible_majority' then y>eligible/2 when 'eligible_fraction' then
   case when v.institution_key='gd' and v.voting_mode='mandate'
     and v.procedure_key in ('bill_reading1','bill_reading1_full','bill_reading2','bill_reading3','sf_veto_override','presidential_veto_override')
     and v.majority_value=2.0/3.0
    then 3*y>=2*eligible
    else y>=ceil(eligible*v.majority_value) end when 'present_majority' then y>present/2 else y>n end;
  if not pass and v.tie_breaker_chair and y=n and y>0 then
   select b.choice into chair from public.game_ballots b join public.game_members m on m.game_id=v.game_id and m.user_id=b.voter_id
   where b.vote_id=v.id and m.role_title ~* 'председател.*правительств|председател.*дум|председател.*совет.*федерац' limit 1;
   pass:=coalesce(chair='yes',false);
  end if;
  result:=case when pass then 'passed' else 'rejected' end;label:=case when pass then 'Решение принято' else 'Решение отклонено' end;
 end if;
 update public.game_votes set status='closed',closed_at=now(),result_code=result,result_label=label,result_yes=y,result_no=n,result_abstain=a,result_eligible=eligible,result_cast=casted,result_present=present,result_quorum_met=q,decision_note=nullif(trim(p_note),'') where id=v.id;
 if q then perform private.apply_formal_vote_transition(v.formal_document_id,case when pass then v.pass_transition else v.fail_transition end,uid,v.id,p_note);end if;
 return jsonb_build_object('result',result,'label',label,'yes',y,'no',n,'abstain',a,'eligible',eligible,'cast',casted,'present',present,'quorum',q,'needed',needed);
end;$function$;

CREATE OR REPLACE FUNCTION public.close_procedural_vote(p_vote_id uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
 uid uuid:=auth.uid();
 v public.game_votes%rowtype;
begin
 select * into v from public.game_votes where id=p_vote_id for update;
 if v.id is null or uid is null or not private.is_game_member(v.game_id) then
  raise exception 'Нет доступа к голосованию';
 end if;
 if not private.can_close_procedural_vote(v.game_id,uid,v.institution_key,v.formal_document_id)
 and not exists(
  select 1 from public.institution_units u
  where u.game_id=v.game_id and 'unit:'||u.id::text=v.institution_key and u.head_user_id=uid
 ) then
  raise exception 'Закрыть голосование может председательствующий или преподаватель';
 end if;
 
 if (not private.is_game_teacher(v.game_id) or (v.stage_no=11 and v.institution_key='government' and (v.procedure_key='government_agenda' or (v.procedure_key='state_program' and not v.tie_breaker_chair))))
    and (coalesce((v.electorate_snapshot->>'attendance_required')::boolean,false)
         or v.procedure_key in ('registered_session','presidential_system',
                               'sf_resolution','government_nomination')) then
   if not exists(
     select 1 from public.institution_session_registrations r
     where r.game_id=v.game_id and r.stage_no=v.stage_no
       and r.institution_key=v.institution_key
       and coalesce((v.electorate_snapshot->'weights'->>r.user_id::text)::numeric,0)>0
       and private.vote_eligible_weight(v,r.user_id)>0
   ) or exists(
     select 1 from public.institution_session_registrations r
     where r.game_id=v.game_id and r.stage_no=v.stage_no
       and r.institution_key=v.institution_key
       and coalesce((v.electorate_snapshot->'weights'->>r.user_id::text)::numeric,0)>0
       and private.vote_eligible_weight(v,r.user_id)>0
       and not exists(
         select 1 from public.game_ballots b
         where b.vote_id=v.id and b.voter_id=r.user_id
       )
   ) then
     raise exception 'Голосование не завершено: ещё не все зарегистрированные участники проголосовали'
       using errcode='42501';
   end if;
 end if;

 return private.finalize_procedural_vote(p_vote_id,p_note);
end;$function$;

CREATE OR REPLACE FUNCTION private.guard_stage_bound_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare v_game uuid;v_stage integer;v_vote uuid;
begin
 if tg_table_name='game_ballots' then
  v_vote:=new.vote_id;
  select gv.game_id,gv.stage_no into v_game,v_stage
   from public.game_votes gv where gv.id=v_vote;
  if v_game is null then raise exception 'Unknown vote' using errcode='23503';end if;
 else
  v_game:=new.game_id;
  v_stage:=new.stage_no;
  if tg_op='UPDATE' and (new.game_id is distinct from old.game_id
    or new.stage_no is distinct from old.stage_no) then
   raise exception 'Cannot move a record between stages' using errcode='42501';
  end if;
 end if;
 if auth.uid() is null or private.is_game_teacher(v_game) then return new;end if;
 if not exists(select 1 from public.game_members m
   where m.game_id=v_game and m.user_id=auth.uid() and m.kind='student'
    and m.roster_archived_at is null) then
  raise exception 'Student membership required' using errcode='42501';
 end if;
 -- A global vote without a stage remains governed by its own role and vote RPC.
 if v_stage is null then return new;end if;
 -- Stage 11 editing of Stage 10 programmes is allowed ONLY through
 -- existing validated programme RPCs; do not reopen Stage 10 globally.
 IF tg_table_name='state_programs' AND tg_op='UPDATE' AND v_stage=10 THEN
  IF old.signed_at IS NULL AND new.signed_at IS NULL
    AND old.government_vote_id IS NULL AND new.government_vote_id IS NULL
    AND old.status IN ('draft','revision','minister_review','pm_review','ready')
    AND new.status IN ('draft','revision','minister_review','pm_review','ready')
    AND current_setting('app.gos_stage11_program_edit_id',true)=old.id::text
    AND exists(select 1 from public.game_stages s
      where s.game_id=v_game and s.stage_no=11 and s.status='open')
    AND NOT exists(select 1 from public.government_program_agenda a
      where a.program_id=old.id and a.vote_id is not null and exists(select 1 from public.game_votes gv where gv.id=a.vote_id and gv.status='open'))
  THEN RETURN NEW; END IF;
  IF old.status='adopted' AND old.signed_at IS NULL AND new.signed_at IS NULL
    AND new.status='revision' AND new.government_vote_id IS NULL
    AND current_setting('app.gos_stage11_program_return_id',true)=old.id::text
    AND exists(select 1 from public.game_stages s where s.game_id=v_game and s.stage_no=11 and s.status='open')
    AND exists(select 1 from public.game_votes v where v.id=old.government_vote_id and v.game_id=v_game and v.status='closed' and v.result_code='passed' and v.result_quorum_met)
  THEN RETURN NEW;END IF;
  IF old.status='government_vote' AND old.signed_at IS NULL AND new.signed_at IS NULL
    AND new.status='ready' AND new.government_vote_id IS NULL
    AND current_setting('app.gos_stage11_program_vote_final_id',true)=old.id::text
    AND exists(select 1 from public.game_votes v where v.id=old.government_vote_id and v.game_id=v_game and v.status='closed' and v.result_code IN ('no_quorum','no_majority'))
  THEN RETURN NEW;END IF;
  IF old.status='government_vote' AND old.signed_at IS NULL AND new.signed_at IS NULL
    AND new.status='revision' AND new.government_vote_id IS NULL
    AND current_setting('app.gos_stage11_program_vote_final_id',true)=old.id::text
    AND EXISTS(select 1 from public.game_votes v where v.id=old.government_vote_id
      and v.game_id=v_game and v.stage_no=11 and v.institution_key='government'
      and v.procedure_key='state_program' and v.status='closed'
      and (v.result_code='revision' or (v.result_code='rejected' and v.tie_breaker_chair)) and v.result_quorum_met)
  THEN RETURN NEW; END IF;
  -- Voting lifecycle remains functional while Stage 10 is completed.
  IF old.status='ready' AND new.status='government_vote'
     AND old.government_vote_id IS NULL AND new.government_vote_id IS NOT NULL
     AND current_setting('app.gos_stage11_program_vote_id',true)=old.id::text
     AND exists(select 1 from public.game_votes v
        where v.id=new.government_vote_id and v.game_id=v_game
          and v.stage_no=11 and v.procedure_key='state_program'
          and v.institution_key='government' and v.status='open')
  THEN RETURN NEW; END IF;
  IF old.status='government_vote'
     AND new.status IN ('adopted','rejected')
     AND new.government_vote_id IS NOT DISTINCT FROM old.government_vote_id
     AND current_setting('app.gos_stage11_program_vote_final_id',true)=old.id::text
     AND exists(select 1 from public.game_votes v
        where v.id=old.government_vote_id and v.game_id=v_game
          and v.status='closed' and v.procedure_key='state_program'
          and ( (new.status='adopted' AND v.result_code='passed')
             OR (new.status='rejected' AND v.result_code IS DISTINCT FROM 'passed')))
  THEN RETURN NEW; END IF;
  IF old.status='adopted' AND new.status='adopted'
     AND old.signed_at IS NULL AND new.signed_at IS NOT NULL
     AND new.government_vote_id IS NOT DISTINCT FROM old.government_vote_id
     AND current_setting('app.gos_stage11_program_sign_id',true)=old.id::text
     AND exists(select 1 from public.game_votes v
       where v.id=old.government_vote_id and v.game_id=v_game
         and v.status='closed' and v.result_code='passed'
         and v.result_quorum_met)
  THEN RETURN NEW; END IF;
 END IF;

 if not exists(select 1 from public.game_stages s where s.game_id=v_game
   and s.stage_no=v_stage and s.status='open'
   and (s.deadline is null or s.deadline>clock_timestamp())) then
  raise exception 'Этап завершён или ещё не открыт. Изменения недоступны.' using errcode='42501';
 end if;
 -- Stage 2/3 KSRF actions require BOTH an approved agenda AND personal check-in.
 -- Retain stage-window checks above and teacher administrative override.
 if v_stage in (2,3) then
  if tg_table_name='game_votes' then
   if new.institution_key='ksrf' then
    perform private.require_game_meeting_registration(v_game,auth.uid(),v_stage,'ksrf');
   end if;
  elsif tg_table_name='game_ballots' then
   if exists(select 1 from public.game_votes gv where gv.id=v_vote and gv.institution_key='ksrf') then
    perform private.require_game_meeting_registration(v_game,auth.uid(),v_stage,'ksrf');
   end if;
  end if;
 end if;
 return new;
end; $function$;

CREATE OR REPLACE FUNCTION private.state_program_vote_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare p public.state_programs%rowtype;v_doc uuid;v_steps jsonb;v_revision boolean;
begin
 if new.status='closed' and old.status is distinct from new.status and new.procedure_key='state_program' then
  select * into p from public.state_programs where government_vote_id=new.id for update;
  if p.id is null then return new; end if;

  v_revision:=(new.result_code='revision' or (new.result_code='rejected' and new.tie_breaker_chair)) and new.result_quorum_met and p.signed_at is null;
  PERFORM set_config('app.gos_stage11_program_vote_final_id',p.id::text,true);
  update public.state_programs
  set status=case when new.result_code='passed' and new.result_quorum_met then 'adopted' when new.result_code IN ('no_quorum','no_majority') and p.signed_at is null then 'ready' when v_revision then 'revision' else 'rejected' end,
      government_vote_id=case when v_revision or (new.result_code IN ('no_quorum','no_majority') and p.signed_at is null) then null else p.government_vote_id end,
      pm_revision_reason=case when v_revision then 'Правительство возвратило программу на доработку. '||coalesce(nullif(btrim(new.decision_note),''),'Доработайте программу и повторно направьте на согласование.') else p.pm_revision_reason end,updated_at=now()
  where id=p.id;

  if v_revision then
   update public.government_program_agenda a
   set status='pending',vote_id=null,started_at=null,completed_at=null,qa_closed_at=null,
       result_note=concat_ws(' · ',nullif(a.result_note,''),'Возвращена на доработку; голосование '||new.id::text)
   from public.government_sessions s
   where s.id=a.session_id and s.game_id=p.game_id and s.status<>'closed'
     and a.game_id=p.game_id and a.program_id=p.id and a.vote_id=new.id;
  end if;

  if new.result_code='passed' and new.result_quorum_met
     and not exists(
       select 1 from public.formal_documents
       where game_id=p.game_id and stage_no=11 and doc_type='government_resolution'
         and metadata->>'state_program_id'=p.id::text and metadata->>'government_vote_id'=new.id::text
     )
  then
    v_doc:=public.create_formal_document(
      p.game_id,11,'Об утверждении государственной программы «'||p.title||'»',
      'government_resolution','government','Правительство Российской Федерации',
      'Правительство Российской Федерации постановляет: утвердить государственную программу «'||p.title||
      '». Ответственный исполнитель: '||p.responsible_ministry||
      '. Срок реализации: '||coalesce(p.start_date::text,'не указан')||' — '||coalesce(p.end_date::text,'не указан')||
      '. Общий объём бюджетных ассигнований: '||p.total_budget::text||'.',
      null,null,null,'government_act',
      jsonb_build_object('state_program_id',p.id,'government_vote_id',new.id,'auto_generated',true)
    );
    UPDATE public.formal_documents SET current_step=2,status_code='adopted',status_label='Принята — ожидает подписи',current_owner_key='government',updated_at=now() WHERE id=v_doc;
    -- A favourable vote creates only the draft resolution.
    -- The published programme and resolution are released together by the PM signature RPC.
  end if;
 end if;
 return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.government_program_agenda_vote_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
begin
 if new.status='closed' and old.status is distinct from new.status then
  update public.government_program_agenda
  set status=case when new.result_code IN ('no_quorum','no_majority') and exists(select 1 from public.state_programs p where p.id=government_program_agenda.program_id and p.signed_at is null) then 'pending' else 'completed' end,
      vote_id=case when new.result_code IN ('no_quorum','no_majority') and exists(select 1 from public.state_programs p where p.id=government_program_agenda.program_id and p.signed_at is null) then null else vote_id end,
      qa_closed_at=case when new.result_code IN ('no_quorum','no_majority') then null else qa_closed_at end,
      completed_at=case when new.result_code IN ('no_quorum','no_majority') then null else now() end,
      result_note=concat_ws(' · ',coalesce(new.result_label,new.result_code),case when new.result_code IN ('no_quorum','no_majority') then 'Повторное рассмотрение; голосование '||new.id::text end)
  where vote_id=new.id and status='decision';
 end if;
 return new;
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
     and not exists(select 1 from public.state_program_review_proposals r where r.session_id=s.id and r.program_id=p.id and (r.status='submitted' or (r.status='accepted' and r.incorporated_at IS NULL))))
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
 if exists(select 1 from public.state_program_review_proposals r where r.session_id=s.id and r.program_id=i.program_id and (r.status='submitted' or (r.status='accepted' and r.incorporated_at is null))) then raise exception 'Сначала рассмотрите все поправки и подтвердите внесение одобренных изменений в паспорт ГП';end if;
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

CREATE OR REPLACE FUNCTION public.start_government_program_report(p_item_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare i public.government_program_agenda%rowtype;s public.government_sessions%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into i from public.government_program_agenda where id=p_item_id for update;
 if i.id is null then raise exception 'Agenda item not found'; end if;
 select * into s from public.government_sessions where id=i.session_id for update;
 if not private.can_approve_government_agenda(i.game_id,v_uid) then raise exception 'Government session management access required'; end if;
 if s.status<>'open' or i.status<>'pending' then raise exception 'Agenda item cannot start'; end if;
 if not private.government_agenda_adopted(s.id) then raise exception 'Сначала Правительство должно принять повестку голосованием';end if;
 if not exists(select 1 from public.state_programs p where p.id=i.program_id and p.game_id=i.game_id
  and (p.status='ready' and p.signed_at is null or p.status='government_vote' and p.signed_at is not null and p.government_vote_id is not null))
 then raise exception 'Сначала завершите доработку и согласование программы';end if;
 if exists(select 1 from public.government_program_agenda where session_id=s.id and status in ('presenting','decision'))
 then raise exception 'Finish the current agenda item first'; end if;
 update public.government_program_agenda set status='presenting',started_at=now() where id=i.id;
end;$function$;

CREATE OR REPLACE FUNCTION public.close_government_session(p_session_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare s public.government_sessions%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into s from public.government_sessions where id=p_session_id for update;
 if s.id is null then raise exception 'Government session not found'; end if;
 if not private.can_approve_government_agenda(s.game_id,v_uid) then raise exception 'Government session management access required'; end if;
 if s.status<>'open' then raise exception 'Government session is not open'; end if;
 if exists(select 1 from public.government_program_agenda where session_id=s.id and status in ('presenting','decision')) then raise exception 'Finish the active agenda item before closing the session'; end if;
 if not private.government_agenda_adopted(s.id) then raise exception 'Сначала завершите голосование по повестке';end if;
 if exists(select 1 from public.government_program_agenda a join public.state_programs p on p.id=a.program_id and p.game_id=a.game_id where a.session_id=s.id and a.status='pending' and p.status='ready') then raise exception 'Сначала рассмотрите все готовые программы';end if;
 update public.government_sessions set status='closed',closed_at=now() where id=s.id;
 perform private.ensure_stage11_government_agenda(s.game_id);
 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(s.game_id,11,'Заседание Правительства','notice','Заседание Правительства закрыто',
        'Рассмотрено программ: '||(select count(*) from public.government_program_agenda where session_id=s.id and status='completed'),v_uid);
end;$function$;

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
 if not exists(select 1 from public.government_program_agenda a where a.session_id=s.id and a.program_id=p_program_id and a.status='presenting' and a.qa_closed_at is not null and a.vote_id is null) then raise exception 'Поправки вносятся после обсуждения текущей программы и до голосования';end if;
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
 if q.status<>'submitted' or p_action not in ('accepted','rejected') then raise exception 'Решение недоступно';end if;
 if q.session_id is not null and (not private.can_approve_government_agenda(q.game_id,v_uid) or not private.government_agenda_adopted(q.session_id) or not exists(select 1 from public.government_program_agenda a where a.session_id=q.session_id and a.program_id=q.program_id and a.game_id=q.game_id and a.status='presenting' and a.qa_closed_at is not null and a.vote_id is null)) then raise exception 'Поправки рассматривает Председатель Правительства на этапе поправок текущей ГП';end if;
 update public.state_program_review_proposals set status=p_action,reviewed_by=v_uid,reviewed_at=now(),review_note=left(coalesce(p_note,''),4000),accepted_content_hash=case when p_action='accepted' and q.session_id is not null then private.programme_content_hash(q.program_id) else null end where id=q.id;
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
 IF NOT private.is_game_teacher(p.game_id) AND NOT v_is_pm
 THEN RAISE EXCEPTION 'Только Председатель Правительства может вернуть программу';END IF;
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

CREATE OR REPLACE FUNCTION public.delete_procedural_vote(p_vote_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v public.game_votes%rowtype;
begin
  select * into v
  from public.game_votes
  where id = p_vote_id
  for update;

  if v.id is null or v_uid is null or not private.is_game_member(v.game_id) then
    raise exception 'Нет доступа к голосованию';
  end if;

  if not (
    v.created_by = v_uid
    or private.is_game_teacher(v.game_id)
  ) then
    raise exception 'Удалить голосование может только его автор или преподаватель';
  end if;

  if v.stage_no=11 and v.institution_key='government' and v.procedure_key in ('government_agenda','state_program') then raise exception 'Официальные голосования по повестке и госпрограммам сохраняются в истории';end if;
  -- An open vote has not applied a result yet. Return linked workflows to
  -- their immediate pre-vote state so no object remains stuck in "vote open".
  if v.status = 'open' then
    update public.parliamentary_election_rules
       set vote_id = null, status = 'draft', updated_at = now()
     where vote_id = v.id and status = 'vote_open';

    update public.regional_election_rules
       set vote_id = null, status = 'draft', updated_at = now()
     where vote_id = v.id and status = 'vote_open';

    update public.ghost_voting_policies
       set vote_id = null, status = 'draft', updated_at = now()
     where vote_id = v.id and status = 'vote_open';

    update public.presidential_system_proposals
       set vote_id = null, status = 'draft', updated_at = now()
     where vote_id = v.id and status = 'vote_open';

    update public.government_nominations
       set vote_id = null, status = 'submitted', updated_at = now()
     where vote_id = v.id and status = 'vote_open';

    update public.municipal_projects
       set vote_id = null, status = 'submitted', updated_at = now()
     where vote_id = v.id and status = 'vote_open';

    update public.government_program_agenda
       set vote_id = null, status = 'presenting', completed_at = null, result_note = null
     where vote_id = v.id and status = 'decision';

    update public.state_programs
       set government_vote_id = null, status = 'ready', updated_at = now()
     where government_vote_id = v.id and status = 'government_vote';

    update public.party_agreements
       set target_vote_id = null,
           status = case when status in ('proposed','accepted') then 'expired' else status end,
           resolved_at = case when status in ('proposed','accepted') then now() else resolved_at end
     where target_vote_id = v.id;
  end if;

  -- This FK is RESTRICT, so detach it explicitly for both open and closed votes.
  update public.budget_faction_amendments
     set vote_id = null
   where vote_id = v.id;

  -- Other vote references are ON DELETE SET NULL and ballots are ON DELETE CASCADE.
  delete from public.game_votes where id = v.id;

  return found;
end;
$function$;
