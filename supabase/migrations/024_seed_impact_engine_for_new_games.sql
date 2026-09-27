-- Seed new games with the expanded KPI model and automatic impact rules.

create or replace function private.seed_game_simulation_defaults(p_game uuid)
returns void
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
begin
  insert into public.state_metrics(
    game_id,metric_key,label,value,previous_value,unit,is_public,
    group_key,description,min_value,max_value,sort_order
  )
  values
    (p_game,'public_trust','Доверие граждан',50,null,'%',true,'society','Игровой индекс доверия граждан к публичной власти и принимаемым решениям.',0,100,10),
    (p_game,'elite_support','Поддержка элит',50,null,'%',true,'elites','Игровой индекс поддержки со стороны политико-административных и экономических элит.',0,100,30),
    (p_game,'international_standing','Международное положение',50,null,'%',true,'international','Игровой индекс внешнеполитического положения и отношения международных акторов.',0,100,50),
    (p_game,'social_stability','Социальная стабильность',50,null,'%',true,'society','Игровой индекс устойчивости общественных отношений и управляемости конфликтов.',0,100,35),
    (p_game,'media_climate','Информационный фон',50,null,'%',true,'society','Игровой индекс общего информационного фона вокруг власти и политических акторов.',0,100,45),
    (p_game,'lawfulness','Правовая устойчивость',70,null,'%',true,'state','Игровой индекс соблюдения процедур, компетенций и нормативных ограничений.',0,100,55)
  on conflict(game_id,metric_key) do nothing;

  insert into public.impact_rules(
    game_id,rule_key,label,event_type,description,conditions,effects,priority
  )
  values
   (p_game,'post_official','Публичное действие власти','post_published',
    'Официальная публикация слегка усиливает информационный фон. Это игровой эффект видимости, а не оценка содержания.',
    '{"actor_key":["president","government","gd","sf","ministry","municipality"]}'::jsonb,
    '{"metrics":{"media_climate":0.3}}'::jsonb,100),
   (p_game,'post_media','Публикация СМИ','post_published',
    'Публикация от СМИ увеличивает интенсивность информационной повестки.',
    '{"actor_key":"media"}'::jsonb,'{"metrics":{"media_climate":0.5}}'::jsonb,110),
   (p_game,'decision_accept','Принятое решение','decision_accepted',
    'Формально принятое решение повышает процедурную устойчивость и немного влияет на доверие; содержательные последствия преподаватель может дополнить отдельно.',
    '{}'::jsonb,'{"metrics":{"lawfulness":0.6,"public_trust":0.3},"actor_party_support":0.2}'::jsonb,100),
   (p_game,'vote_passed','Решение принято голосованием','vote_closed',
    'Успешно завершённая процедура голосования укрепляет процедурную устойчивость.',
    '{"result_code":"passed"}'::jsonb,'{"metrics":{"lawfulness":0.5}}'::jsonb,100),
   (p_game,'vote_no_quorum','Срыв кворума','vote_closed',
    'Отсутствие кворума снижает процедурную устойчивость и доверие к управляемости процесса.',
    '{"result_code":"no_quorum"}'::jsonb,'{"metrics":{"lawfulness":-1.2,"public_trust":-0.5}}'::jsonb,90),
   (p_game,'formal_published','НПА завершил процедуру','formal_transition',
    'Завершение нормативной процедуры повышает правовую устойчивость.',
    '{"to_status":["published","signed","adopted"]}'::jsonb,'{"metrics":{"lawfulness":0.8}}'::jsonb,100),
   (p_game,'crisis_low','Кризис низкой интенсивности','crisis','Игровой шок низкой интенсивности.',
    '{"intensity":"low"}'::jsonb,'{"metrics":{"social_stability":-1,"public_trust":-0.5,"security":-0.5}}'::jsonb,50),
   (p_game,'crisis_medium','Кризис средней интенсивности','crisis','Игровой шок средней интенсивности.',
    '{"intensity":"medium"}'::jsonb,'{"metrics":{"social_stability":-2.5,"public_trust":-1,"security":-1.5,"economy":-0.5}}'::jsonb,50),
   (p_game,'crisis_high','Кризис высокой интенсивности','crisis','Игровой шок высокой интенсивности.',
    '{"intensity":"high"}'::jsonb,'{"metrics":{"social_stability":-5,"public_trust":-2.5,"security":-3,"economy":-1.5,"elite_support":-1}}'::jsonb,50),
   (p_game,'crisis_ultra','Кризис сверхвысокой интенсивности','crisis','Сильный игровой шок.',
    '{"intensity":"ultra"}'::jsonb,'{"metrics":{"social_stability":-9,"public_trust":-5,"security":-6,"economy":-3,"elite_support":-2,"international_standing":-2}}'::jsonb,50)
  on conflict(game_id,rule_key) do nothing;
end;
$$;

create or replace function private.seed_game_simulation_defaults_trigger()
returns trigger
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
begin
  perform private.seed_game_simulation_defaults(new.id);
  return new;
end;
$$;

drop trigger if exists trg_seed_game_simulation_defaults on public.games;
create trigger trg_seed_game_simulation_defaults
after insert on public.games
for each row execute function private.seed_game_simulation_defaults_trigger();

create or replace function private.metric_baseline_trigger()
returns trigger
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
begin
  insert into public.state_metric_history(
    game_id,metric_id,metric_key,value,previous_value,delta,
    source_type,source_id,note,recorded_at
  )
  values(
    new.game_id,new.id,new.metric_key,new.value,new.previous_value,0,
    'baseline',new.id::text,'Начальная точка показателя',new.updated_at
  );
  return new;
end;
$$;

drop trigger if exists trg_metric_baseline on public.state_metrics;
create trigger trg_metric_baseline
after insert on public.state_metrics
for each row execute function private.metric_baseline_trigger();

do $$
declare g record;
begin
  for g in select id from public.games loop
    perform private.seed_game_simulation_defaults(g.id);
  end loop;
end $$;
