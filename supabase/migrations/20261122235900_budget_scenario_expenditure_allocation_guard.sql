-- Preserve the existing invariant: program allocations <= total budget
-- expenditure, even when the latter decreases in Budget Lab.
-- Reuse the existing locked scenario row lookup. The indexed allocation sum
-- is checked ONLY on expenditure reductions; no extra ordinary save reads,
-- client RPCs, subscriptions, tables, formulas, UI or role changes.
CREATE OR REPLACE FUNCTION public.save_budget_scenario(p_game_id uuid, p_scenario_id uuid, p_title text, p_budget_year integer, p_source_note text, p_gdp numeric, p_oil_price numeric, p_cutoff_price numeric, p_key_rate numeric, p_fx_change_pct numeric, p_fx_intervention numeric, p_revenue numeric, p_expenditure numeric, p_debt_start numeric, p_financing numeric, p_deficit_limit_pct numeric, p_debt_limit_pct numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_uid uuid:=(select auth.uid());v_role text;v_id uuid;v_balance numeric;v_deficit numeric;v_debt_end numeric;v_debt_pct numeric;v_existing_status text;v_existing_document uuid;v_existing_year integer;v_existing_note text;v_existing_unit text;v_new_unit text;v_existing_expenditure numeric;
begin
 if v_uid is null or not private.is_game_member(p_game_id) then raise exception 'Game access required'; end if;
 v_role:=private.game_role(p_game_id,v_uid);
 if not private.is_game_teacher(p_game_id)
    and not private.has_effective_role_like(p_game_id,v_uid,ARRAY['%правительств%','%министр%','%банк%росс%'])
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
  select status,formal_document_id,budget_year,source_note,expenditure
    into v_existing_status,v_existing_document,v_existing_year,v_existing_note,v_existing_expenditure
  from public.budget_scenarios where id=p_scenario_id and game_id=p_game_id for update;
  if not found then raise exception 'Scenario not found'; end if;
  if v_existing_status is distinct from 'draft' or v_existing_document is not null then
   raise exception 'Зафиксированный бюджетный сценарий нельзя менять. Создайте новый вариант.';
  end if;
  -- Match BudgetLab's existing scenarioUnit() precedence. Once annual
  -- allocations exist, changing the year or the display/stored-money scale
  -- would silently reinterpret their already approved amounts.
  if p_budget_year is distinct from v_existing_year
     or nullif(trim(coalesce(p_source_note,'')),'') is distinct from v_existing_note then
    v_existing_unit:=case
     when lower(coalesce(v_existing_note,'')) ~ 'трлн|триллион' then 'trln'
     when lower(coalesce(v_existing_note,'')) ~ 'млрд|миллиард' then 'mlrd'
     when lower(coalesce(v_existing_note,'')) ~ 'млн|миллион' then 'mln'
     when lower(coalesce(v_existing_note,'')) ~ 'тыс\.?|тысяч' then 'tys'
     when lower(coalesce(v_existing_note,'')) ~ 'рубл|₽' then 'rub'
     else 'mln' end;
    v_new_unit:=case
     when lower(coalesce(p_source_note,'')) ~ 'трлн|триллион' then 'trln'
     when lower(coalesce(p_source_note,'')) ~ 'млрд|миллиард' then 'mlrd'
     when lower(coalesce(p_source_note,'')) ~ 'млн|миллион' then 'mln'
     when lower(coalesce(p_source_note,'')) ~ 'тыс\.?|тысяч' then 'tys'
     when lower(coalesce(p_source_note,'')) ~ 'рубл|₽' then 'rub'
     else 'mln' end;
    if (p_budget_year is distinct from v_existing_year
         or v_new_unit is distinct from v_existing_unit)
       and exists(select 1 from public.budget_program_allocations a
                  where a.scenario_id=p_scenario_id and a.game_id=p_game_id)
    then
     raise exception 'В сценарии уже распределены средства по госпрограммам. Перед изменением года или единиц измерения удалите распределения и создайте их заново.';
    end if;
  end if;
  -- Preserve allocation <= total expenses if the budget ceiling decreases.
  -- Check indexed allocations only on reduction; unchanged/greater totals
  -- do not acquire any extra read.
  if p_expenditure < v_existing_expenditure then
    if exists (
      select 1 from public.budget_program_allocations a
      where a.scenario_id=p_scenario_id and a.game_id=p_game_id
      having coalesce(sum(a.amount),0)>p_expenditure
    ) then
      raise exception 'Общие расходы бюджета не могут быть меньше уже распределённых средств по госпрограммам. Сначала скорректируйте распределения.';
    end if;
  end if;
  update public.budget_scenarios set title=coalesce(nullif(trim(p_title),''),title),budget_year=p_budget_year,source_note=nullif(trim(coalesce(p_source_note,'')),''),
   gdp=p_gdp,oil_price=p_oil_price,cutoff_price=p_cutoff_price,key_rate=p_key_rate,fx_change_pct=p_fx_change_pct,fx_intervention=p_fx_intervention,
   revenue=p_revenue,expenditure=p_expenditure,debt_start=p_debt_start,financing=p_financing,balance=v_balance,
   deficit_pct_gdp=v_deficit,debt_end=v_debt_end,debt_pct_gdp=v_debt_pct,deficit_limit_pct=p_deficit_limit_pct,debt_limit_pct=p_debt_limit_pct,
   updated_by=v_uid,updated_at=now()
  where id=p_scenario_id returning id into v_id;
 end if;
 return v_id;
end;
$function$
;
