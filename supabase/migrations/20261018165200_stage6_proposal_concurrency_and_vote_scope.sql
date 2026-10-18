-- ГОС.ID: защита президентских голосований от обхода RPC и коллизий в условиях 40 участников.
-- Серверные правила обычных чтений законопроектов не изменены.
CREATE OR REPLACE FUNCTION private.guard_bill_session_ballot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE v_doc public.formal_documents%rowtype;
BEGIN
 IF NEW.formal_document_id IS NULL OR NEW.status<>'open' THEN RETURN NEW; END IF;
 SELECT * INTO v_doc FROM public.formal_documents WHERE id=NEW.formal_document_id;
 IF v_doc.id IS NULL OR v_doc.workflow_key<>'bill' THEN RETURN NEW; END IF;
 IF NEW.procedure_key='presidential_system' THEN
   IF NEW.stage_no<>6 OR NEW.institution_key<>'gd'
      OR NEW.formal_step_code IS NOT NULL
      OR current_setting('app.gos_presidential_vote_scope',true) IS DISTINCT FROM v_doc.id::text
      OR NEW.created_by IS DISTINCT FROM v_doc.author_id
      OR v_doc.game_id IS DISTINCT FROM NEW.game_id
      OR v_doc.stage_no<>6
      OR v_doc.status_code<>'draft'
      OR v_doc.metadata->>'purpose'<>'presidential_electoral_system'
      OR NOT EXISTS(
         SELECT 1 FROM public.duma_agenda_items i
         JOIN public.duma_sessions s ON s.id=i.session_id AND s.game_id=i.game_id
         WHERE i.formal_document_id=v_doc.id AND i.game_id=v_doc.game_id
           AND i.status='in_progress' AND s.status='open' AND s.stage_no=6)
   THEN RAISE EXCEPTION 'Поправка к системе выборов Президента должна быть связана с открытым заседанием ГД шестого этапа'
     USING ERRCODE='42501'; END IF;
   RETURN NEW;
 END IF;
 IF NEW.formal_step_code NOT IN ('reading1','reading2','reading3') THEN RETURN NEW; END IF;
 IF v_doc.game_id IS DISTINCT FROM NEW.game_id
   OR v_doc.status_code IS DISTINCT FROM NEW.formal_step_code
   OR NEW.institution_key<>'gd' OR NEW.procedure_key<>'bill_'||NEW.formal_step_code
 THEN RAISE EXCEPTION 'Голосование должно соответствовать стадии законопроекта и органу'
   USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(
  SELECT 1 FROM public.duma_agenda_items i
  JOIN public.duma_sessions s ON s.id=i.session_id AND s.game_id=i.game_id
  WHERE i.formal_document_id=v_doc.id AND i.game_id=v_doc.game_id
    AND i.status='in_progress' AND s.status='open'
    AND s.stage_no=NEW.stage_no
 ) THEN RAISE EXCEPTION
  'Голосование по законопроекту закрыто до начала рассмотрения вопроса на заседании Государственной Думы'
  USING ERRCODE='42501'; END IF;
 RETURN NEW;
END;$function$;

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
 v_body:='Проектом предлагается внести изменение в Федеральный закон от 10.01.2003 № 19-ФЗ «О выборах Президента Российской Федерации» и установить для определения результатов выборов для президентских выборов мажоритарную систему '||v_label||'.'
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
 v_registry:='ГОС.ID-НПА-'||lpad(v_no::text,4,'0');
 insert into public.formal_documents(
   id,game_id,stage_no,registry_no,title,doc_type,subject_key,subject_label,author_id,
   body_text,workflow_key,workflow_steps,current_step,status_code,status_label,current_owner_key,metadata
 )
 values(
   v_doc,p_game_id,6,v_registry,
   'О внесении изменения в Федеральный закон № 19-ФЗ «О выборах Президента Российской Федерации»',
   'bill','gd','Государственная Дума Федерального Собрания Российской Федерации',v_uid,
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
