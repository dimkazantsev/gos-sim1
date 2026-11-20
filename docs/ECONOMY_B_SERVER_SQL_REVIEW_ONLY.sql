-- ECONOMY B: SERVER REVIEW SCRIPT. NOT A MIGRATION. DO NOT APPLY TO LIVE DATA.
-- Must first verify current schema and approve integration test results.
-- Requires private.fiscal_activity_reference from 2026-11-13.
-- No coefficient for trust or legal stability is enabled here.
-- No new tables, triggers, polling, network subscriptions, or RLS grants.
-- Running this at approval time replaces 2 helpers; budget amounts must remain
-- identical in the absence of a teacher's explicit activity override.

-- Qualify live rates against the article helper's local rate variable.
create or replace function private.budget_income_details(p_game uuid,d jsonb,groups jsonb,p_activity numeric,p_oil numeric) returns jsonb
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare model jsonb:='[{"key":"oil_ndpi","group_key":"oil_gas","label":"Налоги на добычу нефти и газа","share":0.8,"reference_rate":40,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":true,"base_label":"Расчётная стоимость добычи","driver_note":"Цена нефти и курс рубля"},{"key":"oil_extra","group_key":"oil_gas","label":"Дополнительные нефтегазовые поступления","share":0.2,"reference_rate":25,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":true,"base_label":"Расчётный доход нефтегазового сектора","driver_note":"Цена нефти и курс рубля"},{"key":"vat","group_key":"turnover","label":"НДС","share":0.72,"reference_rate":22,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":false,"base_label":"Облагаемый оборот без НДС","driver_note":"Предприятия, занятость, спрос и решения в игре"},{"key":"excise","group_key":"turnover","label":"Акцизы","share":0.18,"reference_rate":20,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":true,"base_label":"Расчётная стоимость подакцизных товаров","driver_note":"Деловая активность и объём потребления"},{"key":"customs","group_key":"turnover","label":"Таможенные пошлины","share":0.1,"reference_rate":10,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":true,"base_label":"Расчётная стоимость облагаемого импорта","driver_note":"Деловая активность и внешняя торговля"},{"key":"profit","group_key":"income","label":"Налог на прибыль · федеральная часть","share":0.8,"reference_rate":25,"rate_unit":"percent","base_unit":"million_rubles","federal_share":0.32,"model_rate":false,"base_label":"Облагаемая прибыль организаций","driver_note":"Предприятия, активность и принятые налоговые решения"},{"key":"personal_income","group_key":"income","label":"Федеральные поступления налога на доходы физических лиц","share":0.2,"reference_rate":15,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":true,"base_label":"Расчётная база федеральных поступлений","driver_note":"Деловая активность; ставка усреднена для игры"},{"key":"dividends","group_key":"assets","label":"Дивиденды по государственной доле","share":0.6,"reference_rate":100,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":true,"base_label":"Прогноз выплат по государственной доле","driver_note":"Прогноз распределяемых выплат"},{"key":"asset_interest","group_key":"assets","label":"Доходы от размещения средств и использования имущества","share":0.4,"reference_rate":100,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":true,"base_label":"Прогноз процентных, арендных и иных платежей","driver_note":"Утверждённый прогноз неналоговых поступлений"},{"key":"rent","group_key":"rent","label":"Платежи за другие природные ресурсы","share":1,"reference_rate":8,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":true,"base_label":"Расчётная стоимость использования ресурсов","driver_note":"Объём производства и деловая активность"},{"key":"recycling","group_key":"recycling","label":"Утилизационный сбор","share":1,"reference_rate":200000,"rate_unit":"rubles","base_unit":"units","federal_share":1,"model_rate":true,"base_label":"Количество объектов, с которых взимается сбор","driver_note":"Производство и ввоз; рублёвая ставка усреднена для игры"},{"key":"other","group_key":"other","label":"Прочие налоговые и неналоговые доходы","share":1,"reference_rate":100,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":true,"base_label":"Прогноз остальных поступлений","driver_note":"Подтверждённые изменения прогнозных поступлений"}]'::jsonb;
 b jsonb;l jsonb;m jsonb;rate numeric;divisor numeric;driver numeric;raw_group numeric;group_tax numeric;scale numeric;tax_base numeric;amount numeric;vat numeric;profit numeric;collection numeric;rows jsonb:='[]';
begin
 select data into b from private.budget_baseline where year=2026;
 vat:=coalesce((select r.rate from game_fiscal_rates r where r.game_id=p_game and r.region_code='00' and r.tax_key='vat'),22);
 profit:=coalesce((select r.rate from game_fiscal_rates r where r.game_id=p_game and r.region_code='00' and r.tax_key='profit'),25);
 for m in select jsonb_array_elements(model) loop
  select value into l from jsonb_array_elements(b->'income_lines') where value->>'key'=m->>'group_key';
  driver:=case l->>'driver' when 'oil' then p_oil when 'activity' then p_activity else 1 end*(1+coalesce((d->'income_changes'->>(l->>'key'))::numeric,0)/100);
  group_tax:=case l->>'key' when 'turnover' then 1+.72*(vat/22-1) when 'income' then 1+.8*(profit/25-1) else 1 end;
  raw_group:=(l->>'amount')::numeric*driver*group_tax;
  select case when raw_group>0 then (value->>'amount')::numeric/raw_group else 0 end into scale from jsonb_array_elements(groups) where value->>'key'=l->>'key';
  rate:=case m->>'key' when 'vat' then vat when 'profit' then profit else (m->>'reference_rate')::numeric end;
  divisor:=case m->>'rate_unit' when 'rubles' then (m->>'reference_rate')::numeric/1000000 else (m->>'reference_rate')::numeric/100 end;
  collection:=case when m->>'key' in ('dividends','asset_interest','other') then 1 else .95 end;
  tax_base:=(l->>'amount')::numeric*(m->>'share')::numeric/(divisor*(m->>'federal_share')::numeric)*driver*scale/collection;
  amount:=tax_base*case m->>'rate_unit' when 'rubles' then rate/1000000 else rate/100 end*collection*(m->>'federal_share')::numeric;
  rows:=rows||jsonb_build_array(m||jsonb_build_object('rate',rate,'base',tax_base,'collection',collection,'amount',amount,'baseline',(l->>'amount')::numeric*(m->>'share')::numeric));
 end loop;
 return rows;
end;$$;
revoke all on function private.budget_income_details(uuid,jsonb,jsonb,numeric,numeric) from public,anon,authenticated;


-- Manual activity override parity for federal calculations:
CREATE OR REPLACE FUNCTION private.calculate_budget_simulator(p_game uuid, d jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare b jsonb;s budget_simulator_state%rowtype;p game_fiscal_policy%rowtype;a jsonb;e numeric;t numeric;fx numeric;v_regional_auto numeric;activity numeric;cost numeric;oil numeric;firms numeric;vat numeric;profit numeric;
 il jsonb:='[]';el jsonb:='[]';l jsonb;k text;n numeric;driver numeric;tax numeric;rev numeric;exp numeric;annual numeric:=0;interest numeric;transfer_exp numeric;credit numeric;fin numeric:=0;intr numeric:=0;extr numeric;balance numeric;need numeric;uncertainty numeric;issued numeric;locked_rate numeric;quote numeric;item_amount numeric;base_amount numeric;transfer_amount numeric;interest_amount numeric;reallocation numeric;tr jsonb;
begin
 if exists(select 1 from games where id=p_game and status not in ('finished','archived')) then perform private.ensure_budget_simulator(p_game);end if;perform private.validate_budget_draft(p_game,d);
 select data into b from private.budget_baseline where year=2026;select * into s from budget_simulator_state where game_id=p_game;select * into p from game_fiscal_policy where game_id=p_game;a:=s.anchor;
 e:=coalesce((select value from state_metrics where game_id=p_game and metric_key='economy'),(a->>'economy')::numeric)-(a->>'economy')::numeric;
 t:=coalesce((select value from state_metrics where game_id=p_game and metric_key='public_trust'),(a->>'trust')::numeric)-(a->>'trust')::numeric;
 fx:=p.fx_rate*greatest(.75,least(1.3,1-e*.001-t*.001-(p.key_rate-(a->>'key_rate')::numeric)*.0015));
 select coalesce(sum(enterprises*activity_multiplier),0)/greatest(1,(a->>'enterprises')::numeric) into firms from game_fiscal_regions where game_id=p_game;
 if p.activity_override is null then
  activity:=greatest(.2,least(2,firms*(1-(p.key_rate-(a->>'key_rate')::numeric)*.007+e*.002+t*.001)));
 else
  -- The regional helper is already defined in the November 13 migration.
  -- Reuse it only for manual teacher-set economic activity.
  v_regional_auto:=private.fiscal_activity_reference(
    p.key_rate,p.fx_rate,
    e+(a->>'economy')::numeric-p.baseline_economy,
    t+(a->>'trust')::numeric-p.baseline_trust
  );
  activity:=greatest(.2,least(2,firms*greatest(0,least(10,
    (p.activity_override/100)*v_regional_auto/
    greatest(.00000001,coalesce(nullif(p.activity_reference,0),v_regional_auto))
  ))));
 end if;
 cost:=greatest(.7,least(1.6,1+(p.inflation-(a->>'inflation')::numeric)*.004+(fx/(a->>'fx_rate')::numeric-1)*.02));
 oil:=greatest(.1,least(3,p.oil_price/(a->>'oil_price')::numeric*fx/(a->>'fx_rate')::numeric));
 vat:=coalesce((select rate from game_fiscal_rates where game_id=p_game and region_code='00' and tax_key='vat'),22);
 profit:=coalesce((select rate from game_fiscal_rates where game_id=p_game and region_code='00' and tax_key='profit'),25);
 rev:=(b->>'income_rounding')::numeric+s.revenue_adjustment;
 for l in select jsonb_array_elements(b->'income_lines') loop
  k:=l->>'key';driver:=case l->>'driver' when 'oil' then oil when 'activity' then activity else 1 end;
  tax:=case k when 'turnover' then 1+.72*(vat/22-1) when 'income' then 1+.8*(profit/25-1) else 1 end;
  n:=round(greatest(0,(l->>'amount')::numeric*driver*tax*(1+coalesce((d->'income_changes'->>k)::numeric,0)/100)+coalesce((d->'revenue_adjustments'->>k)::numeric,0)),2);
  il:=il||jsonb_build_array(jsonb_build_object('key',k,'label',l->>'label','baseline',(l->>'amount')::numeric,'amount',n));rev:=rev+n;
 end loop;
 for k in select jsonb_object_keys(b->'financing') loop
  n:=(d->'financing'->>k)::numeric;fin:=fin+n;
  if k in ('ofz_fixed','ofz_float','bank_credit','external') then
   issued:=case when s.last_plan_id is null then 0 else least(n,(s.last_financing->>k)::numeric) end;quote:=private.budget_financing_rate(k,p.key_rate);
   locked_rate:=coalesce((s.financing_rates->>k)::numeric,private.budget_financing_rate(k,(a->>'key_rate')::numeric));
   annual:=annual+case when k='ofz_float' then n*quote/100 else (issued*locked_rate+(n-issued)*quote)/100 end;
  end if;
  if k in ('ofz_fixed','ofz_float','bank_credit') then intr:=intr+n-(s.last_financing->>k)::numeric;end if;
 end loop;
 interest:=(annual-(b->'financing'->>'ofz_fixed')::numeric*(a->>'key_rate')::numeric/100)*.5+s.service_adjustment;
 select coalesce(sum(amount) filter(where kind<>'budget_credit'),0),coalesce(sum(amount) filter(where kind='budget_credit'),0) into transfer_exp,credit from budget_transfer_requests where game_id=p_game and status<>'rejected' and d->'transfer_ids' ? id::text;
 exp:=(b->>'expense_rounding')::numeric;
 for l in select jsonb_array_elements(b->'expense_lines') loop
  k:=l->>'key';select coalesce(sum(amount),0) into transfer_amount from budget_transfer_requests where game_id=p_game and status<>'rejected' and kind<>'budget_credit' and section_key=k and d->'transfer_ids' ? id::text;
  select coalesce(sum((i->>'amount')::numeric),0) into item_amount from jsonb_array_elements(coalesce(d->'expense_items','[]'::jsonb)) i where i->>'section_key'=k;
  base_amount:=(l->>'amount')::numeric*(1+coalesce((d->'spending_changes'->>k)::numeric,0)/100)*cost;
  interest_amount:=case when k='13' then interest else 0 end;
  reallocation:=coalesce((d->'base_reallocations'->>k)::numeric,0);
  if round(greatest(0,base_amount+interest_amount),2)+reallocation<0 then raise exception 'Поправка не может уменьшить базовое ассигнование раздела ниже нуля или расходовать защищённые программы и трансферты.';end if;
  n:=round(round(greatest(0,base_amount+interest_amount),2)+reallocation+transfer_amount+item_amount,8);
  el:=el||jsonb_build_array(jsonb_build_object('key',k,'label',l->>'label','baseline',(l->>'amount')::numeric,'base_amount',round(greatest(0,base_amount+interest_amount),2)-interest_amount+reallocation,'base_reallocation_amount',reallocation,'transfer_amount',transfer_amount,'items_amount',item_amount,'interest_amount',interest_amount,'amount',n));exp:=exp+n;
 end loop;
 intr:=round(greatest(0,s.internal_debt+intr),8);extr:=round(greatest(0,s.external_debt*fx/(a->>'fx_rate')::numeric+(d->'financing'->>'external')::numeric-(s.last_financing->>'external')::numeric),8);
 rev:=round(rev,2);exp:=round(exp,8);balance:=round(rev-exp,8);need:=round(greatest(0,-balance)+credit,8);
 uncertainty:=greatest(.025,least(.2,.04+abs(e)*.001+abs(t)*.001+abs(p.inflation-(a->>'inflation')::numeric)*.003));
 select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at,r.id),'[]'::jsonb) into tr from (select r.*,f.name region_name,c.title event_title from budget_transfer_requests r join fiscal_region_reference f on f.code=r.region_code left join event_cases c on c.id=r.event_case_id and c.game_id=r.game_id where r.game_id=p_game and r.status<>'rejected' and d->'transfer_ids' ? r.id::text) r;
 return jsonb_build_object('income_lines',il,'income_details',private.budget_income_details(p_game,d,il,activity,oil),'expense_lines',el,'expense_items',coalesce(d->'expense_items','[]'::jsonb),'program_expenses',private.server_budget_program_expenses(p_game,coalesce(d->'expense_items','[]'::jsonb)),'transfer_requests',tr,'income_rounding',(b->>'income_rounding')::numeric,'revenue_adjustment',s.revenue_adjustment,'revenue',rev,'expenditure',exp,'balance',balance,'deficit',greatest(0,-balance),'surplus',greatest(0,balance),
 'deficit_pct_gdp',greatest(0,-balance)/(b->>'gdp')::numeric*100,'financing',round(fin,8),'funding_need',need,'funding_gap',round(greatest(0,need-fin),8),'cash_excess',round(greatest(0,fin-need)+greatest(0,balance),8),
 'internal_debt',intr,'external_debt',extr,'debt_total',intr+extr,'debt_pct_gdp',(intr+extr)/(b->>'gdp')::numeric*100,'annual_interest',annual,'interest_delta',interest,'transfer_expense',transfer_exp,'credit_outflow',credit,
 'reserve_remaining',round(s.reserve_remaining-(d->'financing'->>'reserves')::numeric+case when s.last_plan_id is not null then (s.last_financing->>'reserves')::numeric else 0 end,8),
 'activity',activity,'cost',cost,'fx',fx,'uncertainty',uncertainty,'revenue_low',rev*(1-uncertainty),'revenue_high',rev*(1+uncertainty),'expenditure_low',exp*(1-uncertainty),'expenditure_high',exp*(1+uncertainty));
end$function$;
