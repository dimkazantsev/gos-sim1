create or replace function public.propose_presidential_system(
 p_game_id uuid,
 p_system_type text,
 p_threshold_pct numeric default null,
 p_rationale text default null
)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
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

 v_label:=case p_system_type
   when 'relative' then 'относительного большинства'
   when 'absolute' then 'абсолютного большинства'
   when 'qualified' then 'квалифицированного большинства ('||p_threshold_pct||'%)'
   else 'преференциального большинства'
 end;
 v_body:='Проектом предлагается внести изменение в Федеральный закон от 10.01.2003 № 19-ФЗ «О выборах Президента Российской Федерации» и установить для определения результатов выборов в учебной модели мажоритарную систему '||v_label||'.'
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
 v_registry:='ИГРА-НПА-'||lpad(v_no::text,4,'0');
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
$$;

create or replace function public.register_presidential_system_proposal(p_proposal_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare p public.presidential_system_proposals%rowtype;
begin
 select * into p from public.presidential_system_proposals where id=p_proposal_id;
 if p.id is null then raise exception 'Proposal not found';end if;
 if p.bill_document_id is not null then return p.bill_document_id; end if;
 raise exception 'Legacy proposal has no linked bill; create a new proposal in the stage 6 form';
end;
$$;

create or replace function public.open_presidential_system_vote(p_proposal_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare p public.presidential_system_proposals%rowtype;
begin
 select * into p from public.presidential_system_proposals where id=p_proposal_id;
 if p.id is null then raise exception 'Proposal not found';end if;
 if p.vote_id is not null then return p.vote_id; end if;
 raise exception 'Legacy proposal has no linked vote; create a new proposal in the stage 6 form';
end;
$$;

create or replace function private.presidential_system_vote_trigger()
returns trigger
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
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
    update public.presidential_system_proposals
       set status='superseded',updated_at=now()
     where game_id=new.game_id and status='adopted' and id<>p.id;
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

    v_result:='принять проект поправки и установить систему '||v_label||' для определения результатов выборов Президента Российской Федерации в учебной модели';

    update public.formal_documents
       set current_step=jsonb_array_length(workflow_steps)-1,
           status_code='published',
           status_label='Принят и опубликован',
           current_owner_key='system',
           updated_at=now()
     where id=p.bill_document_id;
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
     ||'Результат голосования зафиксирован в системе GOS//SIMS: '||coalesce(new.result_label,new.result_code,'результат закрыт')||'.';

   v_steps:=private.formal_workflow('gd_resolution');
   v_no:=nextval('public.formal_registry_seq');
   v_registry:='ИГРА-ПГД-'||lpad(v_no::text,4,'0');

   insert into public.formal_documents(
     id,game_id,stage_no,registry_no,title,doc_type,subject_key,subject_label,author_id,
     body_text,workflow_key,workflow_steps,current_step,status_code,status_label,current_owner_key,metadata
   )
   values(
     v_doc,p.game_id,6,v_registry,
     case when new.result_code='passed'
       then 'О принятии поправки к Федеральному закону № 19-ФЗ о системе выборов Президента Российской Федерации'
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
$$;
