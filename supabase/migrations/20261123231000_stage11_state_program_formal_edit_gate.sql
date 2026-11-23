-- Permit only pre-vote Stage 11 edits of the same Stage 10 official passport.
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
          where a.program_id=p.id and a.vote_id IS NOT NULL)
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
       where a.program_id=p.id and a.vote_id IS NOT NULL)
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
