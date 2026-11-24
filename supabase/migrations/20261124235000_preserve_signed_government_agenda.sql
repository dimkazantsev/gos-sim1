-- Never regenerate a signed Government agenda when a session opens or closes.
CREATE OR REPLACE FUNCTION private.refresh_government_agenda_document(p_session uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare s public.government_sessions%rowtype; v_doc uuid;v_registry text;v_steps jsonb;v_body text;v_rows text;v_actor uuid;
begin
 perform set_config('app.gos_government_agenda_session',p_session::text,true);
 select * into s from public.government_sessions where id=p_session;
 if s.id is null then return null; end if;
 -- The signed text is immutable. The session's current status is rendered separately.
 IF s.agenda_document_id IS NOT NULL AND (s.status<>'draft' OR s.agenda_approved_at IS NOT NULL) THEN
  PERFORM set_config('app.gos_government_agenda_session','',true);
  RETURN s.agenda_document_id;
 END IF;
 v_actor:=coalesce((select auth.uid()),s.created_by);
 select string_agg(format('%s. %s%s%s', q.rn, q.title,
    case when q.description='' then '' else E'\n   '||q.description end,
    E'\n   Доклад: '||q.minutes||' мин.'), E'\n\n' order by q.rn) into v_rows
 from (
   select row_number() over(order by src.sort_at,src.agenda_order,src.sort_id) as rn,src.title,src.description,src.minutes
   from (
      select q.created_at as sort_at,0::integer as agenda_order,q.id as sort_id,q.title,q.description,q.duration_minutes as minutes
      from public.government_session_questions q where q.session_id=s.id
      union all
      select a.created_at,a.agenda_no,a.id,'Рассмотрение государственной программы '||case when left(btrim(p.title),1)='«' and right(btrim(p.title),1)='»' then btrim(p.title) else '«'||p.title||'»' end,
             'Ответственный исполнитель: '||p.responsible_ministry,a.report_minutes
      from public.government_program_agenda a
      join public.state_programs p on p.id=a.program_id
      where a.session_id=s.id and not exists(select 1 from public.government_session_questions q where q.program_agenda_id=a.id)
   ) src
 ) q;
 v_body:='ПОВЕСТКА ЗАСЕДАНИЯ ПРАВИТЕЛЬСТВА РОССИЙСКОЙ ФЕДЕРАЦИИ'
      ||E'\n\n'||s.title||E'\nЗаседание № '||s.session_no
      ||E'\nОбщий регламент: '||s.time_limit_minutes||' мин.'
      ||E'\nСтатус: '||case when s.status='draft' and s.agenda_approved_at is null then 'Проект' when s.status='closed' then 'Заседание завершено' else 'Утверждена' end
      ||E'\n\nВОПРОСЫ ПОВЕСТКИ\n\n'||coalesce(v_rows,'Вопросы повестки пока не внесены.');
 v_doc:=s.agenda_document_id;
 if v_doc is null then
   v_doc:=gen_random_uuid();
   v_registry:='ГОС.ID-ПОВ-'||lpad(nextval('public.formal_registry_seq')::text,4,'0');
   v_steps:=private.formal_workflow('government_act');
   insert into public.formal_documents(
     id,game_id,stage_no,registry_no,title,doc_type,subject_key,subject_label,author_id,
     body_text,workflow_key,workflow_steps,current_step,status_code,status_label,current_owner_key,metadata
   ) values(
     v_doc,s.game_id,11,v_registry,'Повестка заседания Правительства № '||s.session_no,
     'meeting_agenda','government','Правительство Российской Федерации',s.created_by,
     v_body,'government_act',v_steps,0,'draft','Проект повестки','government',
     jsonb_build_object('document_kind','government_session_agenda','government_session_id',s.id,'auto_generated',true)
   );
   update public.government_sessions set agenda_document_id=v_doc where id=s.id;
   insert into public.formal_document_history(document_id,game_id,actor_id,action,to_status,to_owner,note)
     values(v_doc,s.game_id,v_actor,'Создан проект повестки','draft','government','Связан с заседанием Правительства № '||s.session_no);
 else
   update public.formal_documents set body_text=v_body,updated_at=now(),
     status_code=case when s.status='draft' and s.agenda_approved_at is null then 'draft' else 'published' end,
     status_label=case when s.status='draft' and s.agenda_approved_at is null then 'Проект повестки' when s.status='closed' then 'Заседание завершено' else 'Утверждена Председателем Правительства' end,
     current_owner_key=case when s.status='draft' and s.agenda_approved_at is null then 'government' else 'system' end
   where id=v_doc and (body_text is distinct from v_body or status_label is distinct from
      case when s.status='draft' and s.agenda_approved_at is null then 'Проект повестки' when s.status='closed' then 'Заседание завершено' else 'Утверждена Председателем Правительства' end);
 end if;
 perform set_config('app.gos_government_agenda_session','',true);
 return v_doc;
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
  UPDATE public.government_sessions SET agenda_approved_at=coalesce(agenda_approved_at,now())
   WHERE agenda_document_id=d.id AND status='draft';
 ELSE
  UPDATE public.institution_meeting_records SET updated_at=now() WHERE agenda_document_id=d.id;
 END IF;
END $function$;
