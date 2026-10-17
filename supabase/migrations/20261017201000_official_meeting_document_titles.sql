-- ГОС.ID: small amendment to the existing approved official-document
-- template. The stage stays in metadata, linkage tables and game state; it
-- must not appear in the legal title or printed footer.
-- Never create a new workflow or alter signing / approval permissions.
CREATE OR REPLACE FUNCTION private.formal_meeting_institution_name(
 p_game uuid,p_institution text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,private,pg_temp
AS $issuer$
 SELECT CASE p_institution
  WHEN 'ksrf' THEN 'Координационного Совета Российской Федерации'
  WHEN 'gd' THEN 'Государственной Думы Федерального Собрания Российской Федерации'
  WHEN 'sf' THEN 'Совета Федерации Федерального Собрания Российской Федерации'
  WHEN 'government' THEN 'Правительства Российской Федерации'
  WHEN 'municipality' THEN 'органа местного самоуправления'
  WHEN 'committee' THEN 'комитета Государственной Думы'
  WHEN 'region' THEN 'законодательного органа субъекта Российской Федерации'
  WHEN 'cec' THEN 'избирательной комиссии'
  WHEN 'ks' THEN 'Конституционного Суда Российской Федерации'
  WHEN 'vs' THEN 'Верховного Суда Российской Федерации'
  WHEN 'central_bank' THEN 'Совета директоров Банка России'
  WHEN 'accounts' THEN 'Коллегии Счётной палаты Российской Федерации'
  ELSE coalesce(
   (SELECT title FROM public.institution_units
    WHERE game_id=p_game AND 'unit:'||id::text=p_institution LIMIT 1),
   'органа публичной власти')
 END;
$issuer$;
REVOKE ALL ON FUNCTION private.formal_meeting_institution_name(uuid,text)
 FROM PUBLIC,anon,authenticated;

-- Nominative names belong in the issuing authority line and footer.
CREATE OR REPLACE FUNCTION private.formal_meeting_institution_label(
 p_game uuid,p_institution text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,private,pg_temp
AS $issuer$
 SELECT CASE p_institution
  WHEN 'ksrf' THEN 'Координационный Совет Российской Федерации'
  WHEN 'gd' THEN 'Государственная Дума Федерального Собрания Российской Федерации'
  WHEN 'sf' THEN 'Совет Федерации Федерального Собрания Российской Федерации'
  WHEN 'government' THEN 'Правительство Российской Федерации'
  WHEN 'municipality' THEN 'Орган местного самоуправления'
  WHEN 'committee' THEN 'Комитет Государственной Думы'
  WHEN 'region' THEN 'Законодательный орган субъекта Российской Федерации'
  WHEN 'cec' THEN 'Избирательная комиссия'
  WHEN 'ks' THEN 'Конституционный Суд Российской Федерации'
  WHEN 'vs' THEN 'Верховный Суд Российской Федерации'
  WHEN 'central_bank' THEN 'Совет директоров Банка России'
  WHEN 'accounts' THEN 'Коллегия Счётной палаты Российской Федерации'
  ELSE coalesce(
   (SELECT title FROM public.institution_units
    WHERE game_id=p_game AND 'unit:'||id::text=p_institution LIMIT 1),
   'Орган публичной власти')
 END;
$issuer$;
REVOKE ALL ON FUNCTION private.formal_meeting_institution_label(uuid,text)
 FROM PUBLIC,anon,authenticated;


CREATE OR REPLACE FUNCTION public.save_institution_meeting_document(p_game_id uuid, p_stage_no integer, p_institution text, p_kind text, p_body text, p_delegate_user_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare uid uuid:=auth.uid();m public.institution_meeting_records%rowtype;
 v_manager boolean;v_doc uuid;v_subject text;v_steps jsonb;v_title text;v_reg text;v_official_issuer text;
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
 v_official_issuer:=private.formal_meeting_institution_name(p_game_id,p_institution);
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
  v_title:='Повестка заседания '||CASE WHEN p_institution LIKE 'unit:%' THEN '«'||v_official_issuer||'»' ELSE v_official_issuer END;
 else
  if not exists(select 1 from public.institution_session_registrations where game_id=p_game_id
    and stage_no=p_stage_no and institution_key=p_institution) then
   raise exception 'Протокол оформляется после регистрации участников заседания';end if;
  if exists(select 1 from public.game_votes where game_id=p_game_id and stage_no=p_stage_no
    and institution_key=p_institution and status='open') then
   raise exception 'Сначала завершите все голосования заседания';end if;
  v_doc:=m.minutes_document_id;
  v_title:='Протокол заседания '||CASE WHEN p_institution LIKE 'unit:%' THEN '«'||v_official_issuer||'»' ELSE v_official_issuer END;
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
    v_subject,private.formal_meeting_institution_label(p_game_id,p_institution),uid,btrim(p_body),
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

-- Repair ONLY automatically generated meeting documents linked to their
-- authoritative meeting record, and only if the title still has a stage suffix.
-- Preserve document IDs, stage_no, content, status, signatures and history.
UPDATE public.formal_documents d
SET title=CASE WHEN d.doc_type='meeting_agenda' THEN 'Повестка заседания '
               ELSE 'Протокол заседания ' END
          ||CASE WHEN m.institution_key LIKE 'unit:%' THEN '«'||private.formal_meeting_institution_name(d.game_id,m.institution_key)||'»' ELSE private.formal_meeting_institution_name(d.game_id,m.institution_key) END,
 subject_label=private.formal_meeting_institution_label(d.game_id,m.institution_key)
FROM public.institution_meeting_records m
WHERE m.game_id=d.game_id
 AND (
  (m.agenda_document_id=d.id AND d.doc_type='meeting_agenda'
    AND d.metadata->>'document_kind'='institution_meeting_agenda')
  OR (m.minutes_document_id=d.id AND d.doc_type='minutes'
    AND d.metadata->>'document_kind'='institution_meeting_minutes')
 )
 AND d.metadata->>'institution_key'=m.institution_key
 AND d.title ~* 'этап[[:space:]]*[0-9]+[[:space:]]*$';
