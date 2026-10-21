-- Government programme sessions generate their official agenda via the existing server function.
-- Permit ONLY this documented route, with transaction-local provenance and same-game identity.
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
 v_actor:=coalesce((select auth.uid()),s.created_by);
 select string_agg(format('%s. %s%s%s', q.rn, q.title,
    case when q.description='' then '' else E'\n   '||q.description end,
    E'\n   Доклад: '||q.minutes||' мин.'), E'\n\n' order by q.rn) into v_rows
 from (
   select row_number() over(order by src.sort_at,src.sort_id) as rn,src.title,src.description,src.minutes
   from (
      select q.created_at as sort_at,q.id as sort_id,q.title,q.description,q.duration_minutes as minutes
      from public.government_session_questions q where q.session_id=s.id
      union all
      select a.created_at,a.id,'Рассмотрение государственной программы «'||p.title||'»',
             'Ответственный исполнитель: '||p.responsible_ministry,a.report_minutes
      from public.government_program_agenda a
      join public.state_programs p on p.id=a.program_id
      where a.session_id=s.id and not exists(select 1 from public.government_session_questions q where q.program_agenda_id=a.id)
   ) src
 ) q;
 v_body:='ПОВЕСТКА ЗАСЕДАНИЯ ПРАВИТЕЛЬСТВА РОССИЙСКОЙ ФЕДЕРАЦИИ'
      ||E'\n\n'||s.title||E'\nЗаседание № '||s.session_no
      ||E'\nОбщий регламент: '||s.time_limit_minutes||' мин.'
      ||E'\nСтатус: '||case s.status when 'draft' then 'Проект' when 'open' then 'Утверждена' else 'Заседание завершено' end
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
     status_code=case when s.status='draft' then 'draft' else 'published' end,
     status_label=case s.status when 'draft' then 'Проект повестки' when 'open' then 'Утверждена' else 'Заседание завершено' end,
     current_owner_key=case when s.status='draft' then 'government' else 'system' end
   where id=v_doc and (body_text is distinct from v_body or status_label is distinct from
      case s.status when 'draft' then 'Проект повестки' when 'open' then 'Утверждена' else 'Заседание завершено' end);
 end if;
 perform set_config('app.gos_government_agenda_session','',true);
 return v_doc;
end;$function$
;
CREATE OR REPLACE FUNCTION private.guard_formal_document_kind_route()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE v_expected text;v_kind text;
BEGIN
 v_expected:=CASE NEW.doc_type
  WHEN 'fz_bill' THEN 'bill' WHEN 'fkz_bill' THEN 'bill'
  WHEN 'federal_budget' THEN 'budget'
  WHEN 'president_decree' THEN 'president_act'
  WHEN 'president_order' THEN 'president_act'
  WHEN 'government_resolution' THEN 'government_act'
  WHEN 'government_order' THEN 'government_act'
  WHEN 'state_program' THEN 'government_act'
  WHEN 'gd_resolution' THEN 'gd_resolution'
  WHEN 'sf_resolution' THEN 'sf_resolution'
  WHEN 'ministry_order' THEN 'ministry_act'
  WHEN 'municipal_act' THEN 'municipal_act'
  WHEN 'other' THEN 'generic'
  WHEN 'justice_response' THEN 'official_correspondence'
  WHEN 'party_certificate' THEN 'official_correspondence'
  ELSE NULL
 END;
 v_kind:=coalesce(NEW.metadata->>'document_kind','');
 IF v_expected IS NOT NULL AND NEW.workflow_key IS DISTINCT FROM v_expected THEN
  RAISE EXCEPTION 'Вид документа не соответствует установленному маршруту рассмотрения'
    USING ERRCODE='23514';
 END IF;
 -- Institution-generated agendas and minutes use the dedicated meeting RPC.
 IF NEW.doc_type IN ('meeting_agenda','minutes') THEN
  IF v_kind NOT IN ('institution_meeting_agenda','duma_session_agenda','institution_meeting_minutes','government_session_agenda')
    OR NEW.workflow_key NOT IN ('gd_resolution','government_act')
    OR (v_kind='government_session_agenda' AND NOT (
       NEW.doc_type='meeting_agenda' AND NEW.workflow_key='government_act'
       AND NEW.subject_key='government' AND NEW.stage_no=11
       AND NEW.metadata->>'government_session_id'=nullif(current_setting('app.gos_government_agenda_session',true),'')
       AND EXISTS (select 1 from public.government_sessions s
        where s.id=(NEW.metadata->>'government_session_id')::uuid and s.game_id=NEW.game_id)
    ))
  THEN
   RAISE EXCEPTION 'Документы заседания оформляются только установленной процедурой'
     USING ERRCODE='23514';
  END IF;
 END IF;
 -- The old technical type "bill" may appear in history but must not be
 -- used to introduce a NEW legislative document.
 IF NEW.workflow_key='bill' AND NEW.doc_type NOT IN ('fz_bill','fkz_bill') THEN
  IF NOT (TG_OP='UPDATE' AND OLD.doc_type='bill'
   AND NEW.doc_type='bill' AND NEW.metadata->>'purpose'='presidential_electoral_system') THEN
   RAISE EXCEPTION 'Законодательный маршрут доступен только для ФЗ и ФКЗ'
     USING ERRCODE='23514';
  END IF;
 END IF;
 IF TG_OP='UPDATE' AND OLD.status_code IN ('rejected','superseded','withdrawn')
   AND auth.uid() IS NOT NULL
   AND (NEW.status_code IS DISTINCT FROM OLD.status_code
     OR NEW.current_step IS DISTINCT FROM OLD.current_step
     OR NEW.current_owner_key IS DISTINCT FROM OLD.current_owner_key
     OR NEW.doc_type IS DISTINCT FROM OLD.doc_type
     OR NEW.workflow_key IS DISTINCT FROM OLD.workflow_key
     OR NEW.workflow_steps IS DISTINCT FROM OLD.workflow_steps)
 THEN
  RAISE EXCEPTION 'Отклонённый документ окончателен. Возобновление процедуры запрещено'
    USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END;$function$
;