-- CANDIDATE ONLY: not an applied migration. First load economic-model-v2-core.sql in the same migration transaction after tests.
-- Existing grants on replaced functions are preserved; new private functions are explicitly revoked.
CREATE OR REPLACE FUNCTION private.budget_aux_impact_v2(p_game uuid,p_anchor jsonb)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO '' AS $f$
 SELECT private.economic_aux_v2(coalesce(jsonb_object_agg(metric_key,value),'{}'::jsonb),p_anchor->'aux_metrics')
 FROM public.state_metrics WHERE game_id=p_game AND metric_key IN ('social_stability','security','elite_support','international_standing','social_tension','legitimacy','media_climate')
$f$;
REVOKE ALL ON FUNCTION private.budget_aux_impact_v2(uuid,jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.budget_income_details_v2(p_game uuid, d jsonb, groups jsonb, p_activity numeric, p_oil numeric, p_collection numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare model jsonb:='[{"key":"oil_ndpi","group_key":"oil_gas","label":"Налоги на добычу нефти и газа","share":0.8,"reference_rate":40,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":true,"base_label":"Расчётная стоимость добычи","driver_note":"Цена нефти и курс рубля"},{"key":"oil_extra","group_key":"oil_gas","label":"Дополнительные нефтегазовые поступления","share":0.2,"reference_rate":25,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":true,"base_label":"Расчётный доход нефтегазового сектора","driver_note":"Цена нефти и курс рубля"},{"key":"vat","group_key":"turnover","label":"НДС","share":0.72,"reference_rate":22,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":false,"base_label":"Облагаемый оборот без НДС","driver_note":"Предприятия, занятость, спрос и решения в игре"},{"key":"excise","group_key":"turnover","label":"Акцизы","share":0.18,"reference_rate":20,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":true,"base_label":"Расчётная стоимость подакцизных товаров","driver_note":"Деловая активность и объём потребления"},{"key":"customs","group_key":"turnover","label":"Таможенные пошлины","share":0.1,"reference_rate":10,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":true,"base_label":"Расчётная стоимость облагаемого импорта","driver_note":"Деловая активность и внешняя торговля"},{"key":"profit","group_key":"income","label":"Налог на прибыль · федеральная часть","share":0.8,"reference_rate":25,"rate_unit":"percent","base_unit":"million_rubles","federal_share":0.32,"model_rate":false,"base_label":"Облагаемая прибыль организаций","driver_note":"Предприятия, активность и принятые налоговые решения"},{"key":"personal_income","group_key":"income","label":"Федеральные поступления налога на доходы физических лиц","share":0.2,"reference_rate":15,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":true,"base_label":"Расчётная база федеральных поступлений","driver_note":"Деловая активность; ставка усреднена для игры"},{"key":"dividends","group_key":"assets","label":"Дивиденды по государственной доле","share":0.6,"reference_rate":100,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":true,"base_label":"Прогноз выплат по государственной доле","driver_note":"Прогноз распределяемых выплат"},{"key":"asset_interest","group_key":"assets","label":"Доходы от размещения средств и использования имущества","share":0.4,"reference_rate":100,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":true,"base_label":"Прогноз процентных, арендных и иных платежей","driver_note":"Утверждённый прогноз неналоговых поступлений"},{"key":"rent","group_key":"rent","label":"Платежи за другие природные ресурсы","share":1,"reference_rate":8,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":true,"base_label":"Расчётная стоимость использования ресурсов","driver_note":"Объём производства и деловая активность"},{"key":"recycling","group_key":"recycling","label":"Утилизационный сбор","share":1,"reference_rate":200000,"rate_unit":"rubles","base_unit":"units","federal_share":1,"model_rate":true,"base_label":"Количество объектов, с которых взимается сбор","driver_note":"Производство и ввоз; рублёвая ставка усреднена для игры"},{"key":"other","group_key":"other","label":"Прочие налоговые и неналоговые доходы","share":1,"reference_rate":100,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":true,"base_label":"Прогноз остальных поступлений","driver_note":"Подтверждённые изменения прогнозных поступлений"}]'::jsonb;
 b jsonb;l jsonb;m jsonb;rate numeric;divisor numeric;driver numeric;raw_group numeric;group_tax numeric;group_amount numeric;scale numeric;tax_base numeric;amount numeric;vat numeric;profit numeric;collection numeric;v_collection numeric;rows jsonb:='[]';adjustments jsonb:='[]';
begin
 select data into b from private.budget_baseline where year=2026;
 vat:=coalesce((select r.rate from game_fiscal_rates r where r.game_id=p_game and r.region_code='00' and r.tax_key='vat'),22);
 profit:=coalesce((select r.rate from game_fiscal_rates r where r.game_id=p_game and r.region_code='00' and r.tax_key='profit'),25);
 v_collection:=p_collection;
 for m in select jsonb_array_elements(model) loop
  select value into l from jsonb_array_elements(b->'income_lines') where value->>'key'=m->>'group_key';
  driver:=case l->>'driver' when 'oil' then p_oil when 'activity' then p_activity else 1 end*(1+coalesce((d->'income_changes'->>(l->>'key'))::numeric,0)/100);
  group_tax:=case l->>'key' when 'turnover' then 1+.72*(vat/22-1) when 'income' then 1+.8*(profit/25-1) else 1 end;
  raw_group:=(l->>'amount')::numeric*driver*group_tax;
  select (value->>'amount')::numeric into group_amount from jsonb_array_elements(groups) where value->>'key'=l->>'key';
  scale:=case when raw_group>0 then group_amount/raw_group else 0 end;
  IF raw_group<=0 AND group_amount>0 AND NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(adjustments) j WHERE j->>'key'='adjustment:'||(l->>'key')
  ) THEN
   adjustments:=adjustments||jsonb_build_array(jsonb_build_object('key','adjustment:'||(l->>'key'),'group_key',l->>'key','label','Корректировка доходов · '||(l->>'label'),'rate',100,'rate_unit','percent','base',group_amount,'base_unit','million_rubles','collection',1,'federal_share',1,'amount',group_amount,'baseline',0,'base_label','Сохранённая отдельная корректировка','driver_note','Не является налоговой базой','model_rate',true));
  END IF;
  rate:=case m->>'key' when 'vat' then vat when 'profit' then profit else (m->>'reference_rate')::numeric end;
  divisor:=case m->>'rate_unit' when 'rubles' then (m->>'reference_rate')::numeric/1000000 else (m->>'reference_rate')::numeric/100 end;
  collection:=case when m->>'key' in ('dividends','asset_interest','other') then 1 else v_collection end;
  tax_base:=(l->>'amount')::numeric*(m->>'share')::numeric/(divisor*(m->>'federal_share')::numeric)*driver*scale/collection;
  amount:=tax_base*case m->>'rate_unit' when 'rubles' then rate/1000000 else rate/100 end*collection*(m->>'federal_share')::numeric;
  rows:=rows||jsonb_build_array(m||jsonb_build_object('rate',rate,'base',tax_base,'collection',collection,'amount',amount,'baseline',(l->>'amount')::numeric*(m->>'share')::numeric));
 end loop;
 return rows||adjustments;
end;$function$
;
REVOKE ALL ON FUNCTION private.budget_income_details_v2(uuid,jsonb,jsonb,numeric,numeric,numeric) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.calculate_budget_simulator(p_game uuid, d jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare b jsonb;s budget_simulator_state%rowtype;p game_fiscal_policy%rowtype;a jsonb;e numeric;t numeric;fx numeric;v_auto numeric;v_ref numeric;v_model_v2 boolean;v_macro numeric;v_enterprise_count numeric;v_weighted numeric;v_factors jsonb;activity numeric;cost numeric;oil numeric;firms numeric;vat numeric;profit numeric;v_collection numeric;v_aux jsonb;v_activity_adj numeric;v_collection_adj numeric;v_internal_terms jsonb;v_internal_new numeric:=0;v_internal_over numeric:=0;v_internal_interest_over numeric:=0;v_oil_saving numeric:=0;v_oil_change numeric:=0;v_access jsonb;v_external_new numeric;v_external_over numeric;v_refinance numeric;v_due numeric;v_refinance_allowed numeric;v_refinance_over numeric;v_refinance_left numeric;v_repay numeric;v_paid_internal numeric:=0;v_paid_external numeric:=0;v_due_ct record;
 il jsonb:='[]';el jsonb:='[]';l jsonb;k text;n numeric;driver numeric;tax numeric;rev numeric;exp numeric;annual numeric:=0;interest numeric;transfer_exp numeric;credit numeric;fin numeric:=0;intr numeric:=0;extr numeric;balance numeric;need numeric;net_need numeric;uncertainty numeric;issued numeric;locked_rate numeric;quote numeric;item_amount numeric;base_amount numeric;transfer_amount numeric;interest_amount numeric;reallocation numeric;tr jsonb;
begin
 if exists(select 1 from games where id=p_game and status not in ('finished','archived')) then perform private.ensure_budget_simulator(p_game);end if;perform private.validate_budget_draft(p_game,d);
 -- Mandatory signed annual amounts are calculated once, independently of manual expenses.
 d:=jsonb_set(d,'{expense_items}',coalesce((select jsonb_agg(i.value order by i.ordinality) from jsonb_array_elements(coalesce(d->'expense_items','[]'::jsonb)) with ordinality i(value,ordinality) where nullif(i.value->>'program_id','') is null),'[]'::jsonb)||private.signed_program_budget_items(p_game),true);
 if jsonb_array_length(d->'expense_items')>100 then raise exception 'Сократите дополнительные ручные расходы: обязательные ГП и мероприятия должны помещаться в 100 строк.';end if;
 select data into b from private.budget_baseline where year=2026;select * into s from budget_simulator_state where game_id=p_game;select * into p from game_fiscal_policy where game_id=p_game;a:=s.anchor;v_model_v2:=coalesce(a->>'economic_model_version','1')='2';
 v_ref:=case when v_model_v2 then p.baseline_economy else (a->>'economy')::numeric end;
 e:=coalesce((select value from state_metrics where game_id=p_game and metric_key='economy'),v_ref)-v_ref;
 v_ref:=case when v_model_v2 then p.baseline_trust else (a->>'trust')::numeric end;
 t:=coalesce((select value from state_metrics where game_id=p_game and metric_key='public_trust'),v_ref)-v_ref;
 v_aux:=case when v_model_v2 then private.budget_aux_impact_v2(p_game,a) else private.budget_aux_impact(p_game,a) end;
 v_activity_adj:=coalesce((v_aux->>'activity_adjustment')::numeric,0);
 v_collection_adj:=coalesce((v_aux->>'collection_adjustment')::numeric,0);
 v_access:=private.external_borrowing_access(p_game);v_internal_terms:=private.internal_borrowing_terms(p_game);
 IF v_model_v2 THEN
  v_factors:=private.economic_automatic_v2(p.key_rate,p.fx_rate,e,t,v_activity_adj);
  fx:=(v_factors->>'fx')::numeric;
  v_macro:=private.economic_manual_v2((v_factors->>'automatic')::numeric,p.activity_override,p.activity_reference);
  SELECT coalesce(sum(enterprises),0),coalesce(sum(enterprises*activity_multiplier),0)
   INTO v_enterprise_count,v_weighted FROM game_fiscal_regions WHERE game_id=p_game;
  v_factors:=private.enterprise_factors_v2(v_enterprise_count,v_weighted,(a->>'enterprises')::numeric,v_macro);
  activity:=(v_factors->>'activity')::numeric;
 ELSE
 fx:=p.fx_rate*greatest(.75,least(1.3,1-e*.001-t*.001-(p.key_rate-(a->>'key_rate')::numeric)*.0015));
 select coalesce(sum(enterprises*activity_multiplier),0)/greatest(1,(a->>'enterprises')::numeric) into firms from game_fiscal_regions where game_id=p_game;
 activity:=greatest(.2,least(2,firms*(1-(p.key_rate-(a->>'key_rate')::numeric)*.007+e*.002+t*.001+v_activity_adj)));
 END IF;
 cost:=greatest(.7,least(1.6,1+(p.inflation-(a->>'inflation')::numeric)*.004+(fx/(a->>'fx_rate')::numeric-1)*.02));
 oil:=greatest(.1,least(3,p.oil_price/(a->>'oil_price')::numeric*fx/(a->>'fx_rate')::numeric))*greatest(.7,least(1.3,1+e*.002));
 vat:=coalesce((select rate from game_fiscal_rates where game_id=p_game and region_code='00' and tax_key='vat'),22);
 profit:=coalesce((select rate from game_fiscal_rates where game_id=p_game and region_code='00' and tax_key='profit'),25);
 IF v_model_v2 THEN
  -- Enterprise numbers only change the taxable base, not collection a second time.
  v_collection:=private.bounded_collection_v2(.95+private.economic_collection_v2(v_macro,
    coalesce((a->>'regional_activity_reference')::numeric,1),
    coalesce((select m.value-p.collection_lawfulness_reference from state_metrics m where m.game_id=p_game and m.metric_key='lawfulness'),0),t,v_collection_adj),.70,.995);
 ELSE
 v_collection:=greatest(.85,least(.995,.95+private.budget_tax_compliance_shift(activity,a)+coalesce((select (m.value-p.collection_lawfulness_reference)*.0003 from state_metrics m where m.game_id=p_game and m.metric_key='lawfulness' and p.collection_lawfulness_reference is not null),0)+t*.0005+v_collection_adj));
 END IF;
 rev:=(b->>'income_rounding')::numeric+s.revenue_adjustment;
 for l in select jsonb_array_elements(b->'income_lines') loop
  k:=l->>'key';driver:=case l->>'driver' when 'oil' then oil when 'activity' then activity else 1 end;
  tax:=case k when 'turnover' then 1+.72*(vat/22-1) when 'income' then 1+.8*(profit/25-1) else 1 end;
  n:=round(greatest(0,(l->>'amount')::numeric*driver*tax*(1+coalesce((d->'income_changes'->>k)::numeric,0)/100)*case when k in ('oil_gas','turnover','income','rent','recycling') then v_collection/.95 else 1 end+coalesce((d->'revenue_adjustments'->>k)::numeric,0)),2);
  il:=il||jsonb_build_array(jsonb_build_object('key',k,'label',l->>'label','baseline',(l->>'amount')::numeric,'amount',n));rev:=rev+n;
 end loop;
 for k in select jsonb_object_keys(b->'financing') loop
  n:=(d->'financing'->>k)::numeric;fin:=fin+n;
  if k in ('ofz_fixed','ofz_float','bank_credit','external') then
   issued:=least(n,coalesce((s.last_financing->>k)::numeric,0));
 quote:=case when k='external' then (v_access->>'rate')::numeric
 else private.budget_financing_rate(k,p.key_rate)+private.internal_borrowing_premium(p.key_rate,p.inflation) end;
 if k in ('ofz_fixed','ofz_float','bank_credit') then
  v_internal_new:=v_internal_new+greatest(0,n-coalesce((s.last_financing->>k)::numeric,0));end if;
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
 v_external_new:=greatest(0,(d->'financing'->>'external')::numeric-case when s.last_plan_id is null then 0 else (s.last_financing->>'external')::numeric end);
 v_external_over:=greatest(0,v_external_new-(v_access->>'available')::numeric);
 v_internal_over:=greatest(0,v_internal_new-(v_internal_terms->>'available')::numeric);
 v_internal_interest_over:=greatest(0,annual-rev*.10);
 v_refinance:=coalesce((d->>'external_refinance')::numeric,0);
 select coalesce(sum(case when c.source_key='external' then c.principal*fx/(a->>'fx_rate')::numeric else c.principal end),0)
 into v_due from budget_finance_contracts c where c.game_id=p_game and c.status='due' and c.maturity_month<=s.month and c.principal>0;
 v_refinance_allowed:=least(v_refinance,v_due,v_external_new);
 v_refinance_over:=greatest(0,v_refinance-v_refinance_allowed);
 v_refinance_left:=v_refinance_allowed;
 for v_due_ct in select source_key,principal from budget_finance_contracts
 where game_id=p_game and status='due' and maturity_month<=s.month and principal>0 order by maturity_month,id loop
  exit when v_refinance_left<=0;
  v_repay:=least(v_refinance_left,case when v_due_ct.source_key='external' then v_due_ct.principal*fx/(a->>'fx_rate')::numeric else v_due_ct.principal end);
  if v_due_ct.source_key='external' then v_paid_external:=v_paid_external+v_repay;else v_paid_internal:=v_paid_internal+v_repay;end if;
  v_refinance_left:=greatest(0,v_refinance_left-v_repay);
 end loop;
 intr:=round(greatest(0,s.internal_debt+intr-v_paid_internal),8);
 extr:=round(greatest(0,s.external_debt*fx/(a->>'fx_rate')::numeric+(d->'financing'->>'external')::numeric-(s.last_financing->>'external')::numeric-v_paid_external),8);
 fin:=fin-v_refinance;
 select round(coalesce((i->>'amount')::numeric,0)
 *greatest(0,p.oil_price-p.cutoff_price)/greatest(.01,p.oil_price),8)
 into v_oil_saving from jsonb_array_elements(il) i where i->>'key'='oil_gas';
 v_oil_saving:=coalesce(v_oil_saving,0);
 v_oil_change:=v_oil_saving-s.fnb_last_oil_allocation;
 rev:=round(rev,2);exp:=round(exp,8);balance:=round(rev-exp,8);
 -- Surplus also covers mandatory financial outflows.
 net_need:=round(-balance+credit+v_oil_change,8);
 need:=greatest(0,net_need);
 uncertainty:=greatest(.025,least(.2,.04+abs(e)*.001+abs(t)*.001+abs(p.inflation-(a->>'inflation')::numeric)*.003));
 select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at,r.id),'[]'::jsonb) into tr from (select r.*,f.name region_name,c.title event_title from budget_transfer_requests r join fiscal_region_reference f on f.code=r.region_code left join event_cases c on c.id=r.event_case_id and c.game_id=r.game_id where r.game_id=p_game and r.status<>'rejected' and d->'transfer_ids' ? r.id::text) r;
 return jsonb_build_object('budget_year',2027,'baseline_year',2026,'income_lines',il,'income_details',case when v_model_v2 then private.budget_income_details_v2(p_game,d,il,activity,oil,v_collection) else private.budget_income_details(p_game,d,il,activity,oil) end,'expense_lines',el,'expense_items',coalesce(d->'expense_items','[]'::jsonb),'program_expenses',private.server_budget_program_expenses(p_game,coalesce(d->'expense_items','[]'::jsonb)),'transfer_requests',tr,'income_rounding',(b->>'income_rounding')::numeric,'revenue_adjustment',s.revenue_adjustment,'revenue',rev,'expenditure',exp,'balance',balance,'deficit',greatest(0,-balance),'surplus',greatest(0,balance),
 'deficit_pct_gdp',greatest(0,-balance)/(b->>'gdp')::numeric*100,'financing',round(fin,8),'funding_need',need,'funding_gap',round(greatest(0,net_need-fin),8),'cash_excess',round(greatest(0,fin-net_need),8),
 'internal_debt',intr,'external_debt',extr,'debt_total',intr+extr,'debt_pct_gdp',(intr+extr)/(b->>'gdp')::numeric*100,'annual_interest',annual,'interest_delta',interest,'transfer_expense',transfer_exp,'credit_outflow',credit,
 'reserve_remaining',round(s.reserve_remaining+v_oil_change-(d->'financing'->>'reserves')::numeric+case when s.last_plan_id is not null then (s.last_financing->>'reserves')::numeric else 0 end,8),
 'activity',activity,'cost',cost,'fx',fx,'uncertainty',uncertainty,'model_b_additional_channels',v_aux,
 'external_borrowing_limit',(v_access->>'annual_limit')::numeric,'external_borrowing_available',(v_access->>'available')::numeric,
 'external_borrowing_used',(v_access->>'used')::numeric,'external_borrowing_rate',(v_access->>'rate')::numeric,
 'external_borrowing_new',v_external_new,'external_borrowing_over_limit',v_external_over,
 'external_refinance',v_refinance,'external_refinance_eligible',v_due,
 'external_refinance_allocated',v_refinance_allowed,'external_refinance_over_limit',v_refinance_over,'revenue_low',rev*(1-uncertainty),'revenue_high',rev*(1+uncertainty),'expenditure_low',exp*(1-uncertainty),'expenditure_high',exp*(1+uncertainty))||
 jsonb_build_object('economic_model_version',case when v_model_v2 then 2 else 1 end,'business_activity',v_macro,'enterprise_count',v_enterprise_count,'enterprise_factor',v_factors->'enterprise_factor','regional_activity',v_factors->'regional_activity','tax_collection',v_collection)||
 jsonb_build_object('internal_borrowing_limit',(v_internal_terms->>'annual_limit')::numeric,
 'internal_borrowing_available',(v_internal_terms->>'available')::numeric,
 'internal_borrowing_used',(v_internal_terms->>'used')::numeric,
 'internal_borrowing_new',v_internal_new,'internal_borrowing_over_limit',v_internal_over,
 'internal_interest_over_limit',v_internal_interest_over,
 'internal_borrowing_premium',private.internal_borrowing_premium(p.key_rate,p.inflation),
 'fnb_oil_allocation',v_oil_saving,'fnb_oil_change',v_oil_change,'fnb_total',s.fnb_total+v_oil_change-(d->'financing'->>'reserves')::numeric+case when s.last_plan_id is not null then (s.last_financing->>'reserves')::numeric else 0 end);
end$function$;

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
 perform private.settle_monetary_inflation(p_game_id);
 if not exists(select 1 from budget_simulator_state where game_id=p_game_id) then perform private.ensure_budget_simulator(p_game_id);end if;
 -- Existing policy rows must never contend on ON CONFLICT during a read.
 -- The original INSERT remains the first-read path and is race-safe.
 if not exists (select 1 from game_fiscal_policy where game_id=p_game_id) then
 insert into game_fiscal_policy(game_id,federal_expenditure,municipal_expenditure,baseline_economy,baseline_trust,collection_lawfulness_reference)
 select p_game_id,coalesce(sum(expenditure)*.6,0),coalesce(sum(expenditure)*.25,0),
 coalesce((select value from state_metrics where game_id=p_game_id and metric_key='economy'),50),
 coalesce((select value from state_metrics where game_id=p_game_id and metric_key='public_trust'),50),
 (select value from state_metrics where game_id=p_game_id and metric_key='lawfulness')
 from game_fiscal_regions where game_id=p_game_id on conflict(game_id) do nothing;
 end if;
 select jsonb_build_object('policy',to_jsonb(p)||jsonb_build_object('economic_model_version',coalesce((s.anchor->>'economic_model_version')::integer,1),'budget_aux_anchor',coalesce(s.anchor->'aux_metrics','{}'::jsonb),'tax_activity_reference',coalesce((s.anchor->>'regional_activity_reference')::numeric,1),'fnb_total',s.fnb_total,'fnb_liquid',s.reserve_remaining,'fnb_fx_share',case when s.reserve_remaining>0 then round(s.fnb_fx_units*p.fx_rate/s.reserve_remaining*100,4) else 0 end),'can_issue_bank_rate_decision',private.can_issue_bank_rate_decision(p_game_id,auth.uid()),'can_change_rate',private.is_game_teacher(p_game_id) or exists(
 select 1 from game_members m where m.game_id=p_game_id and m.user_id=auth.uid() and m.kind='student' and m.roster_archived_at is null
 and private.role_is_available(p_game_id,auth.uid())
 and (
   lower(coalesce(m.role_title,'')) ~ 'банк[а-я]* россии|центральн.{0,20}банк'
   or exists (
     select 1 from public.game_office_assignments a
     where a.game_id=p_game_id and a.user_id=m.user_id and a.status='active'
       and a.role_title='Председатель Центрального банка Российской Федерации'
   )
 )),
 'metrics',(select coalesce(jsonb_object_agg(metric_key,value),'{}') from state_metrics where game_id=p_game_id and (is_public or private.is_game_teacher(p_game_id))))
 into answer from game_fiscal_policy p left join budget_simulator_state s on s.game_id=p.game_id where p.game_id=p_game_id;
 return answer;
end$function$;

CREATE OR REPLACE FUNCTION private.ensure_budget_simulator(p_game uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare p game_fiscal_policy%rowtype;b jsonb;a jsonb;begin
 perform private.ensure_fiscal_game(p_game);
 -- All existing rows already satisfy the initialization contract.
 -- Avoid repeated conflict inserts, 89-region sums and anchor construction
 -- for every budget viewer, while preserving repairs for incomplete games.
 if exists(select 1 from game_fiscal_policy where game_id=p_game)
    and exists(select 1 from budget_simulator_state where game_id=p_game) then
   return;
 end if;
 insert into game_fiscal_policy(game_id,federal_expenditure,municipal_expenditure,baseline_economy,baseline_trust,collection_lawfulness_reference)
 select p_game,coalesce(sum(expenditure)*.6,0),coalesce(sum(expenditure)*.25,0),coalesce((select value from state_metrics where game_id=p_game and metric_key='economy'),50),coalesce((select value from state_metrics where game_id=p_game and metric_key='public_trust'),50),
 (select value from state_metrics where game_id=p_game and metric_key='lawfulness')
 from game_fiscal_regions where game_id=p_game on conflict(game_id) do nothing;
 select * into p from game_fiscal_policy where game_id=p_game;
 select data into b from private.budget_baseline where year=2026;
 a:=jsonb_build_object('economic_model_version',2,'enterprises',greatest(1,(select sum(enterprises*activity_multiplier) from game_fiscal_regions where game_id=p_game)),
 'key_rate',p.key_rate,'fx_rate',p.fx_rate,'oil_price',greatest(.01,p.oil_price),'inflation',p.inflation,
 'tax_activity_reference',1,'regional_activity_reference',1,'economy',coalesce((select value from state_metrics where game_id=p_game and metric_key='economy'),50),'trust',coalesce((select value from state_metrics where game_id=p_game and metric_key='public_trust'),50),
 'aux_metrics',(select coalesce(jsonb_object_agg(metric_key,value),'{}'::jsonb)
 from state_metrics where game_id=p_game and metric_key in ('social_stability','security','elite_support','international_standing','social_tension','legitimacy','media_climate')));
 insert into budget_simulator_state(game_id,anchor,internal_debt,external_debt,reserve_remaining,last_financing,fnb_fx_units)
 values(p_game,a,(b->>'internal_debt_end')::numeric,(b->>'external_debt_end')::numeric,(b->>'reserve_available_model')::numeric,b->'financing',round((b->>'reserve_available_model')::numeric*.25/greatest(.01,p.fx_rate),8)) on conflict(game_id) do nothing;
end$function$;

CREATE OR REPLACE FUNCTION private.reconcile_budget_driver_once(p_game uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE v_completed text:=coalesce(current_setting('gos.budget_driver_processed',true),'');
BEGIN
 IF p_game IS NULL OR current_setting('gos.economic_policy_pending',true)=p_game::text OR position('|'||p_game::text||'|' IN v_completed)>0 THEN RETURN; END IF;
 PERFORM private.reconcile_budget_driver(p_game);
 PERFORM set_config('gos.budget_driver_processed',
                    v_completed||'|'||p_game::text||'|',true);
END;
$function$;

CREATE OR REPLACE FUNCTION private.sync_budget_from_fiscal_ledger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE v_relevant boolean:=false;
BEGIN
 IF NEW.source_type IN ('event','teacher') THEN
  v_relevant:=
   (NEW.before_values->'enterprises') IS DISTINCT FROM (NEW.after_values->'enterprises')
   OR (NEW.before_values->'activity_multiplier') IS DISTINCT FROM (NEW.after_values->'activity_multiplier');
 ELSIF NEW.source_type='macro' THEN
  v_relevant:=
   (NEW.before_values->'key_rate') IS DISTINCT FROM (NEW.after_values->'key_rate')
   OR (NEW.before_values->'fx_rate') IS DISTINCT FROM (NEW.after_values->'fx_rate')
   OR (NEW.before_values->'activity_override') IS DISTINCT FROM (NEW.after_values->'activity_override')
   OR (NEW.before_values->'oil_price') IS DISTINCT FROM (NEW.after_values->'oil_price')
   OR (NEW.before_values->'cutoff_price') IS DISTINCT FROM (NEW.after_values->'cutoff_price')
   OR (NEW.before_values->'inflation') IS DISTINCT FROM (NEW.after_values->'inflation')
   OR (NEW.before_values->'fnb_total') IS DISTINCT FROM (NEW.after_values->'fnb_total')
   OR (NEW.before_values->'fnb_liquid') IS DISTINCT FROM (NEW.after_values->'fnb_liquid')
   OR (NEW.before_values->'fnb_fx_share') IS DISTINCT FROM (NEW.after_values->'fnb_fx_share');
 ELSIF NEW.source_type='act' AND NEW.region_code='00' THEN
  v_relevant:=
   split_part(NEW.source_id,':',2) IN ('vat','profit')
   AND (NEW.before_values->'rate') IS DISTINCT FROM (NEW.after_values->'rate');
 END IF;
 IF v_relevant THEN
  BEGIN
   PERFORM private.reconcile_budget_driver_once(NEW.game_id);
  EXCEPTION WHEN OTHERS THEN
   RAISE WARNING 'ГОС.ID: fiscal-ledger budget sync failed for game %, SQLSTATE %',
    NEW.game_id,SQLSTATE;
  END;
 END IF;
 RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_fiscal_policy(p_game_id uuid, p_values jsonb, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare old_row jsonb;new_row jsonb;is_teacher boolean;k text;allowed boolean;
 v_context jsonb;v_reference numeric;v_model_v2 boolean:=false;v_previous_pending text;v_metrics jsonb;v_old_fnb budget_simulator_state%rowtype;v_total numeric;v_liquid numeric;v_share numeric;v_fx_old numeric;
begin
 if auth.uid() is null or not private.is_game_member(p_game_id) then
   raise exception 'Нет доступа к этой игре.';
 end if;
 is_teacher:=private.is_game_teacher(p_game_id);
 allowed:=is_teacher or exists(
   select 1 from game_members m where m.game_id=p_game_id and m.user_id=auth.uid()
   and m.kind='student' and m.roster_archived_at is null
 and private.role_is_available(p_game_id,auth.uid())
 and (
   lower(coalesce(m.role_title,'')) ~ 'банк[а-я]* россии|центральн.{0,20}банк'
   or exists (
     select 1 from public.game_office_assignments a
     where a.game_id=p_game_id and a.user_id=m.user_id and a.status='active'
       and a.role_title='Председатель Центрального банка Российской Федерации'
   )
 )
 );
 if not allowed then
   raise exception 'Ключевую ставку меняет Банк России. Параметры сценария задаёт преподаватель.';
 end if;
 -- Students may not change the rate without its adopted, immutable Bank of Russia decision.
 -- Teachers retain their separately authorized administrative policy editor.
 if not is_teacher and p_values ? 'key_rate' and not exists(
  select 1 from public.formal_documents d
  where d.id=nullif(current_setting('app.gos_bank_rate_active_decision_id',true),'')::uuid
    and d.game_id=p_game_id and d.author_id=auth.uid() and d.doc_type='bank_rate_decision'
    and d.status_code='adopted' and d.metadata->>'bank_rate_decision'='true'
    and (d.metadata->>'new_rate')::numeric=(p_values->>'key_rate')::numeric
 ) then raise exception 'Измените ключевую ставку через её карточку: решение Банка России будет зарегистрировано автоматически.' using errcode='42501';end if;
 if p_values is null or jsonb_typeof(p_values)<>'object' or p_values='{}'::jsonb
    or p_reason is null or length(trim(p_reason))<8 then
   raise exception 'Укажите параметры и содержательное основание решения.';
 end if;
 for k in select jsonb_object_keys(p_values) loop
   if k not in ('key_rate','fx_rate','oil_price','cutoff_price','inflation','federal_expenditure','municipal_expenditure','activity_override','fnb_total','fnb_liquid','fnb_fx_share') then
     raise exception 'Неизвестный параметр бюджетного сценария.';
   end if;
   if not is_teacher and k<>'key_rate' then
     raise exception 'Экономическую основу модели меняет только преподаватель.';
   end if;
   if k='activity_override' then
     if jsonb_typeof(p_values->k) not in ('number','null') then
       raise exception 'Деловая активность должна быть числом или автоматическим расчётом.';
     end if;
     if jsonb_typeof(p_values->k)='number'
       and ((p_values->>k)::numeric < 0 or (p_values->>k)::numeric > 1000) then
       raise exception 'Деловая активность должна быть от 0 до 1000 процентов исходного уровня.';
     end if;
   elsif jsonb_typeof(p_values->k)<>'number' then
     raise exception 'Значение должно быть числом.';
   end if;
 end loop;
 -- For a rate or ordinary macro change, avoid a second full fiscal
 -- context read. Keep the original region seeding on the write path.
 -- Manual activity still uses the original authorized context/metrics.
 if p_values ? 'activity_override' and p_values->>'activity_override' is not null then
   v_context:=public.get_fiscal_context(p_game_id);
 else
   perform private.ensure_fiscal_game(p_game_id);
 end if;
 if p_values ? 'key_rate' or p_values ? 'inflation' then
  perform private.settle_monetary_inflation(p_game_id);
 end if;
 if p_values ? 'fnb_total' or p_values ? 'fnb_liquid' or p_values ? 'fnb_fx_share' then
  perform pg_advisory_xact_lock(hashtextextended('budget:'||p_game_id::text,0));
  perform private.ensure_budget_simulator(p_game_id);
 end if;
 select to_jsonb(p)||jsonb_build_object('fnb_total',s.fnb_total,'fnb_liquid',s.reserve_remaining,
   'fnb_fx_share',case when s.reserve_remaining>0 then round(s.fnb_fx_units*p.fx_rate/s.reserve_remaining*100,4) else 0 end)
 into old_row from game_fiscal_policy p left join budget_simulator_state s on s.game_id=p.game_id
 where p.game_id=p_game_id for update of p;
 -- Preserve the original initialization behavior for a first direct write.
 if old_row is null then
   v_context:=public.get_fiscal_context(p_game_id);
   select to_jsonb(p)||jsonb_build_object('fnb_total',s.fnb_total,'fnb_liquid',s.reserve_remaining,
  'fnb_fx_share',case when s.reserve_remaining>0 then round(s.fnb_fx_units*p.fx_rate/s.reserve_remaining*100,4) else 0 end)
   into old_row from game_fiscal_policy p left join budget_simulator_state s on s.game_id=p.game_id
   where p.game_id=p_game_id for update of p;
 end if;
 if old_row is null then
   raise exception 'Не удалось получить экономические параметры этой игры.';
 end if;
 -- A stale/repeated request must not write identical policy data or a
 -- misleading fiscal-change ledger record. Evaluate while holding the row lock.
 if not exists (
   select 1 from jsonb_each(p_values) change
   where (change.value #>> '{}')::numeric
     is distinct from (old_row->>change.key)::numeric
 ) then
   raise exception 'Значения параметров не изменились. Обновите данные перед повторным сохранением.';
 end if;
 -- Rebase only when the teacher explicitly submits a new manual value.
 -- A rate change by the Bank of Russia never resets this reference.
 v_model_v2:=exists(select 1 from budget_simulator_state s where s.game_id=p_game_id and s.anchor->>'economic_model_version'='2');
 IF v_model_v2 THEN
  v_previous_pending:=current_setting('gos.economic_policy_pending',true);
  PERFORM set_config('gos.economic_policy_pending',p_game_id::text,true);
 END IF;
 if p_values ? 'activity_override' and p_values->>'activity_override' is not null and v_model_v2 then
  v_reference:=(private.economic_automatic_v2(
   coalesce((p_values->>'key_rate')::numeric,(old_row->>'key_rate')::numeric),
   coalesce((p_values->>'fx_rate')::numeric,(old_row->>'fx_rate')::numeric),
   coalesce((v_context->'metrics'->>'economy')::numeric,(old_row->>'baseline_economy')::numeric)-(old_row->>'baseline_economy')::numeric,
   coalesce((v_context->'metrics'->>'public_trust')::numeric,(old_row->>'baseline_trust')::numeric)-(old_row->>'baseline_trust')::numeric,
   (private.economic_aux_v2(v_context->'metrics',v_context->'policy'->'budget_aux_anchor')->>'activity_adjustment')::numeric)->>'automatic')::numeric;
 else
 if p_values ? 'activity_override' and p_values->>'activity_override' is not null then
  v_reference:=private.fiscal_activity_reference(
   coalesce((p_values->>'key_rate')::numeric,(old_row->>'key_rate')::numeric),
   coalesce((p_values->>'fx_rate')::numeric,(old_row->>'fx_rate')::numeric),
   coalesce((v_context->'metrics'->>'economy')::numeric,(old_row->>'baseline_economy')::numeric)
    -(old_row->>'baseline_economy')::numeric,
   coalesce((v_context->'metrics'->>'public_trust')::numeric,(old_row->>'baseline_trust')::numeric)
    -(old_row->>'baseline_trust')::numeric
  );
 end if;

 end if;
 update game_fiscal_policy set
   key_rate=coalesce((p_values->>'key_rate')::numeric,key_rate),
   fx_rate=coalesce((p_values->>'fx_rate')::numeric,fx_rate),
   oil_price=coalesce((p_values->>'oil_price')::numeric,oil_price),
   cutoff_price=coalesce((p_values->>'cutoff_price')::numeric,cutoff_price),
   inflation=coalesce((p_values->>'inflation')::numeric,inflation),
   federal_expenditure=coalesce((p_values->>'federal_expenditure')::numeric,federal_expenditure),
   municipal_expenditure=coalesce((p_values->>'municipal_expenditure')::numeric,municipal_expenditure),
   activity_override=case when p_values ? 'activity_override'
     then (p_values->>'activity_override')::numeric else activity_override end,
   activity_reference=case when p_values ? 'activity_override'
     then v_reference else activity_reference end,
   updated_at=now()
 where game_id=p_game_id returning to_jsonb(game_fiscal_policy.*) into new_row;
 if p_values ? 'key_rate' or p_values ? 'inflation' then
  perform private.settle_monetary_inflation(p_game_id);
 end if;
 if p_values ? 'fnb_total' or p_values ? 'fnb_liquid' or p_values ? 'fnb_fx_share' then
  select * into v_old_fnb from budget_simulator_state where game_id=p_game_id for update;
  v_fx_old:=greatest(.01,(old_row->>'fx_rate')::numeric);
  v_total:=coalesce((p_values->>'fnb_total')::numeric,v_old_fnb.fnb_total);
  v_liquid:=coalesce((p_values->>'fnb_liquid')::numeric,
   case when p_values ? 'fnb_total' and v_old_fnb.fnb_total>0 then round(v_old_fnb.reserve_remaining*v_total/v_old_fnb.fnb_total,8)
    else v_old_fnb.reserve_remaining end);
  v_share:=coalesce((p_values->>'fnb_fx_share')::numeric,
    case when v_old_fnb.reserve_remaining>0 then round(v_old_fnb.fnb_fx_units*v_fx_old/v_old_fnb.reserve_remaining*100,4) else 0 end);
  if v_total<0 or v_total>50000000 or v_liquid<0 or v_liquid>v_total or v_share<0 or v_share>100
    or v_total::text in ('NaN','Infinity','-Infinity') or v_liquid::text in ('NaN','Infinity','-Infinity')
  then raise exception 'ФНБ: общий объём до 50 трлн рублей, доступная сумма не выше общей, валютная доля от 0 до 100.';end if;
  update budget_simulator_state set fnb_total=v_total,reserve_remaining=v_liquid,
   fnb_fx_units=round(v_liquid*v_share/100/greatest(.01,(new_row->>'fx_rate')::numeric),8),version=version+1,updated_at=now()
   where game_id=p_game_id;
  new_row:=new_row||jsonb_build_object('fnb_total',v_total,'fnb_liquid',v_liquid,'fnb_fx_share',v_share);
 end if;
 insert into fiscal_change_ledger(game_id,source_type,source_id,note,before_values,after_values,actor_id)
 values(p_game_id,'macro',gen_random_uuid()::text,
   case when is_teacher then 'Параметры сценария: ' else 'Решение Банка России: ' end||trim(p_reason),
   old_row,new_row,auth.uid());
 IF v_model_v2 THEN
  -- The ledger's derived macro and political effects have now completed.
  -- Rebase an explicitly entered manual value only, never subsequent rate changes.
  IF p_values ? 'activity_override' AND p_values->>'activity_override' IS NOT NULL THEN
   SELECT coalesce(jsonb_object_agg(metric_key,value),'{}'::jsonb) INTO v_metrics
    FROM public.state_metrics WHERE game_id=p_game_id
      AND metric_key IN ('economy','public_trust','social_stability','security','elite_support','international_standing','social_tension','legitimacy','media_climate');
   SELECT (private.economic_automatic_v2(p.key_rate,p.fx_rate,
      coalesce((v_metrics->>'economy')::numeric,p.baseline_economy)-p.baseline_economy,
      coalesce((v_metrics->>'public_trust')::numeric,p.baseline_trust)-p.baseline_trust,
      (private.economic_aux_v2(v_metrics,s.anchor->'aux_metrics')->>'activity_adjustment')::numeric)->>'automatic')::numeric
   INTO v_reference FROM public.game_fiscal_policy p JOIN public.budget_simulator_state s USING(game_id)
    WHERE p.game_id=p_game_id;
   UPDATE public.game_fiscal_policy SET activity_reference=v_reference WHERE game_id=p_game_id
    AND activity_reference IS DISTINCT FROM v_reference;
  END IF;
  PERFORM set_config('gos.economic_policy_pending',coalesce(v_previous_pending,''),true);
  BEGIN
   PERFORM private.reconcile_budget_driver_once(p_game_id);
  EXCEPTION WHEN OTHERS THEN
   RAISE WARNING 'ГОС.ID: final v2 macro budget sync failed for game %, SQLSTATE %',p_game_id,SQLSTATE;
  END;
 END IF;
end$function$;

-- Preserve the currently displayed manual activity when upgrading an existing
-- active game. Previously finished/archived games keep version 1 and their anchors.
WITH snapshots AS (
 SELECT p.game_id,p.key_rate,p.fx_rate,p.activity_reference,p.baseline_economy,p.baseline_trust,
   s.anchor,coalesce((SELECT jsonb_object_agg(metric_key,value) FROM public.state_metrics m WHERE m.game_id=p.game_id),'{}'::jsonb) metrics
 FROM public.game_fiscal_policy p JOIN public.budget_simulator_state s USING(game_id)
 JOIN public.games g ON g.id=p.game_id
 WHERE g.status NOT IN ('finished','archived') AND p.activity_override IS NOT NULL
  AND coalesce(s.anchor->>'economic_model_version','1')<>'2'
), deltas AS (
 SELECT *,coalesce((metrics->>'economy')::numeric,baseline_economy)-baseline_economy e,
   coalesce((metrics->>'public_trust')::numeric,baseline_trust)-baseline_trust t FROM snapshots
), auto AS (
 SELECT *,greatest(.65,least(1.4,1-(key_rate-16)*.007+e*.002+t*.001
  -(fx_rate*greatest(.75,least(1.3,1-e*.001-t*.001-(key_rate-16)*.0015))/80-1)*.06
  +(private.budget_aux_impact(game_id,anchor)->>'activity_adjustment')::numeric)) old_auto,
  (private.economic_automatic_v2(key_rate,fx_rate,e,t,(private.economic_aux_v2(metrics,anchor->'aux_metrics')->>'activity_adjustment')::numeric)->>'automatic')::numeric new_auto
 FROM deltas
)
UPDATE public.game_fiscal_policy p SET activity_reference=a.new_auto*case when a.activity_reference>0 then a.activity_reference else a.old_auto end/a.old_auto
FROM auto a WHERE p.game_id=a.game_id;

UPDATE public.budget_simulator_state s SET anchor=s.anchor||jsonb_build_object('economic_model_version',2),version=s.version+1,updated_at=clock_timestamp()
FROM public.games g WHERE g.id=s.game_id AND g.status NOT IN ('finished','archived')
 AND coalesce(s.anchor->>'economic_model_version','1')<>'2';
-- The anchor participates in the existing forecast signature; its version change invalidates
-- active-game cached forecasts without deleting caches or rewriting saved legal documents.
