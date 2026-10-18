-- ГОС.ID: enforce legal document kinds, terminal rejection and honest FZ enactment.
-- Based on live signatures after PR #277. No fictional presidential signatures.
CREATE OR REPLACE FUNCTION public.create_formal_document(p_game_id uuid, p_stage_no integer, p_title text, p_doc_type text, p_subject_key text, p_subject_label text, p_body_text text, p_file_path text, p_file_name text, p_mime text, p_workflow_key text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
 v_id uuid:=gen_random_uuid();v_uid uuid:=(select auth.uid());v_steps jsonb;
 v_prefix text;v_no bigint;v_registry text;
begin
 if v_uid is null or not private.is_game_member(p_game_id) then raise exception 'Game access required';end if;
 if not private.can_create_formal_subject(p_game_id,v_uid,p_subject_key) then raise exception 'Your game role cannot create a document for this subject';end if;
 if length(trim(coalesce(p_title,'')))<3 then raise exception 'Document title is required';end if;

 -- A document's legal route is determined by its kind, never by a client-supplied workflow.
 IF p_workflow_key IS DISTINCT FROM (
  CASE p_doc_type
   WHEN 'fz_bill' THEN 'bill' WHEN 'fkz_bill' THEN 'bill'
   WHEN 'federal_budget' THEN 'budget'
   WHEN 'president_decree' THEN 'president_act' WHEN 'president_order' THEN 'president_act'
   WHEN 'government_resolution' THEN 'government_act' WHEN 'government_order' THEN 'government_act'
   WHEN 'state_program' THEN 'government_act'
   WHEN 'gd_resolution' THEN 'gd_resolution' WHEN 'sf_resolution' THEN 'sf_resolution'
   WHEN 'ministry_order' THEN 'ministry_act'
   WHEN 'municipal_act' THEN 'municipal_act'
   WHEN 'other' THEN 'generic'
   ELSE NULL
  END
 ) THEN
  RAISE EXCEPTION 'Вид документа не соответствует правовой процедуре' USING ERRCODE='23514';
 END IF;
 v_steps:=private.formal_workflow(p_workflow_key);
 v_prefix:=case p_doc_type
  when 'fz_bill' then 'ЗП-ФЗ' when 'fkz_bill' then 'ЗП-ФКЗ'
  when 'federal_budget' then 'ФБ'
  when 'president_decree' then 'УК' when 'president_order' then 'РП'
  when 'government_resolution' then 'ПП' when 'government_order' then 'РПР'
  when 'gd_resolution' then 'ПГД' when 'sf_resolution' then 'ПСФ'
  when 'ministry_order' then 'ПР' when 'state_program' then 'ГП'
  when 'municipal_act' then 'МСУ' else 'НПА' end;
 v_no:=nextval('public.formal_registry_seq');
 v_registry:='ГОС.ID-'||v_prefix||'-'||lpad(v_no::text,4,'0');
 insert into public.formal_documents(
  id,game_id,stage_no,registry_no,title,doc_type,subject_key,subject_label,author_id,
  body_text,source_file_path,source_file_name,source_mime_type,workflow_key,workflow_steps,
  current_step,status_code,status_label,current_owner_key,metadata
 ) values(
  v_id,p_game_id,p_stage_no,v_registry,trim(p_title),p_doc_type,p_subject_key,p_subject_label,v_uid,
  nullif(p_body_text,''),p_file_path,p_file_name,p_mime,p_workflow_key,v_steps,
  0,v_steps->0->>'code',v_steps->0->>'label',v_steps->0->>'owner',coalesce(p_metadata,'{}'::jsonb)
 );
 insert into public.formal_document_history(document_id,game_id,actor_id,action,to_status,to_owner,note)
 values(v_id,p_game_id,v_uid,'Создан документ',v_steps->0->>'code',v_steps->0->>'owner','Черновик создан в системе');
 return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.advance_formal_document(p_document_id uuid, p_action text DEFAULT 'advance'::text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
 d public.formal_documents%rowtype;
 v_uid uuid:=(select auth.uid());
 v_next integer;
 v_step jsonb;
 v_from_status text;
 v_from_owner text;
 v_ready jsonb;
begin
 if p_action not in ('advance','return','reject') then raise exception 'Неизвестное действие';end if;
 select * into d from public.formal_documents where id=p_document_id for update;
 if d.id is null then raise exception 'Document not found'; end if;
 if d.status_code in ('rejected','superseded','withdrawn') then raise exception 'Документ отклонён или прекращён. Продолжение процедуры недоступно' using errcode='42501'; end if;
 if d.doc_type in ('meeting_agenda','minutes') and d.metadata->>'document_kind' in ('institution_meeting_agenda','duma_session_agenda','institution_meeting_minutes') then raise exception 'Повестка или протокол утверждается в разделе заседания, а не через маршрут постановления' using errcode='42501';end if;
 if v_uid is null or not private.is_game_member(d.game_id) then raise exception 'Game access required'; end if;
 if not private.matches_formal_owner(d.game_id,v_uid,d.current_owner_key,d.author_id) then raise exception 'Current stage belongs to another institution'; end if;

 v_from_status:=d.status_code; v_from_owner:=d.current_owner_key;

 if p_action='return' then
  if d.workflow_key='budget' and d.status_code in ('budget_committee','budget_council') then
   v_next:=1;
   update public.formal_documents
   set current_step=v_next,status_code='revision',
       status_label='Возвращён Правительству на доработку',
       current_owner_key='government',updated_at=now()
   where id=d.id;
   insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
   values(d.id,d.game_id,v_uid,'Проект бюджета возвращён Правительству на доработку',v_from_status,'revision',v_from_owner,'government',p_note);
  else
   v_next:=0;v_step:=d.workflow_steps->v_next;
   update public.formal_documents set current_step=v_next,status_code='revision',status_label='Возвращён на доработку',current_owner_key='author',updated_at=now() where id=d.id;
   insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
   values(d.id,d.game_id,v_uid,'Возвращён на доработку',v_from_status,'revision',v_from_owner,'author',p_note);
  end if;
 elsif p_action='reject' then
  update public.formal_documents set status_code='rejected',status_label='Отклонён',current_owner_key='system',updated_at=now() where id=d.id;
  insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
  values(d.id,d.game_id,v_uid,'Отклонён',v_from_status,'rejected',v_from_owner,'system',p_note);
 else
  if d.workflow_key='bill' AND d.doc_type NOT IN ('fz_bill','fkz_bill')
     AND NOT (d.doc_type='bill' AND d.metadata->>'purpose'='presidential_electoral_system')
  THEN RAISE EXCEPTION 'Полная законодательная процедура предусмотрена только для ФЗ и ФКЗ' USING ERRCODE='42501'; END IF;
  if d.current_owner_key='president'
    and d.workflow_key in ('bill','budget','president_act')
    and not exists(
      select 1 from public.game_profiles gp where gp.game_id=d.game_id
       and gp.user_id=v_uid and nullif(gp.signature_path,'') is not null
    )
  then raise exception 'Президенту необходимо загрузить личную подпись в профиль перед подписанием' using errcode='23514';end if;
  if private.formal_vote_required(d) then raise exception 'Эта стадия завершается результатом голосования';end if;
  if exists(select 1 from public.game_votes where formal_document_id=d.id and status='open') then raise exception 'Сначала завершите открытое голосование';end if;
  if d.workflow_key='bill' and d.status_code in ('draft','revision') then
   v_ready:=private.bill_dossier_readiness_json(d.id);
   if not coalesce((v_ready->>'submission_ready')::boolean,false)
   then raise exception 'Bill submission package is incomplete: %',array_to_string(array(select jsonb_array_elements_text(v_ready->'issues')),'; '); end if;
  end if;
  if d.workflow_key='bill' and d.status_code='committee' then
   v_ready:=private.bill_dossier_readiness_json(d.id);
   if not coalesce((v_ready->>'committee_ready')::boolean,false)
   then raise exception 'Committee review is incomplete: %',array_to_string(array(select jsonb_array_elements_text(v_ready->'review_issues')),'; '); end if;
  end if;
  if d.workflow_key='budget' and d.status_code='budget_committee'
     and not private.budget_preliminary_ready(d.id)
  then raise exception 'Complete the Budget Committee preliminary review before sending the project to the State Duma Council'; end if;

  v_next:=d.current_step+1;
  if v_next>=jsonb_array_length(d.workflow_steps) then raise exception 'Workflow already completed'; end if;
  v_step:=d.workflow_steps->v_next;
  update public.formal_documents
  set current_step=v_next,status_code=v_step->>'code',status_label=v_step->>'label',
      current_owner_key=v_step->>'owner',updated_at=now()
  where id=d.id;
  insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
  values(d.id,d.game_id,v_uid,coalesce(d.workflow_steps->d.current_step->>'action','Передан далее'),v_from_status,v_step->>'code',v_from_owner,v_step->>'owner',p_note);
 end if;
end;$function$;

CREATE OR REPLACE FUNCTION public.get_formal_document_tools(p_document_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare d public.formal_documents%rowtype;u uuid:=auth.uid();manage boolean;open_vote boolean;editable boolean;signable boolean;next_step jsonb;
begin
 select * into d from public.formal_documents where id=p_document_id;
 if d.id is null or not private.is_game_member(d.game_id) then raise exception 'Документ недоступен';end if;
 manage:=d.status_code NOT IN ('rejected','superseded','withdrawn') AND private.matches_formal_owner(d.game_id,u,d.current_owner_key,d.author_id);
 open_vote:=exists(select 1 from public.game_votes where formal_document_id=d.id and status='open');
 editable:=not open_vote and (private.is_game_teacher(d.game_id) or (manage and d.current_owner_key<>'system' and d.status_code not in ('signed','published','adopted','rejected')));
 next_step:=CASE WHEN d.status_code IN ('rejected','superseded','withdrawn') THEN NULL ELSE d.workflow_steps->(d.current_step+1) END;
 signable:=d.status_code NOT IN ('rejected','superseded','withdrawn') and not open_vote and not private.formal_vote_required(d) and
 ((manage and coalesce(d.workflow_steps->d.current_step->>'action','') ilike '%подпис%')
 or ((d.metadata->>'signed_by'=u::text)
 and d.status_code in ('signed','published','adopted') and d.metadata ? 'revision_changed_at'
 and (not (d.metadata ? 'signed_on') or (d.metadata->>'revision_changed_at')::timestamptz>(d.metadata->>'signed_on')::timestamptz)));
 return jsonb_build_object('can_edit',editable,'can_manage',manage,'can_sign',signable,
 'can_copy',exists(select 1 from public.game_members where game_id=d.game_id and user_id=u and kind<>'observer'),
 'vote_required',private.formal_vote_required(d),'open_vote',open_vote,'next_owner',next_step->>'owner','next_action',CASE WHEN d.status_code IN ('rejected','superseded','withdrawn') THEN NULL ELSE d.workflow_steps->d.current_step->>'action' END);
end;$function$;

CREATE OR REPLACE FUNCTION private.apply_formal_vote_transition(p_document uuid, p_transition text, p_actor uuid, p_vote uuid, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
 d public.formal_documents%rowtype;
 v_step jsonb;
 v_next integer;
 v_action text;
begin
 if p_document is null or p_transition='none' then return; end if;
 select * into d from public.formal_documents where id=p_document for update;
 if d.id is null then return; end if;
 if d.status_code IN ('rejected','superseded','withdrawn','published') THEN RETURN; END IF;
 if not exists(select 1 from public.game_votes where id=p_vote and formal_document_id=d.id and formal_step_code=d.status_code) then
  update public.game_votes set decision_note=concat_ws(' · ',decision_note,'Стадия документа изменилась; результат сохранён без перехода') where id=p_vote;
  return;
 end if;

 if p_transition='advance' then
   if d.workflow_key='bill' and d.status_code='reading3' then
     v_next:=d.current_step+2;
     v_step:=d.workflow_steps->v_next;
     update public.formal_documents
       set current_step=v_next,status_code=v_step->>'code',status_label=v_step->>'label',
           current_owner_key=v_step->>'owner',updated_at=now()
     where id=d.id;
     v_action:='Закон принят ГД; Совет Федерации автоматически одобрил его по правилам игры; направлен Президенту';
   else
     v_next:=d.current_step+1;
     if v_next>=jsonb_array_length(d.workflow_steps) then return; end if;
     v_step:=d.workflow_steps->v_next;
     update public.formal_documents
       set current_step=v_next,status_code=v_step->>'code',status_label=v_step->>'label',
           current_owner_key=v_step->>'owner',updated_at=now()
     where id=d.id;
     v_action:='Документ продвинут по результатам голосования';
   end if;
 elsif p_transition='reject' then
   update public.formal_documents
     set status_code='rejected',status_label='Отклонён голосованием',current_owner_key='system',updated_at=now()
   where id=d.id;
   v_action:='Документ отклонён голосованием';
 elsif p_transition='return_author' then
   v_step:=d.workflow_steps->0;
   update public.formal_documents
     set current_step=0,status_code='revision',status_label='Возвращён автору по результатам голосования',
         current_owner_key='author',updated_at=now()
   where id=d.id;
   v_action:='Документ возвращён автору по результатам голосования';
 elsif p_transition='return_previous' then
   v_next:=greatest(0,d.current_step-1);
   v_step:=d.workflow_steps->v_next;
   update public.formal_documents
     set current_step=v_next,status_code='revision',status_label='Возвращён на предыдущую стадию',
         current_owner_key=v_step->>'owner',updated_at=now()
   where id=d.id;
   v_action:='Документ возвращён на предыдущую стадию по результатам голосования';
 else
   return;
 end if;

 insert into public.formal_document_history(
  document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note
 )
 select d.id,d.game_id,p_actor,v_action,d.status_code,fd.status_code,
        d.current_owner_key,fd.current_owner_key,
        'Голосование '||p_vote::text||coalesce(' · '||nullif(p_note,''),'')
 from public.formal_documents fd where fd.id=d.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.propose_presidential_system(p_game_id uuid, p_system_type text, p_threshold_pct numeric DEFAULT NULL::numeric, p_rationale text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
 v_uid uuid:=(select auth.uid());
 v_id uuid:=gen_random_uuid();
 v_doc uuid:=gen_random_uuid();
 v_vote uuid:=gen_random_uuid();
 v_steps jsonb;
 v_no bigint;
 v_registry text;
 v_label text;
 v_body text;
 v_session uuid;
 v_agenda uuid;
 v_session_no integer;
begin
 if v_uid is null or not private.is_game_member(p_game_id) then raise exception 'Game access required'; end if;
 if private.party_led_by(p_game_id,v_uid) is null and not private.is_game_teacher(p_game_id)
 then raise exception 'Faction leader / teacher access required'; end if;
 if p_system_type not in ('relative','absolute','qualified','preferential') then raise exception 'Unsupported presidential electoral system'; end if;
 if p_system_type='qualified' and (p_threshold_pct is null or p_threshold_pct<=50 or p_threshold_pct>100)
 then raise exception 'Qualified majority requires a threshold above 50 and at most 100'; end if;

 -- One game-wide transaction lock keeps session/agenda numbers unique for 40 simultaneous proposals.
 PERFORM pg_advisory_xact_lock(hashtextextended('presidential-system-proposal:'||p_game_id::text,0));
 v_label:=case p_system_type
   when 'relative' then 'относительного большинства'
   when 'absolute' then 'абсолютного большинства'
   when 'qualified' then 'квалифицированного большинства ('||p_threshold_pct||'%)'
   else 'преференциального большинства'
 end;
 v_body:='Проектом предлагается внести изменение в Федеральный закон от 10.01.2003 № 19-ФЗ «О выборах Президента Российской Федерации» и установить для определения результатов выборов Президента Российской Федерации мажоритарную систему '||v_label||'.'
   ||case when nullif(trim(coalesce(p_rationale,'')),'') is not null then E'\n\nОбоснование субъекта инициативы: '||trim(p_rationale) else '' end;

 insert into public.presidential_system_proposals(
   id,game_id,system_type,threshold_pct,rationale,proposed_by,status
 )
 values(
   v_id,p_game_id,p_system_type,
   case when p_system_type='absolute' then 50 when p_system_type='qualified' then p_threshold_pct else null end,
   nullif(trim(coalesce(p_rationale,'')),''),v_uid,'draft'
 );

 -- Законопроект сразу появляется в общем реестре НПА.
 v_steps:=private.formal_workflow('bill');
 v_no:=nextval('public.formal_registry_seq');
 v_registry:='ГОС.ID-ЗП-ФЗ-'||lpad(v_no::text,4,'0');
 insert into public.formal_documents(
   id,game_id,stage_no,registry_no,title,doc_type,subject_key,subject_label,author_id,
   body_text,workflow_key,workflow_steps,current_step,status_code,status_label,current_owner_key,metadata
 )
 values(
   v_doc,p_game_id,6,v_registry,
   'О внесении изменения в Федеральный закон № 19-ФЗ «О выборах Президента Российской Федерации»',
   'fz_bill','gd','Государственная Дума Федерального Собрания Российской Федерации',v_uid,
   v_body,'bill',v_steps,0,'draft','Черновик','author',
   jsonb_build_object(
     'purpose','presidential_electoral_system',
     'proposal_id',v_id,
     'system_type',p_system_type,
     'threshold_pct',case when p_system_type='absolute' then 50 when p_system_type='qualified' then p_threshold_pct else null end
   )
 );
 insert into public.formal_document_history(document_id,game_id,actor_id,action,to_status,to_owner,note)
 values(v_doc,p_game_id,v_uid,'Создан проект поправки к ФЗ № 19-ФЗ','draft','author','Автоматически создан из формы 6-го этапа');

 -- Все проекты этого этапа собираются в одно заседание ГД.
 select id into v_session
 from public.duma_sessions
 where game_id=p_game_id and stage_no=6 and status='open'
 order by opened_at desc nulls last limit 1;

 if v_session is null then
   select id into v_session
   from public.duma_sessions
   where game_id=p_game_id and stage_no=6 and status='draft'
   order by created_at desc limit 1;
 end if;

 if v_session is null then
   select coalesce(max(session_no),0)+1 into v_session_no from public.duma_sessions where game_id=p_game_id;
   insert into public.duma_sessions(game_id,stage_no,session_no,title,status,chair_user_id,created_by,opened_at)
   values(p_game_id,6,v_session_no,'Заседание Государственной Думы · поправки к ФЗ № 19-ФЗ','open',null,v_uid,now())
   returning id into v_session;
 else
   update public.duma_sessions
   set status='open',opened_at=coalesce(opened_at,now())
   where id=v_session and status='draft';
 end if;

 insert into public.duma_agenda_items(session_id,game_id,formal_document_id,agenda_no,status,started_at)
 values(
   v_session,p_game_id,v_doc,
   coalesce((select max(agenda_no) from public.duma_agenda_items where session_id=v_session),0)+1,
   'in_progress',now()
 )
 returning id into v_agenda;

 -- A dedicated transaction-local scope prevents direct forged presidential voting inserts.
 PERFORM set_config('app.gos_presidential_vote_scope',v_doc::text,true);
 -- Связанный проект голосования создаётся автоматически.
 insert into public.game_votes(
   id,game_id,stage_no,title,body,voting_mode,status,created_by,
   institution_key,procedure_key,quorum_kind,quorum_value,
   majority_kind,majority_value,allow_abstain,tie_breaker_chair,
   pass_transition,fail_transition,formal_document_id
 )
 values(
   v_vote,p_game_id,6,
   'ГД ФС РФ · поправка к ФЗ № 19-ФЗ · система выборов Президента РФ',
   'Государственная Дума рассматривает проект поправки к Федеральному закону № 19-ФЗ. Предлагается система '||v_label||coalesce('. Обоснование: '||nullif(trim(coalesce(p_rationale,'')),''),''),
   'mandate','open',v_uid,
   'gd','presidential_system','fraction',0.5,
   'present_majority',0.5,true,false,
   'none','none',v_doc
 );

 PERFORM set_config('app.gos_presidential_vote_scope','',true);

 update public.presidential_system_proposals
 set status='vote_open',
     registered_at=now(),
     registered_by=v_uid,
     bill_document_id=v_doc,
     vote_id=v_vote,
     session_id=v_session,
     agenda_item_id=v_agenda,
     updated_at=now()
 where id=v_id;

 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(
   p_game_id,6,'Государственная Дума','notice',
   'Создан проект поправки и связанное голосование',
   'Проект поправки к ФЗ № 19-ФЗ автоматически добавлен в реестр НПА и связан с голосованием Государственной Думы.',
   v_uid
 );

 return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION private.presidential_system_vote_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
 p public.presidential_system_proposals%rowtype;
 v_doc uuid:=gen_random_uuid();
 v_steps jsonb;
 v_no bigint;
 v_registry text;
 v_label text;
 v_body text;
 v_result text;
begin
 if new.status='closed' and old.status is distinct from new.status and new.procedure_key='presidential_system' then
  select * into p from public.presidential_system_proposals where vote_id=new.id for update;
  if p.id is not null then
   v_label:=case p.system_type
    when 'relative' then 'относительного большинства'
    when 'absolute' then 'абсолютного большинства'
    when 'qualified' then 'квалифицированного большинства ('||p.threshold_pct||'%)'
    else 'преференциального большинства'
   end;

   if new.result_code='passed' then
    update public.presidential_system_proposals set status='adopted',updated_at=now() where id=p.id;

    insert into public.presidential_election_settings(game_id,system_type,threshold_pct,poll_enabled,status,updated_by)
    values(new.game_id,p.system_type,coalesce(p.threshold_pct,50),true,'setup',new.created_by)
    on conflict(game_id) do update
      set system_type=excluded.system_type,
          threshold_pct=excluded.threshold_pct,
          status=case when presidential_election_settings.status='finished' then 'setup' else presidential_election_settings.status end,
          result='{}'::jsonb,
          updated_at=now(),
          updated_by=new.created_by;

    v_result:='одобрить проект поправки о системе '||v_label||' для выборов Президента Российской Федерации и направить его в Совет Федерации';

    -- GD adopted the proposal's model; this is NOT enactment of federal law.
    -- The FZ still requires the Council and the future President.
    update public.formal_documents
       set current_step=8,
           status_code='sf',
           status_label='Одобрен Государственной Думой. Ожидает рассмотрения Советом Федерации',
           current_owner_key='sf',
           metadata=coalesce(metadata,'{}'::jsonb)
             ||jsonb_build_object('model_selected_for_elections',true,'law_entered_into_force',false),
           updated_at=now()
     where id=p.bill_document_id
       and workflow_key='bill' and metadata->>'purpose'='presidential_electoral_system';
   else
    update public.presidential_system_proposals set status='rejected',updated_at=now() where id=p.id;
    v_result:='отклонить проект поправки к Федеральному закону № 19-ФЗ о введении системы '||v_label;

    update public.formal_documents
       set status_code='rejected',
           status_label='Отклонён Государственной Думой',
           current_owner_key='system',
           updated_at=now()
     where id=p.bill_document_id;
   end if;

   v_body:='Государственная Дума Федерального Собрания Российской Федерации по итогам рассмотрения вопроса на заседании постановляет: '||v_result||'. '
     ||'Результат голосования зафиксирован в системе ГОС.ID: '||coalesce(new.result_label,new.result_code,'результат закрыт')||'.';

   v_steps:=private.formal_workflow('gd_resolution');
   v_no:=nextval('public.formal_registry_seq');
   v_registry:='ГОС.ID-ПГД-'||lpad(v_no::text,4,'0');

   insert into public.formal_documents(
     id,game_id,stage_no,registry_no,title,doc_type,subject_key,subject_label,author_id,
     body_text,workflow_key,workflow_steps,current_step,status_code,status_label,current_owner_key,metadata
   )
   values(
     v_doc,p.game_id,6,v_registry,
     case when new.result_code='passed'
       then 'Об одобрении проекта поправки к Федеральному закону № 19-ФЗ о системе выборов Президента Российской Федерации'
       else 'Об отклонении проекта поправки к Федеральному закону № 19-ФЗ о системе выборов Президента Российской Федерации'
     end,
     'gd_resolution','gd','Государственная Дума Федерального Собрания Российской Федерации',new.created_by,
     v_body,'gd_resolution',v_steps,3,'published','Оформлено','system',
     jsonb_build_object(
       'purpose','presidential_electoral_system_result',
       'proposal_id',p.id,
       'vote_id',new.id,
       'result_code',new.result_code,
       'system_type',p.system_type
     )
   );

   insert into public.formal_document_history(document_id,game_id,actor_id,action,to_status,to_owner,note)
   values(v_doc,p.game_id,new.created_by,'Постановление оформлено по итогам голосования ГД','published','system','Автоматически сформировано после закрытия связанного голосования');

   update public.presidential_system_proposals set resolution_document_id=v_doc,updated_at=now() where id=p.id;
   update public.duma_agenda_items set status='completed',completed_at=now(),result_note=v_result where id=p.agenda_item_id;

   if not exists(
     select 1 from public.game_votes
     where game_id=p.game_id and stage_no=6 and status='open'
       and procedure_key='presidential_system' and id<>new.id
   ) then
     update public.duma_sessions set status='closed',closed_at=now() where id=p.session_id and status='open';
   end if;
  end if;
 end if;
 return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.institution_document_signers(p_document uuid)
 RETURNS TABLE(user_id uuid, office text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE d public.formal_documents%rowtype;v_signer uuid;
BEGIN
 SELECT * INTO d FROM public.formal_documents WHERE id=p_document;
 IF d.id IS NULL OR d.status_code NOT IN ('published','adopted','signed') THEN RETURN; END IF;
 IF d.subject_key='ksrf' THEN
  RETURN QUERY SELECT DISTINCT p.leader_user_id,
    'Председатель фракции «'||p.name||'» (КСРФ)'::text
  FROM public.game_parties p
  JOIN public.game_members gm ON gm.game_id=p.game_id AND gm.user_id=p.leader_user_id
  WHERE p.game_id=d.game_id AND p.registration_status='registered'
    AND gm.kind='student' AND gm.roster_archived_at IS NULL
  ORDER BY 1,2;
 ELSIF d.subject_key='gd' AND d.doc_type NOT IN ('fz_bill','fkz_bill','bill','federal_budget') THEN
  -- A signed GD act has exactly one authentic signatory. A later attendance
  -- change cannot replace the signature already attached to the act.
  SELECT s.signer_id INTO v_signer FROM public.formal_document_signatures s
   WHERE s.document_id=d.id
    AND s.signed_at>=coalesce(nullif(d.metadata->>'revision_changed_at','')::timestamptz,'-infinity'::timestamptz)
   ORDER BY s.signed_at,s.id LIMIT 1;
  IF v_signer IS NULL THEN v_signer:=private.gd_presiding_officer(d.game_id,d.stage_no); END IF;
  IF v_signer IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT v_signer,
   CASE WHEN EXISTS(SELECT 1 FROM public.game_office_assignments a
    WHERE a.game_id=d.game_id AND a.user_id=v_signer
      AND lower(btrim(a.role_title))='председатель государственной думы')
   THEN 'Председатель Государственной Думы Федерального Собрания Российской Федерации'::text
   ELSE 'Исполняющий обязанности Председателя Государственной Думы Федерального Собрания Российской Федерации'::text END;
 END IF;
END;$function$;

-- Existing two Presidential amendment bills: normalize the type without changing
-- their registry identifiers, texts, vote linkage, dates or history.
UPDATE public.formal_documents d
SET doc_type='fz_bill'
WHERE d.doc_type='bill' AND d.workflow_key='bill'
 AND d.metadata->>'purpose'='presidential_electoral_system'
 AND EXISTS(SELECT 1 FROM public.presidential_system_proposals p
   WHERE p.bill_document_id=d.id AND p.game_id=d.game_id);

-- Only the historically auto-published GD-adopted amendment that was never
-- signed by an actual President is returned to the next REAL institutional step.
UPDATE public.formal_documents d SET
 current_step=8, status_code='sf',
 status_label='Одобрен Государственной Думой. Ожидает рассмотрения Советом Федерации',
 current_owner_key='sf',
 metadata=coalesce(d.metadata,'{}'::jsonb)
   ||jsonb_build_object('model_selected_for_elections',true,'law_entered_into_force',false),
 updated_at=clock_timestamp()
WHERE d.doc_type='fz_bill' AND d.workflow_key='bill'
 AND d.metadata->>'purpose'='presidential_electoral_system'
 AND d.status_code='published'
 AND d.current_step=jsonb_array_length(d.workflow_steps)-1
 AND NOT EXISTS(SELECT 1 FROM public.formal_document_signatures s WHERE s.document_id=d.id)
 AND EXISTS(SELECT 1 FROM public.presidential_system_proposals p
  WHERE p.bill_document_id=d.id AND p.game_id=d.game_id AND p.status='adopted');

-- Preserve the rejected document's factual status. No invented signature or
-- vote is added and no global rewriting of historical registered acts takes place.
