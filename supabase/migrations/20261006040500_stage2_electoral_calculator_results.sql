-- Applied to production: teacher-only publication of electoral calculation results.
create table if not exists public.electoral_calculator_results(
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  system_type text not null check (system_type in ('proportional','majoritarian','mixed')),
  allocation_method text null check (allocation_method is null or allocation_method in ('hare','droop','dhondt','sainte_lague','imperiali')),
  proportional_share integer null check (proportional_share is null or proportional_share between 1 and 99),
  support jsonb not null default '{}'::jsonb,
  district_seats jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  published boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists electoral_calculator_results_game_created_idx
  on public.electoral_calculator_results(game_id,created_at desc);
alter table public.electoral_calculator_results enable row level security;
drop policy if exists electoral_calculator_results_read on public.electoral_calculator_results;
create policy electoral_calculator_results_read
on public.electoral_calculator_results
for select to authenticated
using (private.is_game_member(game_id));
revoke insert,update,delete on public.electoral_calculator_results from authenticated;

create or replace function public.publish_electoral_calculator_result(
 p_game_id uuid,
 p_system_type text,
 p_allocation_method text,
 p_proportional_share integer,
 p_support jsonb,
 p_district_seats jsonb,
 p_result jsonb
) returns uuid
language plpgsql
security definer
set search_path='public','private','pg_temp'
as $$
declare v_id uuid;
begin
 if not private.is_game_teacher(p_game_id) then
  raise exception 'Сохранение расчёта доступно только преподавателю';
 end if;
 if p_system_type not in ('proportional','majoritarian','mixed') then
  raise exception 'Неизвестный тип избирательной системы';
 end if;
 if p_system_type <> 'majoritarian' and p_allocation_method not in ('hare','droop','dhondt','sainte_lague','imperiali') then
  raise exception 'Неизвестная формула распределения';
 end if;
 if p_system_type='mixed' and (p_proportional_share is null or p_proportional_share not between 1 and 99) then
  raise exception 'Для смешанной системы задайте долю пропорциональной части';
 end if;
 insert into public.electoral_calculator_results(
  game_id,created_by,system_type,allocation_method,proportional_share,support,district_seats,result
 ) values(
  p_game_id,auth.uid(),p_system_type,
  case when p_system_type='majoritarian' then null else p_allocation_method end,
  case when p_system_type='mixed' then p_proportional_share else null end,
  coalesce(p_support,'{}'::jsonb),
  coalesce(p_district_seats,'{}'::jsonb),
  coalesce(p_result,'{}'::jsonb)
 ) returning id into v_id;
 return v_id;
end;
$$;
revoke all on function public.publish_electoral_calculator_result(uuid,text,text,integer,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.publish_electoral_calculator_result(uuid,text,text,integer,jsonb,jsonb,jsonb) to authenticated;
