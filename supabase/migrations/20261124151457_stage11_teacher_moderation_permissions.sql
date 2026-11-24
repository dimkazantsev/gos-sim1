
ALTER TABLE public.government_sessions ADD COLUMN IF NOT EXISTS moderator_approval_hash text;
ALTER TABLE public.government_sessions ADD COLUMN IF NOT EXISTS moderator_approved_by uuid;
ALTER TABLE public.government_sessions ADD COLUMN IF NOT EXISTS moderator_approved_at timestamptz;

CREATE OR REPLACE FUNCTION private.government_agenda_revision_hash(p_doc public.formal_documents)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
 SELECT md5(jsonb_build_array(p_doc.id,p_doc.title,p_doc.body_text,p_doc.metadata->>'revision_changed_at')::text);
$$;
REVOKE ALL ON FUNCTION private.government_agenda_revision_hash(public.formal_documents) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.agenda_approved_or_signed(p_doc uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT private.agenda_all_signed(p_doc) OR EXISTS(
  SELECT 1 FROM public.formal_documents d JOIN public.government_sessions s
   ON s.agenda_document_id=d.id AND s.game_id=d.game_id
  WHERE d.id=p_doc AND d.doc_type='meeting_agenda' AND d.stage_no=11
    AND d.metadata->>'document_kind'='government_session_agenda'
    AND s.moderator_approved_by IS NOT NULL AND s.moderator_approved_at IS NOT NULL
    AND s.moderator_approval_hash=private.government_agenda_revision_hash(d)
 );
$$;
REVOKE ALL ON FUNCTION private.agenda_approved_or_signed(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.current_government_chair(p_game uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT m.user_id FROM public.game_members m WHERE m.game_id=p_game AND m.kind='student' AND m.roster_archived_at IS NULL
  AND private.role_is_available(p_game,m.user_id)
  AND NOT EXISTS(SELECT 1 FROM public.game_member_access_blocks b WHERE b.game_id=p_game AND b.user_id=m.user_id)
  AND EXISTS(SELECT 1 FROM private.formal_user_roles(p_game,m.user_id) r WHERE r ~* '^[[:space:]]*председатель[[:space:]]+правительства([[:space:]]|$)')
 ORDER BY m.user_id LIMIT 1;
$$;
REVOKE ALL ON FUNCTION private.current_government_chair(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.can_approve_government_agenda(p_game uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
 SELECT p_user IS NOT NULL
  AND private.is_game_member(p_game)
  AND p_user=auth.uid() AND NOT private.is_game_observer(p_game)
  AND (private.is_game_teacher(p_game) OR (private.role_is_available(p_game,p_user)
  AND (
   private.game_role(p_game,p_user) ~* '^[[:space:]]*председатель[[:space:]]+правительства([[:space:]]|$)'
   OR EXISTS(
    SELECT 1 FROM public.game_office_assignments a
     WHERE a.game_id=p_game AND a.user_id=p_user AND a.status='active'
      AND a.role_title ~* '^[[:space:]]*председатель[[:space:]]+правительства([[:space:]]|$)'
   )
  )));
$function$;

CREATE OR REPLACE FUNCTION private.agenda_document_revision_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_changed boolean:=false;
BEGIN
 IF NEW.doc_type<>'meeting_agenda' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN
  v_changed:=private.agenda_normalized_body(NEW.body_text)
               IS DISTINCT FROM private.agenda_normalized_body(OLD.body_text)
   OR NEW.title IS DISTINCT FROM OLD.title
   OR nullif(NEW.metadata->>'revision_changed_at','') IS DISTINCT FROM nullif(OLD.metadata->>'revision_changed_at','');
  IF v_changed AND nullif(NEW.metadata->>'revision_changed_at','')
                        IS NOT DISTINCT FROM nullif(OLD.metadata->>'revision_changed_at','') THEN
   NEW.metadata:=coalesce(NEW.metadata,'{}'::jsonb)||
      jsonb_build_object('revision_changed_at',clock_timestamp());
  END IF;
 END IF;
 IF v_changed OR NEW.status_code IN ('published','adopted','signed')
                   AND NOT private.agenda_approved_or_signed(NEW.id) THEN
  NEW.status_code:='draft';
  NEW.status_label:='Ожидает личных подписей';
  NEW.current_owner_key:=coalesce(nullif(NEW.subject_key,''),'author');
 END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION private.agenda_session_open_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF NEW.status='open' AND OLD.status IS DISTINCT FROM 'open' AND
   ((TG_TABLE_NAME='duma_sessions' AND NEW.stage_no=12) OR
    (TG_TABLE_NAME='government_sessions' AND NEW.stage_no=11)) THEN
  IF NEW.agenda_document_id IS NULL OR NOT private.agenda_approved_or_signed(NEW.agenda_document_id) THEN
   RAISE EXCEPTION 'Сначала соберите личные подписи всех уполномоченных лиц под повесткой'
    USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION private.government_agenda_personal_approval_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF NEW.agenda_approved_at IS NOT NULL
  AND (OLD.agenda_approved_at IS DISTINCT FROM NEW.agenda_approved_at
    OR OLD.agenda_document_id IS DISTINCT FROM NEW.agenda_document_id)
  AND (NEW.agenda_document_id IS NULL
    OR NOT private.agenda_approved_or_signed(NEW.agenda_document_id)) THEN
  RAISE EXCEPTION 'Повестка Правительства утверждается только после личной подписи Председателя Правительства'
   USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION private.meeting_record_approval_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF NEW.agenda_document_id IS NOT NULL
  AND NEW.agenda_approved_at IS NOT NULL
  AND NOT private.agenda_approved_or_signed(NEW.agenda_document_id) THEN
  NEW.agenda_approved_at:=NULL;
  NEW.agenda_approved_by:=NULL;
 END IF;
 IF TG_OP='UPDATE' AND NEW.agenda_document_id IS DISTINCT FROM OLD.agenda_document_id THEN
  NEW.agenda_approved_at:=NULL;
  NEW.agenda_approved_by:=NULL;
 END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION private.open_government_agenda_vote_internal(p_session uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 IF d.id IS NULL OR NOT private.agenda_approved_or_signed(d.id) THEN RETURN NULL;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.game_members m WHERE m.game_id=s.game_id
  AND private.government_office_vote_weight(s.game_id,m.user_id)>0) OR EXISTS(
 SELECT 1 FROM public.game_members m WHERE m.game_id=s.game_id AND private.government_office_vote_weight(s.game_id,m.user_id)>0
 AND NOT EXISTS(SELECT 1 FROM public.institution_session_registrations r WHERE r.game_id=s.game_id AND r.stage_no=11
 AND r.institution_key='government' AND r.user_id=m.user_id AND r.government_session_id=s.id)) THEN RETURN NULL;END IF;
 IF EXISTS(SELECT 1 FROM public.government_program_agenda a WHERE a.session_id=s.id AND a.status IN ('presenting','decision')) THEN RETURN NULL;END IF;
 PERFORM set_config('app.vote_group','',true);
 INSERT INTO public.game_votes(game_id,stage_no,title,body,voting_mode,status,created_by,formal_document_id,formal_step_code,institution_key,procedure_key,
 quorum_kind,quorum_value,majority_kind,majority_value,allow_abstain,tie_breaker_chair,pass_transition,fail_transition)
 VALUES(s.game_id,11,'Утверждение повестки заседания Правительства',d.body_text,'member','open',case when private.is_game_teacher(s.game_id) then u else coalesce(s.chair_user_id,s.agenda_approved_by,u) end,
 d.id,'reference','government','government_agenda','fraction',0.5,'present_majority',0.5,false,false,'none','none') RETURNING id INTO v_id;
 UPDATE public.government_sessions SET agenda_vote_id=v_id WHERE id=s.id;
 RETURN v_id;
END;$function$;

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
  if v_session.id is null or v_session.agenda_approved_at is null or not private.agenda_approved_or_signed(v_session.agenda_document_id)
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
 update public.government_sessions set status='open',opened_at=now(),chair_user_id=case when private.is_game_teacher(s.game_id) then private.current_government_chair(s.game_id) else v_uid end where id=s.id;
 -- The Government session agenda is the ONE official agenda used by voting registration.
 insert into public.institution_meeting_records(
  game_id,stage_no,institution_key,agenda_document_id,agenda_body,
  agenda_prepared_by,agenda_approved_by,agenda_approved_at)
 select s.game_id,11,'government',d.id,d.body_text,v_uid,s.agenda_approved_by,s.agenda_approved_at
 from public.government_sessions gs
 join public.formal_documents d on d.id=gs.agenda_document_id and d.game_id=gs.game_id
 where gs.id=s.id and d.status_code='published' and length(btrim(d.body_text))>=30
 on conflict(game_id,stage_no,institution_key) do update
 set agenda_document_id=excluded.agenda_document_id, agenda_body=excluded.agenda_body,
  agenda_prepared_by=excluded.agenda_prepared_by,agenda_approved_by=excluded.agenda_approved_by,
  agenda_approved_at=excluded.agenda_approved_at,updated_at=now()
;
 -- The meeting-record trigger resets approval when the document changes. Reapply only after verified signature.
 update public.institution_meeting_records r set agenda_approved_by=s.agenda_approved_by,agenda_approved_at=s.agenda_approved_at,updated_at=now()
 where r.game_id=s.game_id and r.stage_no=11 and r.institution_key='government' and r.agenda_document_id=s.agenda_document_id;
 if not exists(select 1 from public.institution_meeting_records r
    join public.formal_documents d on d.id=r.agenda_document_id and d.game_id=r.game_id
    where r.game_id=s.game_id and r.stage_no=11 and r.institution_key='government'
    and r.agenda_document_id=s.agenda_document_id and r.agenda_approved_at is not null and d.status_code='published' and length(btrim(r.agenda_body))>=30) then
  raise exception 'Открытие заседания требует утверждённой повестки';end if;
end;$function$;

CREATE OR REPLACE FUNCTION public.create_government_session(p_game_id uuid, p_title text, p_time_limit_minutes integer DEFAULT 60)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_uid uuid:=(select auth.uid());v_no integer;v_id uuid;
begin
 if v_uid is null or not private.can_approve_government_agenda(p_game_id,v_uid) then raise exception 'Подготовить заседание может только Председатель Правительства'; end if;
 if exists(select 1 from public.government_sessions where game_id=p_game_id and status='open') then raise exception 'Close the active Government session first'; end if;
 select coalesce(max(session_no),0)+1 into v_no from public.government_sessions where game_id=p_game_id;
 insert into public.government_sessions(game_id,session_no,title,time_limit_minutes,chair_user_id,created_by)
 values(p_game_id,v_no,coalesce(nullif(trim(p_title),''),'Заседание Правительства №'||v_no),greatest(5,least(240,p_time_limit_minutes)),case when private.is_game_teacher(p_game_id) then private.current_government_chair(p_game_id) else v_uid end,v_uid)
 returning id into v_id;
 return v_id;
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
 IF v_pm IS NULL AND NOT private.is_game_teacher(p_game) THEN RETURN; END IF;

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
   VALUES(p_game,11,v_next_no,'Заседание Правительства Российской Федерации',60,'draft',v_pm,coalesce(v_pm,auth.uid()))
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

CREATE OR REPLACE FUNCTION public.correct_government_agenda_text(p_session_id uuid, p_body text, p_expected_body text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 UPDATE public.government_sessions SET agenda_approved_at=NULL,agenda_approved_by=NULL,agenda_vote_id=NULL,moderator_approval_hash=NULL,moderator_approved_by=NULL,moderator_approved_at=NULL WHERE id=s.id;
 PERFORM set_config('app.gos_government_agenda_session',s.id::text,true);
 UPDATE public.formal_documents SET body_text=b,status_code='draft',status_label='Повестка скорректирована — ожидает подписи',current_owner_key='government',updated_at=now() WHERE id=d.id;
 PERFORM set_config('app.gos_government_agenda_session','',true);
 UPDATE public.institution_meeting_records SET agenda_body=b,agenda_approved_at=NULL,agenda_approved_by=NULL,updated_at=now()
 WHERE game_id=s.game_id AND stage_no=11 AND institution_key='government' AND agenda_document_id=d.id;
 INSERT INTO public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,note)
 VALUES(d.id,d.game_id,u,'Скорректирован текст повестки',d.status_code,'draft','Предыдущая редакция сохранена; голосование '||coalesce(v.id::text,'ещё не проводилось'));
END;$function$;

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
 
 if not private.is_game_teacher(v.game_id)
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

 return private.finalize_procedural_vote(p_vote_id,case when private.is_game_teacher(v.game_id) and v.stage_no=11 and v.institution_key='government' and v.procedure_key in ('government_agenda','state_program') then concat_ws(' · ','Закрыто преподавателем: '||uid::text,nullif(btrim(p_note),'')) else p_note end);
end;$function$;

CREATE OR REPLACE FUNCTION private.government_agenda_adopted(p_session uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 SELECT EXISTS(SELECT 1 FROM public.government_sessions s
 JOIN public.game_votes v ON v.id=s.agenda_vote_id AND v.game_id=s.game_id
 JOIN public.formal_documents d ON d.id=s.agenda_document_id AND d.game_id=s.game_id
 WHERE s.id=p_session AND s.status='open' AND s.agenda_approved_at IS NOT NULL
 AND v.stage_no=11 AND v.institution_key='government' AND v.procedure_key='government_agenda'
 AND v.status='closed' AND v.result_code='passed' AND v.result_quorum_met
 AND v.formal_document_id=d.id AND v.body=d.body_text AND d.status_code='published' AND private.agenda_approved_or_signed(d.id));
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
 set current_step=3,status_code='published',status_label=case when private.is_game_teacher(p.game_id) then 'Удостоверен преподавателем и опубликован' else 'Подписан и опубликован' end,
     current_owner_key='system',updated_at=now()
 where id=v_doc.id;
 insert into public.formal_document_history(document_id,game_id,actor_id,action,
  from_status,to_status,from_owner,to_owner,note)
 values(v_doc.id,p.game_id,v_uid,case when private.is_game_teacher(p.game_id) then 'Удостоверено преподавателем после голосования' else 'Подписано Председателем Правительства после голосования' end,
  v_doc.status_code,'published',coalesce(v_doc.current_owner_key,'author'),'system',
  'Положительное решение Правительства зафиксировано в голосовании; программа удостоверена и опубликована.');
end
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
 'Всего: '||p.total_budget||' ₽',(case when private.is_game_teacher(p.game_id) then 'Удостоверил преподаватель: ' else 'Подписал Председатель Правительства: ' end)||coalesce(signer_name,'Уполномоченный участник'),
 case when private.is_game_teacher(p.game_id) then 'Программа принята голосованием Правительства и удостоверена преподавателем. Бюджетные ассигнования утверждаются бюджетной процедурой.' else 'Программа принята голосованием Правительства и подписана Председателем Правительства. Бюджетные ассигнования утверждаются бюджетной процедурой.' end);
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

CREATE OR REPLACE FUNCTION public.teacher_approve_government_agenda(p_session_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE s public.government_sessions%rowtype;d public.formal_documents%rowtype;u uuid:=auth.uid();
BEGIN
 SELECT * INTO s FROM public.government_sessions WHERE id=p_session_id FOR UPDATE;
 IF s.id IS NULL OR u IS NULL OR NOT private.is_game_teacher(s.game_id) OR private.is_game_observer(s.game_id)
 THEN RAISE EXCEPTION 'Административное утверждение доступно только преподавателю этой игры' USING ERRCODE='42501';END IF;
 IF s.stage_no<>11 OR s.status NOT IN ('draft','open') OR s.agenda_vote_id IS NOT NULL
 OR NOT EXISTS(SELECT 1 FROM public.game_stages st WHERE st.game_id=s.game_id AND st.stage_no=11 AND st.status='open')
 OR EXISTS(SELECT 1 FROM public.government_program_agenda a WHERE a.session_id=s.id AND a.status IN ('presenting','decision'))
 THEN RAISE EXCEPTION 'Утверждение доступно до голосования по действующей повестке открытого этапа 11';END IF;
 IF s.status='draft' AND EXISTS(SELECT 1 FROM public.government_sessions x WHERE x.game_id=s.game_id AND x.stage_no=11 AND x.status='open' AND x.id<>s.id)
 THEN RAISE EXCEPTION 'Сначала завершите текущее заседание';END IF;
 SELECT * INTO d FROM public.formal_documents WHERE id=s.agenda_document_id AND game_id=s.game_id AND doc_type='meeting_agenda'
 AND stage_no=11 AND metadata->>'document_kind'='government_session_agenda' AND metadata->>'government_session_id'=s.id::text FOR UPDATE;
 IF d.id IS NULL OR d.status_code NOT IN ('draft','published') OR length(btrim(coalesce(d.body_text,'')))<30 OR NOT EXISTS(SELECT 1 FROM public.government_program_agenda a WHERE a.session_id=s.id)
 THEN RAISE EXCEPTION 'Сначала подготовьте повестку с государственными программами';END IF;
 IF s.agenda_approved_at IS NOT NULL AND d.status_code='published' AND private.agenda_approved_or_signed(d.id) THEN RETURN;END IF;
 UPDATE public.government_sessions SET moderator_approval_hash=private.government_agenda_revision_hash(d),moderator_approved_by=u,moderator_approved_at=now() WHERE id=s.id;
 PERFORM set_config('app.gos_government_agenda_session',s.id::text,true);
 UPDATE public.formal_documents SET status_code='published',status_label='Утверждена преподавателем',current_owner_key='system',updated_at=now() WHERE id=d.id;
 PERFORM set_config('app.gos_government_agenda_session','',true);
 UPDATE public.government_sessions SET agenda_approved_by=u,agenda_approved_at=now() WHERE id=s.id;
 INSERT INTO public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
 VALUES(d.id,s.game_id,u,'Повестка административно утверждена преподавателем',d.status_code,'published',d.current_owner_key,'system','Личная подпись Председателя не имитируется. Голосование участников сохраняется.');
 IF s.status='draft' THEN
  PERFORM public.open_government_session(s.id);
 ELSE
  INSERT INTO public.institution_meeting_records(game_id,stage_no,institution_key,agenda_document_id,agenda_body,agenda_prepared_by,agenda_approved_by,agenda_approved_at)
  VALUES(s.game_id,11,'government',d.id,d.body_text,u,u,now())
  ON CONFLICT(game_id,stage_no,institution_key) DO UPDATE SET agenda_document_id=excluded.agenda_document_id,agenda_body=excluded.agenda_body,
   agenda_approved_by=excluded.agenda_approved_by,agenda_approved_at=excluded.agenda_approved_at,updated_at=now();
  UPDATE public.institution_meeting_records SET agenda_approved_by=u,agenda_approved_at=now(),updated_at=now() WHERE game_id=s.game_id AND stage_no=11 AND institution_key='government' AND agenda_document_id=d.id;
  PERFORM private.open_government_agenda_vote_internal(s.id);
 END IF;
END;$$;
REVOKE ALL ON FUNCTION public.teacher_approve_government_agenda(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.teacher_approve_government_agenda(uuid) TO authenticated;
