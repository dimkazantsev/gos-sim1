-- Stage 13: link adopted state programs to the budget and generate a formal federal-budget bill.
create table if not exists public.budget_program_allocations(
 id uuid primary key default gen_random_uuid(),
 scenario_id uuid not null references public.budget_scenarios(id) on delete cascade,
 game_id uuid not null references public.games(id) on delete cascade,
 program_id uuid not null references public.state_programs(id) on delete cascade,
 amount numeric not null check(amount>=0),
 note text,
 created_by uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(scenario_id,program_id)
);
alter table public.budget_scenarios add column if not exists formal_document_id uuid references public.formal_documents(id) on delete set null;
create index if not exists budget_program_allocations_scenario_idx on public.budget_program_allocations(scenario_id);
create index if not exists budget_program_allocations_program_idx on public.budget_program_allocations(program_id);
alter table public.budget_program_allocations enable row level security;
revoke all privileges on table public.budget_program_allocations from anon,authenticated;
grant select on table public.budget_program_allocations to authenticated;
drop policy if exists budget_program_allocations_read on public.budget_program_allocations;
create policy budget_program_allocations_read on public.budget_program_allocations for select to authenticated using(private.is_game_member(game_id));
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='budget_program_allocations')
 then alter publication supabase_realtime add table public.budget_program_allocations; end if;
end $$;

create or replace function public.set_budget_program_allocation(p_scenario_id uuid,p_program_id uuid,p_amount numeric,p_note text default null)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare s public.budget_scenarios%rowtype;p public.state_programs%rowtype;v_uid uuid:=(select auth.uid());v_role text;v_id uuid;v_total numeric;
begin
 select * into s from public.budget_scenarios where id=p_scenario_id for update;
 if s.id is null then raise exception 'Budget scenario not found'; end if;
 if s.status='final' then raise exception 'Final budget scenario is locked'; end if;
 if v_uid is null or not private.is_game_member(s.game_id) then raise exception 'Game access required'; end if;
 v_role:=private.game_role(s.game_id,v_uid);
 if not private.is_game_teacher(s.game_id) and v_role not like '%председател%правительств%' and v_role not like '%министр%финанс%' then raise exception 'Prime Minister / Finance Minister access required'; end if;
 select * into p from public.state_programs where id=p_program_id;
 if p.id is null or p.game_id<>s.game_id or p.status<>'adopted' then raise exception 'Only adopted state programs in this game may be financed'; end if;
 if p_amount<0 then raise exception 'Allocation cannot be negative'; end if;
 select coalesce(sum(amount),0)-coalesce((select amount from public.budget_program_allocations where scenario_id=s.id and program_id=p.id),0)+p_amount
 into v_total from public.budget_program_allocations where scenario_id=s.id;
 if v_total>s.expenditure then raise exception 'Program allocations exceed total budget expenditure'; end if;
 insert into public.budget_program_allocations(scenario_id,game_id,program_id,amount,note,created_by)
 values(s.id,s.game_id,p.id,p_amount,nullif(trim(coalesce(p_note,'')),''),v_uid)
 on conflict(scenario_id,program_id) do update set amount=excluded.amount,note=excluded.note,updated_at=now()
 returning id into v_id;
 return v_id;
end;$$;
revoke all on function public.set_budget_program_allocation(uuid,uuid,numeric,text) from public,anon;
grant execute on function public.set_budget_program_allocation(uuid,uuid,numeric,text) to authenticated;

create or replace function public.delete_budget_program_allocation(p_allocation_id uuid)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare a public.budget_program_allocations%rowtype;s public.budget_scenarios%rowtype;v_uid uuid:=(select auth.uid());v_role text;
begin
 select * into a from public.budget_program_allocations where id=p_allocation_id;
 if a.id is null then return; end if;
 select * into s from public.budget_scenarios where id=a.scenario_id;
 if s.status='final' then raise exception 'Final budget scenario is locked'; end if;
 v_role:=private.game_role(a.game_id,v_uid);
 if not private.is_game_teacher(a.game_id) and v_role not like '%председател%правительств%' and v_role not like '%министр%финанс%' then raise exception 'Prime Minister / Finance Minister access required'; end if;
 delete from public.budget_program_allocations where id=a.id;
end;$$;
revoke all on function public.delete_budget_program_allocation(uuid) from public,anon;
grant execute on function public.delete_budget_program_allocation(uuid) to authenticated;

create or replace function public.create_budget_document_from_scenario(p_scenario_id uuid)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare s public.budget_scenarios%rowtype;v_uid uuid:=(select auth.uid());v_role text;v_doc uuid;v_body text;v_programs text;
begin
 select * into s from public.budget_scenarios where id=p_scenario_id for update;
 if s.id is null then raise exception 'Budget scenario not found'; end if;
 if s.status<>'final' then raise exception 'Finalize the budget scenario first'; end if;
 if s.formal_document_id is not null then return s.formal_document_id; end if;
 v_role:=private.game_role(s.game_id,v_uid);
 if not private.is_game_teacher(s.game_id) and v_role not like '%председател%правительств%' and v_role not like '%министр%финанс%' and v_role not like '%правительств%' then raise exception 'Government / Finance Ministry access required'; end if;
 select string_agg('• '||p.title||': '||a.amount::text,E'\n' order by p.title) into v_programs
 from public.budget_program_allocations a join public.state_programs p on p.id=a.program_id where a.scenario_id=s.id;
 v_body:='Проект федерального бюджета на '||s.budget_year||' год.'||E'\n\n'||
   'Макроэкономический сценарий: '||s.title||E'\n'||'ВВП: '||s.gdp||E'\n'||'Доходы: '||s.revenue||E'\n'||
   'Расходы: '||s.expenditure||E'\n'||'Баланс: '||s.balance||E'\n'||
   case when s.deficit_pct_gdp is not null then 'Дефицит к ВВП: '||round(s.deficit_pct_gdp,2)||'%'||E'\n' else '' end||
   'Государственный долг на конец периода: '||s.debt_end||case when s.debt_pct_gdp is not null then ' ('||round(s.debt_pct_gdp,2)||'% ВВП)' else '' end||E'\n\n'||
   'Финансирование принятых государственных программ:'||E'\n'||coalesce(v_programs,'Связанные государственные программы не указаны.')||E'\n\n'||
   'Источник и допущения сценария: '||coalesce(s.source_note,'не указаны');
 v_doc:=public.create_formal_document(s.game_id,13,'О федеральном бюджете на '||s.budget_year||' год','federal_budget','government','Правительство Российской Федерации',v_body,null,null,null,'budget',jsonb_build_object('budget_scenario_id',s.id,'budget_year',s.budget_year));
 update public.budget_scenarios set formal_document_id=v_doc,updated_at=now(),updated_by=v_uid where id=s.id;
 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(s.game_id,13,'Федеральный бюджет','notice','Проект федерального бюджета внесён в реестр НПА','На основе зафиксированного сценария '||s.title,v_uid);
 return v_doc;
end;$$;
revoke all on function public.create_budget_document_from_scenario(uuid) from public,anon;
grant execute on function public.create_budget_document_from_scenario(uuid) to authenticated;