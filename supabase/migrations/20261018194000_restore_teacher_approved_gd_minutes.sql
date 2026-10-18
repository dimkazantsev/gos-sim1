-- ГОС.ID: return exactly two incorrectly teacher-approved GD minutes
-- to the authorised State Duma office without reopening completed stage 4.
-- A closed stage remains closed. The only authorised exception is accepting
-- a protocol which had already been incorrectly published by the teacher and
-- was explicitly returned for approval by the GD chair.
CREATE OR REPLACE FUNCTION private.can_reapprove_returned_gd_minutes(
 p_old public.formal_documents, p_new public.formal_documents, p_actor uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO public,private,pg_temp
AS $function$
 SELECT p_actor IS NOT NULL
 AND p_old.id=p_new.id AND p_old.game_id=p_new.game_id
 AND p_old.stage_no=4 AND p_new.stage_no=4
 AND p_old.doc_type='other' AND p_new.doc_type='other'
 AND p_old.subject_key='gd' AND p_new.subject_key='gd'
 AND p_old.workflow_key='generic' AND p_new.workflow_key='generic'
 AND p_old.metadata->>'template_key'='minutes'
 AND p_new.metadata->>'template_key'='minutes'
 AND p_old.current_step=1 AND p_new.current_step=2
 AND p_old.status_code='review' AND p_new.status_code='published'
 AND p_old.current_owner_key='gd_staff' AND p_new.current_owner_key='system'
 AND p_old.workflow_steps=p_new.workflow_steps
 AND p_old.workflow_steps->1->>'owner'='gd_staff'
 AND p_new.workflow_steps->2->>'owner'='system'
 AND p_new.status_label=p_new.workflow_steps->2->>'label'
 -- All substantive fields, including the text, signatures and author,
 -- remain unchanged by the approval transition.
 AND (to_jsonb(p_new)-ARRAY['current_step','status_code','status_label','current_owner_key','updated_at'])
   =(to_jsonb(p_old)-ARRAY['current_step','status_code','status_label','current_owner_key','updated_at'])
 AND EXISTS(
   SELECT 1 FROM public.formal_document_history correction
   WHERE correction.document_id=p_old.id
     AND correction.game_id=p_old.game_id
     AND correction.actor_id IS NULL
     AND correction.action='Отменено ошибочное принятие преподавателем'
     AND correction.from_status='published'
     AND correction.to_status='review'
     AND correction.from_owner='system'
     AND correction.to_owner='gd_staff'
 )
 AND EXISTS(
   SELECT 1 FROM public.formal_document_history original
   JOIN public.game_members gm ON gm.game_id=original.game_id
     AND gm.user_id=original.actor_id AND gm.kind='teacher'
   WHERE original.document_id=p_old.id
     AND original.from_status='review'
     AND original.to_status='published'
     AND original.action='Принять'
 )
 AND private.matches_formal_owner(p_old.game_id,p_actor,'gd_staff',p_old.author_id);
$function$;
REVOKE ALL ON FUNCTION private.can_reapprove_returned_gd_minutes(public.formal_documents,public.formal_documents,uuid) FROM PUBLIC,anon,authenticated;

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
 -- The party dossier must follow a completed chair election. An old
 -- permissive INSERT policy alone cannot enforce this ordering.
 if tg_table_name='party_documents' then
  if tg_op='INSERT' and not exists(
   select 1 from public.game_parties p where p.id=new.party_id
    and p.game_id=v_game and p.leader_user_id is not null
  ) then
   raise exception 'Сначала изберите председателя партии.' using errcode='42501';
  end if;
 end if;
 if not exists(select 1 from public.game_members gm
     where gm.game_id=v_game and gm.user_id=auth.uid() and gm.kind='student'
      and gm.roster_archived_at is null) then
  raise exception 'Student membership required' using errcode='42501';
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
  IF tg_table_name='formal_documents' AND tg_op='UPDATE'
      AND private.stage4_legal_act_can_finalize(OLD,NEW,auth.uid()) THEN RETURN NEW; END IF;
  IF tg_table_name='formal_documents' AND tg_op='UPDATE'
      AND private.can_reapprove_returned_gd_minutes(OLD,NEW,auth.uid())
  THEN RETURN NEW; END IF;
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
 IF uid IS NULL THEN RETURN new; END IF;
 IF TG_TABLE_NAME='formal_documents' AND TG_OP='UPDATE'
    AND private.stage4_legal_act_can_finalize(OLD,NEW,uid) THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='formal_documents' AND TG_OP='UPDATE'
    AND private.can_reapprove_returned_gd_minutes(OLD,NEW,uid)
 THEN RETURN NEW; END IF;
 v_game:=new.game_id;v_stage:=new.stage_no;
 IF NOT private.is_game_teacher(v_game)
    AND private.has_prior_stage_document_hold(v_game,uid,v_stage) THEN
    IF TG_TABLE_NAME='formal_documents' AND
       (TG_OP='INSERT' OR (OLD.game_id=NEW.game_id AND OLD.stage_no=NEW.stage_no
          AND OLD.doc_type=NEW.doc_type AND OLD.subject_key=NEW.subject_key
          AND OLD.metadata->>'template_key'=NEW.metadata->>'template_key'))
       AND private.can_remediate_stage_final_document(
         NEW.game_id,NEW.stage_no,uid,NEW.doc_type,NEW.subject_key,NEW.metadata)
    THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Следующий этап недоступен: завершите обязательные итоговые документы предыдущего этапа'
      USING ERRCODE='42501';
 END IF;
 RETURN new;
END;$function$;

-- The criteria are evidence-based, not hard-coded document UUIDs.
-- Abort the entire migration if anything other than exactly two incorrect
-- teacher publications matches. All history rows are retained.
DO $restore$
DECLARE target record; restored integer:=0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('reopen-teacher-approved-stage4-minutes',0));
  FOR target IN
    SELECT d.id,d.game_id,d.status_code,d.current_owner_key
      FROM public.formal_documents d
    WHERE d.stage_no=4 AND d.doc_type='other'
      AND d.subject_key='gd' AND d.workflow_key='generic'
      AND d.metadata->>'template_key'='minutes'
      AND d.current_step=2 AND d.status_code='published'
      AND d.current_owner_key='system'
      AND d.workflow_steps->1->>'owner'='gd_staff'
      AND EXISTS(
        SELECT 1 FROM public.formal_document_history h
        JOIN public.game_members gm ON gm.game_id=h.game_id
          AND gm.user_id=h.actor_id AND gm.kind='teacher'
        WHERE h.document_id=d.id
          AND h.from_status='review' AND h.to_status='published'
          AND h.action='Принять'
      )
      AND NOT EXISTS(
        SELECT 1 FROM public.formal_document_history prior
        WHERE prior.document_id=d.id
          AND prior.action='Отменено ошибочное принятие преподавателем'
      )
    FOR UPDATE OF d
  LOOP
    restored:=restored+1;
    UPDATE public.formal_documents d
       SET current_step=1,
           status_code='review',
           status_label='На рассмотрении',
           current_owner_key='gd_staff',
           updated_at=clock_timestamp()
     WHERE d.id=target.id AND d.game_id=target.game_id
       AND d.status_code='published' AND d.current_step=2;
    IF NOT FOUND THEN RAISE EXCEPTION 'Протокол был изменён во время исправления'; END IF;
    INSERT INTO public.formal_document_history(
      document_id,game_id,actor_id,action,
      from_status,to_status,from_owner,to_owner,note
    ) VALUES(
      target.id,target.game_id,NULL,
      'Отменено ошибочное принятие преподавателем',
      'published','review','system','gd_staff',
      'Повторное согласование протокола Государственной Думы уполномоченным представителем. Прежняя история решений сохранена; текст, авторство, подписи и результаты голосований не изменены.'
    );
  END LOOP;
  IF restored<>2 THEN
    RAISE EXCEPTION 'Ожидались ровно два неправильно принятых преподавателем протокола ГД, найдено: %',restored;
  END IF;
END;$restore$;
