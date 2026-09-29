-- GOS//SIMS: event bank, configurable hourly autopilot and auditable public-trust model.
-- Fictional teaching cases; no claim that these are sourced historical events.
create table if not exists public.event_auto_settings(
 game_id uuid primary key references public.games(id) on delete cascade,
 enabled boolean not null default false,
 interval_hours integer not null default 12 check(interval_hours between 4 and 72),
 activity_weight numeric not null default 1 check(activity_weight between 0 and 2),
 max_daily integer not null default 2 check(max_daily between 1 and 3),
 trust_per_20 numeric not null default 2 check(trust_per_20 between 0 and 4),
 backlog_penalty numeric not null default 1 check(backlog_penalty between 0 and 2),
 last_run_at timestamptz,
 updated_at timestamptz not null default now()
);
alter table public.event_auto_settings enable row level security;
drop policy if exists event_settings_teacher on public.event_auto_settings;
create policy event_settings_teacher on public.event_auto_settings for all to authenticated
 using(private.is_game_teacher(game_id)) with check(private.is_game_teacher(game_id));
grant select,insert,update on public.event_auto_settings to authenticated;

create table if not exists public.event_trust_ledger(
 id bigint generated always as identity primary key,
 game_id uuid not null references public.games(id) on delete cascade,
 action_key text not null,
 delta numeric not null,
 note text not null,
 created_at timestamptz not null default now(),
 unique(game_id,action_key)
);
create index if not exists event_trust_ledger_game on public.event_trust_ledger(game_id,created_at desc);
alter table public.event_trust_ledger enable row level security;
drop policy if exists event_trust_read on public.event_trust_ledger;
create policy event_trust_read on public.event_trust_ledger for select to authenticated
 using(private.is_game_member(game_id));
grant select on public.event_trust_ledger to authenticated;

create or replace function private.seed_event_bank(p_game uuid)
returns integer language plpgsql security definer set search_path=public,private,pg_temp as $$
declare inserted_count integer;
begin
 insert into public.event_cases(game_id,case_key,title,situation,category,seriousness,audience,allowed_roles,verified,status,source_note)
 select p_game,'bank-'||v.key,v.title,v.situation,v.category,v.seriousness,'single',v.roles,false,'ready',
 'Авторская вымышленная ситуация GOS//SIMS. Не относится к реальному событию.'
 from (values
 ('budget-bridge','Ремонт моста','Изношенный мост связывает две части района. Инженеры считают его безопасным лишь при ограничении нагрузки. Бюджет уже распределён. Предложите решение, которое учитывает безопасность и стоимость.','Муниципальное управление','serious',array['депутат','муницип','глава города','администрац']),
 ('budget-school','Школьная крыша','После сильного ветра протекает крыша школы. Родители требуют немедленного ремонта, подрядчик просит дополнительное финансирование. Определите порядок действий и механизм контроля работ.','Образование','serious',array['министр','депутат','муницип']),
 ('budget-health','Очередь в поликлинике','В районной поликлинике выросла очередь к врачам. Руководство предлагает перераспределить бюджет между ремонтом и дополнительными сменами. Какое решение можно обосновать?','Здравоохранение','serious',array['министр','правительств','депутат']),
 ('environment','Загрязнение реки','Жители сообщили об изменении цвета воды в реке. Предприятие отрицает сброс отходов, а общественность требует закрыть производство. Какие проверки и меры вы инициируете?','Экология','serious',array['депутат','муницип','министр']),
 ('records','Пропали протоколы','Перед голосованием выяснилось, что секретариат не загрузил часть протоколов в общий реестр. Заседание назначено на сегодня. Решите, проводить ли заседание и как восстановить документацию.','Государственное управление','serious',array['депутат','председател','правительств']),
 ('public-hearing','Общественные слушания','Проект городской застройки вызвал конфликт между жильцами и инвестором. Подготовьте процедуру слушаний с публикацией результатов и возможностью учесть возражения.','Муниципальное управление','serious',array['муницип','депутат','глава города']),
 ('media-rumour','Слухи о бюджете','В социальной сети распространяется сообщение о якобы закрытии городской библиотеки. Официальных решений пока нет. Как проверить сведения и представить обществу достоверную позицию?','Культура и протокол','light',array[]::text[]),
 ('cat-mayor','Кот в приёмной','Во время официального приёма в кабинет неожиданно вошёл кот и уселся на материалы заседания. Снимок разошёлся по местным пабликам. Нужно ли пресс-службе реагировать?','Культура и протокол','light',array[]::text[]),
 ('bus','Автобус опоздал','Единственный городской автобус сегодня опоздал на сорок минут. Жители создали шуточный рейтинг самых непредсказуемых маршрутов. Предложите содержательный ответ администрации.','Муниципальное управление','light',array[]::text[]),
 ('ceremony','Лента не разрезается','На открытии нового общественного пространства торжественная лента оказалась слишком прочной для церемониальных ножниц. Предложите решение без лишних расходов и с сохранением достоинства участников.','Культура и протокол','light',array[]::text[]),
 ('library','Книжный клуб','Студенты предлагают использовать пустующее помещение для общественного книжного клуба. Администрация считает, что посетителей не будет. Как проверить спрос, не расходуя крупный бюджет?','Образование','light',array[]::text[]),
 ('meeting','Совещание без повестки','Участники собрались в большом зале, но выяснилось, что повестка заседания не согласована. Часть присутствующих предлагает импровизировать. Как организовать продуктивную встречу?','Государственное управление','light',array[]::text[])
 ) as v(key,title,situation,category,seriousness,roles)
 where not exists(select 1 from public.event_cases e where e.game_id=p_game and e.case_key='bank-'||v.key);
 get diagnostics inserted_count=row_count;
 return inserted_count;
end;
$$;
revoke all on function private.seed_event_bank(uuid) from public,anon,authenticated;

create or replace function public.seed_game_event_bank(p_game_id uuid)
returns integer language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher access required';end if;
 return private.seed_event_bank(p_game_id);
end;
$$;
revoke all on function public.seed_game_event_bank(uuid) from public,anon;
grant execute on function public.seed_game_event_bank(uuid) to authenticated;

create or replace function private.apply_event_trust_delta(p_game uuid,p_key text,p_delta numeric,p_note text)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_id bigint;v_old numeric;v_new numeric;v_metric uuid;
begin
 if p_delta=0 then return;end if;
 insert into public.event_trust_ledger(game_id,action_key,delta,note)
 values(p_game,p_key,p_delta,p_note) on conflict do nothing returning id into v_id;
 if v_id is null then return;end if;
 select id,value into v_metric,v_old from public.state_metrics
 where game_id=p_game and metric_key='public_trust' for update;
 if v_metric is null then return;end if;
 v_new=least(100,greatest(0,v_old+p_delta));
 update public.state_metrics set previous_value=v_old,value=v_new,updated_at=now() where id=v_metric;
 insert into public.state_metric_history(game_id,metric_id,metric_key,value,previous_value,delta,source_type,source_id,note)
 values(p_game,v_metric,'public_trust',v_new,v_old,v_new-v_old,'event_autopilot',v_id::text,p_note);
end;
$$;
revoke all on function private.apply_event_trust_delta(uuid,text,numeric,text) from public,anon,authenticated;

create or replace function private.apply_event_trust(p_game uuid)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare decided integer;pending integer;n integer;daily_penalty numeric;s public.event_auto_settings%rowtype;
begin
 select * into s from public.event_auto_settings where game_id=p_game;
 if not found then return;end if;
 select count(*) into decided from public.event_decisions where game_id=p_game;
 if decided>=20 then
   for n in 1..floor(decided/20)::integer loop
     perform private.apply_event_trust_delta(p_game,'resolved-'||n*20,s.trust_per_20,
       'За каждые 20 обработанных учебных ситуаций: +'||s.trust_per_20||' п.п. доверия');
   end loop;
 end if;
 select count(*) into pending from public.event_assignments
 where game_id=p_game and status='pending' and created_at<now()-interval '48 hours';
 daily_penalty=least(3,floor(pending/3)*s.backlog_penalty);
 if daily_penalty>0 then
   perform private.apply_event_trust_delta(p_game,'backlog-'||to_char(now() at time zone 'UTC','YYYY-MM-DD'),
      -daily_penalty,'Накоплено '||pending||' необработанных ситуаций старше 48 часов: -'||daily_penalty||' п.п. доверия');
 end if;
end;
$$;
revoke all on function private.apply_event_trust(uuid) from public,anon,authenticated;

create or replace function public.submit_event_decision(p_assignment_id uuid,p_choice text,p_rationale text default null)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare a public.event_assignments%rowtype;
begin
 select * into a from public.event_assignments where id=p_assignment_id for update;
 if not found or a.recipient_id<>auth.uid() then raise exception 'Assignment unavailable';end if;
 if a.status<>'pending' then raise exception 'Already decided';end if;
 if p_choice not in ('accept','reject') then raise exception 'Invalid choice';end if;
 insert into public.event_decisions(assignment_id,case_id,game_id,actor_id,choice,rationale)
 values(a.id,a.case_id,a.game_id,auth.uid(),p_choice,p_rationale);
 update public.event_assignments set status=case when p_choice='accept' then 'accepted' else 'rejected' end where id=a.id;
 perform private.apply_event_trust(a.game_id);
end;
$$;
revoke all on function public.submit_event_decision(uuid,text,text) from public,anon;
grant execute on function public.submit_event_decision(uuid,text,text) to authenticated;

create or replace function public.configure_game_event_autopilot(
 p_game_id uuid,p_enabled boolean,p_interval_hours integer,p_activity_weight numeric,
 p_max_daily integer,p_trust_per_20 numeric,p_backlog_penalty numeric)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher access required';end if;
 if p_interval_hours not between 4 and 72 or p_activity_weight not between 0 and 2
    or p_max_daily not between 1 and 3 or p_trust_per_20 not between 0 and 4
    or p_backlog_penalty not between 0 and 2 then raise exception 'Invalid event settings';end if;
 perform private.seed_event_bank(p_game_id);
 insert into public.event_auto_settings(game_id,enabled,interval_hours,activity_weight,max_daily,trust_per_20,backlog_penalty)
 values(p_game_id,p_enabled,p_interval_hours,p_activity_weight,p_max_daily,p_trust_per_20,p_backlog_penalty)
 on conflict(game_id) do update set enabled=excluded.enabled,interval_hours=excluded.interval_hours,
 activity_weight=excluded.activity_weight,max_daily=excluded.max_daily,trust_per_20=excluded.trust_per_20,
 backlog_penalty=excluded.backlog_penalty,updated_at=now();
end;
$$;
revoke all on function public.configure_game_event_autopilot(uuid,boolean,integer,numeric,integer,numeric,numeric) from public,anon;
grant execute on function public.configure_game_event_autopilot(uuid,boolean,integer,numeric,integer,numeric,numeric) to authenticated;

create or replace function private.run_game_autopilot(p_game uuid)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare s public.event_auto_settings%rowtype;u record;v_case uuid;v_today integer;v_pending integer;
 v_last timestamptz;idle_hours numeric;effective_interval numeric;dispatched integer:=0;v_recent int;
begin
 select * into s from public.event_auto_settings where game_id=p_game for update;
 if not found or not s.enabled then return jsonb_build_object('sent',0,'reason','paused');end if;
 if s.last_run_at is not null and s.last_run_at>now()-interval '55 minutes'
 then return jsonb_build_object('sent',0,'reason','already_checked');end if;
 for u in select gm.user_id,gm.role_title,gp.last_seen_at
 from public.game_members gm
 left join public.game_presence gp on gp.game_id=gm.game_id and gp.user_id=gm.user_id
 where gm.game_id=p_game and gm.kind='student' order by random() loop
   select count(*) into v_today from public.event_assignments
     where game_id=p_game and recipient_id=u.user_id and created_at>=now()-interval '24 hours';
   if v_today>=s.max_daily then continue;end if;
   select count(*),max(created_at) into v_pending,v_last from public.event_assignments
      where game_id=p_game and recipient_id=u.user_id and status='pending';
   if v_pending>=3 then continue;end if;
   select max(created_at) into v_last from public.event_assignments
      where game_id=p_game and recipient_id=u.user_id;
   idle_hours=least(120,greatest(0,extract(epoch from(now()-coalesce(u.last_seen_at,now()-interval '72 hours')))/3600));
   -- I = max(4, base_interval / (1 + activity_weight * min(2, idle_hours/48))).
   effective_interval=greatest(4,s.interval_hours/(1+s.activity_weight*least(2,idle_hours/48)));
   if v_last is not null and v_last>now()-(effective_interval*interval '1 hour') then continue;end if;
   select ec.id into v_case from public.event_cases ec
   where ec.game_id=p_game and ec.status='ready' and ec.case_key like 'bank-%'
     and (coalesce(array_length(ec.allowed_roles,1),0)=0 or exists
         (select 1 from unnest(ec.allowed_roles) role where lower(coalesce(u.role_title,'')) like '%'||lower(role)||'%'))
     and not exists(select 1 from public.event_assignments ea
       where ea.case_id=ec.id and ea.recipient_id=u.user_id)
   order by case when idle_hours>=48 and s.activity_weight>=1 and ec.seriousness='light' then 0
             when idle_hours<48 and ec.seriousness='serious' then 0 else 1 end,random()
   limit 1;
   if v_case is null then continue;end if;
   insert into public.event_assignments(case_id,game_id,recipient_id,created_by)
   values(v_case,p_game,u.user_id,null);
   dispatched=dispatched+1;
 end loop;
 update public.event_auto_settings set last_run_at=now() where game_id=p_game;
 perform private.apply_event_trust(p_game);
 return jsonb_build_object('sent',dispatched,'checked_at',now());
end;
$$;
revoke all on function private.run_game_autopilot(uuid) from public,anon,authenticated;

create or replace function private.run_all_game_autopilots()
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare item record;
begin
 for item in select s.game_id from public.event_auto_settings s join public.games g on g.id=s.game_id
   where s.enabled and g.status not in ('finished','archived') loop
   perform private.run_game_autopilot(item.game_id);
 end loop;
end;
$$;
revoke all on function private.run_all_game_autopilots() from public,anon,authenticated;

create or replace function public.run_game_event_autopilot(p_game_id uuid)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher access required';end if;
 return private.run_game_autopilot(p_game_id);
end;
$$;
revoke all on function public.run_game_event_autopilot(uuid) from public,anon;
grant execute on function public.run_game_event_autopilot(uuid) to authenticated;
