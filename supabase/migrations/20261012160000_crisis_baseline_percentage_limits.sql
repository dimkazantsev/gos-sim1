-- Crisis baseline for the fictional republic (Day Zero).
-- Real-world statistics are not being asserted. No financial amount is converted to a percent.
-- Apply only once to the named stage-one PAU game; all historical decisions remain recorded.

create or replace function private.clamp_percentage_state_metric()
returns trigger
language plpgsql
set search_path=public,private,pg_temp
as $$
begin
 if new.unit='%' then
   new.min_value:=0;
   new.max_value:=100;
   new.value:=least(100,greatest(0,new.value));
   if new.previous_value is not null then
     new.previous_value:=least(100,greatest(0,new.previous_value));
   end if;
 end if;
 return new;
end;
$$;

drop trigger if exists trg_state_metric_percent_bounds on public.state_metrics;
create trigger trg_state_metric_percent_bounds
before insert or update on public.state_metrics
for each row execute function private.clamp_percentage_state_metric();

alter table public.state_metrics
drop constraint if exists state_metric_percentage_range;
alter table public.state_metrics
add constraint state_metric_percentage_range
check (
 unit is distinct from '%'
 or (
  value between 0 and 100
  and min_value = 0 and max_value = 100
  and (previous_value is null or previous_value between 0 and 100)
 )
);

-- This trigger runs after the existing trg_seed_game_simulation_defaults:
-- it replaces only newly created game baselines and never resets an ongoing game.
create or replace function private.seed_crisis_start_on_new_game()
returns trigger
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare
 record_metric record;
 metric_row public.state_metrics%rowtype;
begin
 for record_metric in
  select * from (values
   ('public_trust','Доверие граждан',12::numeric,'society','Кризис доверия к институтам власти.',10),
   ('economy','Экономика',16::numeric,'economy','Снижение деловой активности и простой предприятий.',60),
   ('social_stability','Социальная стабильность',14::numeric,'society','Высокая конфликтность и низкая устойчивость общественных отношений.',35),
   ('lawfulness','Правовая устойчивость',19::numeric,'state','Нарушение процедур и институциональные ограничения.',55),
   ('international_standing','Международное положение',15::numeric,'international','Сложная внешнеполитическая обстановка.',50),
   ('legitimacy','Легитимность',17::numeric,'society','Низкое признание действующих публичных институтов.',20),
   ('elite_support','Поддержка элит',18::numeric,'elites','Неустойчивые договорённости внутри элит.',30),
   ('media_climate','Информационный фон',13::numeric,'society','Преобладание негативной повестки и недоверия.',45),
   ('security','Безопасность',20::numeric,'state','Недостаточная устойчивость институтов безопасности.',80),
   ('social_tension','Социальное напряжение',86::numeric,'society','Высокое напряжение: снижение индекса означает улучшение.',40)
  ) as v(metric_key,label,start_value,group_key,description,sort_order)
 loop
  insert into public.state_metrics(
   game_id,metric_key,label,value,previous_value,unit,is_public,group_key,
   description,min_value,max_value,sort_order
  ) values(
   new.id,record_metric.metric_key,record_metric.label,record_metric.start_value,
   null,'%',true,record_metric.group_key,record_metric.description,0,100,record_metric.sort_order
  )
  on conflict(game_id,metric_key)
  do update set value=excluded.value,previous_value=null,min_value=0,max_value=100,
                description=excluded.description,updated_at=now();
  -- A new game has not begun: correct the automatically recorded baseline too,
  -- so charts never display a false pre-crisis prosperity at Day Zero.
  select * into metric_row from public.state_metrics
  where game_id=new.id and metric_key=record_metric.metric_key;
  update public.state_metric_history
    set value=record_metric.start_value,previous_value=null,delta=0,
        note='Пролог · День ноль: кризисные исходные условия'
    where metric_id=metric_row.id and source_type='baseline';
 end loop;
 return new;
end;
$$;

drop trigger if exists trg_zz_crisis_game_start on public.games;
create trigger trg_zz_crisis_game_start
after insert on public.games
for each row execute function private.seed_crisis_start_on_new_game();

-- The one existing PAU game is still on stage one. Preserve its real audit
-- history and all linked impact ledgers. Append an explicit re-baseline entry,
-- without replaying already applied decisions or touching the monetary budget.
do $$
declare
 target_game uuid;
 matched_games integer;
 mark text:='20261012:crisis-start';
 current_metric public.state_metrics%rowtype;
 target record;
begin
 select count(*) into matched_games
 from public.games where title='ПАУ' and current_round=1;
 select id into target_game from public.games where title='ПАУ' and current_round=1 limit 1;
 if matched_games <> 1 then
  raise exception 'PAU crisis calibration refused: expected exactly one named stage-one game, found %',matched_games;
 end if;
 if exists(
  select 1 from public.state_metric_history
  where game_id=target_game and source_type='crisis_rebaseline' and source_id=mark
 ) then return;end if;

 for target in
  select * from (values
   ('public_trust',12::numeric),
   ('economy',16::numeric),
   ('social_stability',14::numeric),
   ('lawfulness',19::numeric),
   ('international_standing',15::numeric),
   ('legitimacy',17::numeric),
   ('elite_support',18::numeric),
   ('media_climate',13::numeric),
   ('security',20::numeric),
   ('social_tension',86::numeric)
  ) as v(metric_key,target_value)
 loop
  select * into current_metric from public.state_metrics
   where game_id=target_game and metric_key=target.metric_key for update;
  if current_metric.id is null or current_metric.unit<>'%' then
   raise exception 'Expected percentage metric is missing: %',target.metric_key;
  end if;
  if current_metric.value is distinct from target.target_value then
   update public.state_metrics
   set value=target.target_value,previous_value=target.target_value,
       min_value=0,max_value=100,updated_at=now()
   where id=current_metric.id;
   insert into public.state_metric_history(
    game_id,metric_id,metric_key,value,previous_value,delta,
    source_type,source_id,actor_id,note
   ) values(
    target_game,current_metric.id,target.metric_key,target.target_value,
    current_metric.value,target.target_value-current_metric.value,
    'crisis_rebaseline',mark,null,
    'Перекалибровка исходной кризисной фабулы ПАУ. Прежняя история сохранена; это не результат игрового решения.'
   );
  end if;
 end loop;
end;
$$;
