-- One public outcome per case, canonical option votes and actual metric deltas.
alter table public.event_case_outcomes add column if not exists requested_trust_delta numeric not null default 0;
alter table public.event_case_outcomes add column if not exists resolution_kind text not null default 'neutral';
alter table public.event_case_outcomes add column if not exists option_tallies jsonb not null default '[]'::jsonb;

create or replace function private.assigned_game_case(p_case uuid,p_game uuid)
returns boolean language sql stable security definer set search_path=public,private,pg_temp as $$
 select exists(select 1 from public.event_assignments where case_id=p_case and game_id=p_game);
$$;
revoke all on function private.assigned_game_case(uuid,uuid) from public,anon;
grant execute on function private.assigned_game_case(uuid,uuid) to authenticated;
drop policy if exists event_case_public_assigned on public.event_cases;
create policy event_case_public_assigned on public.event_cases for select to authenticated
 using(private.is_game_member(game_id) and private.assigned_game_case(id,game_id));
drop policy if exists event_assignment_public_read on public.event_assignments;
create policy event_assignment_public_read on public.event_assignments for select to authenticated
 using(private.is_game_member(game_id));
drop policy if exists event_decision_public_read on public.event_decisions;
create policy event_decision_public_read on public.event_decisions for select to authenticated
 using(private.is_game_member(game_id));
-- Writing votes directly would skip the outcome, rating and media transaction.
revoke insert on public.event_decisions from authenticated;

create or replace function private.guard_event_assignment()
returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
declare c public.event_cases%rowtype;
begin
 select * into c from public.event_cases where id=new.case_id for update;
 if c.id is null or c.game_id<>new.game_id then raise exception 'Событие другой игры недоступно';end if;
 if not exists(select 1 from public.game_members where game_id=new.game_id and user_id=new.recipient_id and kind='student')
 then raise exception 'Получателем должен быть участник этой игры';end if;
 if tg_op='INSERT' and (c.status<>'ready' or exists(select 1 from public.event_case_outcomes where case_id=c.id))
 then raise exception 'Нельзя назначать архивное или завершённое событие';end if;
 if tg_op='UPDATE' and (new.game_id<>old.game_id or new.case_id<>old.case_id or new.recipient_id<>old.recipient_id)
 then raise exception 'Назначение нельзя перенести другому участнику';end if;
 if tg_op='UPDATE' and new.status='pending' and exists(select 1 from public.event_case_outcomes where case_id=c.id)
 then raise exception 'Голосование уже завершено';end if;
 return new;
end;
$$;
drop trigger if exists guard_event_assignment on public.event_assignments;
create trigger guard_event_assignment before insert or update on public.event_assignments
 for each row execute function private.guard_event_assignment();

create or replace function public.assign_event_case(p_case_id uuid,p_recipients uuid[])
returns integer language plpgsql security definer set search_path=public,private,pg_temp as $$
declare c public.event_cases%rowtype;recipient uuid;n integer:=0;recipients uuid[];
begin
 select * into c from public.event_cases where id=p_case_id for update;
 if c.id is null or not private.is_game_teacher(c.game_id) then raise exception 'Требуются права преподавателя';end if;
 if c.status<>'ready' or exists(select 1 from public.event_case_outcomes where case_id=c.id)
 then raise exception 'Событие недоступно для назначения';end if;
 select array_agg(distinct v) into recipients from unnest(p_recipients) v where v is not null;
 if coalesce(cardinality(recipients),0)=0 then raise exception 'Выберите получателей';end if;
 if c.audience='single' and cardinality(recipients)<>1 then raise exception 'Выберите одного участника';end if;
 if c.audience='group' and cardinality(recipients) not between 2 and 3 then raise exception 'Выберите 2–3 участников';end if;
 if exists(select 1 from unnest(recipients) r where not exists(select 1 from public.game_members
  where game_id=c.game_id and user_id=r and kind='student')) then raise exception 'Получатель недоступен';end if;
 if c.audience='all' and cardinality(recipients)<>(select count(*) from public.game_members where game_id=c.game_id and kind='student')
 then raise exception 'Общее событие назначается всем участникам';end if;
 foreach recipient in array recipients loop
  insert into public.event_assignments(case_id,game_id,recipient_id,created_by)
  values(c.id,c.game_id,recipient,auth.uid()) on conflict(case_id,recipient_id) do nothing;
  if found then n:=n+1;end if;
 end loop;
 return n;
end;
$$;
revoke all on function public.assign_event_case(uuid,uuid[]) from public,anon;
grant execute on function public.assign_event_case(uuid,uuid[]) to authenticated;

create or replace function public.create_assigned_event(p_game_id uuid,p_title text,p_situation text,
 p_category text,p_seriousness text,p_audience text,p_options jsonb,p_recipients uuid[],p_roles text[] default '{}')
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare c uuid;o jsonb;choices jsonb:='[]';effects jsonb:='[]';i integer:=0;trust numeric;
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Требуются права преподавателя';end if;
 if length(trim(p_title))<6 or length(trim(p_situation))<20 then raise exception 'Добавьте название и описание';end if;
 if jsonb_typeof(p_options)<>'array' or jsonb_array_length(p_options) not between 2 and 6 then raise exception 'Добавьте от 2 до 6 вариантов';end if;
 for o in select value from jsonb_array_elements(p_options) loop
  i:=i+1;
  if length(trim(coalesce(o->>'label','')))<2 or length(trim(coalesce(o->>'description','')))<5 then raise exception 'Заполните вариант и его последствия';end if;
  trust:=(o->>'trust')::numeric;
  if trust is null or trust::text in ('NaN','Infinity','-Infinity') or abs(trust)>100 then raise exception 'Некорректное влияние на доверие';end if;
  choices:=choices||jsonb_build_array(left(trim(o->>'label'),500));
  effects:=effects||jsonb_build_array(jsonb_build_object('key','option_'||i,'trust',trust,
    'description',left(trim(o->>'description'),2000),'public_interest',case when trust>0 then 'beneficial' when trust<0 then 'harmful' else 'neutral' end));
 end loop;
 if (select count(distinct lower(value)) from jsonb_array_elements_text(choices))<>i then raise exception 'Варианты должны различаться';end if;
 insert into public.event_cases(game_id,case_key,title,situation,category,seriousness,audience,allowed_roles,
  decision_options,effect_plan,comic_scene,status,created_by,source_note)
 values(p_game_id,'manual-'||gen_random_uuid(),left(trim(p_title),180),left(trim(p_situation),5000),
  left(trim(p_category),100),p_seriousness,p_audience,coalesce(p_roles,'{}'),choices,
  jsonb_build_object('options',effects),jsonb_build_object('title',trim(p_title),'category',trim(p_category)),
  'ready',auth.uid(),'Учебное событие преподавателя. Влияние размечено автором.') returning id into c;
 perform public.assign_event_case(c,p_recipients);
 return c;
end;
$$;
revoke all on function public.create_assigned_event(uuid,text,text,text,text,text,jsonb,uuid[],text[]) from public,anon;
grant execute on function public.create_assigned_event(uuid,text,text,text,text,text,jsonb,uuid[],text[]) to authenticated;

create or replace function private.apply_event_trust_delta(p_game uuid,p_key text,p_delta numeric,p_note text)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare ledger_id bigint;m public.state_metrics%rowtype;after_value numeric;actual numeric;
begin
 select * into m from public.state_metrics where game_id=p_game and metric_key='public_trust' for update;
 if m.id is null then raise exception 'Показатель доверия не настроен';end if;
 after_value:=least(coalesce(m.max_value,100),greatest(coalesce(m.min_value,0),m.value+p_delta));
 actual:=after_value-m.value;
 insert into public.event_trust_ledger(game_id,action_key,delta,note)
 values(p_game,p_key,actual,p_note) on conflict(game_id,action_key) do nothing returning id into ledger_id;
 if ledger_id is null then return;end if;
 update public.state_metrics set previous_value=m.value,value=after_value,updated_at=now() where id=m.id;
 insert into public.state_metric_history(game_id,metric_id,metric_key,value,previous_value,delta,source_type,source_id,note)
 values(p_game,m.id,'public_trust',after_value,m.value,actual,'event_autopilot',ledger_id::text,p_note);
end;
$$;

create or replace function private.finalize_game_case(p_case uuid,p_allow_pending boolean default false)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare c public.event_cases%rowtype;n integer;assigned integer;yes_count integer;no_count integer;
 winner text;requested numeric:=0;actual numeric:=0;info jsonb;post_id uuid;author uuid;media text;label text;
 tallies jsonb;best integer;winners integer;idx integer;kind text;lead text;body text;pending integer;
begin
 select * into c from public.event_cases where id=p_case for update;
 if c.id is null then raise exception 'Событие недоступно';end if;
 if exists(select 1 from public.event_case_outcomes where case_id=p_case)
 then return jsonb_build_object('reason','already_finalized');end if;
 select count(*),count(*) filter(where status='pending') into assigned,pending from public.event_assignments where case_id=p_case;
 if assigned=0 then return jsonb_build_object('reason','not_assigned');end if;
 if pending>0 and not p_allow_pending then return jsonb_build_object('reason','awaiting_answers');end if;
 select count(*) into n from public.event_decisions where case_id=p_case;
 if n=0 then return jsonb_build_object('reason','no_answers');end if;
 with counts as (
  select 'option_'||o.ordinality key,o.ordinality idx,o.value label,
    (select count(*) from public.event_decisions d where d.case_id=p_case and
     case d.choice when 'accept' then 'option_1' when 'reject' then 'option_2' else d.choice end='option_'||o.ordinality)::integer votes
  from jsonb_array_elements_text(c.decision_options) with ordinality o
 ) select jsonb_agg(jsonb_build_object('key',key,'label',label,'votes',votes) order by idx),max(votes)
 into tallies,best from counts;
 select count(*) into winners from jsonb_array_elements(tallies) t where (t->>'votes')::integer=best;
 if winners<>1 then winner:='tie';idx:=-1;info:='{}';
 else
  select t->>'key' into winner from jsonb_array_elements(tallies) t where (t->>'votes')::integer=best;
  idx:=substring(winner from 8)::integer-1;info:=c.effect_plan->'options'->idx;
 end if;
 requested:=case when winner='tie' then 0 else coalesce((info->>'trust')::numeric,0) end;
 kind:=case when winner='tie' then 'tie' when requested>0 then 'beneficial' when requested<0 then 'harmful' else 'neutral' end;
 select count(*) filter(where coalesce((c.effect_plan->'options'->
  (case choice when 'accept' then 0 when 'reject' then 1 else substring(choice from 8)::integer-1 end)->>'trust')::numeric,0)>0),
  count(*) filter(where coalesce((c.effect_plan->'options'->
  (case choice when 'accept' then 0 when 'reject' then 1 else substring(choice from 8)::integer-1 end)->>'trust')::numeric,0)<0)
 into yes_count,no_count from public.event_decisions where case_id=c.id;
 label:=case when winner='tie' then 'Равное число голосов — общее решение не определено' else c.decision_options->>idx end;
 perform private.apply_event_trust_delta(c.game_id,'choice-'||c.id,requested,'Итог события: '||c.title||'; '||label);
 select delta into actual from public.event_trust_ledger where game_id=c.game_id and action_key='choice-'||c.id;
 media:=coalesce(nullif(c.comic_scene->>'media_label',''),case
  when c.category ilike '%Эколог%' then 'Экологический Вестник Республики'
  when c.category ilike '%Эконом%' then 'Деловая Газета Республики'
  when c.category ilike '%Международ%' then 'Международный Обозреватель Республики'
  when c.seriousness='light' then 'Культурное Радио Республики'
  else 'Общественная Служба Новостей Республики' end);
 lead:=coalesce(nullif(c.comic_scene->>'news_lead',''),'Сегодня ситуация «'||c.title||'» получила ответ участников игры.');
 body:=lead||E'\n\nВыбрано: '||label||'.'||E'\n\n'||case when winner='tie'
  then 'Голоса разделились поровну. Общее решение не принято; показатель доверия не изменился.'
  else coalesce(nullif(info->>'news',''),nullif(info->>'description',''),nullif(info->>'note',''),'Исход оценён в учебной модели.') end||
  E'\n\nГолосов: '||n||' из '||assigned||'. Фактическое изменение доверия: '||case when actual>0 then '+' else '' end||actual||' п.п.'||
  case when actual<>requested then ' Расчётный эффект: '||requested||' п.п.; применены границы показателя.' else '' end;
 select owner_id into author from public.games where id=c.game_id;
 insert into public.political_posts(game_id,author_id,process_type,actor_key,actor_label,title,body,tags,
  internal_view,internal_ref_id,status,comic_scene,effects_applied)
 values(c.game_id,author,'news','media',media,c.title||' · Итог выбора',body,array['EVENT','Учебные Новости',c.category],
  'events',c.id::text,'published',c.comic_scene||jsonb_build_object('title',c.title,'category',c.category,'case_key',c.case_key),true)
 returning id into post_id;
 insert into public.event_case_outcomes(game_id,case_id,winner,yes_votes,no_votes,votes_count,assignments_count,
  trust_delta,requested_trust_delta,resolution_kind,option_tallies,media_post_id)
 values(c.game_id,c.id,winner,yes_count,no_count,n,assigned,actual,requested,kind,tallies,post_id);
 update public.event_assignments set status='resolved' where case_id=c.id and status='pending';
 return jsonb_build_object('winner',winner,'trust_delta',actual,'requested_trust_delta',requested,'post_id',post_id);
end;
$$;

create or replace function public.submit_event_decision(p_assignment_id uuid,p_choice text,p_rationale text default null)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare a public.event_assignments%rowtype;c public.event_cases%rowtype;choice_index integer;case_id uuid;
begin
 select ea.case_id into case_id from public.event_assignments ea where ea.id=p_assignment_id and ea.recipient_id=auth.uid();
 if case_id is null then raise exception 'Задание недоступно';end if;
 -- Every writer locks the case before an assignment, avoiding two-voter deadlocks.
 select * into c from public.event_cases where id=case_id for update;
 select * into a from public.event_assignments where id=p_assignment_id for update;
 if a.recipient_id<>auth.uid() or not exists(select 1 from public.game_members where game_id=a.game_id and user_id=auth.uid() and kind='student')
 then raise exception 'Голосовать может назначенный участник';end if;
 if a.status<>'pending' or exists(select 1 from public.event_case_outcomes where event_case_outcomes.case_id=c.id)
 then raise exception 'Голосование уже завершено';end if;
 choice_index:=case p_choice when 'accept' then 1 when 'reject' then 2 else
  case when p_choice ~ '^option_[1-6]$' then substring(p_choice from 8)::integer else 0 end end;
 if choice_index<1 or choice_index>jsonb_array_length(c.decision_options) then raise exception 'Вариант недоступен';end if;
 insert into public.event_decisions(assignment_id,case_id,game_id,actor_id,choice,rationale)
 values(a.id,c.id,c.game_id,auth.uid(),'option_'||choice_index,left(coalesce(p_rationale,''),3000));
 update public.event_assignments set status='resolved' where id=a.id;
 perform private.finalize_game_case(c.id,false);
 perform private.apply_event_trust(c.game_id);
end;
$$;
