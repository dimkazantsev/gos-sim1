-- Stage 11 programme lifecycle: one status source, signed agenda unchanged, prior votes retained.
CREATE OR REPLACE FUNCTION private.sync_stage11_program_registry_status(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
DECLARE p public.state_programs%rowtype;d record;item_status text;code text;label text;owner text;step integer;actor uuid;
BEGIN
 SELECT * INTO p FROM public.state_programs WHERE id=p_id;
 IF p.id IS NULL OR p.stage_no<>10 OR NOT EXISTS(SELECT 1 FROM public.game_stages s WHERE s.game_id=p.game_id AND s.stage_no=11 AND s.status='open') THEN RETURN;END IF;
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
END;$f$;
REVOKE ALL ON FUNCTION private.sync_stage11_program_registry_status(uuid) FROM PUBLIC,anon,authenticated;
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
    AND exists(select 1 from public.game_votes v where v.id=old.government_vote_id and v.game_id=v_game and v.status='closed' and v.result_code='no_quorum')
  THEN RETURN NEW;END IF;
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

CREATE OR REPLACE FUNCTION public.begin_stage11_program_revision(p_program_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_program public.state_programs%rowtype;v_uid uuid:=auth.uid();
BEGIN
 IF v_uid IS NULL OR p_program_id IS NULL THEN RAISE EXCEPTION 'Войдите в игру' USING ERRCODE='42501';END IF;
 PERFORM private.lock_active_program_actor((SELECT game_id FROM public.state_programs WHERE id=p_program_id));
 SELECT * INTO v_program FROM public.state_programs WHERE id=p_program_id FOR UPDATE;
 IF v_program.id IS NULL OR v_program.stage_no<>10
   OR NOT EXISTS(SELECT 1 FROM public.game_stages s WHERE s.game_id=v_program.game_id AND s.stage_no=11 AND s.status='open')
 THEN RAISE EXCEPTION 'Доработка возможна только на Этапе 11' USING ERRCODE='42501';END IF;
 IF NOT private.is_game_teacher(v_program.game_id)
    AND (v_program.responsible_minister_id IS DISTINCT FROM v_uid
      OR NOT private.role_is_available(v_program.game_id,v_uid))
 THEN RAISE EXCEPTION 'Редактировать эту ГП может только ответственный министр' USING ERRCODE='42501';END IF;
 IF NOT private.is_game_teacher(v_program.game_id)
   AND NOT EXISTS (
     SELECT 1 FROM public.institution_units u
     WHERE u.game_id=v_program.game_id AND u.unit_kind='ministry'
       AND u.head_user_id=v_uid
   )
 THEN RAISE EXCEPTION 'Доработка доступна только действующему министру' USING ERRCODE='42501';END IF;
 IF v_program.signed_at IS NOT NULL OR v_program.government_vote_id IS NOT NULL
   OR v_program.status NOT IN ('draft','revision','minister_review','pm_review','ready')
   OR EXISTS(SELECT 1 FROM public.government_program_agenda a
        WHERE a.program_id=v_program.id AND a.vote_id IS NOT NULL and exists(select 1 from public.game_votes gv where gv.id=a.vote_id and gv.status='open'))
 THEN RAISE EXCEPTION 'После открытия голосования ГП не редактируется' USING ERRCODE='42501';END IF;
 IF v_program.status IN ('ready','pm_review') THEN
   PERFORM set_config('app.gos_stage11_program_edit_id',v_program.id::text,true);
   UPDATE public.state_programs
    SET status='revision',pm_revision_reason=NULL,updated_at=now()
    WHERE id=v_program.id;
 END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION private.can_edit_state_program(p_program uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
 SELECT p_user=(select auth.uid())
   AND (private.is_platform_admin() OR EXISTS(
     SELECT 1 FROM public.game_members gm
     WHERE gm.game_id=p.game_id AND gm.user_id=p_user
       AND gm.kind IN ('teacher','student') AND gm.roster_archived_at IS NULL
   ))
   AND NOT private.is_game_observer(p.game_id)
   AND (private.is_game_teacher(p.game_id) OR private.role_is_available(p.game_id,p_user))
   AND p.status IN ('draft','revision','minister_review')
   AND p.signed_at IS NULL
   AND p.government_vote_id IS NULL
   AND NOT EXISTS(SELECT 1 FROM public.government_program_agenda a
     WHERE a.program_id=p.id AND a.vote_id IS NOT NULL and exists(select 1 from public.game_votes gv where gv.id=a.vote_id and gv.status='open'))
   AND (
     private.is_game_teacher(p.game_id)
     OR p.created_by=p_user
     OR p.responsible_minister_id=p_user
     OR (
       p.status IN ('draft','revision','minister_review')
       AND EXISTS(
         SELECT 1 FROM public.institution_units u
         JOIN public.institution_assignments ia ON ia.unit_id=u.id
           AND ia.game_id=u.game_id AND ia.unit_kind='ministry'
         WHERE u.game_id=p.game_id
           AND u.unit_kind='ministry'
           AND u.head_user_id=p.responsible_minister_id
           AND ia.user_id=p_user
       )
     )
   )
 FROM public.state_programs p WHERE p.id=p_program;
$function$;

CREATE OR REPLACE FUNCTION private.lock_signed_program_content()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare p state_programs%rowtype;pid uuid;
begin
 pid:=case when tg_op='DELETE' then old.program_id else new.program_id end;
 if exists(select 1 from games where id=case when tg_op='DELETE' then old.game_id else new.game_id end) then perform private.lock_active_program_actor(case when tg_op='DELETE' then old.game_id else new.game_id end);end if;
 select * into p from state_programs where id=pid for update;
 if p.id is not null and (p.status not in ('draft','revision','minister_review') or p.signed_at is not null or p.government_vote_id is not null
   or exists(select 1 from public.government_program_agenda a where a.program_id=pid and a.vote_id is not null and exists(select 1 from public.game_votes gv where gv.id=a.vote_id and gv.status='open'))) then raise exception 'Согласованный или подписанный текст программы защищён от изменений';end if;
 if tg_op='DELETE' then return old;else return new;end if;
end;$function$;

CREATE OR REPLACE FUNCTION private.lock_signed_program_passport()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
begin
 if old.status not in ('draft','revision','minister_review') or old.signed_at is not null
  or old.government_vote_id is not null
  or exists(select 1 from public.government_program_agenda a where a.program_id=old.id and a.vote_id is not null and exists(select 1 from public.game_votes gv where gv.id=a.vote_id and gv.status='open')) then
  if row(new.title,new.responsible_ministry,new.responsible_minister_id,new.curator_id,new.national_goal,new.start_date,new.end_date,new.total_budget,new.expected_results,new.participants,new.presidential_priority_id)
  is distinct from row(old.title,old.responsible_ministry,old.responsible_minister_id,old.curator_id,old.national_goal,old.start_date,old.end_date,old.total_budget,old.expected_results,old.participants,old.presidential_priority_id) then raise exception 'Согласованный или подписанный паспорт защищён от изменений';end if;
 end if;
 return new;
end;$function$;

CREATE OR REPLACE FUNCTION private.sync_state_program_registry(p_program_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE p public.state_programs%ROWTYPE;d public.formal_documents%ROWTYPE;
 v_uid uuid:=auth.uid();v_title text;v_body text;v_goals text;v_components text;v_expenses text;v_steps jsonb;
 v_id uuid;v_rev integer;v_meta jsonb;
BEGIN
 SELECT * INTO p FROM public.state_programs WHERE id=p_program_id;
 IF p.id IS NULL THEN RAISE EXCEPTION 'Программа не найдена';END IF;
 IF v_uid IS NULL OR NOT private.can_edit_state_program(p.id,v_uid) THEN RAISE EXCEPTION 'Нет доступа к редактированию программы';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('state-program-formal:'||p.id::text,0));
 SELECT * INTO d FROM public.formal_documents
 WHERE game_id=p.game_id AND stage_no=10 AND doc_type='state_program'
 AND metadata->>'state_program_id'=p.id::text FOR UPDATE;
 v_title:='Государственная программа «'||p.title||'»';
 SELECT string_agg('• '||goal_text||' — '||indicator_name,E'\n' ORDER BY created_at,id)
 INTO v_goals FROM public.state_program_goals WHERE program_id=p.id;
 SELECT string_agg('• '||title||': '||goal_text,E'\n' ORDER BY direction_no,created_at,id)
 INTO v_components FROM public.state_program_components WHERE program_id=p.id;
 SELECT string_agg('• '||budget_year::text||': '||indicator_name||' — '||amount::text||' руб. ('||justification||')',E'\n' ORDER BY position,id)
 INTO v_expenses FROM public.state_program_expenses WHERE program_id=p.id;
 v_body:='ПАСПОРТ ГОСУДАРСТВЕННОЙ ПРОГРАММЫ'||E'\n'||
 'Наименование: '||p.title||E'\n'||
 'Ответственный исполнитель: '||p.responsible_ministry||E'\n'||
 'Ответственный министр: '||coalesce((SELECT full_name FROM public.game_members WHERE game_id=p.game_id AND user_id=p.responsible_minister_id LIMIT 1),'Не назначен')||E'\n'||
 'Куратор: '||coalesce((SELECT full_name FROM public.game_members WHERE game_id=p.game_id AND user_id=p.curator_id LIMIT 1),'Не назначен')||E'\n'||
 'Участники: '||coalesce(p.participants,'Не определены')||E'\n'||
 'Национальная цель: '||coalesce(p.national_goal,'Не выбрана')||E'\n'||
 'Срок реализации: '||coalesce(p.start_date::text,'Не указан')||' — '||coalesce(p.end_date::text,'Не указан')||E'\n'||
 'Ожидаемые результаты: '||coalesce(p.expected_results,'Не определены')||E'\n\n'||
 'Цели и показатели:'||E'\n'||coalesce(v_goals,'Ещё не заполнены')||E'\n\n'||
 'Мероприятия:'||E'\n'||coalesce(v_components,'Ещё не заполнены')||E'\n\n'||
 'Финансово-экономическое обоснование:'||E'\n'||
 coalesce(v_expenses,'Ещё не заполнено')||E'\n\n'||
 'Общий объём финансирования: '||p.total_budget::text||' руб.';
 v_meta:=jsonb_build_object('document_kind','stage10_state_program','state_program_id',p.id,
   'source','state_program_editor','auto_synced',true);
 -- The Stage 10 passport is reopened ONLY inside an authorized Stage 11 edit RPC.
 PERFORM set_config('app.gos_stage11_program_formal_id',p.id::text,true);
 IF d.id IS NULL THEN
   v_steps:=private.formal_workflow('government_act');
   v_id:=gen_random_uuid();
   INSERT INTO public.formal_documents(
     id,game_id,stage_no,registry_no,title,doc_type,subject_key,subject_label,author_id,
     body_text,workflow_key,workflow_steps,current_step,status_code,status_label,current_owner_key,metadata
   ) VALUES(
     v_id,p.game_id,10,'ГОС.ID-ГП-'||lpad(nextval('public.formal_registry_seq')::text,4,'0'),
     v_title,'state_program','ministry',p.responsible_ministry,p.created_by,
     v_body,'government_act',v_steps,0,v_steps->0->>'code',v_steps->0->>'label',
     v_steps->0->>'owner',v_meta
   );
   INSERT INTO public.formal_document_history(document_id,game_id,actor_id,action,to_status,note)
   VALUES(v_id,p.game_id,v_uid,'Синхронизирована государственная программа','draft',
    'Черновик автоматически зарегистрирован из раздела «Работа».');
 ELSIF d.status_code='agenda'
   AND d.metadata->>'auto_synced'='true' AND p.status='revision'
   AND p.signed_at IS NULL AND p.government_vote_id IS NULL
   AND exists(select 1 from public.game_stages st where st.game_id=p.game_id and st.stage_no=11 and st.status='open')
   AND NOT EXISTS (select 1 from public.government_program_agenda a
       where a.program_id=p.id and a.vote_id IS NOT NULL and exists(select 1 from public.game_votes gv where gv.id=a.vote_id and gv.status='open'))
   AND (d.title IS DISTINCT FROM v_title OR d.body_text IS DISTINCT FROM v_body) THEN
   -- Explicitly return the not-yet-signed passport for revision, preserving
   -- its previous contents and place in the official audit trail.
   SELECT coalesce(max(revision),0)+1 INTO v_rev FROM public.formal_document_revisions WHERE document_id=d.id;
   INSERT INTO public.formal_document_revisions(game_id,document_id,revision,title,body_text,metadata,editor_id)
   VALUES(p.game_id,d.id,v_rev,d.title,d.body_text,d.metadata,v_uid);
   UPDATE public.formal_documents SET title=v_title,body_text=v_body,
     subject_label=p.responsible_ministry,metadata=d.metadata||v_meta,
     current_step=0,status_code='revision',status_label='На доработке',
     current_owner_key='ministry',updated_at=now() WHERE id=d.id;
   INSERT INTO public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,note)
   VALUES(d.id,p.game_id,v_uid,'Изменена версия ГП до голосования','agenda','revision',
     'Доработка ГП на Этапе 11; предыдущий текст сохранён в истории.');
 
ELSIF d.status_code NOT IN ('draft','revision')
   AND (d.title IS DISTINCT FROM v_title OR d.body_text IS DISTINCT FROM v_body) THEN
   RAISE EXCEPTION 'Документ государственной программы уже передан на рассмотрение; верните его на доработку перед редактированием программы';
 ELSIF d.metadata->>'auto_synced'='true' AND d.status_code IN ('draft','revision')
   AND (d.title IS DISTINCT FROM v_title OR d.body_text IS DISTINCT FROM v_body) THEN
   -- Все прежние версии сохраняются. Если документ передан на рассмотрение, не переписываем его.
   SELECT coalesce(max(revision),0)+1 INTO v_rev FROM public.formal_document_revisions WHERE document_id=d.id;
   INSERT INTO public.formal_document_revisions(game_id,document_id,revision,title,body_text,metadata,editor_id)
   VALUES(p.game_id,d.id,v_rev,d.title,d.body_text,d.metadata,v_uid);
   UPDATE public.formal_documents SET title=v_title,body_text=v_body,subject_label=p.responsible_ministry,
     metadata=d.metadata||v_meta,updated_at=now() WHERE id=d.id;
   INSERT INTO public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,note)
   VALUES(d.id,p.game_id,v_uid,'Обновлена версия государственной программы',d.status_code,d.status_code,
     'Новая версия получена из раздела «Работа»; предыдущая сохранена.');
 END IF;
END $function$;

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
 IF p.signed_at IS NOT NULL OR p.status NOT IN ('pm_review','ready','adopted')
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

CREATE OR REPLACE FUNCTION private.state_program_vote_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare p public.state_programs%rowtype;v_doc uuid;v_steps jsonb;
begin
 if new.status='closed' and old.status is distinct from new.status and new.procedure_key='state_program' then
  select * into p from public.state_programs where government_vote_id=new.id for update;
  if p.id is null then return new; end if;

  PERFORM set_config('app.gos_stage11_program_vote_final_id',p.id::text,true);
  update public.state_programs
  set status=case when new.result_code='passed' and new.result_quorum_met then 'adopted' when new.result_code='no_quorum' and p.signed_at is null then 'ready' else 'rejected' end,
      government_vote_id=case when new.result_code='no_quorum' and p.signed_at is null then null else p.government_vote_id end,updated_at=now()
  where id=p.id;

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
  set status=case when new.result_code='no_quorum' and exists(select 1 from public.state_programs p where p.id=government_program_agenda.program_id and p.signed_at is null) then 'pending' else 'completed' end,
      vote_id=case when new.result_code='no_quorum' and exists(select 1 from public.state_programs p where p.id=government_program_agenda.program_id and p.signed_at is null) then null else vote_id end,
      qa_closed_at=case when new.result_code='no_quorum' then null else qa_closed_at end,
      completed_at=case when new.result_code='no_quorum' then null else now() end,
      result_note=concat_ws(' · ',coalesce(new.result_label,new.result_code),case when new.result_code='no_quorum' then 'Повторное рассмотрение; голосование '||new.id::text end)
  where vote_id=new.id and status='decision';
 end if;
 return new;
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
 if not exists(select 1 from public.state_programs p where p.id=i.program_id and p.game_id=i.game_id
  and (p.status='ready' and p.signed_at is null or p.status='government_vote' and p.signed_at is not null and p.government_vote_id is not null))
 then raise exception 'Сначала завершите доработку и согласование программы';end if;
 if exists(select 1 from public.government_program_agenda where session_id=s.id and status in ('presenting','decision'))
 then raise exception 'Finish the current agenda item first'; end if;
 update public.government_program_agenda set status='presenting',started_at=now() where id=i.id;
end;$function$;

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
   WHERE s.game_id=p_game AND s.stage_no=11 AND s.status='open'
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
 update public.government_sessions set status='closed',closed_at=now() where id=s.id;
 perform private.ensure_stage11_government_agenda(s.game_id);
 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(s.game_id,11,'Заседание Правительства','notice','Заседание Правительства закрыто',
        'Рассмотрено программ: '||(select count(*) from public.government_program_agenda where session_id=s.id and status='completed'),v_uid);
end;$function$;

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
 where public.institution_meeting_records.agenda_approved_at is null
  and not exists(select 1 from public.institution_session_registrations r
    where r.game_id=s.game_id and r.stage_no=11 and r.institution_key='government');
 if not exists(select 1 from public.institution_meeting_records r
    join public.formal_documents d on d.id=r.agenda_document_id and d.game_id=r.game_id
    where r.game_id=s.game_id and r.stage_no=11 and r.institution_key='government'
    and r.agenda_approved_at is not null and d.status_code='published' and length(btrim(r.agenda_body))>=30) then
  raise exception 'Открытие заседания требует утверждённой повестки';end if;
end;$function$;

CREATE OR REPLACE FUNCTION private.stage11_government_agenda_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF TG_TABLE_NAME='state_programs' THEN
   IF TG_OP='UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status
     AND OLD.signed_at IS NOT DISTINCT FROM NEW.signed_at THEN RETURN NEW; END IF;
   IF NEW.status='revision' AND NEW.signed_at IS NULL AND NEW.government_vote_id IS NULL THEN
     UPDATE public.government_program_agenda a SET status='pending',started_at=NULL,qa_closed_at=NULL,
        result_note=coalesce(NEW.pm_revision_reason,'Программа на доработке')
     FROM public.government_sessions s WHERE s.id=a.session_id AND s.status='open' AND a.program_id=NEW.id AND a.status='presenting' AND a.vote_id IS NULL;
   END IF;
   IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND
      (NEW.status='ready' OR OLD.status='ready')) THEN
     PERFORM private.ensure_stage11_government_agenda(NEW.game_id);
   END IF;
   PERFORM private.sync_stage11_program_registry_status(NEW.id);
 ELSE
   IF NEW.stage_no=11 AND NEW.status='open' THEN
     PERFORM private.ensure_stage11_government_agenda(NEW.game_id);
   END IF;
 END IF;
 RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.government_question_doc_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
begin
 if TG_TABLE_NAME='government_program_agenda' then
  if TG_OP<>'DELETE' then perform private.sync_stage11_program_registry_status(new.program_id);end if;
  if TG_OP='UPDATE' and (old.session_id,old.program_id,old.agenda_no,old.report_minutes) IS NOT DISTINCT FROM (new.session_id,new.program_id,new.agenda_no,new.report_minutes) then return new;end if;
 end if;
 if exists(select 1 from public.government_sessions s where s.id=case when tg_op='DELETE' then old.session_id else new.session_id end and s.status='draft' and s.agenda_approved_at is null)
 then perform private.refresh_government_agenda_document(case when tg_op='DELETE' then old.session_id else new.session_id end);end if;
 return coalesce(new,old);
end;$function$;

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
 if (d.doc_type='state_program' and d.metadata->>'auto_synced'='true' and exists(select 1 from public.government_program_agenda a where a.program_id::text=d.metadata->>'state_program_id'))
 or (d.doc_type='government_resolution' and d.stage_no=11 and d.metadata ? 'state_program_id' and d.metadata ? 'government_vote_id')
 then raise exception 'Государственные программы рассматриваются и подписываются в разделе заседания Правительства' using errcode='42501';end if;
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

CREATE OR REPLACE FUNCTION public.get_formal_document_tools(p_document_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare d public.formal_documents%rowtype;u uuid:=auth.uid();manage boolean;open_vote boolean;has_ballot boolean;editable boolean;signable boolean;next_step jsonb;president_editor boolean;
begin
 select * into d from public.formal_documents where id=p_document_id;
 if d.id is null or not private.is_game_member(d.game_id) then raise exception 'Документ недоступен';end if;
 manage:=d.status_code NOT IN ('rejected','superseded','withdrawn') AND private.matches_formal_owner(d.game_id,u,d.current_owner_key,d.author_id);
 open_vote:=exists(select 1 from public.game_votes where formal_document_id=d.id and status='open');
 -- An opened ballot is not yet a cast vote. Editing stops permanently
 -- once ANY linked vote has a ballot (open or closed), even from another user.
 has_ballot:=exists(
   select 1 from public.game_votes v join public.game_ballots b on b.vote_id=v.id
   where v.formal_document_id=d.id
 );
 president_editor:=d.doc_type='president_decree' and d.subject_key='president' and d.workflow_key='president_act'
  and d.status_code in ('draft','review','revision','signed','published')
  and not private.is_game_teacher(d.game_id) and private.can_manage_presidential_policy(d.game_id,u);
 editable:=d.doc_type<>'bank_rate_decision' and not has_ballot and (private.is_game_teacher(d.game_id) or (manage and d.current_owner_key<>'system' and d.status_code not in ('signed','published','adopted','rejected')) or president_editor);
 next_step:=CASE WHEN d.status_code IN ('rejected','superseded','withdrawn') THEN NULL ELSE d.workflow_steps->(d.current_step+1) END;
 signable:=d.status_code NOT IN ('rejected','superseded','withdrawn') and not open_vote and not private.formal_vote_required(d) and (
  (manage and coalesce(d.workflow_steps->d.current_step->>'action','') ilike '%подпис%')
  or ((d.metadata->>'signed_by'=u::text) and d.status_code in ('signed','published','adopted')
   and d.metadata ? 'revision_changed_at'
   and (not (d.metadata ? 'signed_on') or (d.metadata->>'revision_changed_at')::timestamptz>(d.metadata->>'signed_on')::timestamptz))
  or (president_editor and d.status_code='signed' and d.metadata ? 'revision_changed_at'
   and (not (d.metadata ? 'signed_on') or (d.metadata->>'revision_changed_at')::timestamptz>(d.metadata->>'signed_on')::timestamptz))
 );
 if (d.doc_type='state_program' and d.metadata->>'auto_synced'='true' and exists(select 1 from public.government_program_agenda a where a.program_id::text=d.metadata->>'state_program_id')) or (d.doc_type='government_resolution' and d.stage_no=11 and d.metadata ? 'state_program_id' and d.metadata ? 'government_vote_id') then manage:=false;editable:=false;signable:=false;end if;
 return jsonb_build_object('can_edit',editable,'can_manage',manage,'can_sign',signable,
 'can_copy',exists(select 1 from public.game_members where game_id=d.game_id and user_id=u and kind<>'observer'),
 'vote_required',private.formal_vote_required(d),'open_vote',open_vote,'has_ballot',has_ballot,'next_owner',next_step->>'owner','next_action',CASE WHEN d.status_code IN ('rejected','superseded','withdrawn') THEN NULL ELSE d.workflow_steps->d.current_step->>'action' END);
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
    if (d.doc_type='state_program' or (d.doc_type='government_resolution' and d.stage_no=11 and d.metadata ? 'state_program_id')) and p_procedure_key not in ('manual','registered_session') then
      raise exception 'Используйте голосование по программе в повестке заседания Правительства' using errcode='42501';end if;
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

CREATE OR REPLACE FUNCTION public.sign_adopted_state_program(p_program_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare p public.state_programs%rowtype;
 v_uid uuid:=(select auth.uid());
 v_doc public.formal_documents%rowtype;
begin
 select * into p from public.state_programs where id=p_program_id for update;
 if p.id is null then raise exception 'Государственная программа не найдена'; end if;
 if v_uid is null or not private.is_game_member(p.game_id) or private.is_game_observer(p.game_id) then
  raise exception 'Требуются полномочия действующего участника';end if;
 if not private.is_game_teacher(p.game_id)
   and (not private.role_is_available(p.game_id,v_uid)
     or not exists(select 1 from private.formal_user_roles(p.game_id,v_uid) r
      where r ~* '^председатель[[:space:]]+правительства([[:space:]]|$)')) then
   raise exception 'Подписать программу может только Председатель Правительства';end if;
 if p.status<>'adopted' or p.government_vote_id is null
  or not exists(select 1 from public.game_votes v
    where v.id=p.government_vote_id and v.game_id=p.game_id and v.status='closed'
      and v.procedure_key='state_program' and v.result_code='passed'
      and v.result_quorum_met) then
  raise exception 'Подпись доступна только после положительного голосования Правительства с кворумом';end if;
 select * into v_doc from public.formal_documents d
 where d.game_id=p.game_id and d.stage_no=11
   and d.doc_type='government_resolution'
   and d.metadata->>'state_program_id'=p.id::text
   and d.metadata->>'government_vote_id'=p.government_vote_id::text
 order by d.created_at limit 1 for update;
 if v_doc.id is null then raise exception 'Не найдено постановление по итогам голосования';end if;
 if p.signed_at is null then
  perform private.publish_signed_state_program(p.id,v_uid);
 end if;
 if v_doc.status_code='published' then return;end if;
 if v_doc.status_code NOT IN ('draft','adopted') then raise exception 'Непредусмотренный статус постановления';end if;
 update public.formal_documents
 set current_step=3,status_code='published',status_label='Подписан и опубликован',
     current_owner_key='system',updated_at=now()
 where id=v_doc.id;
 insert into public.formal_document_history(document_id,game_id,actor_id,action,
  from_status,to_status,from_owner,to_owner,note)
 values(v_doc.id,p.game_id,v_uid,'Подписано Председателем Правительства после голосования',
  v_doc.status_code,'published',coalesce(v_doc.current_owner_key,'author'),'system',
  'Положительное решение Правительства зафиксировано в голосовании; программа подписана и опубликована.');
end
$function$;

-- Reconcile the live game's stale presentation and register its actual current statuses without inventing votes.
UPDATE public.government_program_agenda a SET status='pending',started_at=NULL,qa_closed_at=NULL,result_note='Программа на доработке'
FROM public.state_programs p,public.government_sessions s
WHERE a.game_id='068dac89-00ea-447a-96bf-0cb11d85014a' AND p.id=a.program_id AND s.id=a.session_id
 AND s.status='open' AND a.status='presenting' AND a.vote_id IS NULL AND p.status='revision' AND p.government_vote_id IS NULL AND p.signed_at IS NULL;
SELECT private.ensure_stage11_government_agenda('068dac89-00ea-447a-96bf-0cb11d85014a');
SELECT private.sync_stage11_program_registry_status(id) FROM public.state_programs WHERE game_id='068dac89-00ea-447a-96bf-0cb11d85014a';

UPDATE public.formal_documents d SET current_step=2,status_code='adopted',status_label='Принята — ожидает подписи',current_owner_key='government',updated_at=now() FROM public.state_programs p WHERE d.game_id='068dac89-00ea-447a-96bf-0cb11d85014a' AND d.game_id=p.game_id AND d.stage_no=11 AND d.doc_type='government_resolution' AND d.status_code='draft' AND d.metadata->>'state_program_id'=p.id::text AND d.metadata->>'government_vote_id'=p.government_vote_id::text AND p.status='adopted' AND p.signed_at IS NULL ;
