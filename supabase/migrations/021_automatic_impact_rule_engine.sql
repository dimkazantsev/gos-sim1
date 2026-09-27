-- Teacher-controlled automatic impact engine for meaningful game events.

create table if not exists public.impact_rules(
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  rule_key text not null,
  label text not null,
  event_type text not null,
  description text,
  conditions jsonb not null default '{}'::jsonb,
  effects jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  auto_apply boolean not null default true,
  priority integer not null default 100,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(game_id,rule_key)
);

alter table public.impact_rules enable row level security;
grant select on public.impact_rules to authenticated;
drop policy if exists impact_rules_read on public.impact_rules;
create policy impact_rules_read on public.impact_rules
for select to authenticated using(private.is_game_member(game_id));

create table if not exists public.impact_ledger(
  id bigserial primary key,
  game_id uuid not null references public.games(id) on delete cascade,
  rule_id uuid references public.impact_rules(id) on delete set null,
  rule_key text not null,
  source_type text not null,
  source_id text not null,
  actor_id uuid references auth.users(id) on delete set null,
  effects jsonb not null default '{}'::jsonb,
  note text,
  status text not null default 'applied' check(status in ('applied','reverted','adjusted')),
  created_at timestamptz not null default now(),
  reverted_at timestamptz,
  unique(game_id,rule_key,source_type,source_id)
);

create index if not exists impact_ledger_game_time_idx on public.impact_ledger(game_id,created_at desc);

alter table public.impact_ledger enable row level security;
grant select on public.impact_ledger to authenticated;
drop policy if exists impact_ledger_read on public.impact_ledger;
create policy impact_ledger_read on public.impact_ledger
for select to authenticated using(private.is_game_member(game_id));

create or replace function private.impact_condition_matches(p_conditions jsonb,p_context jsonb)
returns boolean
language plpgsql stable
set search_path=public,private,pg_temp
as $$
declare kv record;actual text;allowed jsonb;
begin
  if p_conditions is null or p_conditions='{}'::jsonb then return true;end if;
  for kv in select key,value from jsonb_each(p_conditions)
  loop
    actual:=coalesce(p_context->>kv.key,'');
    allowed:=kv.value;
    if jsonb_typeof(allowed)='array' then
      if not exists(select 1 from jsonb_array_elements_text(allowed) x where x=actual) then return false;end if;
    else
      if actual<>trim(both '"' from allowed::text) then return false;end if;
    end if;
  end loop;
  return true;
end;
$$;

create or replace function private.apply_rule_effects(
 p_game uuid,p_rule public.impact_rules,p_source_type text,p_source_id text,p_actor uuid,p_context jsonb,p_note text
) returns boolean
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare
 kv record;
 m public.state_metrics%rowtype;
 party public.game_parties%rowtype;
 delta numeric;
 v_old numeric;
 v_new numeric;
 v_actual numeric;
 v_actual_metrics jsonb:='{}'::jsonb;
 v_actual_effects jsonb:='{}'::jsonb;
begin
 if not p_rule.enabled or not p_rule.auto_apply then return false;end if;
 if not private.impact_condition_matches(p_rule.conditions,p_context) then return false;end if;
 if exists(
   select 1 from public.impact_ledger
   where game_id=p_game and rule_key=p_rule.rule_key
     and source_type=p_source_type and source_id=p_source_id
 ) then return false;end if;

 for kv in select key,value from jsonb_each_text(coalesce(p_rule.effects->'metrics','{}'::jsonb))
 loop
   delta:=kv.value::numeric;
   select * into m from public.state_metrics where game_id=p_game and metric_key=kv.key;
   if m.id is not null and delta<>0 then
     v_old:=m.value;
     v_new:=v_old+delta;
     if m.min_value is not null then v_new:=greatest(m.min_value,v_new);end if;
     if m.max_value is not null then v_new:=least(m.max_value,v_new);end if;
     v_actual:=v_new-v_old;
     if v_actual<>0 then
       perform private.record_metric_change(
         p_game,kv.key,v_new,'rule:'||p_rule.rule_key,p_source_id,p_actor,coalesce(p_note,p_rule.label)
       );
       v_actual_metrics:=v_actual_metrics||jsonb_build_object(kv.key,v_actual);
     end if;
   end if;
 end loop;

 v_actual_effects:=jsonb_build_object('metrics',v_actual_metrics);

 if (p_rule.effects ? 'actor_party_support') and p_actor is not null then
   select gp.* into party
   from public.game_members gm
   join public.game_parties gp on gp.game_id=gm.game_id and gp.name=gm.team
   where gm.game_id=p_game and gm.user_id=p_actor
   limit 1;

   if party.id is not null then
     delta:=(p_rule.effects->>'actor_party_support')::numeric;
     v_old:=party.support;
     v_new:=least(100,greatest(0,v_old+delta));
     v_actual:=v_new-v_old;
     if v_actual<>0 then
       update public.game_parties set support=v_new where id=party.id;
       insert into public.party_support_history(
         game_id,party_id,value,previous_value,delta,source_type,source_id
       )
       values(p_game,party.id,v_new,v_old,v_actual,'rule:'||p_rule.rule_key,p_source_id);
       v_actual_effects:=v_actual_effects||jsonb_build_object('actor_party_support',v_actual);
     end if;
   end if;
 end if;

 insert into public.impact_ledger(
   game_id,rule_id,rule_key,source_type,source_id,actor_id,effects,note
 )
 values(
   p_game,p_rule.id,p_rule.rule_key,p_source_type,p_source_id,p_actor,
   v_actual_effects,coalesce(p_note,p_rule.label)
 );

 return true;
end;
$$;

create or replace function private.run_impact_rules(
 p_game uuid,p_event_type text,p_source_type text,p_source_id text,p_actor uuid,p_context jsonb,p_note text default null
) returns integer
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare r public.impact_rules%rowtype;n integer:=0;
begin
 for r in
   select *
   from public.impact_rules
   where game_id=p_game and event_type=p_event_type and enabled=true
   order by priority,id
 loop
   if private.apply_rule_effects(
     p_game,r,p_source_type,p_source_id,p_actor,coalesce(p_context,'{}'::jsonb),p_note
   ) then n:=n+1;end if;
 end loop;
 return n;
end;
$$;

create or replace function public.update_impact_rule(
 p_rule_id uuid,p_enabled boolean,p_auto_apply boolean,p_effects jsonb,p_description text default null
) returns void
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare r public.impact_rules%rowtype;
begin
 select * into r from public.impact_rules where id=p_rule_id;
 if r.id is null then raise exception 'Rule not found';end if;
 if not private.is_game_teacher(r.game_id) then raise exception 'Teacher access required';end if;

 update public.impact_rules
 set enabled=p_enabled,
     auto_apply=p_auto_apply,
     effects=coalesce(p_effects,'{}'::jsonb),
     description=coalesce(p_description,description),
     updated_at=now()
 where id=p_rule_id;
end;
$$;
revoke all on function public.update_impact_rule(uuid,boolean,boolean,jsonb,text) from public,anon;
grant execute on function public.update_impact_rule(uuid,boolean,boolean,jsonb,text) to authenticated;

create or replace function public.revert_impact_entry(p_ledger_id bigint)
returns void
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare
 l public.impact_ledger%rowtype;
 kv record;
 m public.state_metrics%rowtype;
 party public.game_parties%rowtype;
 delta numeric;
 v_old numeric;
 v_new numeric;
begin
 select * into l from public.impact_ledger where id=p_ledger_id for update;
 if l.id is null then raise exception 'Impact entry not found';end if;
 if not private.is_game_teacher(l.game_id) then raise exception 'Teacher access required';end if;
 if l.status='reverted' then return;end if;

 for kv in select key,value from jsonb_each_text(coalesce(l.effects->'metrics','{}'::jsonb))
 loop
   delta:=kv.value::numeric;
   select * into m from public.state_metrics where game_id=l.game_id and metric_key=kv.key;
   if m.id is not null and delta<>0 then
     perform private.record_metric_change(
       l.game_id,kv.key,m.value-delta,'rule_revert:'||l.rule_key,l.id::text,
       (select auth.uid()),'Отмена автоматического эффекта: '||coalesce(l.note,l.rule_key)
     );
   end if;
 end loop;

 if (l.effects ? 'actor_party_support') and l.actor_id is not null then
   select gp.* into party
   from public.game_members gm
   join public.game_parties gp on gp.game_id=gm.game_id and gp.name=gm.team
   where gm.game_id=l.game_id and gm.user_id=l.actor_id
   limit 1;

   if party.id is not null then
     delta:=(l.effects->>'actor_party_support')::numeric;
     v_old:=party.support;
     v_new:=least(100,greatest(0,v_old-delta));
     update public.game_parties set support=v_new where id=party.id;
     insert into public.party_support_history(
       game_id,party_id,value,previous_value,delta,source_type,source_id
     )
     values(l.game_id,party.id,v_new,v_old,v_new-v_old,'rule_revert:'||l.rule_key,l.id::text);
   end if;
 end if;

 update public.impact_ledger
 set status='reverted',reverted_at=now()
 where id=l.id;
end;
$$;
revoke all on function public.revert_impact_entry(bigint) from public,anon;
grant execute on function public.revert_impact_entry(bigint) to authenticated;

create or replace function private.impact_post_insert_trigger()
returns trigger
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
begin
 perform private.run_impact_rules(
   new.game_id,'post_published','political_post',new.id::text,new.author_id,
   jsonb_build_object('process_type',new.process_type,'actor_key',new.actor_key),
   'Публикация: '||new.title
 );
 return new;
end;
$$;
drop trigger if exists trg_impact_post_insert on public.political_posts;
create trigger trg_impact_post_insert
after insert on public.political_posts
for each row execute function private.impact_post_insert_trigger();

create or replace function private.impact_decision_insert_trigger()
returns trigger
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare p public.political_posts%rowtype;
begin
 select * into p from public.political_posts where id=new.post_id;
 perform private.run_impact_rules(
   new.game_id,'decision_accepted','political_decision',new.id::text,
   coalesce(new.decided_by,p.author_id),
   jsonb_build_object(
     'decision_method',new.decision_method,
     'actor_key',coalesce(p.actor_key,''),
     'process_type',coalesce(p.process_type,'')
   ),
   'Принято решение: '||new.title
 );
 return new;
end;
$$;
drop trigger if exists trg_impact_decision_insert on public.political_decisions;
create trigger trg_impact_decision_insert
after insert on public.political_decisions
for each row execute function private.impact_decision_insert_trigger();

create or replace function private.impact_vote_close_trigger()
returns trigger
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
begin
 if new.status='closed' and old.status='open' then
   perform private.run_impact_rules(
     new.game_id,'vote_closed','vote',new.id::text,new.created_by,
     jsonb_build_object(
       'result_code',coalesce(new.result_code,''),
       'institution_key',new.institution_key,
       'procedure_key',new.procedure_key
     ),
     'Итог голосования: '||new.title||' — '||coalesce(new.result_label,new.result_code,'')
   );
 end if;
 return new;
end;
$$;
drop trigger if exists trg_impact_vote_close on public.game_votes;
create trigger trg_impact_vote_close
after update of status,result_code on public.game_votes
for each row execute function private.impact_vote_close_trigger();

create or replace function private.impact_formal_history_trigger()
returns trigger
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare d public.formal_documents%rowtype;
begin
 select * into d from public.formal_documents where id=new.document_id;
 if d.id is not null then
   perform private.run_impact_rules(
     new.game_id,'formal_transition','formal_history',new.id::text,new.actor_id,
     jsonb_build_object(
       'action',new.action,
       'to_status',coalesce(new.to_status,''),
       'doc_type',d.doc_type,
       'subject_key',d.subject_key
     ),
     'НПА: '||d.title||' → '||coalesce(new.to_status,new.action)
   );
 end if;
 return new;
end;
$$;
drop trigger if exists trg_impact_formal_history on public.formal_document_history;
create trigger trg_impact_formal_history
after insert on public.formal_document_history
for each row execute function private.impact_formal_history_trigger();

create or replace function private.impact_crisis_insert_trigger()
returns trigger
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
begin
 perform private.run_impact_rules(
   new.game_id,'crisis','crisis',new.id::text,new.created_by,
   jsonb_build_object('intensity',new.intensity,'crisis_type',new.crisis_type),
   'Кризис: '||new.crisis_type||' · '||new.intensity
 );
 return new;
end;
$$;
drop trigger if exists trg_impact_crisis_insert on public.game_crises;
create trigger trg_impact_crisis_insert
after insert on public.game_crises
for each row execute function private.impact_crisis_insert_trigger();

insert into public.impact_rules(
 game_id,rule_key,label,event_type,description,conditions,effects,priority
)
select g.id,x.rule_key,x.label,x.event_type,x.description,x.conditions,x.effects,x.priority
from public.games g
cross join (values
 ('post_official','Публичное действие власти','post_published',
  'Официальная публикация слегка усиливает информационный фон. Это игровой эффект видимости, а не оценка содержания.',
  '{"actor_key":["president","government","gd","sf","ministry","municipality"]}'::jsonb,
  '{"metrics":{"media_climate":0.3}}'::jsonb,100),

 ('post_media','Публикация СМИ','post_published',
  'Публикация от СМИ увеличивает интенсивность информационной повестки.',
  '{"actor_key":"media"}'::jsonb,
  '{"metrics":{"media_climate":0.5}}'::jsonb,110),

 ('decision_accept','Принятое решение','decision_accepted',
  'Формально принятое решение повышает показатель управленческой определённости и немного влияет на доверие; содержательные последствия преподаватель может дополнить отдельно.',
  '{}'::jsonb,
  '{"metrics":{"lawfulness":0.6,"public_trust":0.3},"actor_party_support":0.2}'::jsonb,100),

 ('vote_passed','Решение принято голосованием','vote_closed',
  'Успешно завершённая процедура голосования укрепляет процедурную устойчивость.',
  '{"result_code":"passed"}'::jsonb,
  '{"metrics":{"lawfulness":0.5}}'::jsonb,100),

 ('vote_no_quorum','Срыв кворума','vote_closed',
  'Отсутствие кворума снижает процедурную устойчивость и доверие к управляемости процесса.',
  '{"result_code":"no_quorum"}'::jsonb,
  '{"metrics":{"lawfulness":-1.2,"public_trust":-0.5}}'::jsonb,90),

 ('formal_published','НПА завершил процедуру','formal_transition',
  'Завершение нормативной процедуры повышает правовую устойчивость.',
  '{"to_status":["published","signed","adopted"]}'::jsonb,
  '{"metrics":{"lawfulness":0.8}}'::jsonb,100),

 ('crisis_low','Кризис низкой интенсивности','crisis',
  'Игровой шок низкой интенсивности.',
  '{"intensity":"low"}'::jsonb,
  '{"metrics":{"social_stability":-1,"public_trust":-0.5,"security":-0.5}}'::jsonb,50),

 ('crisis_medium','Кризис средней интенсивности','crisis',
  'Игровой шок средней интенсивности.',
  '{"intensity":"medium"}'::jsonb,
  '{"metrics":{"social_stability":-2.5,"public_trust":-1,"security":-1.5,"economy":-0.5}}'::jsonb,50),

 ('crisis_high','Кризис высокой интенсивности','crisis',
  'Игровой шок высокой интенсивности.',
  '{"intensity":"high"}'::jsonb,
  '{"metrics":{"social_stability":-5,"public_trust":-2.5,"security":-3,"economy":-1.5,"elite_support":-1}}'::jsonb,50),

 ('crisis_ultra','Кризис сверхвысокой интенсивности','crisis',
  'Сильный игровой шок.',
  '{"intensity":"ultra"}'::jsonb,
  '{"metrics":{"social_stability":-9,"public_trust":-5,"security":-6,"economy":-3,"elite_support":-2,"international_standing":-2}}'::jsonb,50)
) as x(rule_key,label,event_type,description,conditions,effects,priority)
where not exists(
 select 1 from public.impact_rules r
 where r.game_id=g.id and r.rule_key=x.rule_key
);

do $$
begin
 if not exists(
   select 1 from pg_publication_tables
   where pubname='supabase_realtime' and schemaname='public' and tablename='impact_rules'
 ) then
   alter publication supabase_realtime add table public.impact_rules;
 end if;
 if not exists(
   select 1 from pg_publication_tables
   where pubname='supabase_realtime' and schemaname='public' and tablename='impact_ledger'
 ) then
   alter publication supabase_realtime add table public.impact_ledger;
 end if;
end $$;
