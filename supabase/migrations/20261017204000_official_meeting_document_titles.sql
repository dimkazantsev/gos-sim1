-- Existing official document standard: no stage references or educational
-- disclaimers in titles. Stage identifiers remain in metadata and relations.
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
  v_reg:='ИГРА-ЗАС-'||lpad(nextval('public.formal_registry_seq')::text,6,'0');
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

-- Rename ONLY historical system-generated meeting papers whose old title
-- exposes a stage or internal institution key. No documents are recreated.
WITH canonical AS (
 SELECT d.id,d.subject_label,d.subject_key,
 CASE d.metadata->>'institution_key'
   WHEN 'ksrf' THEN 'Координационного Совета Российской Федерации'
   WHEN 'gd' THEN 'Государственной Думы Федерального Собрания Российской Федерации'
   WHEN 'government' THEN 'Правительства Российской Федерации'
   WHEN 'sf' THEN 'Совета Федерации Федерального Собрания Российской Федерации'
   WHEN 'municipality' THEN 'органа местного самоуправления'
   WHEN 'region' THEN 'законодательного органа субъекта Российской Федерации'
   WHEN 'committee' THEN 'комитета Государственной Думы'
   WHEN 'cec' THEN 'Центральной избирательной комиссии Российской Федерации'
   WHEN 'ks' THEN 'Конституционного Суда Российской Федерации'
   WHEN 'vs' THEN 'Верховного Суда Российской Федерации'
   WHEN 'central_bank' THEN 'Совета директоров Банка России'
   WHEN 'accounts' THEN 'Коллегии Счётной палаты Российской Федерации'
 END AS genitive,
 CASE d.metadata->>'institution_key'
   WHEN 'ksrf' THEN 'Координационный Совет Российской Федерации'
   WHEN 'gd' THEN 'Государственная Дума Федерального Собрания Российской Федерации'
   WHEN 'government' THEN 'Правительство Российской Федерации'
   WHEN 'sf' THEN 'Совет Федерации Федерального Собрания Российской Федерации'
   ELSE NULL
 END AS nominative
 FROM public.formal_documents d
 WHERE d.doc_type IN ('meeting_agenda','minutes')
   AND d.metadata->>'document_kind' IN ('institution_meeting_agenda','institution_meeting_minutes')
   AND d.title ~* '(^|[[:space:]])этап[[:space:]]+[0-9]+[[:space:]]*$'
)
UPDATE public.formal_documents d
SET title=case d.doc_type
 WHEN 'meeting_agenda' THEN 'Повестка заседания '||c.genitive
 ELSE 'Протокол заседания '||c.genitive END,
 subject_label=case
  when c.nominative IS NOT NULL AND (
   coalesce(d.subject_label,'')='' OR lower(d.subject_label)=lower(coalesce(d.metadata->>'institution_key',''))
  ) then c.nominative
  else d.subject_label end
FROM canonical c
WHERE d.id=c.id AND c.genitive IS NOT NULL;
