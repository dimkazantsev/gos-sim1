-- Unified political wall, accepted decisions and metric history.
alter table public.state_metrics
  add column if not exists group_key text not null default 'state',
  add column if not exists description text,
  add column if not exists min_value numeric,
  add column if not exists max_value numeric,
  add column if not exists sort_order integer not null default 100;

create table if not exists public.state_metric_history(
 id bigserial primary key,
 game_id uuid not null references public.games(id) on delete cascade,
 metric_id uuid references public.state_metrics(id) on delete set null,
 metric_key text not null,
 value numeric not null,
 previous_value numeric,
 delta numeric,
 source_type text not null default 'system',
 source_id text,
 actor_id uuid references auth.users(id) on delete set null,
 note text,
 recorded_at timestamptz not null default now()
);
create index if not exists state_metric_history_game_key_time_idx on public.state_metric_history(game_id,metric_key,recorded_at desc);
alter table public.state_metric_history enable row level security;
grant select on public.state_metric_history to authenticated;
drop policy if exists metric_history_read on public.state_metric_history;
create policy metric_history_read on public.state_metric_history for select to authenticated using(private.is_game_member(game_id));

create table if not exists public.political_posts(
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 author_id uuid not null references auth.users(id) on delete cascade,
 process_type text not null default 'statement',
 actor_key text not null default 'participant',
 actor_label text not null default 'Участник',
 title text not null,
 body text not null,
 tags text[] not null default '{}',
 external_url text,
 internal_view text,
 internal_ref_id text,
 status text not null default 'published' check(status in ('published','accepted','rejected')),
 impact_plan jsonb not null default '{"metrics":{}}'::jsonb,
 impact_approved_by uuid references auth.users(id) on delete set null,
 impact_approved_at timestamptz,
 effects_applied boolean not null default false,
 accepted_by uuid references auth.users(id) on delete set null,
 accepted_at timestamptz,
 pinned boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists political_posts_game_time_idx on public.political_posts(game_id,created_at desc);
create index if not exists political_posts_tags_gin on public.political_posts using gin(tags);
alter table public.political_posts enable row level security;
grant select on public.political_posts to authenticated;
drop policy if exists political_posts_read on public.political_posts;
create policy political_posts_read on public.political_posts for select to authenticated using(private.is_game_member(game_id));

create table if not exists public.political_post_media(
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 post_id uuid not null references public.political_posts(id) on delete cascade,
 uploader_id uuid not null references auth.users(id) on delete cascade,
 media_kind text not null check(media_kind in ('image','audio','video','file')),
 storage_path text not null,
 file_name text not null,
 mime_type text,
 file_size bigint,
 created_at timestamptz not null default now()
);
create index if not exists political_post_media_post_idx on public.political_post_media(post_id);
alter table public.political_post_media enable row level security;
grant select,insert on public.political_post_media to authenticated;
drop policy if exists political_post_media_read on public.political_post_media;
create policy political_post_media_read on public.political_post_media for select to authenticated using(private.is_game_member(game_id));
drop policy if exists political_post_media_insert on public.political_post_media;
create policy political_post_media_insert on public.political_post_media for insert to authenticated with check(private.is_game_member(game_id) and uploader_id=(select auth.uid()));

create table if not exists public.political_post_formal_links(
 game_id uuid not null references public.games(id) on delete cascade,
 post_id uuid not null references public.political_posts(id) on delete cascade,
 formal_document_id uuid not null references public.formal_documents(id) on delete cascade,
 created_by uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(post_id,formal_document_id)
);
alter table public.political_post_formal_links enable row level security;
grant select,insert,delete on public.political_post_formal_links to authenticated;
drop policy if exists post_formal_links_read on public.political_post_formal_links;
create policy post_formal_links_read on public.political_post_formal_links for select to authenticated using(private.is_game_member(game_id));
drop policy if exists post_formal_links_write on public.political_post_formal_links;
create policy post_formal_links_write on public.political_post_formal_links for all to authenticated
 using(private.is_game_teacher(game_id) or created_by=(select auth.uid()))
 with check(private.is_game_member(game_id) and created_by=(select auth.uid()));

create sequence if not exists public.political_decision_seq;
create table if not exists public.political_decisions(
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 registry_no text not null unique,
 post_id uuid not null unique references public.political_posts(id) on delete cascade,
 vote_id uuid references public.game_votes(id) on delete set null,
 title text not null,
 actor_label text not null,
 decided_by uuid references auth.users(id) on delete set null,
 decision_method text not null check(decision_method in ('teacher','vote')),
 impact_snapshot jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create index if not exists political_decisions_game_time_idx on public.political_decisions(game_id,created_at desc);
alter table public.political_decisions enable row level security;
grant select on public.political_decisions to authenticated;
drop policy if exists political_decisions_read on public.political_decisions;
create policy political_decisions_read on public.political_decisions for select to authenticated using(private.is_game_member(game_id));

alter table public.game_votes add column if not exists source_post_id uuid references public.political_posts(id) on delete set null;
create index if not exists game_votes_source_post_idx on public.game_votes(source_post_id);

create table if not exists public.party_support_history(
 id bigserial primary key,
 game_id uuid not null references public.games(id) on delete cascade,
 party_id uuid not null references public.game_parties(id) on delete cascade,
 value numeric not null,
 previous_value numeric,
 delta numeric,
 source_type text not null,
 source_id text,
 recorded_at timestamptz not null default now()
);
create index if not exists party_support_history_idx on public.party_support_history(game_id,party_id,recorded_at desc);
alter table public.party_support_history enable row level security;
grant select on public.party_support_history to authenticated;
drop policy if exists party_support_history_read on public.party_support_history;
create policy party_support_history_read on public.party_support_history for select to authenticated using(private.is_game_member(game_id));

create or replace function private.record_metric_change(p_game uuid,p_metric_key text,p_new numeric,p_source_type text,p_source_id text,p_actor uuid,p_note text)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare m public.state_metrics%rowtype;v_old numeric;v_new numeric;
begin
 select * into m from public.state_metrics where game_id=p_game and metric_key=p_metric_key for update;
 if m.id is null then raise exception 'Metric % not found',p_metric_key;end if;
 v_old:=m.value;v_new:=p_new;
 if m.min_value is not null then v_new:=greatest(m.min_value,v_new);end if;
 if m.max_value is not null then v_new:=least(m.max_value,v_new);end if;
 update public.state_metrics set previous_value=v_old,value=v_new,updated_at=now() where id=m.id;
 insert into public.state_metric_history(game_id,metric_id,metric_key,value,previous_value,delta,source_type,source_id,actor_id,note)
 values(p_game,m.id,p_metric_key,v_new,v_old,v_new-v_old,p_source_type,p_source_id,p_actor,p_note);
end;$$;

create or replace function public.set_state_metric(p_metric_id uuid,p_value numeric,p_note text default null)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare m public.state_metrics%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into m from public.state_metrics where id=p_metric_id;
 if m.id is null then raise exception 'Metric not found';end if;
 if not private.is_game_teacher(m.game_id) then raise exception 'Teacher access required';end if;
 perform private.record_metric_change(m.game_id,m.metric_key,p_value,'teacher',m.id::text,v_uid,p_note);
end;$$;
revoke all on function public.set_state_metric(uuid,numeric,text) from public,anon;
grant execute on function public.set_state_metric(uuid,numeric,text) to authenticated;

create or replace function private.apply_post_effects(p_post uuid,p_actor uuid)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.political_posts%rowtype;kv record;m public.state_metrics%rowtype;party_kv record;party_row public.game_parties%rowtype;v_old numeric;v_new numeric;
begin
 select * into p from public.political_posts where id=p_post for update;
 if p.id is null or p.effects_applied then return;end if;
 for kv in select key,value from jsonb_each_text(coalesce(p.impact_plan->'metrics','{}'::jsonb)) loop
  select * into m from public.state_metrics where game_id=p.game_id and metric_key=kv.key;
  if m.id is not null then perform private.record_metric_change(p.game_id,kv.key,m.value+(kv.value::numeric),'decision',p.id::text,p_actor,'Политический процесс: '||p.title);end if;
 end loop;
 for party_kv in select key,value from jsonb_each_text(coalesce(p.impact_plan->'party_support','{}'::jsonb)) loop
  select * into party_row from public.game_parties where id=party_kv.key::uuid and game_id=p.game_id for update;
  if party_row.id is not null then
   v_old:=party_row.support;v_new:=least(100,greatest(0,v_old+(party_kv.value::numeric)));
   update public.game_parties set support=v_new where id=party_row.id;
   insert into public.party_support_history(game_id,party_id,value,previous_value,delta,source_type,source_id)
   values(p.game_id,party_row.id,v_new,v_old,v_new-v_old,'decision',p.id::text);
  end if;
 end loop;
 update public.political_posts set effects_applied=true,updated_at=now() where id=p.id;
end;$$;

create or replace function private.register_post_decision(p_post uuid,p_method text,p_vote uuid,p_actor uuid)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.political_posts%rowtype;d uuid;v_no bigint;
begin
 select * into p from public.political_posts where id=p_post for update;
 if p.id is null then raise exception 'Post not found';end if;
 update public.political_posts set status='accepted',accepted_by=coalesce(accepted_by,p_actor),accepted_at=coalesce(accepted_at,now()),updated_at=now() where id=p.id;
 select id into d from public.political_decisions where post_id=p.id;
 if d is null then
  v_no:=nextval('public.political_decision_seq');
  insert into public.political_decisions(game_id,registry_no,post_id,vote_id,title,actor_label,decided_by,decision_method,impact_snapshot)
  values(p.game_id,'РЕШ-'||lpad(v_no::text,5,'0'),p.id,p_vote,p.title,p.actor_label,p_actor,p_method,p.impact_plan) returning id into d;
 end if;
 if p.impact_approved_at is not null and not p.effects_applied then perform private.apply_post_effects(p.id,p_actor);end if;
 return d;
end;$$;

create or replace function public.approve_post_impact(p_post_id uuid,p_impact_plan jsonb)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.political_posts%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into p from public.political_posts where id=p_post_id for update;
 if p.id is null then raise exception 'Post not found';end if;
 if not private.is_game_teacher(p.game_id) then raise exception 'Teacher access required';end if;
 update public.political_posts set impact_plan=coalesce(p_impact_plan,'{"metrics":{}}'::jsonb),impact_approved_by=v_uid,impact_approved_at=now(),updated_at=now() where id=p.id;
 if p.status='accepted' and not p.effects_applied then perform private.apply_post_effects(p.id,v_uid);end if;
end;$$;
revoke all on function public.approve_post_impact(uuid,jsonb) from public,anon;
grant execute on function public.approve_post_impact(uuid,jsonb) to authenticated;

create or replace function public.accept_political_post(p_post_id uuid,p_impact_plan jsonb default null)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.political_posts%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into p from public.political_posts where id=p_post_id for update;
 if p.id is null then raise exception 'Post not found';end if;
 if not private.is_game_teacher(p.game_id) then raise exception 'Teacher access required';end if;
 if p_impact_plan is not null then
  update public.political_posts set impact_plan=p_impact_plan,impact_approved_by=v_uid,impact_approved_at=now(),updated_at=now() where id=p.id;
 elsif p.impact_approved_at is null then
  update public.political_posts set impact_approved_by=v_uid,impact_approved_at=now(),updated_at=now() where id=p.id;
 end if;
 return private.register_post_decision(p.id,'teacher',null,v_uid);
end;$$;
revoke all on function public.accept_political_post(uuid,jsonb) from public,anon;
grant execute on function public.accept_political_post(uuid,jsonb) to authenticated;

create or replace function public.reject_political_post(p_post_id uuid)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.political_posts%rowtype;
begin
 select * into p from public.political_posts where id=p_post_id;
 if p.id is null then raise exception 'Post not found';end if;
 if not private.is_game_teacher(p.game_id) then raise exception 'Teacher access required';end if;
 update public.political_posts set status='rejected',updated_at=now() where id=p.id;
end;$$;
revoke all on function public.reject_political_post(uuid) from public,anon;
grant execute on function public.reject_political_post(uuid) to authenticated;

create or replace function public.create_vote_from_post(p_post_id uuid,p_institution_key text default 'all',p_voting_mode text default 'member',p_quorum_value numeric default 0.6666667,p_majority_kind text default 'present_majority',p_majority_value numeric default 0.5)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.political_posts%rowtype;v_uid uuid:=(select auth.uid());v_id uuid:=gen_random_uuid();v_stage integer;
begin
 select * into p from public.political_posts where id=p_post_id;
 if p.id is null then raise exception 'Post not found';end if;
 if not private.is_game_member(p.game_id) then raise exception 'Game access required';end if;
 select current_round into v_stage from public.games where id=p.game_id;
 insert into public.game_votes(id,game_id,stage_no,title,body,voting_mode,status,created_by,institution_key,procedure_key,quorum_kind,quorum_value,majority_kind,majority_value,allow_abstain,tie_breaker_chair,source_post_id,pass_transition,fail_transition)
 values(v_id,p.game_id,coalesce(v_stage,1),'Решение: '||p.title,p.body,p_voting_mode,'open',v_uid,p_institution_key,'political_post','fraction',p_quorum_value,p_majority_kind,p_majority_value,true,(p_institution_key='government'),p.id,'none','none');
 return v_id;
end;$$;
revoke all on function public.create_vote_from_post(uuid,text,text,numeric,text,numeric) from public,anon;
grant execute on function public.create_vote_from_post(uuid,text,text,numeric,text,numeric) to authenticated;

create or replace function private.accept_post_after_vote()
returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 if new.status='closed' and old.status='open' and new.result_code='passed' and new.source_post_id is not null then
  perform private.register_post_decision(new.source_post_id,'vote',new.id,new.created_by);
 end if;
 return new;
end;$$;
drop trigger if exists trg_accept_post_after_vote on public.game_votes;
create trigger trg_accept_post_after_vote after update of status,result_code on public.game_votes for each row execute function private.accept_post_after_vote();

update public.state_metrics set
 group_key=case metric_key when 'budget' then 'economy' when 'economy' then 'economy' when 'legitimacy' then 'society' when 'social_tension' then 'society' when 'security' then 'state' else group_key end,
 description=case metric_key
  when 'budget' then 'Игровой бюджетный ресурс государства. Меняется только через подтверждённые решения и ручные корректировки преподавателя.'
  when 'economy' then 'Сводный игровой индекс экономической устойчивости.'
  when 'legitimacy' then 'Игровой индекс восприятия законности и приемлемости действующей власти и институтов.'
  when 'social_tension' then 'Игровой индекс социальной напряжённости: чем выше, тем выше конфликтность.'
  when 'security' then 'Игровой индекс внутренней устойчивости и безопасности.'
  else description end,
 min_value=case when metric_key='budget' then null else 0 end,
 max_value=case when metric_key='budget' then null else 100 end,
 sort_order=case metric_key when 'legitimacy' then 20 when 'social_tension' then 40 when 'economy' then 60 when 'budget' then 70 when 'security' then 80 else 100 end;

insert into public.state_metrics(game_id,metric_key,label,value,previous_value,unit,is_public,group_key,description,min_value,max_value,sort_order)
select g.id,x.metric_key,x.label,x.value,null,x.unit,true,x.group_key,x.description,0,100,x.sort_order
from public.games g
cross join (values
 ('public_trust','Доверие граждан',50::numeric,'%','society','Игровой индекс доверия граждан к публичной власти и принимаемым решениям.',10),
 ('elite_support','Поддержка элит',50::numeric,'%','elites','Игровой индекс поддержки со стороны политико-административных и экономических элит.',30),
 ('international_standing','Международное положение',50::numeric,'%','international','Игровой индекс внешнеполитического положения и отношения международных акторов.',50),
 ('social_stability','Социальная стабильность',50::numeric,'%','society','Игровой индекс устойчивости общественных отношений и управляемости конфликтов.',35),
 ('media_climate','Информационный фон',50::numeric,'%','society','Игровой индекс общего информационного фона вокруг власти и политических акторов.',45),
 ('lawfulness','Правовая устойчивость',70::numeric,'%','state','Игровой индекс соблюдения процедур, компетенций и нормативных ограничений.',55)
) as x(metric_key,label,value,unit,group_key,description,sort_order)
where not exists(select 1 from public.state_metrics m where m.game_id=g.id and m.metric_key=x.metric_key);

insert into public.state_metric_history(game_id,metric_id,metric_key,value,previous_value,delta,source_type,source_id,note,recorded_at)
select m.game_id,m.id,m.metric_key,m.value,m.previous_value,0,'baseline',m.id::text,'Начальная точка показателя',m.updated_at
from public.state_metrics m
where not exists(select 1 from public.state_metric_history h where h.metric_id=m.id);

do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='political_posts') then alter publication supabase_realtime add table public.political_posts;end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='political_post_media') then alter publication supabase_realtime add table public.political_post_media;end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='political_decisions') then alter publication supabase_realtime add table public.political_decisions;end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='state_metric_history') then alter publication supabase_realtime add table public.state_metric_history;end if;
end $$;
