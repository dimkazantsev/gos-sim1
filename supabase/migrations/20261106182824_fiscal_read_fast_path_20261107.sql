-- ГОС.ID 2026-11-07 · avoid repeated fiscal initialization on reads.
-- No game rules, amounts, security grants or RLS policy changes.
-- Same original 89-region seed remains for new/incomplete games.
CREATE OR REPLACE FUNCTION private.ensure_fiscal_game(p_game uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
begin
 -- A seeded game has all 89 region codes. The budget screen calls this helper
 -- from two parallel RPCs: do not issue 89 futile INSERT/ON CONFLICT attempts
 -- for every student's read. Check real keys, not just a row count, so
 -- new reference codes or a missing region still trigger the original seed.
 if not exists (
  select 1 from fiscal_region_reference d
  where not exists (
   select 1 from game_fiscal_regions r
   where r.game_id=p_game and r.region_code=d.code
  )
 ) then
  return;
 end if;
 insert into game_fiscal_regions(game_id,region_code,enterprises,employees_per_firm,monthly_wage,profit_per_firm,consumption_per_firm,expenditure,transfer_in,debt)
 select p_game,code,case profile when 'metropolis' then 12000 when 'resources' then 1800 when 'agriculture' then 2400 when 'northern' then 600 when 'tourism' then 1600 else 3200 end,
 case profile when 'resources' then 35 when 'agriculture' then 8 else 14 end,
 case profile when 'metropolis' then 90000 when 'northern' then 85000 when 'resources' then 80000 else 50000 end,
 case profile when 'resources' then 8 when 'metropolis' then 5 else 2 end,
 case profile when 'metropolis' then 12 when 'tourism' then 8 else 4 end,
 case profile when 'metropolis' then 95000 when 'resources' then 25000 when 'northern' then 8000 else 14000 end,
 case profile when 'northern' then 5000 when 'agriculture' then 3000 else 1000 end,case profile when 'metropolis' then 10000 else 2500 end
 from fiscal_region_reference on conflict do nothing;
end $function$;

CREATE OR REPLACE FUNCTION public.get_fiscal_context(p_game_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare answer jsonb;
begin
 if auth.uid() is null or not private.is_game_member(p_game_id) then raise exception 'Нет доступа к бюджетной модели этой игры.';end if;
 perform private.ensure_fiscal_game(p_game_id);
 -- Existing policy rows must never contend on ON CONFLICT during a read.
 -- The original INSERT remains the first-read path and is race-safe.
 if not exists (select 1 from game_fiscal_policy where game_id=p_game_id) then
 insert into game_fiscal_policy(game_id,federal_expenditure,municipal_expenditure,baseline_economy,baseline_trust)
 select p_game_id,coalesce(sum(expenditure)*.6,0),coalesce(sum(expenditure)*.25,0),
 coalesce((select value from state_metrics where game_id=p_game_id and metric_key='economy'),50),
 coalesce((select value from state_metrics where game_id=p_game_id and metric_key='public_trust'),50)
 from game_fiscal_regions where game_id=p_game_id on conflict(game_id) do nothing;
 end if;
 select jsonb_build_object('policy',to_jsonb(p),'can_change_rate',private.is_game_teacher(p_game_id) or exists(
 select 1 from game_members m where m.game_id=p_game_id and m.user_id=auth.uid() and m.kind='student'
 and private.role_is_available(p_game_id,auth.uid()) and lower(m.role_title) ~ 'банк[а-я]* россии|центральн.{0,20}банк'),
 'metrics',(select coalesce(jsonb_object_agg(metric_key,value),'{}') from state_metrics where game_id=p_game_id and (is_public or private.is_game_teacher(p_game_id))))
 into answer from game_fiscal_policy p where game_id=p_game_id;
 return answer;
end$function$;
