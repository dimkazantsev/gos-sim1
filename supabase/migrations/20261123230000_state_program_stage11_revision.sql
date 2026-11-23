-- Stage 11 Government programme revisions. Retain original Ministry -> PM -> voting protocol.
-- Change only relevant existing functions and a new role-gated revision action.
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
     WHERE a.program_id=p.id AND a.vote_id IS NOT NULL)
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
      where a.program_id=old.id and a.vote_id is not null)
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

CREATE OR REPLACE FUNCTION private.lock_signed_program_passport()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
begin
 if old.status not in ('draft','revision','minister_review') or old.signed_at is not null
  or old.government_vote_id is not null
  or exists(select 1 from public.government_program_agenda a where a.program_id=old.id and a.vote_id is not null) then
  if row(new.title,new.responsible_ministry,new.responsible_minister_id,new.curator_id,new.national_goal,new.start_date,new.end_date,new.total_budget,new.expected_results,new.participants,new.presidential_priority_id)
  is distinct from row(old.title,old.responsible_ministry,old.responsible_minister_id,old.curator_id,old.national_goal,old.start_date,old.end_date,old.total_budget,old.expected_results,old.participants,old.presidential_priority_id) then raise exception 'Согласованный или подписанный паспорт защищён от изменений';end if;
 end if;
 return new;
end;$function$;

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
   or exists(select 1 from public.government_program_agenda a where a.program_id=pid and a.vote_id is not null)) then raise exception 'Согласованный или подписанный текст программы защищён от изменений';end if;
 if tg_op='DELETE' then return old;else return new;end if;
end;$function$;

CREATE OR REPLACE FUNCTION public.save_state_program(p_game_id uuid, p_program_id uuid, p_title text, p_responsible_ministry text, p_responsible_minister_id uuid, p_curator_id uuid, p_national_goal text, p_start_date date, p_end_date date, p_total_budget numeric, p_expected_results text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_uid uuid:=(select auth.uid());v_id uuid;v_role text;
begin
 perform private.lock_active_program_actor(p_game_id);
 if v_uid is null or not private.is_game_member(p_game_id) or private.is_game_observer(p_game_id) or (not private.is_game_teacher(p_game_id) and not private.role_is_available(p_game_id,v_uid)) then raise exception 'Game access required'; end if;
 if length(trim(coalesce(p_title,'')))<5 or length(trim(coalesce(p_responsible_ministry,'')))<3 then raise exception 'Program title and responsible ministry are required'; end if;
 if p_total_budget<0 or p_total_budget::text in ('NaN','Infinity','-Infinity') then raise exception 'Budget cannot be negative'; end if;
 if p_end_date is not null and p_start_date is not null and p_end_date<p_start_date then raise exception 'Program end date must follow start date'; end if;
 if p_responsible_minister_id is not null and not exists(select 1 from public.game_members where game_id=p_game_id and user_id=p_responsible_minister_id)
 then raise exception 'Responsible minister is not a game member'; end if;
 if p_curator_id is not null and not exists(select 1 from public.game_members where game_id=p_game_id and user_id=p_curator_id)
 then raise exception 'Curator is not a game member'; end if;

 if p_program_id is null then
  v_role:=private.game_role(p_game_id,v_uid);
  if not private.is_game_teacher(p_game_id)
     and not (
       -- gos_id_ministry_head_program_creation_v1
       private.has_effective_role_like(p_game_id,v_uid,ARRAY['%министр%','%правительств%'])
       or exists (
         select 1
         from public.institution_units u
         join public.game_members gm
           on gm.game_id=u.game_id and gm.user_id=u.head_user_id
         where u.game_id=p_game_id
           and u.unit_kind='ministry'
           and u.head_user_id=v_uid
           and gm.kind='student'
           and gm.roster_archived_at is null
       )
     )
  then raise exception 'Government member role required to create a state program'; end if;
  insert into public.state_programs(
   game_id,title,responsible_ministry,responsible_minister_id,curator_id,national_goal,start_date,end_date,total_budget,expected_results,created_by
  ) values(
   p_game_id,trim(p_title),trim(p_responsible_ministry),coalesce(p_responsible_minister_id,v_uid),p_curator_id,
   nullif(trim(coalesce(p_national_goal,'')),''),p_start_date,p_end_date,coalesce(p_total_budget,0),
   nullif(trim(coalesce(p_expected_results,'')),''),v_uid
  ) returning id into v_id;
 else
  perform 1 from public.state_programs where id=p_program_id and game_id=p_game_id for update;
  if not found then raise exception 'Программа не принадлежит этой игре';end if;
  if not private.can_edit_state_program(p_program_id,v_uid) then raise exception 'Program editing access required'; end if;
  PERFORM set_config('app.gos_stage11_program_edit_id',p_program_id::text,true);
  update public.state_programs set title=trim(p_title),responsible_ministry=trim(p_responsible_ministry),
   responsible_minister_id=p_responsible_minister_id,curator_id=p_curator_id,national_goal=nullif(trim(coalesce(p_national_goal,'')),''),
   start_date=p_start_date,end_date=p_end_date,total_budget=coalesce(p_total_budget,0),
   expected_results=nullif(trim(coalesce(p_expected_results,'')),''),updated_at=now()
  where id=p_program_id and game_id=p_game_id returning id into v_id;
 end if;
 return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_state_program_draft(p_game_id uuid, p_program_id uuid, p_payload jsonb, p_confirm boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare p state_programs%rowtype;uid uuid:=auth.uid();v_program_id uuid;c_id uuid;component_ids uuid[]:='{}';x jsonb;
 total numeric:=0;component_total numeric;amount numeric;idx integer:=0;year_no integer;component_no integer;
 starts date;ends date;minister uuid;curator uuid;priority uuid;component_start date;component_end date;
begin
 perform private.lock_active_program_actor(p_game_id);
 if uid is null or not private.is_game_member(p_game_id) or private.is_game_observer(p_game_id)
 or (not private.is_game_teacher(p_game_id) and not private.role_is_available(p_game_id,uid)) then raise exception 'Нет доступа к разработке программы';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>262144 then raise exception 'Некорректная форма программы';end if;
 if jsonb_typeof(p_payload->'goals') is distinct from 'array' or jsonb_typeof(p_payload->'components') is distinct from 'array' or jsonb_typeof(p_payload->'expenses') is distinct from 'array' then raise exception 'Цели, мероприятия и расходы передаются списками';end if;
 if jsonb_array_length(p_payload->'goals')>50 or jsonb_array_length(p_payload->'components')>25 or jsonb_array_length(p_payload->'expenses')>200 then raise exception 'Превышен лимит строк формы';end if;
 if p_program_id is not null then
  select * into p from state_programs where id=p_program_id and game_id=p_game_id for update;
  if p.id is null or not private.can_edit_state_program(p.id,uid) then raise exception 'Нет доступа к этой программе';end if;
if p_payload ? 'expected_updated_at' and p.updated_at is distinct from nullif(p_payload->>'expected_updated_at','')::timestamptz then raise exception 'Программа изменена другим участником. Обновите страницу и повторите правки в актуальной версии.' using errcode='40001';end if;
  if p.status not in ('draft','revision','minister_review') or p.signed_at is not null then raise exception 'Согласованный или подписанный текст защищён от изменений';end if;
  PERFORM set_config('app.gos_stage11_program_edit_id',p.id::text,true);
 end if;
 starts:=nullif(p_payload->>'start_date','')::date;ends:=nullif(p_payload->>'end_date','')::date;
 if (starts is not null and extract(year from starts) not between 2000 and 2100) or (ends is not null and extract(year from ends) not between 2000 and 2100) then raise exception 'Срок программы должен быть в пределах 2000–2100 годов';end if;
 minister:=nullif(p_payload->>'responsible_minister_id','')::uuid;curator:=nullif(p_payload->>'curator_id','')::uuid;priority:=nullif(p_payload->>'presidential_priority_id','')::uuid;
 if minister is not null and not exists(select 1 from game_members where game_id=p_game_id and user_id=minister and kind='student' and roster_archived_at is null) then raise exception 'Ответственный министр должен быть действующим участником игры';end if;
 if curator is not null and not exists(select 1 from game_members where game_id=p_game_id and user_id=curator and kind='student' and roster_archived_at is null) then raise exception 'Куратор должен быть действующим участником игры';end if;
 if priority is not null and not exists(select 1 from presidential_priorities pr join presidential_addresses a on a.id=pr.address_id where pr.id=priority and pr.game_id=p_game_id and a.status='published') then raise exception 'Выберите опубликованный приоритет этой игры';end if;
 for x in select value from jsonb_array_elements(p_payload->'expenses') loop
  amount:=(x->>'amount')::numeric;year_no:=(x->>'budget_year')::integer;component_no:=(x->>'component_no')::integer;
  if amount is null or amount<0 or amount>1000000000000000 or amount::text in ('NaN','Infinity','-Infinity') or amount<>round(amount,2) then raise exception 'Расход должен быть неотрицательной суммой в рублях, не более двух знаков после запятой';end if;
  if year_no is null or year_no not between 2000 and 2100 or (starts is not null and year_no<extract(year from starts)) or (ends is not null and year_no>extract(year from ends)) then raise exception 'Год расхода должен входить в период программы';end if;
  if component_no is null or component_no not between 1 and jsonb_array_length(p_payload->'components') then raise exception 'Каждый расход необходимо связать с мероприятием программы';end if;
  if length(trim(coalesce(x->>'indicator_name','')))<3 or length(trim(coalesce(x->>'justification','')))<5 then raise exception 'Заполните индикатор расхода и его обоснование';end if;
  total:=total+amount;
 end loop;
 v_program_id:=public.save_state_program(p_game_id,p_program_id,p_payload->>'title',p_payload->>'responsible_ministry',minister,curator,p_payload->>'national_goal',starts,ends,total,p_payload->>'expected_results');
 if v_program_id is null then raise exception 'Программа не сохранена';end if;
 perform private.replace_state_program_rows(v_program_id,p_payload);
 perform private.sync_state_program_registry(v_program_id);
 -- The unsigned agenda document follows the changed title or ministry.
 IF p_program_id IS NOT NULL AND
    (p.title IS DISTINCT FROM p_payload->>'title' OR p.responsible_ministry IS DISTINCT FROM p_payload->>'responsible_ministry') THEN
   PERFORM private.refresh_government_agenda_document(s.id)
   FROM public.government_program_agenda a
   JOIN public.government_sessions s ON s.id=a.session_id
   WHERE a.program_id=v_program_id AND s.status='draft' AND s.agenda_approved_at IS NULL;
 END IF;
 if p_confirm and not exists (select 1 from public.presidential_priorities pr join public.presidential_addresses a on a.id=pr.address_id where pr.game_id=p_game_id and a.status='published' and pr.national_goal=p_payload->>'national_goal') then raise exception 'Для направления программы выберите цель, утверждённую Президентом в опубликованном послании';end if;
if p_confirm then perform public.advance_state_program(v_program_id,'submit_minister');end if;
 return v_program_id;
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
  if not private.is_game_teacher(p.game_id) and not v_is_pm then raise exception 'Prime Minister access required';end if;
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
  if not private.is_game_teacher(p.game_id) and not v_is_pm then raise exception 'Prime Minister access required'; end if;
  if p_action='pm_ready' then
   v_ready:=private.state_program_readiness_json(p.id);
   if not coalesce((v_ready->>'ready')::boolean,false) then raise exception 'Программа не готова к подписи: %',v_ready->'issues';end if;
  end if;
  update public.state_programs set status=case when p_action='pm_ready' then 'ready' else 'revision' end,updated_at=now() where id=p.id;
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
 IF NOT private.is_game_teacher(p.game_id) AND NOT v_is_pm
 THEN RAISE EXCEPTION 'Только Председатель Правительства может вернуть программу';END IF;
 IF p.status<>'pm_review' OR p.signed_at IS NOT NULL
 THEN RAISE EXCEPTION 'Возврат доступен только до согласования и подписания программы';END IF;
 PERFORM set_config('app.gos_stage11_program_edit_id',p.id::text,true);
 UPDATE public.state_programs
 SET status='revision',pm_revision_reason=v_reason,updated_at=now()
 WHERE id=p.id;
END;
$function$;

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
     and a.status='presenting' and s.status='open' and s.stage_no=11)
 then raise exception 'Сначала представьте программу на открытом заседании Правительства';end if;
 insert into public.game_votes(game_id,stage_no,title,body,voting_mode,status,created_by,institution_key,procedure_key,
  quorum_kind,quorum_value,majority_kind,majority_value,allow_abstain,tie_breaker_chair,pass_transition,fail_transition)
 values(p.game_id,11,'Государственная программа · '||p.title,
  'Решение Правительства по государственной программе. Кворум — не менее половины состава; решение при голосовании — большинством присутствующих.',
  'member','open',v_uid,'government','state_program','fraction',0.5,'present_majority',0.5,true,true,'none','none')
 returning id into v_vote;
 PERFORM set_config('app.gos_stage11_program_vote_id',p.id::text,true);
 update public.state_programs set status='government_vote',government_vote_id=v_vote,updated_at=now() where id=p.id;
 return v_vote;
end;$function$;

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
  set status=case when new.result_code='passed' then 'adopted' else 'rejected' end,updated_at=now()
  where id=p.id;

  if new.result_code='passed'
     and not exists(
       select 1 from public.formal_documents
       where game_id=p.game_id and stage_no=11 and doc_type='government_resolution'
         and metadata->>'state_program_id'=p.id::text
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
    -- A favourable vote creates only the draft resolution.
    -- The published programme and resolution are released together by the PM signature RPC.
  end if;
 end if;
 return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.publish_signed_state_program(p_program_id uuid, p_signer uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare p state_programs%rowtype;post_id uuid;signer_name text;body_text text;signed_time timestamptz:=now();
begin
 select * into p from state_programs where id=p_program_id for update;
 if p.signed_at is not null then return;end if;
 if p.status<>'adopted' or p_signer is distinct from auth.uid() then raise exception 'Подпись программы недоступна';end if;
 select full_name into signer_name from game_members where game_id=p.game_id and user_id=p_signer;
 body_text:=concat_ws(E'\n',p.title,'Ответственное министерство: '||p.responsible_ministry,'Национальная цель: '||p.national_goal,'Период: '||p.start_date||' — '||p.end_date,'Участники: '||p.participants,'Ожидаемые результаты: '||p.expected_results,
 'Цели и показатели:',(select string_agg(goal_text||' · '||indicator_name||': '||coalesce(baseline_value::text,'—')||' → '||coalesce(target_value::text,'—')||' '||coalesce(unit,'')||' ('||coalesce(target_year::text,'—')||')',E'\n' order by created_at,id) from state_program_goals where program_id=p.id),
 'Направления и мероприятия:',(select string_agg(direction_no||'. '||direction_title||' · '||title||': '||goal_text||' · '||coalesce(start_date::text,'—')||' — '||coalesce(end_date::text,'—')||' · '||budget||' ₽',E'\n' order by direction_no,created_at,id) from state_program_components where program_id=p.id),
 'Расходы в рублях:',(select string_agg(e.budget_year||' · '||e.indicator_name||' · '||e.justification||' · '||e.amount||' ₽',E'\n' order by e.position,e.id) from state_program_expenses e where e.program_id=p.id),
 'Финансирование по годам:',(select string_agg(budget_year||': '||amount||' ₽',E'\n' order by budget_year) from state_program_budget_years where program_id=p.id),
 'Всего: '||p.total_budget||' ₽','Подписал Председатель Правительства: '||coalesce(signer_name,'Уполномоченный участник'),
 'Программа принята голосованием Правительства и подписана Председателем Правительства. Бюджетные ассигнования утверждаются бюджетной процедурой.');
 insert into political_posts(game_id,author_id,process_type,actor_key,actor_label,title,body,tags,status,source_key,context)
 values(p.game_id,p_signer,'information','government','Правительство','Подписана государственная программа: '||p.title,body_text,array['Государственная программа','Бюджет'],'published','state_program_signed:'||p.id,jsonb_build_object('state_program_id',p.id,'stage_no',11))
 on conflict(game_id,source_key) where source_key is not null do nothing returning id into post_id;
 if post_id is null then select id into post_id from political_posts where game_id=p.game_id and source_key='state_program_signed:'||p.id;end if;
 insert into state_program_budget_commitments(program_id,game_id,budget_year,amount,status,signed_by,signed_at)
 select p.id,p.game_id,budget_year,amount,'approved',p_signer,signed_time from state_program_budget_years where program_id=p.id
 on conflict(program_id,budget_year) do nothing;
 PERFORM set_config('app.gos_stage11_program_sign_id',p.id::text,true);
 update state_programs set signed_by=p_signer,signed_at=signed_time,publication_post_id=post_id,updated_at=now() where id=p.id;
end;$function$;


CREATE OR REPLACE FUNCTION public.begin_stage11_program_revision(p_program_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $begin$
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
 IF v_program.signed_at IS NOT NULL OR v_program.government_vote_id IS NOT NULL
   OR v_program.status NOT IN ('draft','revision','minister_review','pm_review','ready')
   OR EXISTS(SELECT 1 FROM public.government_program_agenda a
        WHERE a.program_id=v_program.id AND a.vote_id IS NOT NULL)
 THEN RAISE EXCEPTION 'После открытия голосования ГП не редактируется' USING ERRCODE='42501';END IF;
 IF v_program.status IN ('ready','pm_review') THEN
   PERFORM set_config('app.gos_stage11_program_edit_id',v_program.id::text,true);
   UPDATE public.state_programs
    SET status='revision',pm_revision_reason=NULL,updated_at=now()
    WHERE id=v_program.id;
 END IF;
END;
$begin$;
REVOKE ALL ON FUNCTION public.begin_stage11_program_revision(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_stage11_program_revision(uuid) TO authenticated;
