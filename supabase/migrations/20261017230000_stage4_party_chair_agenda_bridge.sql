
-- Scope the temporary authority strictly to the constitutive sitting (GD, stage 4).
CREATE OR REPLACE FUNCTION private.can_coordinate_stage_meeting(p_game uuid,p_stage integer,p_institution text,p_uid uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,private,pg_temp
AS $meeting$
DECLARE chair_elected boolean; council_formed boolean;
BEGIN
 IF p_institution<>'gd' OR p_stage<>4 THEN
  RETURN private.can_coordinate_institution_meeting(p_game,p_institution,p_uid);
 END IF;
 IF p_uid IS NULL THEN RETURN false; END IF;
 IF private.is_game_teacher(p_game) THEN RETURN true; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.game_stages
   WHERE game_id=p_game AND stage_no=4 AND status='open') THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.game_members
   WHERE game_id=p_game AND user_id=p_uid AND kind='student' AND roster_archived_at IS NULL)
   OR NOT private.role_is_available(p_game,p_uid) THEN RETURN false; END IF;

 SELECT EXISTS(SELECT 1 FROM public.office_elections e
   WHERE e.game_id=p_game AND e.stage_no=4 AND e.office_key='gd_chair'
     AND e.status='finished' AND e.winner_candidate_id IS NOT NULL)
 INTO chair_elected;
 SELECT EXISTS(SELECT 1 FROM public.game_office_assignments o
   WHERE o.game_id=p_game AND o.status='active' AND lower(o.role_title) LIKE '%совет%дум%')
 OR EXISTS(SELECT 1 FROM public.game_members m
   WHERE m.game_id=p_game AND m.roster_archived_at IS NULL
     AND lower(coalesce(m.role_title,'')) LIKE '%совет%дум%')
 INTO council_formed;

 IF chair_elected AND (
   private.can_manage_duma_session(p_game,p_uid)
   OR EXISTS (SELECT 1 FROM public.office_elections e
     JOIN public.office_candidates c ON c.id=e.winner_candidate_id
       AND c.election_id=e.id AND c.game_id=e.game_id
     WHERE e.game_id=p_game AND e.stage_no=4
       AND e.office_key='gd_chair' AND e.status='finished' AND c.user_id=p_uid)
 ) THEN RETURN true; END IF;

 -- Temporary authority persists until both the chair and Council exist.
 IF NOT (chair_elected AND council_formed) THEN
  RETURN EXISTS(SELECT 1 FROM public.game_parties p
    WHERE p.game_id=p_game AND p.leader_user_id=p_uid AND p.registration_status='registered');
 END IF;
 RETURN false;
END;
$meeting$;
REVOKE ALL ON FUNCTION private.can_coordinate_stage_meeting(uuid,integer,text,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_my_institution_meeting_permissions(p_game_id uuid, p_stage_no integer, p_institution text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_uid uuid := (select auth.uid());
 v_can_coordinate boolean;
 v_can_attend boolean;
 v_delegated boolean;
begin
 if v_uid is null or not private.is_game_member(p_game_id) then
  raise exception 'Нет доступа к игре';
 end if;
 if not exists(select 1 from public.game_stages
  where game_id=p_game_id and stage_no=p_stage_no) then
  raise exception 'Этап игры не найден';
 end if;
 if p_institution not in ('ksrf','gd','government','municipality','sf','committee','region',
  'cec','ks','vs','central_bank','accounts')
  and not exists(select 1 from public.institution_units
    where game_id=p_game_id and 'unit:'||id::text=p_institution) then
  raise exception 'Орган не найден';
 end if;
 v_can_coordinate:=private.can_coordinate_stage_meeting(p_game_id,p_stage_no,p_institution,v_uid);
 v_can_attend:=private.vote_member_has_office(p_game_id,v_uid,p_institution);
 select exists(select 1 from public.institution_meeting_records r
  where r.game_id=p_game_id and r.stage_no=p_stage_no
   and r.institution_key=p_institution and r.delegate_user_id=v_uid)
 into v_delegated;
 return jsonb_build_object(
  'can_coordinate',v_can_coordinate,
  'can_prepare',v_can_coordinate or v_delegated,
  'can_attend',v_can_attend
 );
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_institution_meeting_document(p_game_id uuid, p_stage_no integer, p_institution text, p_kind text, p_body text, p_delegate_user_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare uid uuid:=auth.uid();m public.institution_meeting_records%rowtype;
 v_manager boolean;v_doc uuid;v_subject text;v_steps jsonb;v_title text;v_reg text;
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
  v_title:=CASE WHEN p_institution='gd' AND p_stage_no=4 THEN 'Повестка заседания Государственной Думы — этап 4' ELSE 'Повестка заседания · '||p_institution||' · этап '||p_stage_no END;
 else
  if not exists(select 1 from public.institution_session_registrations where game_id=p_game_id
    and stage_no=p_stage_no and institution_key=p_institution) then
   raise exception 'Протокол оформляется после регистрации участников заседания';end if;
  if exists(select 1 from public.game_votes where game_id=p_game_id and stage_no=p_stage_no
    and institution_key=p_institution and status='open') then
   raise exception 'Сначала завершите все голосования заседания';end if;
  v_doc:=m.minutes_document_id;
  v_title:=CASE WHEN p_institution='gd' AND p_stage_no=4 THEN 'Протокол заседания Государственной Думы — этап 4' ELSE 'Протокол заседания · '||p_institution||' · этап '||p_stage_no END;
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
    v_subject,CASE WHEN p_institution='gd' AND p_stage_no=4 THEN 'Государственная Дума' ELSE p_institution END,uid,btrim(p_body),
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

CREATE OR REPLACE FUNCTION public.approve_institution_meeting_agenda(p_game_id uuid, p_stage_no integer, p_institution text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare uid uuid:=auth.uid();m public.institution_meeting_records%rowtype;v_id uuid;v_body text;v_author uuid;
begin
 if uid is null or not private.can_coordinate_stage_meeting(p_game_id,p_stage_no,p_institution,uid) then
  raise exception 'Утвердить повестку может только председатель или преподаватель';end if;
 -- Reuse established numbered agendas instead of duplicating Duma or Government documents.
 if not exists(select 1 from public.institution_meeting_records where game_id=p_game_id
   and stage_no=p_stage_no and institution_key=p_institution and agenda_document_id is not null) then
  if p_institution='gd' and p_stage_no=12 then
   select d.id,d.body_text,s.created_by into v_id,v_body,v_author
   from public.duma_sessions s join public.formal_documents d on d.id=s.agenda_document_id
   where s.game_id=p_game_id and exists(select 1 from public.duma_agenda_items a where a.session_id=s.id)
   order by s.session_no desc limit 1;
  elsif p_institution='government' and p_stage_no=11 then
   select d.id,d.body_text,s.created_by into v_id,v_body,v_author
   from public.government_sessions s join public.formal_documents d on d.id=s.agenda_document_id
   where s.game_id=p_game_id and (exists(select 1 from public.government_session_questions q where q.session_id=s.id)
    or exists(select 1 from public.government_program_agenda a where a.session_id=s.id))
   order by s.session_no desc limit 1;
  end if;
  if v_id is not null then
   insert into public.institution_meeting_records(game_id,stage_no,institution_key,agenda_document_id,agenda_body,agenda_prepared_by)
   values(p_game_id,p_stage_no,p_institution,v_id,v_body,v_author)
   on conflict(game_id,stage_no,institution_key) do update
    set agenda_document_id=coalesce(public.institution_meeting_records.agenda_document_id,excluded.agenda_document_id),
        agenda_body=coalesce(public.institution_meeting_records.agenda_body,excluded.agenda_body),
        agenda_prepared_by=coalesce(public.institution_meeting_records.agenda_prepared_by,excluded.agenda_prepared_by),updated_at=now();
  end if;
 end if;
 select * into m from public.institution_meeting_records
 where game_id=p_game_id and stage_no=p_stage_no and institution_key=p_institution for update;
 if m.agenda_document_id is null or length(btrim(coalesce(m.agenda_body,'')))<30 then
  raise exception 'Сначала подготовьте повестку заседания';end if;
 update public.institution_meeting_records set agenda_approved_by=uid,agenda_approved_at=now(),updated_at=now()
 where game_id=p_game_id and stage_no=p_stage_no and institution_key=p_institution;
 update public.formal_documents set status_code='published',status_label='Повестка утверждена',
 current_owner_key='system',updated_at=now() where id=m.agenda_document_id;
end;$function$;

CREATE OR REPLACE FUNCTION public.assign_institution_meeting_secretary(p_game_id uuid, p_stage_no integer, p_institution text, p_delegate uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare uid uuid:=auth.uid();
begin
 if uid is null or not private.can_coordinate_stage_meeting(p_game_id,p_stage_no,p_institution,uid) then
  raise exception 'Назначение исполнителя доступно только председателю';end if;
 if p_delegate is not null and not private.vote_member_has_office(p_game_id,p_delegate,p_institution) then
  raise exception 'Исполнитель не входит в состав органа';end if;
 insert into public.institution_meeting_records(game_id,stage_no,institution_key,delegate_user_id)
 values(p_game_id,p_stage_no,p_institution,p_delegate)
 on conflict(game_id,stage_no,institution_key) do update set
 delegate_user_id=excluded.delegate_user_id,updated_at=now();
end;$function$;

CREATE OR REPLACE FUNCTION public.approve_institution_meeting_minutes(p_game_id uuid, p_stage_no integer, p_institution text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare uid uuid:=auth.uid();m public.institution_meeting_records%rowtype;
begin
 if uid is null or not private.can_coordinate_stage_meeting(p_game_id,p_stage_no,p_institution,uid) then
  raise exception 'Утвердить протокол может только председатель или преподаватель';end if;
 select * into m from public.institution_meeting_records
 where game_id=p_game_id and stage_no=p_stage_no and institution_key=p_institution for update;
 if m.minutes_document_id is null or length(btrim(coalesce(m.minutes_body,'')))<30 then
  raise exception 'Сначала подготовьте протокол заседания';end if;
 if exists(select 1 from public.game_votes where game_id=p_game_id and stage_no=p_stage_no and institution_key=p_institution and status='open') then
  raise exception 'Перед подписанием протокола закройте голосования';end if;
 update public.institution_meeting_records set minutes_approved_by=uid,minutes_approved_at=now(),updated_at=now()
 where game_id=p_game_id and stage_no=p_stage_no and institution_key=p_institution;
 update public.formal_documents set status_code='published',status_label='Протокол утверждён',
 current_owner_key='system',updated_at=now() where id=m.minutes_document_id;
end;$function$;
