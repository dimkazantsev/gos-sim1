-- Stage 13 quantitative budget laboratory.
-- Scenario inputs are explicit rather than hard-coded because fiscal-rule parameters can change.

create table if not exists public.budget_scenarios(
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  stage_no integer not null default 13,
  title text not null default 'Базовый сценарий федерального бюджета',
  budget_year integer not null,
  source_note text,
  gdp numeric not null default 0 check(gdp>=0),
  oil_price numeric,
  cutoff_price numeric,
  key_rate numeric,
  fx_change_pct numeric,
  fx_intervention numeric,
  revenue numeric not null default 0 check(revenue>=0),
  expenditure numeric not null default 0 check(expenditure>=0),
  debt_start numeric not null default 0 check(debt_start>=0),
  financing numeric not null default 0,
  balance numeric not null default 0,
  deficit_pct_gdp numeric,
  debt_end numeric not null default 0,
  debt_pct_gdp numeric,
  deficit_limit_pct numeric,
  debt_limit_pct numeric,
  status text not null default 'draft' check(status in ('draft','final')),
  created_by uuid not null references auth.users(id) on delete cascade,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.budget_workstreams(
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references public.budget_scenarios(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  workstream text not null check(workstream in ('central_bank','macro','revenue','expenditure','financing_debt')),
  summary text not null,
  assumptions jsonb not null default '{}'::jsonb,
  submitted_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(scenario_id,workstream)
);

create index if not exists budget_scenarios_game_idx on public.budget_scenarios(game_id,created_at desc);
create index if not exists budget_workstreams_scenario_idx on public.budget_workstreams(scenario_id,workstream);

alter table public.budget_scenarios enable row level security;
alter table public.budget_workstreams enable row level security;
revoke all privileges on table public.budget_scenarios from anon,authenticated;
revoke all privileges on table public.budget_workstreams from anon,authenticated;
grant select on table public.budget_scenarios to authenticated;
grant select on table public.budget_workstreams to authenticated;

drop policy if exists budget_scenarios_read on public.budget_scenarios;
create policy budget_scenarios_read on public.budget_scenarios for select to authenticated using(private.is_game_member(game_id));
drop policy if exists budget_workstreams_read on public.budget_workstreams;
create policy budget_workstreams_read on public.budget_workstreams for select to authenticated using(private.is_game_member(game_id));

do $$
begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='budget_scenarios')
 then alter publication supabase_realtime add table public.budget_scenarios; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='budget_workstreams')
 then alter publication supabase_realtime add table public.budget_workstreams; end if;
end $$;

create or replace function public.save_budget_scenario(
 p_game_id uuid,p_scenario_id uuid,p_title text,p_budget_year integer,p_source_note text,
 p_gdp numeric,p_oil_price numeric,p_cutoff_price numeric,p_key_rate numeric,p_fx_change_pct numeric,p_fx_intervention numeric,
 p_revenue numeric,p_expenditure numeric,p_debt_start numeric,p_financing numeric,p_deficit_limit_pct numeric,p_debt_limit_pct numeric
) returns uuid
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare v_uid uuid:=(select auth.uid());v_role text;v_id uuid;v_balance numeric;v_deficit numeric;v_debt_end numeric;v_debt_pct numeric;
begin
 if v_uid is null or not private.is_game_member(p_game_id) then raise exception 'Game access required'; end if;
 v_role:=private.game_role(p_game_id,v_uid);
 if not private.is_game_teacher(p_game_id)
    and v_role not like '%правительств%'
    and v_role not like '%министр%'
    and v_role not like '%банк%росс%'
 then raise exception 'Budget-team role required'; end if;
 if p_budget_year<2020 or p_budget_year>2100 then raise exception 'Budget year is out of range'; end if;
 if p_gdp<0 or p_revenue<0 or p_expenditure<0 or p_debt_start<0 then raise exception 'Core budget values cannot be negative'; end if;

 v_balance:=p_revenue-p_expenditure;
 v_deficit:=case when p_gdp>0 then greatest(0,-v_balance)/p_gdp*100 else null end;
 v_debt_end:=greatest(0,p_debt_start+greatest(0,-v_balance)-coalesce(p_financing,0));
 v_debt_pct:=case when p_gdp>0 then v_debt_end/p_gdp*100 else null end;

 if p_scenario_id is null then
  insert into public.budget_scenarios(
   game_id,title,budget_year,source_note,gdp,oil_price,cutoff_price,key_rate,fx_change_pct,fx_intervention,
   revenue,expenditure,debt_start,financing,balance,deficit_pct_gdp,debt_end,debt_pct_gdp,deficit_limit_pct,debt_limit_pct,created_by,updated_by
  ) values(
   p_game_id,coalesce(nullif(trim(p_title),''),'Базовый сценарий федерального бюджета'),p_budget_year,nullif(trim(coalesce(p_source_note,'')),''),
   p_gdp,p_oil_price,p_cutoff_price,p_key_rate,p_fx_change_pct,p_fx_intervention,p_revenue,p_expenditure,p_debt_start,p_financing,
   v_balance,v_deficit,v_debt_end,v_debt_pct,p_deficit_limit_pct,p_debt_limit_pct,v_uid,v_uid
  ) returning id into v_id;
 else
  if not exists(select 1 from public.budget_scenarios where id=p_scenario_id and game_id=p_game_id) then raise exception 'Scenario not found'; end if;
  update public.budget_scenarios set title=coalesce(nullif(trim(p_title),''),title),budget_year=p_budget_year,source_note=nullif(trim(coalesce(p_source_note,'')),''),
   gdp=p_gdp,oil_price=p_oil_price,cutoff_price=p_cutoff_price,key_rate=p_key_rate,fx_change_pct=p_fx_change_pct,fx_intervention=p_fx_intervention,
   revenue=p_revenue,expenditure=p_expenditure,debt_start=p_debt_start,financing=p_financing,balance=v_balance,
   deficit_pct_gdp=v_deficit,debt_end=v_debt_end,debt_pct_gdp=v_debt_pct,deficit_limit_pct=p_deficit_limit_pct,debt_limit_pct=p_debt_limit_pct,
   updated_by=v_uid,updated_at=now()
  where id=p_scenario_id returning id into v_id;
 end if;
 return v_id;
end;
$$;
revoke all on function public.save_budget_scenario(uuid,uuid,text,integer,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric) from public,anon;
grant execute on function public.save_budget_scenario(uuid,uuid,text,integer,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric) to authenticated;

create or replace function public.submit_budget_workstream(
 p_scenario_id uuid,p_workstream text,p_summary text,p_assumptions jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare s public.budget_scenarios%rowtype;v_uid uuid:=(select auth.uid());v_id uuid;
begin
 select * into s from public.budget_scenarios where id=p_scenario_id;
 if s.id is null then raise exception 'Scenario not found'; end if;
 if v_uid is null or not private.is_game_member(s.game_id) then raise exception 'Game access required'; end if;
 if s.status='final' then raise exception 'Scenario is finalized'; end if;
 if p_workstream not in ('central_bank','macro','revenue','expenditure','financing_debt') then raise exception 'Unsupported budget workstream'; end if;
 if length(trim(coalesce(p_summary,'')))<10 then raise exception 'Analytical summary is too short'; end if;
 insert into public.budget_workstreams(scenario_id,game_id,workstream,summary,assumptions,submitted_by)
 values(s.id,s.game_id,p_workstream,trim(p_summary),coalesce(p_assumptions,'{}'::jsonb),v_uid)
 on conflict(scenario_id,workstream) do update set summary=excluded.summary,assumptions=excluded.assumptions,submitted_by=v_uid,updated_at=now()
 returning id into v_id;
 return v_id;
end;
$$;
revoke all on function public.submit_budget_workstream(uuid,text,text,jsonb) from public,anon;
grant execute on function public.submit_budget_workstream(uuid,text,text,jsonb) to authenticated;

create or replace function public.finalize_budget_scenario(p_scenario_id uuid)
returns void
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare s public.budget_scenarios%rowtype;v_role text;v_uid uuid:=(select auth.uid());
begin
 select * into s from public.budget_scenarios where id=p_scenario_id for update;
 if s.id is null then raise exception 'Scenario not found'; end if;
 v_role:=private.game_role(s.game_id,v_uid);
 if not private.is_game_teacher(s.game_id) and v_role not like '%председател%правительств%' and v_role not like '%министр%финанс%' then
  raise exception 'Prime Minister / Finance Minister access required';
 end if;
 if (select count(*) from public.budget_workstreams where scenario_id=s.id)<5 then
  raise exception 'All five analytical workstreams must submit their conclusions';
 end if;
 update public.budget_scenarios set status='final',updated_by=v_uid,updated_at=now() where id=s.id;
 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(s.game_id,13,'Федеральный бюджет','notice','Макроэкономический сценарий бюджета зафиксирован',
  s.title||'. Доходы: '||s.revenue||'; расходы: '||s.expenditure||'; баланс: '||s.balance||
  case when s.deficit_pct_gdp is not null then '; дефицит к ВВП: '||round(s.deficit_pct_gdp,2)||'%' else '' end,
  v_uid);
end;
$$;
revoke all on function public.finalize_budget_scenario(uuid) from public,anon;
grant execute on function public.finalize_budget_scenario(uuid) to authenticated;
