-- Move the presidential electoral-system amendment procedure from stage 7 to stage 6.
-- Overrides the earlier stage-7 implementation without rewriting history.

create or replace function public.register_presidential_system_proposal(p_proposal_id uuid)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.presidential_system_proposals%rowtype;v_uid uuid:=(select auth.uid());v_doc uuid;v_label text;v_body text;
begin
 select * into p from public.presidential_system_proposals where id=p_proposal_id for update;
 if p.id is null then raise exception 'Proposal not found';end if;
 if not private.can_manage_presidential_system_vote(p.game_id,v_uid) then raise exception 'State Duma chair / teacher access required';end if;
 if p.status<>'draft' then raise exception 'Only a draft proposal may be registered';end if;
 v_label:=case p.system_type when 'relative' then 'относительного большинства' when 'absolute' then 'абсолютного большинства'
  when 'qualified' then 'квалифицированного большинства ('||p.threshold_pct||'%)' else 'преференциального большинства' end;
 v_body:='Проектом предлагается внести изменение в Федеральный закон от 10.01.2003 № 19-ФЗ «О выборах Президента Российской Федерации» и установить для определения результатов выборов в учебной модели мажоритарную систему '||v_label||'.'||
  case when p.rationale is not null then E'\n\nОбоснование субъекта инициативы: '||p.rationale else '' end;
 v_doc:=public.create_formal_document(p.game_id,6,'О внесении изменения в Федеральный закон № 19-ФЗ «О выборах Президента Российской Федерации»',
  'bill','gd','Государственная Дума Федерального Собрания Российской Федерации',v_body,null,null,null,'bill',
  jsonb_build_object('purpose','presidential_electoral_system','proposal_id',p.id,'system_type',p.system_type,'threshold_pct',p.threshold_pct));
 update public.presidential_system_proposals set status='registered',registered_at=now(),registered_by=v_uid,bill_document_id=v_doc,updated_at=now() where id=p.id;
 return v_doc;
end;$$;
revoke all on function public.register_presidential_system_proposal(uuid) from public,anon;
grant execute on function public.register_presidential_system_proposal(uuid) to authenticated;

create or replace function public.open_presidential_system_vote(p_proposal_id uuid)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.presidential_system_proposals%rowtype;v_uid uuid:=(select auth.uid());v_vote uuid;v_label text;v_session uuid;v_agenda uuid;v_session_no integer;
begin
 select * into p from public.presidential_system_proposals where id=p_proposal_id for update;
 if p.id is null then raise exception 'Proposal not found';end if;
 if not private.can_manage_presidential_system_vote(p.game_id,v_uid) then raise exception 'State Duma chair / teacher access required';end if;
 if p.status<>'registered' or p.bill_document_id is null then raise exception 'Register the bill in the State Duma before opening the vote';end if;
 if exists(select 1 from public.game_votes where game_id=p.game_id and stage_no=6 and status='open' and procedure_key='presidential_system') then raise exception 'Close the current presidential-system vote first';end if;
 select id into v_session from public.duma_sessions where game_id=p.game_id and stage_no=6 and status='open' order by opened_at desc nulls last limit 1;
 if v_session is null then
  select id into v_session from public.duma_sessions where game_id=p.game_id and stage_no=6 and status='draft' order by created_at desc limit 1;
 end if;
 if v_session is null then
  select coalesce(max(session_no),0)+1 into v_session_no from public.duma_sessions where game_id=p.game_id;
  insert into public.duma_sessions(game_id,stage_no,session_no,title,status,chair_user_id,created_by)
  values(p.game_id,6,v_session_no,'Заседание Государственной Думы · поправка к ФЗ № 19-ФЗ','draft',v_uid,v_uid) returning id into v_session;
 end if;
 select id into v_agenda from public.duma_agenda_items where session_id=v_session and formal_document_id=p.bill_document_id limit 1;
 if v_agenda is null then
  insert into public.duma_agenda_items(session_id,game_id,formal_document_id,agenda_no,status)
  values(v_session,p.game_id,p.bill_document_id,coalesce((select max(agenda_no) from public.duma_agenda_items where session_id=v_session),0)+1,'pending') returning id into v_agenda;
 end if;
 update public.duma_sessions set status='open',opened_at=coalesce(opened_at,now()),chair_user_id=v_uid where id=v_session and status='draft';
 update public.duma_agenda_items set status='in_progress',started_at=coalesce(started_at,now()) where id=v_agenda and status='pending';
 v_label:=case p.system_type when 'relative' then 'относительного большинства' when 'absolute' then 'абсолютного большинства (50% + 1)'
   when 'qualified' then 'квалифицированного большинства ('||p.threshold_pct||'%)' else 'преференциального большинства' end;
 insert into public.game_votes(game_id,stage_no,title,body,voting_mode,status,created_by,institution_key,procedure_key,quorum_kind,quorum_value,majority_kind,majority_value,allow_abstain,tie_breaker_chair,pass_transition,fail_transition,formal_document_id)
 values(p.game_id,6,'ГД ФС РФ · поправка к ФЗ № 19-ФЗ · система выборов Президента РФ',
  'На заседании Государственной Думы рассматривается проект поправки к Федеральному закону № 19-ФЗ. Предлагается мажоритарная система '||v_label||coalesce('. Обоснование: '||p.rationale,''),
  'mandate','open',v_uid,'gd','presidential_system','fraction',0.5,'present_majority',0.5,true,false,'none','none',p.bill_document_id) returning id into v_vote;
 update public.presidential_system_proposals set status='vote_open',vote_id=v_vote,session_id=v_session,agenda_item_id=v_agenda,updated_at=now() where id=p.id;
 return v_vote;
end;$$;
revoke all on function public.open_presidential_system_vote(uuid) from public,anon;
grant execute on function public.open_presidential_system_vote(uuid) to authenticated;

update public.game_votes set stage_no=6 where procedure_key='presidential_system';
update public.duma_sessions set stage_no=6 where title like '%система выборов Президента%' or title like '%поправка к ФЗ № 19-ФЗ%';
update public.formal_documents set stage_no=6 where metadata->>'purpose' in ('presidential_electoral_system','presidential_electoral_system_result');
