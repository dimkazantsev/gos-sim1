-- Stage 10: complete the state-program passport with participants and annual appropriations.
alter table public.state_programs add column if not exists participants text;

create table if not exists public.state_program_budget_years(
 id uuid primary key default gen_random_uuid(),
 program_id uuid not null references public.state_programs(id) on delete cascade,
 game_id uuid not null references public.games(id) on delete cascade,
 budget_year integer not null check(budget_year between 2000 and 2100),
 amount numeric not null check(amount>=0),
 created_by uuid not null references auth.users(id) on delete cascade,
 updated_at timestamptz not null default now(),
 unique(program_id,budget_year)
);
create index if not exists state_program_budget_years_program_idx on public.state_program_budget_years(program_id,budget_year);
alter table public.state_program_budget_years enable row level security;
revoke all privileges on table public.state_program_budget_years from anon,authenticated;
grant select on table public.state_program_budget_years to authenticated;
drop policy if exists state_program_budget_years_read on public.state_program_budget_years;
create policy state_program_budget_years_read on public.state_program_budget_years for select to authenticated using(private.is_game_member(game_id));
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='state_program_budget_years')
 then alter publication supabase_realtime add table public.state_program_budget_years; end if;
end $$;

create or replace function public.set_state_program_participants(p_program_id uuid,p_participants text)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.state_programs%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into p from public.state_programs where id=p_program_id for update;
 if p.id is null then raise exception 'Program not found';end if;
 if not private.can_edit_state_program(p.id,v_uid) then raise exception 'Program editing access required';end if;
 if p.status not in ('draft','revision','minister_review') then raise exception 'Program passport is locked at this stage';end if;
 update public.state_programs set participants=nullif(trim(coalesce(p_participants,'')),''),updated_at=now() where id=p.id;
end;$$;
revoke all on function public.set_state_program_participants(uuid,text) from public,anon;
grant execute on function public.set_state_program_participants(uuid,text) to authenticated;

create or replace function public.set_state_program_budget_year(p_program_id uuid,p_budget_year integer,p_amount numeric)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.state_programs%rowtype;v_uid uuid:=(select auth.uid());v_id uuid;v_total numeric;
begin
 select * into p from public.state_programs where id=p_program_id for update;
 if p.id is null then raise exception 'Program not found';end if;
 if not private.can_edit_state_program(p.id,v_uid) then raise exception 'Program editing access required';end if;
 if p.status not in ('draft','revision','minister_review') then raise exception 'Program budget is locked at this stage';end if;
 if p.start_date is not null and p_budget_year<extract(year from p.start_date)::integer then raise exception 'Budget year precedes program start';end if;
 if p.end_date is not null and p_budget_year>extract(year from p.end_date)::integer then raise exception 'Budget year follows program end';end if;
 if p_amount<0 then raise exception 'Annual appropriation cannot be negative';end if;
 select coalesce(sum(amount),0)-coalesce((select amount from public.state_program_budget_years where program_id=p.id and budget_year=p_budget_year),0)+p_amount
 into v_total from public.state_program_budget_years where program_id=p.id;
 if p.total_budget>0 and v_total>p.total_budget then raise exception 'Annual appropriations exceed the total program budget';end if;
 insert into public.state_program_budget_years(program_id,game_id,budget_year,amount,created_by)
 values(p.id,p.game_id,p_budget_year,p_amount,v_uid)
 on conflict(program_id,budget_year) do update set amount=excluded.amount,updated_at=now()
 returning id into v_id;return v_id;
end;$$;
revoke all on function public.set_state_program_budget_year(uuid,integer,numeric) from public,anon;
grant execute on function public.set_state_program_budget_year(uuid,integer,numeric) to authenticated;

create or replace function public.delete_state_program_budget_year(p_budget_year_id uuid)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare y public.state_program_budget_years%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into y from public.state_program_budget_years where id=p_budget_year_id;if y.id is null then return;end if;
 if not private.can_edit_state_program(y.program_id,v_uid) then raise exception 'Program editing access required';end if;
 delete from public.state_program_budget_years where id=y.id;
end;$$;
revoke all on function public.delete_state_program_budget_year(uuid) from public,anon;
grant execute on function public.delete_state_program_budget_year(uuid) to authenticated;

create or replace function private.state_program_readiness_json(p_program_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare p public.state_programs%rowtype;v_goals integer;v_components integer;v_dirs integer;v_component_budget numeric;
 v_has_published_address boolean;v_issues jsonb:='[]'::jsonb;v_budget_years integer;v_expected_years integer;v_annual_total numeric;
begin
 select * into p from public.state_programs where id=p_program_id;
 if p.id is null then return jsonb_build_object('ready',false,'issues',jsonb_build_array('Программа не найдена'));end if;
 select count(*) into v_goals from public.state_program_goals where program_id=p.id;
 select count(*),count(distinct direction_no),coalesce(sum(budget),0) into v_components,v_dirs,v_component_budget from public.state_program_components where program_id=p.id;
 select exists(select 1 from public.presidential_addresses where game_id=p.game_id and status='published') into v_has_published_address;
 select count(*),coalesce(sum(amount),0) into v_budget_years,v_annual_total from public.state_program_budget_years where program_id=p.id;
 v_expected_years:=case when p.start_date is not null and p.end_date is not null then extract(year from p.end_date)::integer-extract(year from p.start_date)::integer+1 else 0 end;
 if nullif(trim(coalesce(p.national_goal,'')),'') is null then v_issues:=v_issues||jsonb_build_array('Не выбрана национальная цель');end if;
 if nullif(trim(coalesce(p.participants,'')),'') is null then v_issues:=v_issues||jsonb_build_array('Не указаны участники программы');end if;
 if p.start_date is null or p.end_date is null then v_issues:=v_issues||jsonb_build_array('Не указан полный срок реализации');end if;
 if p.total_budget<=0 then v_issues:=v_issues||jsonb_build_array('Не задан общий бюджет программы');end if;
 if length(trim(coalesce(p.expected_results,'')))<5 then v_issues:=v_issues||jsonb_build_array('Не заполнены ожидаемые результаты');end if;
 if v_goals<1 then v_issues:=v_issues||jsonb_build_array('Нет целей с измеримыми показателями');end if;
 if v_dirs<>3 then v_issues:=v_issues||jsonb_build_array('По правилам этапов 10–11 программа должна содержать три направления');end if;
 if v_components<3 then v_issues:=v_issues||jsonb_build_array('Недостаточно структурных элементов программы');end if;
 if v_components>25 then v_issues:=v_issues||jsonb_build_array('Превышен лимит 25 структурных элементов');end if;
 if v_component_budget>p.total_budget then v_issues:=v_issues||jsonb_build_array('Сумма бюджетов структурных элементов превышает общий бюджет программы');end if;
 if exists(select 1 from public.state_program_components where program_id=p.id and (start_date is null or end_date is null)) then v_issues:=v_issues||jsonb_build_array('Не у всех структурных элементов указаны сроки');end if;
 if exists(select 1 from (select direction_no,component_kind,count(*) n from public.state_program_components where program_id=p.id and component_kind in ('project','target_program') group by direction_no,component_kind having count(*)>5) q)
 then v_issues:=v_issues||jsonb_build_array('В одном из направлений превышен лимит пяти проектов или пяти целевых программ');end if;
 if v_expected_years>0 and v_budget_years<>v_expected_years then v_issues:=v_issues||jsonb_build_array('Финансирование указано не для каждого года реализации программы');end if;
 if p.total_budget>0 and abs(v_annual_total-p.total_budget)>0.01 then v_issues:=v_issues||jsonb_build_array('Сумма годовых бюджетных ассигнований не равна общему бюджету программы');end if;
 if v_has_published_address and p.presidential_priority_id is null then v_issues:=v_issues||jsonb_build_array('Программа не связана с опубликованным приоритетом послания Президента');end if;
 return jsonb_build_object('ready',jsonb_array_length(v_issues)=0,'issues',v_issues,'goals',v_goals,'directions',v_dirs,'components',v_components,
  'component_budget',v_component_budget,'total_budget',p.total_budget,'budget_years',v_budget_years,'expected_budget_years',v_expected_years,'annual_budget_total',v_annual_total);
end;$$;
revoke execute on function private.state_program_readiness_json(uuid) from public,anon,authenticated;