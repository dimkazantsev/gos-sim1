-- Shared classroom parameters, separate from historical budget scenarios.
create table public.game_fiscal_policy (
 game_id uuid primary key references public.games(id) on delete cascade,
 key_rate numeric not null default 16 check(key_rate between 0 and 100),
 fx_rate numeric not null default 80 check(fx_rate between .01 and 100000),
 oil_price numeric not null default 75 check(oil_price between 0 and 100000),
 cutoff_price numeric not null default 60 check(cutoff_price between 0 and 100000),
 inflation numeric not null default 6 check(inflation between -50 and 100),
 federal_expenditure numeric not null check(federal_expenditure>=0),
 municipal_expenditure numeric not null check(municipal_expenditure>=0),
 baseline_economy numeric not null default 50,baseline_trust numeric not null default 50,
 updated_at timestamptz not null default now()
);
alter table public.game_fiscal_policy enable row level security;
create policy fiscal_policy_read on public.game_fiscal_policy for select to authenticated using(private.is_game_member(game_id));
grant select on public.game_fiscal_policy to authenticated;
revoke insert,update,delete on public.game_fiscal_policy from public,anon,authenticated;

create or replace function public.get_fiscal_context(p_game_id uuid) returns jsonb
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare answer jsonb;
begin
 if auth.uid() is null or not private.is_game_member(p_game_id) then raise exception 'Нет доступа к бюджетной модели этой игры.';end if;
 perform private.ensure_fiscal_game(p_game_id);
 insert into game_fiscal_policy(game_id,federal_expenditure,municipal_expenditure,baseline_economy,baseline_trust)
 select p_game_id,coalesce(sum(expenditure)*.6,0),coalesce(sum(expenditure)*.25,0),
 coalesce((select value from state_metrics where game_id=p_game_id and metric_key='economy'),50),
 coalesce((select value from state_metrics where game_id=p_game_id and metric_key='public_trust'),50)
 from game_fiscal_regions where game_id=p_game_id on conflict(game_id) do nothing;
 select jsonb_build_object('policy',to_jsonb(p),'can_change_rate',private.is_game_teacher(p_game_id) or exists(
 select 1 from game_members m where m.game_id=p_game_id and m.user_id=auth.uid() and m.kind='student'
 and private.role_is_available(p_game_id,auth.uid()) and lower(m.role_title) ~ 'банк[а-я]* россии|центральн.{0,20}банк'),
 'metrics',(select coalesce(jsonb_object_agg(metric_key,value),'{}') from state_metrics where game_id=p_game_id and (is_public or private.is_game_teacher(p_game_id))))
 into answer from game_fiscal_policy p where game_id=p_game_id;
 return answer;
end$$;

create or replace function public.set_fiscal_policy(p_game_id uuid,p_values jsonb,p_reason text) returns void
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare old_row jsonb;new_row jsonb;is_teacher boolean;k text;allowed boolean;
begin
 if auth.uid() is null or not private.is_game_member(p_game_id) then raise exception 'Нет доступа к этой игре.';end if;
 is_teacher:=private.is_game_teacher(p_game_id);
 allowed:=is_teacher or exists(select 1 from game_members m where m.game_id=p_game_id and m.user_id=auth.uid() and m.kind='student' and private.role_is_available(p_game_id,auth.uid()) and lower(m.role_title) ~ 'банк[а-я]* россии|центральн.{0,20}банк');
 if not allowed then raise exception 'Ключевую ставку меняет Банк России. Параметры сценария задаёт преподаватель.';end if;
 if p_values is null or jsonb_typeof(p_values)<>'object' or p_values='{}'::jsonb or p_reason is null or length(trim(p_reason))<8 then raise exception 'Укажите параметры и содержательное основание решения.';end if;
 for k in select jsonb_object_keys(p_values) loop
  if k not in ('key_rate','fx_rate','oil_price','cutoff_price','inflation','federal_expenditure','municipal_expenditure') then raise exception 'Неизвестный параметр бюджетного сценария.';end if;
  if not is_teacher and k<>'key_rate' then raise exception 'Экономическую основу модели меняет только преподаватель.';end if;
  if jsonb_typeof(p_values->k)<>'number' then raise exception 'Значение должно быть числом.';end if;
 end loop;
 perform public.get_fiscal_context(p_game_id);
 select to_jsonb(p) into old_row from game_fiscal_policy p where game_id=p_game_id for update;
 update game_fiscal_policy set key_rate=coalesce((p_values->>'key_rate')::numeric,key_rate),fx_rate=coalesce((p_values->>'fx_rate')::numeric,fx_rate),oil_price=coalesce((p_values->>'oil_price')::numeric,oil_price),cutoff_price=coalesce((p_values->>'cutoff_price')::numeric,cutoff_price),inflation=coalesce((p_values->>'inflation')::numeric,inflation),federal_expenditure=coalesce((p_values->>'federal_expenditure')::numeric,federal_expenditure),municipal_expenditure=coalesce((p_values->>'municipal_expenditure')::numeric,municipal_expenditure),updated_at=now() where game_id=p_game_id returning to_jsonb(game_fiscal_policy.*) into new_row;
 insert into fiscal_change_ledger(game_id,source_type,source_id,note,before_values,after_values,actor_id)
 values(p_game_id,'macro',gen_random_uuid()::text,case when is_teacher then 'Параметры сценария: ' else 'Решение Банка России: ' end||trim(p_reason),old_row,new_row,auth.uid());
end$$;
revoke all on function public.get_fiscal_context(uuid),public.set_fiscal_policy(uuid,jsonb,text) from public,anon;
grant execute on function public.get_fiscal_context(uuid),public.set_fiscal_policy(uuid,jsonb,text) to authenticated;
do $$declare t text;begin
 foreach t in array array['game_fiscal_policy','game_fiscal_regions','game_fiscal_rates','fiscal_rate_proposals','fiscal_change_ledger'] loop
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then execute format('alter publication supabase_realtime add table public.%I',t);end if;
 end loop;
end$$;

-- Separate public channels; out-of-game chat must never create political posts.
update public.chat_channels set name='Публичная политика' where kind='public' and name in ('Общая беседа','Общий штаб','Общий чат');
create or replace function public.ensure_social_channels(p_game_id uuid) returns void
language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 if auth.uid() is null or not private.is_game_member(p_game_id) then raise exception 'Нет доступа к чатам этой игры.';end if;
 perform pg_advisory_xact_lock(hashtextextended('social-channels:'||p_game_id::text,0));
 update chat_channels set name='Публичная политика' where game_id=p_game_id and kind='public' and name in ('Общая беседа','Общий штаб','Общий чат');
 if not exists(select 1 from chat_channels where game_id=p_game_id and kind='public' and name='Публичная политика') then insert into chat_channels(game_id,kind,name,created_by) values(p_game_id,'public','Публичная политика',auth.uid());end if;
 if not exists(select 1 from chat_channels where game_id=p_game_id and kind='public' and name='Вне игры') then insert into chat_channels(game_id,kind,name,created_by) values(p_game_id,'public','Вне игры',auth.uid());end if;
end$$;
revoke all on function public.ensure_social_channels(uuid) from public,anon;
grant execute on function public.ensure_social_channels(uuid) to authenticated;
