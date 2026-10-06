create table if not exists public.regional_calculator_results(
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  method text not null check (method in ('random','proportional','agreement')),
  inputs jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  published boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists regional_calculator_results_game_created_idx
  on public.regional_calculator_results(game_id,created_at desc);

alter table public.regional_calculator_results enable row level security;

drop policy if exists regional_calculator_results_read on public.regional_calculator_results;
create policy regional_calculator_results_read
on public.regional_calculator_results
for select
to authenticated
using (private.is_game_member(game_id));

revoke insert,update,delete on public.regional_calculator_results from authenticated;

create or replace function public.publish_regional_calculator_result(
 p_game_id uuid,
 p_method text,
 p_inputs jsonb,
 p_result jsonb
) returns uuid
language plpgsql
security definer
set search_path='public','private','pg_temp'
as $$
declare v_id uuid;
declare v_total integer;
begin
 if not private.is_game_teacher(p_game_id) then
  raise exception 'Сохранение расчёта доступно только преподавателю';
 end if;
 if p_method not in ('random','proportional','agreement') then
  raise exception 'Неизвестный метод распределения';
 end if;

 select coalesce(sum((value)::integer),0)
 into v_total
 from jsonb_each_text(coalesce(p_result,'{}'::jsonb));

 if v_total <> 89 then
  raise exception 'Итог должен распределять ровно 89 субъектов; сейчас: %',v_total;
 end if;

 insert into public.regional_calculator_results(game_id,created_by,method,inputs,result)
 values(p_game_id,auth.uid(),p_method,coalesce(p_inputs,'{}'::jsonb),coalesce(p_result,'{}'::jsonb))
 returning id into v_id;

 return v_id;
end;
$$;

revoke all on function public.publish_regional_calculator_result(uuid,text,jsonb,jsonb) from public,anon;
grant execute on function public.publish_regional_calculator_result(uuid,text,jsonb,jsonb) to authenticated;
