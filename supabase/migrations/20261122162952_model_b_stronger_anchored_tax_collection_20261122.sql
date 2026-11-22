-- Model B: stronger, anchored tax compliance from effective enterprise activity.
-- 10 percent future activity contraction -> 1.2pp collection decrease, clipped [-6,+1.5]pp.
-- Freeze actual pre-deployment activity as neutral compliance reference.
UPDATE public.budget_simulator_state s
 SET anchor=jsonb_set(jsonb_set(s.anchor,'{tax_activity_reference}',to_jsonb(
  (private.calculate_budget_simulator(s.game_id,jsonb_build_object('title','Служебный прогноз бюджета','note','',
'income_changes','{}'::jsonb,'spending_changes','{}'::jsonb,'revenue_adjustments','{}'::jsonb,
'financing',b.data->'financing','terms',jsonb_build_object('ofz_fixed',60,'ofz_float',60,'bank_credit',12,'external',60),
'transfer_ids','[]'::jsonb,'external_refinance',0))->>'activity')::numeric),true),
 '{regional_activity_reference}',to_jsonb(
 (CASE WHEN p.activity_override IS NULL THEN
  private.fiscal_activity_reference(p.key_rate,p.fx_rate,
  coalesce((select value from state_metrics where game_id=s.game_id and metric_key='economy'),p.baseline_economy)-p.baseline_economy,
  coalesce((select value from state_metrics where game_id=s.game_id and metric_key='public_trust'),p.baseline_trust)-p.baseline_trust)
 ELSE p.activity_override/100*private.fiscal_activity_reference(p.key_rate,p.fx_rate,
  coalesce((select value from state_metrics where game_id=s.game_id and metric_key='economy'),p.baseline_economy)-p.baseline_economy,
  coalesce((select value from state_metrics where game_id=s.game_id and metric_key='public_trust'),p.baseline_trust)-p.baseline_trust)/greatest(.01,coalesce(p.activity_reference,1)) END)::numeric),true)
 FROM game_fiscal_policy p,private.budget_baseline b
 WHERE p.game_id=s.game_id AND b.year=2026 AND NOT (s.anchor ? 'tax_activity_reference');
CREATE OR REPLACE FUNCTION private.budget_tax_compliance_shift(p_activity numeric,p_anchor jsonb)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $model$
SELECT greatest(-.06,least(.015,(coalesce(p_activity,1)/greatest(.01,coalesce((p_anchor->>'tax_activity_reference')::numeric,1))-1)*.12))
$model$;
REVOKE ALL ON FUNCTION private.budget_tax_compliance_shift(numeric,jsonb) FROM PUBLIC,anon,authenticated;
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
 insert into game_fiscal_policy(game_id,federal_expenditure,municipal_expenditure,baseline_economy,baseline_trust)
 select p_game,coalesce(sum(expenditure)*.6,0),coalesce(sum(expenditure)*.25,0),coalesce((select value from state_metrics where game_id=p_game and metric_key='economy'),50),coalesce((select value from state_metrics where game_id=p_game and metric_key='public_trust'),50)
 from game_fiscal_regions where game_id=p_game on conflict(game_id) do nothing;
 select * into p from game_fiscal_policy where game_id=p_game;
 select data into b from private.budget_baseline where year=2026;
 a:=jsonb_build_object('enterprises',greatest(1,(select sum(enterprises*activity_multiplier) from game_fiscal_regions where game_id=p_game)),
 'key_rate',p.key_rate,'fx_rate',p.fx_rate,'oil_price',greatest(.01,p.oil_price),'inflation',p.inflation,
 'tax_activity_reference',1,'regional_activity_reference',1,'economy',coalesce((select value from state_metrics where game_id=p_game and metric_key='economy'),50),'trust',coalesce((select value from state_metrics where game_id=p_game and metric_key='public_trust'),50),
 'aux_metrics',(select coalesce(jsonb_object_agg(metric_key,value),'{}'::jsonb)
 from state_metrics where game_id=p_game and metric_key in ('social_stability','security','elite_support','international_standing','social_tension','legitimacy','media_climate')));
 insert into budget_simulator_state(game_id,anchor,internal_debt,external_debt,reserve_remaining,last_financing,fnb_fx_units)
 values(p_game,a,(b->>'internal_debt_end')::numeric,(b->>'external_debt_end')::numeric,(b->>'reserve_available_model')::numeric,b->'financing',round((b->>'reserve_available_model')::numeric*.25/greatest(.01,p.fx_rate),8)) on conflict(game_id) do nothing;
end$function$
;

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
 select jsonb_build_object('policy',to_jsonb(p)||jsonb_build_object('budget_aux_anchor',coalesce(s.anchor->'aux_metrics','{}'::jsonb),'tax_activity_reference',coalesce((s.anchor->>'regional_activity_reference')::numeric,1),'fnb_total',s.fnb_total,'fnb_liquid',s.reserve_remaining,'fnb_fx_share',case when s.reserve_remaining>0 then round(s.fnb_fx_units*p.fx_rate/s.reserve_remaining*100,4) else 0 end),'can_change_rate',private.is_game_teacher(p_game_id) or exists(
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
end$function$
;

CREATE OR REPLACE FUNCTION private.calculate_budget_simulator(p_game uuid, d jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare b jsonb;s budget_simulator_state%rowtype;p game_fiscal_policy%rowtype;a jsonb;e numeric;t numeric;fx numeric;v_auto numeric;v_ref numeric;activity numeric;cost numeric;oil numeric;firms numeric;vat numeric;profit numeric;v_collection numeric;v_aux jsonb;v_activity_adj numeric;v_collection_adj numeric;v_access jsonb;v_external_new numeric;v_external_over numeric;v_refinance numeric;v_due numeric;v_refinance_allowed numeric;v_refinance_over numeric;v_refinance_left numeric;v_repay numeric;v_paid_internal numeric:=0;v_paid_external numeric:=0;v_due_ct record;
 il jsonb:='[]';el jsonb:='[]';l jsonb;k text;n numeric;driver numeric;tax numeric;rev numeric;exp numeric;annual numeric:=0;interest numeric;transfer_exp numeric;credit numeric;fin numeric:=0;intr numeric:=0;extr numeric;balance numeric;need numeric;uncertainty numeric;issued numeric;locked_rate numeric;quote numeric;item_amount numeric;base_amount numeric;transfer_amount numeric;interest_amount numeric;reallocation numeric;tr jsonb;
begin
 if exists(select 1 from games where id=p_game and status not in ('finished','archived')) then perform private.ensure_budget_simulator(p_game);end if;perform private.validate_budget_draft(p_game,d);
 select data into b from private.budget_baseline where year=2026;select * into s from budget_simulator_state where game_id=p_game;select * into p from game_fiscal_policy where game_id=p_game;a:=s.anchor;
 e:=coalesce((select value from state_metrics where game_id=p_game and metric_key='economy'),(a->>'economy')::numeric)-(a->>'economy')::numeric;
 t:=coalesce((select value from state_metrics where game_id=p_game and metric_key='public_trust'),(a->>'trust')::numeric)-(a->>'trust')::numeric;
 v_aux:=private.budget_aux_impact(p_game,a);
 v_activity_adj:=coalesce((v_aux->>'activity_adjustment')::numeric,0);
 v_collection_adj:=coalesce((v_aux->>'collection_adjustment')::numeric,0);
 v_access:=private.external_borrowing_access(p_game);
 fx:=p.fx_rate*greatest(.75,least(1.3,1-e*.001-t*.001-(p.key_rate-(a->>'key_rate')::numeric)*.0015));
 select coalesce(sum(enterprises*activity_multiplier),0)/greatest(1,(a->>'enterprises')::numeric) into firms from game_fiscal_regions where game_id=p_game;
 activity:=greatest(.2,least(2,firms*(1-(p.key_rate-(a->>'key_rate')::numeric)*.007+e*.002+t*.001+v_activity_adj)));
 cost:=greatest(.7,least(1.6,1+(p.inflation-(a->>'inflation')::numeric)*.004+(fx/(a->>'fx_rate')::numeric-1)*.02));
 oil:=greatest(.1,least(3,p.oil_price/(a->>'oil_price')::numeric*fx/(a->>'fx_rate')::numeric))*greatest(.7,least(1.3,1+e*.002));
 vat:=coalesce((select rate from game_fiscal_rates where game_id=p_game and region_code='00' and tax_key='vat'),22);
 profit:=coalesce((select rate from game_fiscal_rates where game_id=p_game and region_code='00' and tax_key='profit'),25);
 v_collection:=greatest(.85,least(.995,.95+private.budget_tax_compliance_shift(activity,a)+coalesce((select (m.value-p.collection_lawfulness_reference)*.0003 from state_metrics m where m.game_id=p_game and m.metric_key='lawfulness' and p.collection_lawfulness_reference is not null),0)+t*.0005+v_collection_adj));
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
   issued:=case when s.last_plan_id is null then 0 else least(n,(s.last_financing->>k)::numeric) end;quote:=case when k='external' then (v_access->>'rate')::numeric else private.budget_financing_rate(k,p.key_rate) end;
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
 rev:=round(rev,2);exp:=round(exp,8);balance:=round(rev-exp,8);need:=round(greatest(0,-balance)+credit,8);
 uncertainty:=greatest(.025,least(.2,.04+abs(e)*.001+abs(t)*.001+abs(p.inflation-(a->>'inflation')::numeric)*.003));
 select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at,r.id),'[]'::jsonb) into tr from (select r.*,f.name region_name,c.title event_title from budget_transfer_requests r join fiscal_region_reference f on f.code=r.region_code left join event_cases c on c.id=r.event_case_id and c.game_id=r.game_id where r.game_id=p_game and r.status<>'rejected' and d->'transfer_ids' ? r.id::text) r;
 return jsonb_build_object('income_lines',il,'income_details',private.budget_income_details(p_game,d,il,activity,oil),'expense_lines',el,'expense_items',coalesce(d->'expense_items','[]'::jsonb),'program_expenses',private.server_budget_program_expenses(p_game,coalesce(d->'expense_items','[]'::jsonb)),'transfer_requests',tr,'income_rounding',(b->>'income_rounding')::numeric,'revenue_adjustment',s.revenue_adjustment,'revenue',rev,'expenditure',exp,'balance',balance,'deficit',greatest(0,-balance),'surplus',greatest(0,balance),
 'deficit_pct_gdp',greatest(0,-balance)/(b->>'gdp')::numeric*100,'financing',round(fin,8),'funding_need',need,'funding_gap',round(greatest(0,need-fin),8),'cash_excess',round(greatest(0,fin-need)+greatest(0,balance),8),
 'internal_debt',intr,'external_debt',extr,'debt_total',intr+extr,'debt_pct_gdp',(intr+extr)/(b->>'gdp')::numeric*100,'annual_interest',annual,'interest_delta',interest,'transfer_expense',transfer_exp,'credit_outflow',credit,
 'reserve_remaining',round(s.reserve_remaining-(d->'financing'->>'reserves')::numeric+case when s.last_plan_id is not null then (s.last_financing->>'reserves')::numeric else 0 end,8),
 'activity',activity,'cost',cost,'fx',fx,'uncertainty',uncertainty,'model_b_additional_channels',v_aux,
 'external_borrowing_limit',(v_access->>'annual_limit')::numeric,'external_borrowing_available',(v_access->>'available')::numeric,
 'external_borrowing_used',(v_access->>'used')::numeric,'external_borrowing_rate',(v_access->>'rate')::numeric,
 'external_borrowing_new',v_external_new,'external_borrowing_over_limit',v_external_over,
 'external_refinance',v_refinance,'external_refinance_eligible',v_due,
 'external_refinance_allocated',v_refinance_allowed,'external_refinance_over_limit',v_refinance_over,'revenue_low',rev*(1-uncertainty),'revenue_high',rev*(1+uncertainty),'expenditure_low',exp*(1-uncertainty),'expenditure_high',exp*(1+uncertainty));
end$function$
;

CREATE OR REPLACE FUNCTION private.budget_income_details(p_game uuid, d jsonb, groups jsonb, p_activity numeric, p_oil numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare model jsonb:='[{"key":"oil_ndpi","group_key":"oil_gas","label":"Налоги на добычу нефти и газа","share":0.8,"reference_rate":40,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":true,"base_label":"Расчётная стоимость добычи","driver_note":"Цена нефти и курс рубля"},{"key":"oil_extra","group_key":"oil_gas","label":"Дополнительные нефтегазовые поступления","share":0.2,"reference_rate":25,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":true,"base_label":"Расчётный доход нефтегазового сектора","driver_note":"Цена нефти и курс рубля"},{"key":"vat","group_key":"turnover","label":"НДС","share":0.72,"reference_rate":22,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":false,"base_label":"Облагаемый оборот без НДС","driver_note":"Предприятия, занятость, спрос и решения в игре"},{"key":"excise","group_key":"turnover","label":"Акцизы","share":0.18,"reference_rate":20,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":true,"base_label":"Расчётная стоимость подакцизных товаров","driver_note":"Деловая активность и объём потребления"},{"key":"customs","group_key":"turnover","label":"Таможенные пошлины","share":0.1,"reference_rate":10,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":true,"base_label":"Расчётная стоимость облагаемого импорта","driver_note":"Деловая активность и внешняя торговля"},{"key":"profit","group_key":"income","label":"Налог на прибыль · федеральная часть","share":0.8,"reference_rate":25,"rate_unit":"percent","base_unit":"million_rubles","federal_share":0.32,"model_rate":false,"base_label":"Облагаемая прибыль организаций","driver_note":"Предприятия, активность и принятые налоговые решения"},{"key":"personal_income","group_key":"income","label":"Федеральные поступления налога на доходы физических лиц","share":0.2,"reference_rate":15,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":true,"base_label":"Расчётная база федеральных поступлений","driver_note":"Деловая активность; ставка усреднена для игры"},{"key":"dividends","group_key":"assets","label":"Дивиденды по государственной доле","share":0.6,"reference_rate":100,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":true,"base_label":"Прогноз выплат по государственной доле","driver_note":"Прогноз распределяемых выплат"},{"key":"asset_interest","group_key":"assets","label":"Доходы от размещения средств и использования имущества","share":0.4,"reference_rate":100,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":true,"base_label":"Прогноз процентных, арендных и иных платежей","driver_note":"Утверждённый прогноз неналоговых поступлений"},{"key":"rent","group_key":"rent","label":"Платежи за другие природные ресурсы","share":1,"reference_rate":8,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":true,"base_label":"Расчётная стоимость использования ресурсов","driver_note":"Объём производства и деловая активность"},{"key":"recycling","group_key":"recycling","label":"Утилизационный сбор","share":1,"reference_rate":200000,"rate_unit":"rubles","base_unit":"units","federal_share":1,"model_rate":true,"base_label":"Количество объектов, с которых взимается сбор","driver_note":"Производство и ввоз; рублёвая ставка усреднена для игры"},{"key":"other","group_key":"other","label":"Прочие налоговые и неналоговые доходы","share":1,"reference_rate":100,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":true,"base_label":"Прогноз остальных поступлений","driver_note":"Подтверждённые изменения прогнозных поступлений"}]'::jsonb;
 b jsonb;l jsonb;m jsonb;rate numeric;divisor numeric;driver numeric;raw_group numeric;group_tax numeric;scale numeric;tax_base numeric;amount numeric;vat numeric;profit numeric;collection numeric;v_collection numeric;rows jsonb:='[]';
begin
 select data into b from private.budget_baseline where year=2026;
 vat:=coalesce((select r.rate from game_fiscal_rates r where r.game_id=p_game and r.region_code='00' and r.tax_key='vat'),22);
 profit:=coalesce((select r.rate from game_fiscal_rates r where r.game_id=p_game and r.region_code='00' and r.tax_key='profit'),25);
 select greatest(.85,least(.995,.95+(coalesce(m.value,p.collection_lawfulness_reference)-coalesce(p.collection_lawfulness_reference,m.value))*.0003+coalesce((t.value-p.baseline_trust)*.0005,0))) into v_collection
 from game_fiscal_policy p left join state_metrics m on m.game_id=p.game_id and m.metric_key='lawfulness'
 left join state_metrics t on t.game_id=p.game_id and t.metric_key='public_trust'
 where p.game_id=p_game;
 v_collection:=greatest(.85,least(.995,coalesce(v_collection,.95)+
   private.budget_tax_compliance_shift(p_activity,(select anchor from budget_simulator_state where game_id=p_game))+
   coalesce((private.budget_aux_impact(p_game,(select anchor from budget_simulator_state where game_id=p_game))->>'collection_adjustment')::numeric,0)));
 for m in select jsonb_array_elements(model) loop
  select value into l from jsonb_array_elements(b->'income_lines') where value->>'key'=m->>'group_key';
  driver:=case l->>'driver' when 'oil' then p_oil when 'activity' then p_activity else 1 end*(1+coalesce((d->'income_changes'->>(l->>'key'))::numeric,0)/100);
  group_tax:=case l->>'key' when 'turnover' then 1+.72*(vat/22-1) when 'income' then 1+.8*(profit/25-1) else 1 end;
  raw_group:=(l->>'amount')::numeric*driver*group_tax;
  select case when raw_group>0 then (value->>'amount')::numeric/raw_group else 0 end into scale from jsonb_array_elements(groups) where value->>'key'=l->>'key';
  rate:=case m->>'key' when 'vat' then vat when 'profit' then profit else (m->>'reference_rate')::numeric end;
  divisor:=case m->>'rate_unit' when 'rubles' then (m->>'reference_rate')::numeric/1000000 else (m->>'reference_rate')::numeric/100 end;
  collection:=case when m->>'key' in ('dividends','asset_interest','other') then 1 else v_collection end;
  tax_base:=(l->>'amount')::numeric*(m->>'share')::numeric/(divisor*(m->>'federal_share')::numeric)*driver*scale/collection;
  amount:=tax_base*case m->>'rate_unit' when 'rubles' then rate/1000000 else rate/100 end*collection*(m->>'federal_share')::numeric;
  rows:=rows||jsonb_build_array(m||jsonb_build_object('rate',rate,'base',tax_base,'collection',collection,'amount',amount,'baseline',(l->>'amount')::numeric*(m->>'share')::numeric));
 end loop;
 return rows;
end;$function$
;

CREATE OR REPLACE FUNCTION private.budget_forecast_signature(p_game uuid, p_draft jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
 SELECT md5(jsonb_build_array(
  'economy_b_activity_tax_compliance_v1',
  p_draft,
  (select data from private.budget_baseline where year=2026),
  (select status from public.games where id=p_game),
  (select to_jsonb(t) from public.budget_simulator_state t where t.game_id=p_game),
  (select to_jsonb(t) from public.game_fiscal_policy t where t.game_id=p_game),
  (select coalesce(jsonb_agg(jsonb_build_array(t.region_code,t.enterprises,t.activity_multiplier) order by t.region_code),'[]'::jsonb) from public.game_fiscal_regions t where t.game_id=p_game),
  (select coalesce(jsonb_agg(jsonb_build_array(t.tax_key,t.rate) order by t.tax_key),'[]'::jsonb) from public.game_fiscal_rates t where t.game_id=p_game and t.region_code='00' and t.tax_key in ('vat','profit')),
  (select coalesce(jsonb_agg(jsonb_build_array(t.metric_key,t.value) order by t.metric_key),'[]'::jsonb) from public.state_metrics t where t.game_id=p_game and t.metric_key in ('economy','public_trust','lawfulness','social_stability','security','elite_support','international_standing','social_tension','legitimacy','media_climate')),
  (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.budget_transfer_requests t where t.game_id=p_game),
  (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.state_programs t where t.game_id=p_game),
  (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.state_program_goals t where t.game_id=p_game),
  (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.state_program_components t where t.game_id=p_game),
  (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.state_program_expenses t where t.game_id=p_game),
  (select coalesce(jsonb_agg(to_jsonb(t) order by t.program_id,t.budget_year),'[]'::jsonb) from public.state_program_budget_commitments t where t.game_id=p_game),
  (select coalesce(jsonb_agg(jsonb_build_array(t.id,t.title) order by t.id),'[]'::jsonb) from public.event_cases t where t.game_id=p_game and exists(select 1 from public.budget_transfer_requests r where r.game_id=p_game and r.event_case_id=t.id)),
  (select coalesce(jsonb_agg(jsonb_build_array(t.code,t.name) order by t.code),'[]'::jsonb) from public.fiscal_region_reference t where exists(select 1 from public.budget_transfer_requests r where r.game_id=p_game and r.region_code=t.code))
 )::text);
$function$
;