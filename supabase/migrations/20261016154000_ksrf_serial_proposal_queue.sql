-- KSRF decision queue for independent questions: electoral_system (stage 2) and regional_system (stage 3).
-- Keep historic ballots, prior accepted decisions and non-KSRF votes unchanged.
alter table public.parliamentary_election_rules add column if not exists queued_at timestamptz;
alter table public.parliamentary_election_rules add column if not exists rejection_reason text;
alter table public.regional_election_rules add column if not exists queued_at timestamptz;
alter table public.regional_election_rules add column if not exists rejection_reason text;
do $guard$ begin
 if exists(select 1 from public.game_votes where status='open' and procedure_key in ('electoral_system','regional_system')
  group by game_id,procedure_key having count(*)>1) then
  raise exception 'Conflicting KSRF votes are already open; inspect before migration';
 end if;
end $guard$;
create unique index if not exists ksrf_open_question_once on public.game_votes(game_id,procedure_key)
 where status='open' and procedure_key in ('electoral_system','regional_system');

create or replace function private.activate_ksrf_proposal(p_game uuid,p_question text,p_proposal uuid)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.parliamentary_election_rules%rowtype;
 r public.regional_election_rules%rowtype;
 v_id uuid;v_body text;v_author uuid;v_stage integer;
begin
 if p_question not in ('electoral_system','regional_system') then raise exception 'Неизвестный вопрос КСРФ';end if;
 if exists(select 1 from public.game_votes where game_id=p_game and procedure_key=p_question and status='open') then
  raise exception 'По вопросу уже идёт голосование';
 end if;
 v_stage:=case when p_question='electoral_system' then 2 else 3 end;
 if p_question='electoral_system' then
  if exists(select 1 from public.parliamentary_election_rules where game_id=p_game and status='adopted') then
   raise exception 'Решение по вопросу уже принято';end if;
  select * into p from public.parliamentary_election_rules where id=p_proposal and game_id=p_game and status='draft' for update;
  if p.id is null then raise exception 'Проект недоступен';end if;
  v_author:=p.proposed_by;
  v_body:='Система: '||p.system_type||coalesce('; формула: '||p.allocation_method,'')
   ||coalesce('; мажоритарное правило: '||p.majoritarian_method,'')
   ||coalesce('; пропорциональная часть: '||p.proportional_share||'%','')
   ||coalesce('. Обоснование: '||p.rationale,'');
 else
  if exists(select 1 from public.regional_election_rules where game_id=p_game and status in ('adopted','allocated')) then
   raise exception 'Решение по вопросу уже принято';end if;
  select * into r from public.regional_election_rules where id=p_proposal and game_id=p_game and status='draft' for update;
  if r.id is null then raise exception 'Проект недоступен';end if;
  v_author:=r.proposed_by;
  v_body:='Метод распределения 89 субъектов: '||r.method||coalesce('. Обоснование: '||r.rationale,'');
 end if;
 insert into public.game_votes(game_id,stage_no,title,body,voting_mode,status,created_by,
   institution_key,procedure_key,quorum_kind,quorum_value,majority_kind,majority_value,
   allow_abstain,tie_breaker_chair,pass_transition,fail_transition)
 values(p_game,v_stage,
  case when p_question='electoral_system' then 'КСРФ · избирательная система'
       else 'КСРФ · метод распределения субъектов РФ' end,
  v_body,'faction','open',v_author,'ksrf',p_question,'fraction',0.5,'eligible_majority',0.5,
  true,false,'none','none') returning id into v_id;
 if p_question='electoral_system' then
  update public.parliamentary_election_rules set vote_id=v_id,status='vote_open',queued_at=null,
   rejection_reason=null,updated_at=now() where id=p_proposal;
 else
  update public.regional_election_rules set vote_id=v_id,status='vote_open',queued_at=null,
   rejection_reason=null,updated_at=now() where id=p_proposal;
 end if;
 return v_id;
end;$$;
revoke all on function private.activate_ksrf_proposal(uuid,text,uuid) from public,anon,authenticated;

create or replace function private.activate_next_ksrf_proposal(p_game uuid,p_question text)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_next uuid;
begin
 if p_question='electoral_system' then
  select id into v_next from public.parliamentary_election_rules
  where game_id=p_game and status='draft' and queued_at is not null
  order by queued_at,created_at,id limit 1 for update;
 elsif p_question='regional_system' then
  select id into v_next from public.regional_election_rules
  where game_id=p_game and status='draft' and queued_at is not null
  order by queued_at,created_at,id limit 1 for update;
 else return null;
 end if;
 if v_next is null then return null;end if;
 return private.activate_ksrf_proposal(p_game,p_question,v_next);
end;$$;
revoke all on function private.activate_next_ksrf_proposal(uuid,text) from public,anon,authenticated;

create or replace function public.open_parliamentary_rule_vote(p_rule_id uuid)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.parliamentary_election_rules%rowtype;v_uid uuid:=auth.uid();
begin
 select * into p from public.parliamentary_election_rules where id=p_rule_id;
 if p.id is null then raise exception 'Проект не найден';end if;
 if v_uid is null or not private.can_propose_ksrf(p.game_id,v_uid) then raise exception 'Нет полномочий КСРФ';end if;
 if not private.is_game_teacher(p.game_id) and not exists(
  select 1 from public.institution_session_registrations
  where game_id=p.game_id and stage_no=2 and institution_key='ksrf' and user_id=v_uid
 ) then raise exception 'Сначала зарегистрируйтесь на заседание КСРФ';end if;
 perform 1 from public.games where id=p.game_id for update;
 select * into p from public.parliamentary_election_rules where id=p_rule_id for update;
 if p.status='vote_open' then return p.vote_id;end if;
 if p.status<>'draft' then raise exception 'Проект уже рассмотрен';end if;
 if exists(select 1 from public.parliamentary_election_rules where game_id=p.game_id and status='adopted') then
  raise exception 'Решение уже принято; вернуть вопрос вправе преподаватель';end if;
 if p.queued_at is not null then return null;end if;
 if exists(select 1 from public.game_votes where game_id=p.game_id and status='open' and procedure_key='electoral_system')
 or exists(select 1 from public.parliamentary_election_rules where game_id=p.game_id and status='draft' and queued_at is not null) then
  update public.parliamentary_election_rules set queued_at=now(),updated_at=now() where id=p.id;
  if not exists(select 1 from public.game_votes where game_id=p.game_id and status='open' and procedure_key='electoral_system') then
   perform private.activate_next_ksrf_proposal(p.game_id,'electoral_system');
  end if;
  return null;
 end if;
 return private.activate_ksrf_proposal(p.game_id,'electoral_system',p.id);
end;$$;
revoke all on function public.open_parliamentary_rule_vote(uuid) from public,anon;
grant execute on function public.open_parliamentary_rule_vote(uuid) to authenticated;

create or replace function public.open_regional_rule_vote(p_rule_id uuid)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.regional_election_rules%rowtype;v_uid uuid:=auth.uid();
begin
 select * into p from public.regional_election_rules where id=p_rule_id;
 if p.id is null then raise exception 'Проект не найден';end if;
 if v_uid is null or not private.can_propose_ksrf(p.game_id,v_uid) then raise exception 'Нет полномочий КСРФ';end if;
 if not private.is_game_teacher(p.game_id) and not exists(
  select 1 from public.institution_session_registrations
  where game_id=p.game_id and stage_no=3 and institution_key='ksrf' and user_id=v_uid
 ) then raise exception 'Сначала зарегистрируйтесь на заседание КСРФ';end if;
 perform 1 from public.games where id=p.game_id for update;
 select * into p from public.regional_election_rules where id=p_rule_id for update;
 if p.status='vote_open' then return p.vote_id;end if;
 if p.status<>'draft' then raise exception 'Проект уже рассмотрен';end if;
 if exists(select 1 from public.regional_election_rules where game_id=p.game_id and status in ('adopted','allocated')) then
  raise exception 'Решение уже принято; вернуть вопрос вправе преподаватель';end if;
 if p.queued_at is not null then return null;end if;
 if exists(select 1 from public.game_votes where game_id=p.game_id and status='open' and procedure_key='regional_system')
 or exists(select 1 from public.regional_election_rules where game_id=p.game_id and status='draft' and queued_at is not null) then
  update public.regional_election_rules set queued_at=now(),updated_at=now() where id=p.id;
  if not exists(select 1 from public.game_votes where game_id=p.game_id and status='open' and procedure_key='regional_system') then
   perform private.activate_next_ksrf_proposal(p.game_id,'regional_system');
  end if;
  return null;
 end if;
 return private.activate_ksrf_proposal(p.game_id,'regional_system',p.id);
end;$$;
revoke all on function public.open_regional_rule_vote(uuid) from public,anon;
grant execute on function public.open_regional_rule_vote(uuid) to authenticated;

create or replace function private.electoral_rule_vote_trigger()
returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_rule uuid;
begin
 if new.status<>'closed' or old.status='closed' or
    new.procedure_key not in ('electoral_system','regional_system') then return new;end if;
 perform 1 from public.games where id=new.game_id for update;
 if new.procedure_key='electoral_system' then
  select id into v_rule from public.parliamentary_election_rules where vote_id=new.id;
  if v_rule is null then return new;end if;
  if new.result_code='passed' then
   update public.parliamentary_election_rules set status='rejected',queued_at=null,
    rejection_reason='По вопросу принято другое предложение',updated_at=now()
    where game_id=new.game_id and status='draft' and id<>v_rule;
   update public.parliamentary_election_rules set status='adopted',queued_at=null,updated_at=now() where id=v_rule;
  elsif new.result_code='no_quorum' then
   update public.parliamentary_election_rules set status='draft',vote_id=null,
    queued_at=coalesce(queued_at,old.opened_at),updated_at=now() where id=v_rule;
   perform private.activate_next_ksrf_proposal(new.game_id,new.procedure_key);
  else
   update public.parliamentary_election_rules set status='rejected',queued_at=null,
    rejection_reason='Не набрано большинство',updated_at=now() where id=v_rule;
   perform private.activate_next_ksrf_proposal(new.game_id,new.procedure_key);
  end if;
 else
  select id into v_rule from public.regional_election_rules where vote_id=new.id;
  if v_rule is null then return new;end if;
  if new.result_code='passed' then
   update public.regional_election_rules set status='rejected',queued_at=null,
    rejection_reason='По вопросу принято другое предложение',updated_at=now()
    where game_id=new.game_id and status='draft' and id<>v_rule;
   update public.regional_election_rules set status='adopted',queued_at=null,updated_at=now() where id=v_rule;
  elsif new.result_code='no_quorum' then
   update public.regional_election_rules set status='draft',vote_id=null,
    queued_at=coalesce(queued_at,old.opened_at),updated_at=now() where id=v_rule;
   perform private.activate_next_ksrf_proposal(new.game_id,new.procedure_key);
  else
   update public.regional_election_rules set status='rejected',queued_at=null,
    rejection_reason='Не набрано большинство',updated_at=now() where id=v_rule;
   perform private.activate_next_ksrf_proposal(new.game_id,new.procedure_key);
  end if;
 end if;
 return new;
end;$$;
revoke all on function private.electoral_rule_vote_trigger() from public,anon,authenticated;

create or replace function public.reopen_ksrf_question(p_game_id uuid,p_question text,p_reason text)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_uid uuid:=auth.uid();
begin
 if v_uid is null or not private.is_game_teacher(p_game_id) then
  raise exception 'Вернуть вопрос может только преподаватель';end if;
 if p_question not in ('electoral_system','regional_system') then raise exception 'Вопрос КСРФ не найден';end if;
 if length(btrim(coalesce(p_reason,'')))<10 then raise exception 'Укажите основание возврата (10 символов или больше)';end if;
 perform 1 from public.games where id=p_game_id for update;
 if exists(select 1 from public.game_votes where game_id=p_game_id and procedure_key=p_question and status='open') then
  raise exception 'Сначала завершите текущее голосование';end if;
 if p_question='electoral_system' then
  if not exists(select 1 from public.parliamentary_election_rules where game_id=p_game_id and status='adopted') then
   raise exception 'По вопросу нет принятого решения';end if;
  update public.parliamentary_election_rules set status='superseded',updated_at=now()
   where game_id=p_game_id and status='adopted';
  update public.parliamentary_election_rules set status='draft',queued_at=null,rejection_reason=null,updated_at=now()
   where game_id=p_game_id and status='rejected' and vote_id is null and rejection_reason='По вопросу принято другое предложение';
 else
  if not exists(select 1 from public.regional_election_rules where game_id=p_game_id and status in ('adopted','allocated')) then
   raise exception 'По вопросу нет принятого решения';end if;
  update public.regional_election_rules set status='superseded',updated_at=now()
   where game_id=p_game_id and status in ('adopted','allocated');
  update public.regional_election_rules set status='draft',queued_at=null,rejection_reason=null,updated_at=now()
   where game_id=p_game_id and status='rejected' and vote_id is null and rejection_reason='По вопросу принято другое предложение';
 end if;
 insert into public.game_activity(game_id,actor_id,event_type,label,view_key,payload)
  values(p_game_id,v_uid,'ksrf_reopen','Вопрос КСРФ возвращён на рассмотрение','votes',
         jsonb_build_object('question',p_question,'reason',btrim(p_reason)));
end;$$;
revoke all on function public.reopen_ksrf_question(uuid,text,text) from public,anon;
grant execute on function public.reopen_ksrf_question(uuid,text,text) to authenticated;
