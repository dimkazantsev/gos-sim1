-- Stage 7: route the presidential electoral-system choice through a registered Duma bill,
-- a State Duma session and mandate vote, then auto-issue a State Duma resolution.

alter table public.presidential_system_proposals
 add column if not exists registered_at timestamptz,
 add column if not exists registered_by uuid references auth.users(id) on delete set null,
 add column if not exists bill_document_id uuid references public.formal_documents(id) on delete set null,
 add column if not exists session_id uuid references public.duma_sessions(id) on delete set null,
 add column if not exists agenda_item_id uuid references public.duma_agenda_items(id) on delete set null,
 add column if not exists resolution_document_id uuid references public.formal_documents(id) on delete set null;

alter table public.presidential_system_proposals drop constraint if exists presidential_system_proposals_status_check;
alter table public.presidential_system_proposals add constraint presidential_system_proposals_status_check
 check(status in ('draft','registered','vote_open','adopted','rejected','superseded'));

create or replace function private.can_manage_presidential_system_vote(p_game uuid,p_user uuid)
returns boolean language sql stable security definer set search_path=public,private,pg_temp as $$
 select private.is_game_teacher(p_game)
    or private.game_role(p_game,p_user) like '%председател%дум%'
    or private.game_role(p_game,p_user) like '%совет%дум%';
$$;
revoke execute on function private.can_manage_presidential_system_vote(uuid,uuid) from public,anon,authenticated;

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
 v_doc:=public.create_formal_document(p.game_id,7,
   'О внесении изменения в Федеральный закон № 19-ФЗ «О выборах Президента Российской Федерации»',
   'bill','gd','Государственная Дума Федерального Собрания Российской Федерации',
   v_body,null,null,null,'bill',
   jsonb_build_object('purpose','presidential_electoral_system','proposal_id',p.id,'system_type',p.system_type,'threshold_pct',p.threshold_pct));
 update public.presidential_system_proposals
 set status='registered',registered_at=now(),registered_by=v_uid,bill_document_id=v_doc,updated_at=now()
 where id=p.id;
 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(p.game_id,7,'Государственная Дума','notice','Проект поправки зарегистрирован в Государственной Думе',
   'Зарегистрирован проект поправки к Федеральному закону № 19-ФЗ по вопросу системы выборов Президента Российской Федерации.',v_uid);
 return v_doc;
end;$$;
revoke all on function public.register_presidential_system_proposal(uuid) from public,anon;
grant execute on function public.register_presidential_system_proposal(uuid) to authenticated;

create or replace function public.open_presidential_system_vote(p_proposal_id uuid)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.presidential_system_proposals%rowtype;v_uid uuid:=(select auth.uid());v_vote uuid;v_label text;
 v_session uuid;v_agenda uuid;v_session_no integer;
begin
 select * into p from public.presidential_system_proposals where id=p_proposal_id for update;
 if p.id is null then raise exception 'Proposal not found';end if;
 if not private.can_manage_presidential_system_vote(p.game_id,v_uid) then raise exception 'State Duma chair / teacher access required';end if;
 if p.status<>'registered' then raise exception 'Register the bill in the State Duma before opening the vote';end if;
 if p.bill_document_id is null then raise exception 'Registered bill document is missing';end if;
 if exists(select 1 from public.game_votes where game_id=p.game_id and stage_no=7 and status='open' and procedure_key='presidential_system') then raise exception 'Close the current presidential-system vote first';end if;
 if exists(select 1 from public.duma_sessions where game_id=p.game_id and status='open' and stage_no<>7) then raise exception 'Close the current State Duma session first';end if;

 select id into v_session from public.duma_sessions where game_id=p.game_id and stage_no=7 and status='open' order by opened_at desc nulls last limit 1;
 if v_session is null then select id into v_session from public.duma_sessions where game_id=p.game_id and stage_no=7 and status='draft' order by created_at desc limit 1; end if;
 if v_session is null then
  select coalesce(max(session_no),0)+1 into v_session_no from public.duma_sessions where game_id=p.game_id;
  insert into public.duma_sessions(game_id,stage_no,session_no,title,status,chair_user_id,created_by)
  values(p.game_id,7,v_session_no,'Заседание Государственной Думы · система выборов Президента РФ','draft',v_uid,v_uid)
  returning id into v_session;
 end if;
 select id into v_agenda from public.duma_agenda_items where session_id=v_session and formal_document_id=p.bill_document_id limit 1;
 if v_agenda is null then
  insert into public.duma_agenda_items(session_id,game_id,formal_document_id,agenda_no,status)
  values(v_session,p.game_id,p.bill_document_id,coalesce((select max(agenda_no) from public.duma_agenda_items where session_id=v_session),0)+1,'pending')
  returning id into v_agenda;
 end if;
 update public.duma_sessions set status='open',opened_at=coalesce(opened_at,now()),chair_user_id=v_uid where id=v_session and status='draft';
 update public.duma_agenda_items set status='in_progress',started_at=coalesce(started_at,now()) where id=v_agenda and status='pending';

 v_label:=case p.system_type when 'relative' then 'относительного большинства'
   when 'absolute' then 'абсолютного большинства (50% + 1)'
   when 'qualified' then 'квалифицированного большинства ('||p.threshold_pct||'%)'
   else 'преференциального большинства' end;
 insert into public.game_votes(game_id,stage_no,title,body,voting_mode,status,created_by,institution_key,procedure_key,
  quorum_kind,quorum_value,majority_kind,majority_value,allow_abstain,tie_breaker_chair,pass_transition,fail_transition,formal_document_id)
 values(p.game_id,7,'ГД · поправка к ФЗ № 19-ФЗ · система выборов Президента РФ',
  'На заседании Государственной Думы рассматривается проект поправки к Федеральному закону № 19-ФЗ. Предлагается мажоритарная система '||v_label||coalesce('. Обоснование: '||p.rationale,''),
  'mandate','open',v_uid,'gd','presidential_system','fraction',0.5,'present_majority',0.5,true,false,'none','none',p.bill_document_id)
 returning id into v_vote;
 update public.presidential_system_proposals
 set status='vote_open',vote_id=v_vote,session_id=v_session,agenda_item_id=v_agenda,updated_at=now()
 where id=p.id;
 return v_vote;
end;$$;
revoke all on function public.open_presidential_system_vote(uuid) from public,anon;
grant execute on function public.open_presidential_system_vote(uuid) to authenticated;

create or replace function private.presidential_system_vote_trigger()
returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.presidential_system_proposals%rowtype;v_doc uuid;v_label text;v_body text;v_result text;
begin
 if new.status='closed' and old.status is distinct from new.status and new.procedure_key='presidential_system' then
  select * into p from public.presidential_system_proposals where vote_id=new.id for update;
  if p.id is not null then
   v_label:=case p.system_type when 'relative' then 'относительного большинства' when 'absolute' then 'абсолютного большинства'
    when 'qualified' then 'квалифицированного большинства ('||p.threshold_pct||'%)' else 'преференциального большинства' end;
   if new.result_code='passed' then
    update public.presidential_system_proposals set status='superseded',updated_at=now() where game_id=new.game_id and status='adopted' and id<>p.id;
    update public.presidential_system_proposals set status='adopted',updated_at=now() where id=p.id;
    insert into public.presidential_election_settings(game_id,system_type,threshold_pct,poll_enabled,status,updated_by)
    values(new.game_id,p.system_type,coalesce(p.threshold_pct,50),true,'setup',new.created_by)
    on conflict(game_id) do update set system_type=excluded.system_type,threshold_pct=excluded.threshold_pct,
      status=case when presidential_election_settings.status='finished' then 'setup' else presidential_election_settings.status end,
      result='{}'::jsonb,updated_at=now(),updated_by=new.created_by;
    v_result:='принять проект поправки и установить систему '||v_label||' для определения результатов выборов Президента Российской Федерации в учебной модели';
   else
    update public.presidential_system_proposals set status='rejected',updated_at=now() where id=p.id;
    v_result:='отклонить проект поправки к Федеральному закону № 19-ФЗ о введении системы '||v_label;
   end if;
   v_body:='Государственная Дума Федерального Собрания Российской Федерации по итогам рассмотрения вопроса на заседании постановляет: '||v_result||'. '||
     'Результат голосования зафиксирован в системе GOS//SIMS: '||coalesce(new.result_label,new.result_code,'результат закрыт')||'.';
   v_doc:=public.create_formal_document(p.game_id,7,
     case when new.result_code='passed' then 'О принятии поправки к Федеральному закону № 19-ФЗ о системе выборов Президента Российской Федерации'
          else 'Об отклонении проекта поправки к Федеральному закону № 19-ФЗ о системе выборов Президента Российской Федерации' end,
     'gd_resolution','gd','Государственная Дума Федерального Собрания Российской Федерации',
     v_body,null,null,null,'gd_resolution',
     jsonb_build_object('purpose','presidential_electoral_system_result','proposal_id',p.id,'vote_id',new.id,'result_code',new.result_code,'system_type',p.system_type));
   update public.formal_documents set current_step=3,status_code='published',status_label='Принято и опубликовано',current_owner_key='system',updated_at=now() where id=v_doc;
   update public.presidential_system_proposals set resolution_document_id=v_doc,updated_at=now() where id=p.id;
   update public.duma_agenda_items set status='completed',completed_at=now(),result_note=v_result where id=p.agenda_item_id;
   update public.duma_sessions set status='closed',closed_at=now() where id=p.session_id and status='open';
   insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
   values(v_doc,p.game_id,new.created_by,'Постановление оформлено по итогам голосования ГД','draft','published','author','system',
     'Автоматически сформировано после закрытия голосования по проекту поправки к ФЗ № 19-ФЗ.');
  end if;
 end if;
 return new;
end;$$;
revoke execute on function private.presidential_system_vote_trigger() from public,anon,authenticated;
drop trigger if exists trg_presidential_system_vote on public.game_votes;
create trigger trg_presidential_system_vote after update of status on public.game_votes for each row execute function private.presidential_system_vote_trigger();
