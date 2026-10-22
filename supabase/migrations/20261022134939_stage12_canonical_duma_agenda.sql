-- Stage 12: one canonical State Duma agenda for both registration and the session.
-- Reuses the existing numbered formal agenda document. No new tables, ballots,
-- privileges or background polling. Other stages and institutions unchanged.
CREATE OR REPLACE FUNCTION private.sync_duma_session_agenda_document(p_session_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare s public.duma_sessions%rowtype; v_doc uuid; v_lines text; v_body text; v_steps jsonb;
begin
 select * into s from public.duma_sessions where id=p_session_id;
 if s.id is null then return null; end if;
 select string_agg(format('%s. %s · %s%s',
      x.agenda_no,d.title,d.registry_no,
      E'\n   Текущая стадия НПА: '||d.status_label),
      E'\n\n' order by x.agenda_no)
  into v_lines
  from public.duma_agenda_items x join public.formal_documents d on d.id=x.formal_document_id
  where x.session_id=s.id;
 v_body:='ПОВЕСТКА ЗАСЕДАНИЯ ГОСУДАРСТВЕННОЙ ДУМЫ'
   ||E'\n\nЗаседание № '||s.session_no||E'\n'||s.title
   ||E'\nВремя начала: '||coalesce(to_char(s.scheduled_start at time zone 'Asia/Barnaul','DD.MM.YYYY HH24:MI'),'Не указано')
   ||E'\nВремя окончания: '||coalesce(to_char(s.scheduled_end at time zone 'Asia/Barnaul','DD.MM.YYYY HH24:MI'),'Не указано')
   ||E'\nСтатус заседания: '||case s.status when 'draft' then 'Подготовка' when 'open' then 'Открыто' else 'Завершено' end
   ||E'\n\nВОПРОСЫ ПОВЕСТКИ\n\n'||coalesce(v_lines,'Документы ещё не включены в повестку.');
 if s.agenda_document_id is null then
  v_doc:=gen_random_uuid();
  v_steps:=private.formal_workflow('gd_resolution');
  insert into public.formal_documents(id,game_id,stage_no,registry_no,title,doc_type,subject_key,subject_label,author_id,
    body_text,workflow_key,workflow_steps,current_step,status_code,status_label,current_owner_key,metadata)
  values(v_doc,s.game_id,s.stage_no,'ГОС.ID-ПОВ-ГД-'||lpad(nextval('public.formal_registry_seq')::text,5,'0'),
    'Повестка заседания Государственной Думы № '||s.session_no,
    'meeting_agenda','gd','Государственная Дума Федерального Собрания РФ',s.created_by,
    v_body,'gd_resolution',v_steps,0,'draft','Проект повестки','gd',
    jsonb_build_object('document_kind','duma_session_agenda','duma_session_id',s.id,'auto_generated',true));
  update public.duma_sessions set agenda_document_id=v_doc where id=s.id;
  insert into public.formal_document_history(document_id,game_id,actor_id,action,to_status,to_owner,note)
  values(v_doc,s.game_id,s.created_by,'Создана повестка заседания','draft','gd','Служебный документ заседания № '||s.session_no);
 else
  v_doc:=s.agenda_document_id;
  update public.formal_documents set body_text=v_body,
   status_code=case when s.status='draft' then 'draft' else 'published' end,
   status_label=case s.status when 'draft' then 'Проект повестки' when 'open' then 'Утверждённая повестка' else 'Повестка завершённого заседания' end,
   current_owner_key=case when s.status='draft' then 'gd' else 'system' end,
   updated_at=now()
  where id=v_doc and (body_text is distinct from v_body or status_label is distinct from
   case s.status when 'draft' then 'Проект повестки' when 'open' then 'Утверждённая повестка' else 'Повестка завершённого заседания' end);
 end if;
 if s.stage_no=12 then
  -- One canonical State Duma agenda. The registration panel reuses its
  -- document id and text; never create an independent agenda for Stage 12.
  insert into public.institution_meeting_records(
    game_id,stage_no,institution_key,agenda_document_id,agenda_body,agenda_prepared_by,updated_at
  ) values(
    s.game_id,12,'gd',v_doc,v_body,s.created_by,now()
  )
  on conflict (game_id,stage_no,institution_key) do update
   set agenda_document_id=excluded.agenda_document_id,
       agenda_body=excluded.agenda_body,
       agenda_prepared_by=coalesce(public.institution_meeting_records.agenda_prepared_by,excluded.agenda_prepared_by),
       agenda_approved_at=case
         when s.status='draft' and public.institution_meeting_records.agenda_body is distinct from excluded.agenda_body
         then null else public.institution_meeting_records.agenda_approved_at end,
       agenda_approved_by=case
         when s.status='draft' and public.institution_meeting_records.agenda_body is distinct from excluded.agenda_body
         then null else public.institution_meeting_records.agenda_approved_by end,
       updated_at=case
         when public.institution_meeting_records.agenda_body is distinct from excluded.agenda_body
           or public.institution_meeting_records.agenda_document_id is distinct from excluded.agenda_document_id
         then now() else public.institution_meeting_records.updated_at end;
 end if;
 return v_doc;
end;$function$;

CREATE OR REPLACE FUNCTION public.save_institution_meeting_document(p_game_id uuid, p_stage_no integer, p_institution text, p_kind text, p_body text, p_delegate_user_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare uid uuid:=auth.uid();m public.institution_meeting_records%rowtype;
 v_manager boolean;v_doc uuid;v_subject text;v_steps jsonb;v_title text;v_reg text;
 v_org text;v_org_gen text;
begin
 if uid is null or not private.is_game_member(p_game_id) then raise exception 'Нет доступа к игре';end if;
 if p_stage_no not between 1 and 16 or not exists(
   select 1 from public.game_stages where game_id=p_game_id and stage_no=p_stage_no
 ) then raise exception 'Этап не найден';end if;
 if p_kind not in ('agenda','minutes') then raise exception 'Неизвестный вид документа';end if;
 if p_kind='agenda' and p_institution='gd' and p_stage_no=12 then
  raise exception 'Повестка ГД Этапа 12 формируется автоматически из пакетов законопроектов. Утвердите её в разделе регистрации, корректировки заседания выполняйте отдельно.' using errcode='23514';
 end if;
 if length(btrim(coalesce(p_body,'')))<30 then raise exception 'Заполните содержание документа (не менее 30 символов)';end if;
 if p_institution not in ('ksrf','gd','government','municipality','sf','committee','region','cec','ks','vs','central_bank','accounts')
 and not exists(select 1 from public.institution_units where game_id=p_game_id and 'unit:'||id::text=p_institution)
 then raise exception 'Орган не найден';end if;
 v_manager:=private.can_coordinate_stage_meeting(p_game_id,p_stage_no,p_institution,uid);
 insert into public.institution_meeting_records(game_id,stage_no,institution_key)
 values(p_game_id,p_stage_no,p_institution) on conflict do nothing;
 select * into m from public.institution_meeting_records
 where game_id=p_game_id and stage_no=p_stage_no and institution_key=p_institution for update;
 if not v_manager and m.delegate_user_id is distinct from uid then
  raise exception 'Повестку и протокол готовит председатель или назначенный им участник';end if;
 if not v_manager and p_delegate_user_id is not null then
  raise exception 'Поручить подготовку вправе председатель';end if;
 if p_delegate_user_id is not null and not private.vote_member_has_office(p_game_id,p_delegate_user_id,p_institution) then
  raise exception 'Исполнитель должен иметь действующее назначение в этом органе';end if;
 -- The guard will accept meeting documents even before stage work opens.
 -- Authorization above remains mandatory; other documents cannot use this scope.
 perform set_config('app.gos_meeting_document_scope',
   p_game_id::text||':'||p_stage_no||':'||p_institution||':'||p_kind,true);
 -- Institution names are official document requisites. Stage number remains
 -- in metadata for routing but must never appear in the public title.
 v_org:=case p_institution
  when 'ksrf' then 'Координационный Совет Российской Федерации'
  when 'gd' then 'Государственная Дума Федерального Собрания Российской Федерации'
  when 'government' then 'Правительство Российской Федерации'
  when 'sf' then 'Совет Федерации Федерального Собрания Российской Федерации'
  when 'municipality' then 'Орган местного самоуправления'
  when 'region' then 'Законодательный орган субъекта Российской Федерации'
  when 'committee' then 'Комитет Государственной Думы'
  when 'cec' then 'Центральная избирательная комиссия Российской Федерации'
  when 'ks' then 'Конституционный Суд Российской Федерации'
  when 'vs' then 'Верховный Суд Российской Федерации'
  when 'central_bank' then 'Совет директоров Банка России'
  when 'accounts' then 'Коллегия Счётной палаты Российской Федерации'
  else (select u.title from public.institution_units u
    where u.game_id=p_game_id and 'unit:'||u.id::text=p_institution limit 1)
 end;
 if v_org is null then raise exception 'Официальное наименование органа не найдено';end if;
 v_org_gen:=case p_institution
  when 'ksrf' then 'Координационного Совета Российской Федерации'
  when 'gd' then 'Государственной Думы Федерального Собрания Российской Федерации'
  when 'government' then 'Правительства Российской Федерации'
  when 'sf' then 'Совета Федерации Федерального Собрания Российской Федерации'
  when 'municipality' then 'органа местного самоуправления'
  when 'region' then 'законодательного органа субъекта Российской Федерации'
  when 'committee' then 'комитета Государственной Думы'
  when 'cec' then 'Центральной избирательной комиссии Российской Федерации'
  when 'ks' then 'Конституционного Суда Российской Федерации'
  when 'vs' then 'Верховного Суда Российской Федерации'
  when 'central_bank' then 'Совета директоров Банка России'
  when 'accounts' then 'Коллегии Счётной палаты Российской Федерации'
  else null
 end;
 if p_kind='agenda' then
  -- Historic registrations created before agenda enforcement must not
  -- permanently block the FIRST agenda document. Once an agenda exists,
  -- preserve the existing freeze on edits after the first registration.
  if m.agenda_document_id is not null and exists(
    select 1 from public.institution_session_registrations
    where game_id=p_game_id and stage_no=p_stage_no
      and institution_key=p_institution
  ) then
   raise exception 'После начала регистрации повестку менять нельзя';end if;
  v_doc:=m.agenda_document_id;
  v_title:=case when v_org_gen is null then 'Повестка заседания «'||v_org||'»' else 'Повестка заседания '||v_org_gen end;
 else
  if not exists(select 1 from public.institution_session_registrations where game_id=p_game_id
    and stage_no=p_stage_no and institution_key=p_institution) then
   raise exception 'Протокол оформляется после регистрации участников заседания';end if;
  if exists(select 1 from public.game_votes where game_id=p_game_id and stage_no=p_stage_no
    and institution_key=p_institution and status='open') then
   raise exception 'Сначала завершите все голосования заседания';end if;
  v_doc:=m.minutes_document_id;
  v_title:=case when v_org_gen is null then 'Протокол заседания «'||v_org||'»' else 'Протокол заседания '||v_org_gen end;
 end if;
 v_subject:=case when p_institution='government' then 'government'
                 when p_institution like 'unit:%' then 'gd' else p_institution end;
 if v_doc is null then
  v_doc:=gen_random_uuid();
  v_reg:='ГОС.ID-ЗАС-'||lpad(nextval('public.formal_registry_seq')::text,6,'0');
  v_steps:=private.formal_workflow(case when p_institution='government' then 'government_act' else 'gd_resolution' end);
  insert into public.formal_documents(id,game_id,stage_no,registry_no,title,doc_type,
   subject_key,subject_label,author_id,body_text,workflow_key,workflow_steps,
   current_step,status_code,status_label,current_owner_key,metadata)
  values(v_doc,p_game_id,p_stage_no,v_reg,v_title,
    case when p_kind='agenda' then 'meeting_agenda' else 'minutes' end,
    v_subject,v_org,uid,btrim(p_body),
    case when p_institution='government' then 'government_act' else 'gd_resolution' end,
    v_steps,0,'draft',
    case when p_kind='agenda' then 'Проект повестки' else 'Протокол подготовлен' end,
    v_subject,jsonb_build_object('document_kind','institution_meeting_'||p_kind,
      'institution_key',p_institution,'stage_no',p_stage_no));
 else
  update public.formal_documents set body_text=btrim(p_body),updated_at=now()
  where id=v_doc and game_id=p_game_id;
 end if;
 if p_kind='agenda' then
  update public.institution_meeting_records set agenda_document_id=v_doc,
   agenda_body=btrim(p_body),agenda_prepared_by=uid,
   agenda_approved_by=case when v_manager then uid else null end,
   agenda_approved_at=case when v_manager then now() else null end,
   delegate_user_id=coalesce(p_delegate_user_id,delegate_user_id),updated_at=now()
   where game_id=p_game_id and stage_no=p_stage_no and institution_key=p_institution;
  if v_manager then
   update public.formal_documents set status_code='published',status_label='Повестка утверждена',
    current_owner_key='system',updated_at=now() where id=v_doc;
  end if;
 else
  update public.institution_meeting_records set minutes_document_id=v_doc,
   minutes_body=btrim(p_body),minutes_prepared_by=uid,minutes_saved_at=now(),
   minutes_approved_by=case when v_manager then uid else null end,
   minutes_approved_at=case when v_manager then now() else null end,updated_at=now() where game_id=p_game_id and stage_no=p_stage_no and institution_key=p_institution;
  update public.formal_documents set status_code=case when v_manager then 'published' else 'draft' end,
   status_label=case when v_manager then 'Протокол утверждён' else 'Проект протокола' end,
   current_owner_key=case when v_manager then 'system' else v_subject end,updated_at=now() where id=v_doc;
 end if;
 insert into public.formal_document_history(document_id,game_id,actor_id,action,to_status,to_owner,note)
 values(v_doc,p_game_id,uid,case when p_kind='agenda' then 'Подготовлена повестка заседания' else 'Составлен протокол заседания' end,
  case when not v_manager then 'draft' else 'published' end,
  case when v_manager then 'system' else v_subject end,'Этап '||p_stage_no||', орган '||p_institution);
 return v_doc;
end;$function$;
CREATE OR REPLACE FUNCTION public.open_duma_session(p_session_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare s public.duma_sessions%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into s from public.duma_sessions where id=p_session_id for update;
 if s.id is null then raise exception 'Session not found'; end if;
 if not private.can_manage_duma_session(s.game_id,v_uid) then raise exception 'State Duma chair / teacher access required'; end if;
 perform private.require_duma_stage_open(s.game_id,s.stage_no);
 if s.status<>'draft' then raise exception 'Session is not a draft'; end if;
 if s.stage_no=12 and not exists (
  select 1 from public.institution_meeting_records m
  where m.game_id=s.game_id and m.stage_no=12 and m.institution_key='gd'
   and m.agenda_document_id=s.agenda_document_id and m.agenda_approved_at is not null
 ) then raise exception 'Председатель должен утвердить автоматически сформированную повестку до начала заседания' using errcode='23514'; end if;
 if not exists(select 1 from public.duma_agenda_items where session_id=s.id and status='pending')
 then raise exception 'The Duma does not meet without an agenda'; end if;
 update public.duma_sessions set status='open',opened_at=now(),chair_user_id=v_uid where id=s.id;
end;$function$;
-- Backfill just the existing latest Stage 12 session per game. Previously
-- approved or completed meetings are not rewritten.
DO $backfill_duma12$
DECLARE v_session record;
BEGIN
 FOR v_session IN
  SELECT DISTINCT ON (game_id) id
  FROM public.duma_sessions
  WHERE stage_no=12 AND status='draft'
  ORDER BY game_id,session_no DESC
 LOOP
  PERFORM private.sync_duma_session_agenda_document(v_session.id);
 END LOOP;
END;
$backfill_duma12$;
