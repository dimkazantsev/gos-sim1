-- 2027 planning; retain 2026 reference data and all fiscal coefficients.
CREATE OR REPLACE FUNCTION private.signed_program_budget_items(p_game uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO ''
AS $function$
 SELECT coalesce(jsonb_agg(jsonb_build_object(
 'id','program-'||p.id::text,'program_id',p.id,'budget_year',2027,
 'section_key',case
  when p.responsible_ministry ilike '%внешн%политик%' then '01'
  when p.responsible_ministry ilike '%оборон%' or p.responsible_ministry ilike '%безопасност%' then '03'
  when p.responsible_ministry ilike '%социальн%политик%' then '10'
  when p.responsible_ministry ilike '%экономическ%политик%' or p.responsible_ministry ilike '%внутренн%политик%' then '04'
  else '01' end,
 'title',left(p.title,200),
 'indicator',coalesce(nullif(left((select string_agg(g.indicator_name||case when nullif(g.unit,'') is not null then ' ('||g.unit||')' else '' end,'; ' order by g.created_at,g.id) from public.state_program_goals g where g.program_id=p.id and g.game_id=p_game),500),''),'Показатели утверждённой государственной программы'),
 'justification',left('Финансирование на 2027 год по принятой и подписанной государственной программе. Ответственный исполнитель: '||p.responsible_ministry,4000),
 'amount',c.amount/1000000::numeric) order by p.id),'[]'::jsonb)
 FROM public.state_program_budget_commitments c JOIN public.state_programs p ON p.id=c.program_id AND p.game_id=c.game_id
 WHERE c.game_id=p_game AND c.budget_year=2027 AND c.status='approved' AND c.amount>0
 AND p.status='adopted' AND p.signed_at IS NOT NULL AND p.signed_by IS NOT NULL AND c.signed_by=p.signed_by;
$function$;
REVOKE ALL ON FUNCTION private.signed_program_budget_items(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.budget_program_expense_keys(p_items jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $function$
 SELECT coalesce(jsonb_agg(jsonb_build_array(lower(i->>'program_id'),i->'budget_year',i->'amount',i->>'section_key')
 ORDER BY lower(i->>'program_id'),i->>'section_key',i->>'amount'),'[]'::jsonb)
 FROM jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) i WHERE nullif(i->>'program_id','') IS NOT NULL;
$function$;
REVOKE ALL ON FUNCTION private.budget_program_expense_keys(jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.validate_budget_draft(p_game uuid, d jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare b jsonb;k text;v jsonb;field text;lo numeric;hi numeric;req text;item jsonb;pid uuid;yr integer;commitment numeric;begin
 select data into b from private.budget_baseline where year=2026;
 if d is null or jsonb_typeof(d)<>'object' or length(trim(coalesce(d->>'title','')))<5 or length(d->>'title')>200 or length(coalesce(d->>'note',''))>20000 then raise exception 'Укажите название расчета от 5 до 200 символов и допустимое обоснование.';end if;
 if exists(select 1 from jsonb_object_keys(d) as keys(key_name) where keys.key_name not in ('title','note','income_changes','spending_changes','revenue_adjustments','financing','terms','transfer_ids','expense_items','base_reallocations','external_refinance')) then raise exception 'Неизвестное поле бюджетного расчета.';end if;
 foreach field in array array['income_changes','spending_changes','revenue_adjustments','financing','terms'] loop
  if jsonb_typeof(d->field) is distinct from 'object' then raise exception 'Бюджетный расчет содержит неверную структуру: %.',field;end if;
  lo:=case field when 'income_changes' then -80 when 'spending_changes' then -80 when 'revenue_adjustments' then -50000000 when 'financing' then -50000000 else 1 end;
  hi:=case when field in ('income_changes','spending_changes') then 200 when field='terms' then 120 else 50000000 end;
  for k,v in select * from jsonb_each(d->field) loop
   if jsonb_typeof(v)<>'number' or (v#>>'{}')::numeric::text in ('NaN','Infinity','-Infinity') or (v#>>'{}')::numeric not between lo and hi then raise exception 'Число в поле % выходит за допустимый диапазон.',field;end if;
   if field in ('income_changes','revenue_adjustments') and not exists(select 1 from jsonb_array_elements(b->'income_lines') l where l->>'key'=k) then raise exception 'Неизвестная группа доходов.';end if;
   if field='spending_changes' and not exists(select 1 from jsonb_array_elements(b->'expense_lines') l where l->>'key'=k) then raise exception 'Неизвестный раздел расходов.';end if;
   if field='financing' and round((v#>>'{}')::numeric,8)<>(v#>>'{}')::numeric then raise exception 'Источник финансирования указывается с точностью до копейки.';end if;
   if field='financing' and (not b->'financing' ? k or (k<>'other' and (v#>>'{}')::numeric<0)) then raise exception 'Источник финансирования должен быть известным и иметь неотрицательную сумму.';end if;
   if field='terms' and (k not in ('ofz_fixed','ofz_float','bank_credit','external') or trunc((v#>>'{}')::numeric)<>(v#>>'{}')::numeric) then raise exception 'Срок кредита должен быть целым числом месяцев от 1 до 120.';end if;
  end loop;
 end loop;
 if (select count(*) from jsonb_object_keys(d->'financing'))<>7 then raise exception 'Укажите все семь источников финансирования, включая нулевые суммы.';end if;
 if jsonb_typeof(d->'transfer_ids') is distinct from 'array' or jsonb_array_length(d->'transfer_ids')>100 then raise exception 'Неверный список региональных запросов.';end if;
 if (select count(distinct value) from jsonb_array_elements_text(d->'transfer_ids'))<>jsonb_array_length(d->'transfer_ids') then raise exception 'Региональный запрос включен дважды.';end if;
 for req in select jsonb_array_elements_text(d->'transfer_ids') loop
  if not exists(select 1 from budget_transfer_requests where id::text=req and game_id=p_game and status<>'rejected') then raise exception 'Запрос не относится к этой игре или уже отклонен.';end if;
 end loop;

 if d ? 'external_refinance' then
 if jsonb_typeof(d->'external_refinance') is distinct from 'number'
 or (d->>'external_refinance')::numeric::text in ('NaN','Infinity','-Infinity')
 or (d->>'external_refinance')::numeric not between 0 and 50000000
 or round((d->>'external_refinance')::numeric,8)<>(d->>'external_refinance')::numeric
 then raise exception 'Рефинансирование должно иметь неотрицательную сумму с точностью до копейки.';end if;
 end if;
 if d ? 'base_reallocations' then
  if jsonb_typeof(d->'base_reallocations') is distinct from 'object' then raise exception 'Перераспределения базовых расходов задаются таблицей разделов.';end if;
  for k,v in select key,value from jsonb_each(d->'base_reallocations') loop
   if k='13' or not exists(select 1 from jsonb_array_elements(b->'expense_lines') l where l->>'key'=k)
    or jsonb_typeof(v) is distinct from 'number' or (v#>>'{}')::numeric::text in ('NaN','Infinity','-Infinity')
    or (v#>>'{}')::numeric not between -1000000 and 1000000 or round((v#>>'{}')::numeric,8)<>(v#>>'{}')::numeric then raise exception 'Перераспределение допускает известные профильные разделы, конечную сумму до 1 000 млрд ₽ и точность до копейки.';end if;
  end loop;
  if coalesce((select sum((value#>>'{}')::numeric) from jsonb_each(d->'base_reallocations')),0)<>0 then raise exception 'Поправка перераспределяет расходы: общая сумма бюджета не меняется.';end if;
 end if;
 if d ? 'expense_items' then
  if jsonb_typeof(d->'expense_items') is distinct from 'array' or jsonb_array_length(d->'expense_items')>100 then raise exception 'Неверная таблица расходов: не более 100 строк.';end if;
  if exists(select 1 from jsonb_array_elements(d->'expense_items') i where jsonb_typeof(i)<>'object') then raise exception 'Строка расхода должна содержать название, показатель, обоснование и сумму.';end if;
  if (select count(distinct i->>'id') from jsonb_array_elements(d->'expense_items') i)<>jsonb_array_length(d->'expense_items') then raise exception 'Каждая строка расхода должна иметь уникальный идентификатор.';end if;
  if exists(select 1 from jsonb_array_elements(d->'expense_items') i where nullif(i->>'program_id','') is not null group by lower(i->>'program_id') having count(*)>1) then raise exception 'Годовое финансирование одной госпрограммы включено дважды.';end if;
  for item in select jsonb_array_elements(d->'expense_items') loop
   if exists(select 1 from jsonb_object_keys(item) k(key_name) where key_name not in ('id','section_key','title','indicator','justification','amount','program_id','budget_year')) then raise exception 'Неизвестное поле строки расхода.';end if;
   if coalesce(item->>'id','') !~ '^[A-Za-z0-9_-]{1,80}$'
    or jsonb_typeof(item->'title') is distinct from 'string' or length(trim(item->>'title')) not between 3 and 200
    or jsonb_typeof(item->'indicator') is distinct from 'string' or length(trim(item->>'indicator')) not between 3 and 500
    or jsonb_typeof(item->'justification') is distinct from 'string' or length(trim(item->>'justification')) not between 10 and 4000 then raise exception 'Укажите название, измеримый показатель и обоснование каждой строки расхода.';end if;
   if item->>'section_key'='13' or not exists(select 1 from jsonb_array_elements(b->'expense_lines') l where l->>'key'=item->>'section_key') then raise exception 'Выберите профильный раздел расходов. Обслуживание долга рассчитывается отдельно.';end if;
   if jsonb_typeof(item->'amount') is distinct from 'number' or (item->>'amount')::numeric::text in ('NaN','Infinity','-Infinity') or ((item->>'amount')::numeric<0.00000001 or (nullif(item->>'program_id','') is null and (item->>'amount')::numeric>1000000)) or round((item->>'amount')::numeric,8)<>(item->>'amount')::numeric then raise exception 'Сумма расхода должна быть положительной и с точностью до копейки. Для ручной строки предел 1 000 млрд ₽; для ГП — точная подписанная годовая сумма.';end if;
   if item ? 'budget_year' and (jsonb_typeof(item->'budget_year') is distinct from 'number' or (item->>'budget_year')::numeric<>2027) then raise exception 'В федеральный бюджет 2027 года включаются расходы только 2027 года.';end if;
   if item ? 'program_id' and jsonb_typeof(item->'program_id') not in ('string','null') then raise exception 'Неверная ссылка на государственную программу.';end if;
   if nullif(item->>'program_id','') is not null then
    if item->>'program_id' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Неверная ссылка на государственную программу.';end if;
    pid:=(item->>'program_id')::uuid;yr:=coalesce((item->>'budget_year')::numeric::integer,2027);
    select c.amount/1000000 into commitment from state_program_budget_commitments c
     join state_programs p on p.id=c.program_id and p.game_id=c.game_id
     where c.program_id=pid and c.game_id=p_game and c.budget_year=yr and c.status='approved'
      and p.status='adopted' and p.signed_at is not null and p.signed_by=c.signed_by;
    if commitment is null or commitment<=0 then raise exception 'Включить можно только подписанную и принятую госпрограмму этой игры с утверждённым финансированием 2027 года.';end if;
    if (item->>'amount')::numeric<>commitment then raise exception 'Сумма госпрограммы должна совпадать с подписанным годовым финансированием 2027 года.';end if;
   end if;
  end loop;
 end if;
end$function$;

CREATE OR REPLACE FUNCTION private.calculate_budget_simulator(p_game uuid, d jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare b jsonb;s budget_simulator_state%rowtype;p game_fiscal_policy%rowtype;a jsonb;e numeric;t numeric;fx numeric;v_auto numeric;v_ref numeric;activity numeric;cost numeric;oil numeric;firms numeric;vat numeric;profit numeric;v_collection numeric;v_aux jsonb;v_activity_adj numeric;v_collection_adj numeric;v_internal_terms jsonb;v_internal_new numeric:=0;v_internal_over numeric:=0;v_internal_interest_over numeric:=0;v_oil_saving numeric:=0;v_oil_change numeric:=0;v_access jsonb;v_external_new numeric;v_external_over numeric;v_refinance numeric;v_due numeric;v_refinance_allowed numeric;v_refinance_over numeric;v_refinance_left numeric;v_repay numeric;v_paid_internal numeric:=0;v_paid_external numeric:=0;v_due_ct record;
 il jsonb:='[]';el jsonb:='[]';l jsonb;k text;n numeric;driver numeric;tax numeric;rev numeric;exp numeric;annual numeric:=0;interest numeric;transfer_exp numeric;credit numeric;fin numeric:=0;intr numeric:=0;extr numeric;balance numeric;need numeric;uncertainty numeric;issued numeric;locked_rate numeric;quote numeric;item_amount numeric;base_amount numeric;transfer_amount numeric;interest_amount numeric;reallocation numeric;tr jsonb;
begin
 if exists(select 1 from games where id=p_game and status not in ('finished','archived')) then perform private.ensure_budget_simulator(p_game);end if;perform private.validate_budget_draft(p_game,d);
 -- Mandatory signed annual amounts are calculated once, independently of manual expenses.
 d:=jsonb_set(d,'{expense_items}',coalesce((select jsonb_agg(i.value order by i.ordinality) from jsonb_array_elements(coalesce(d->'expense_items','[]'::jsonb)) with ordinality i(value,ordinality) where nullif(i.value->>'program_id','') is null),'[]'::jsonb)||private.signed_program_budget_items(p_game),true);
 if jsonb_array_length(d->'expense_items')>100 then raise exception 'Сократите дополнительные ручные расходы: обязательные ГП и мероприятия должны помещаться в 100 строк.';end if;
 select data into b from private.budget_baseline where year=2026;select * into s from budget_simulator_state where game_id=p_game;select * into p from game_fiscal_policy where game_id=p_game;a:=s.anchor;
 e:=coalesce((select value from state_metrics where game_id=p_game and metric_key='economy'),(a->>'economy')::numeric)-(a->>'economy')::numeric;
 t:=coalesce((select value from state_metrics where game_id=p_game and metric_key='public_trust'),(a->>'trust')::numeric)-(a->>'trust')::numeric;
 v_aux:=private.budget_aux_impact(p_game,a);
 v_activity_adj:=coalesce((v_aux->>'activity_adjustment')::numeric,0);
 v_collection_adj:=coalesce((v_aux->>'collection_adjustment')::numeric,0);
 v_access:=private.external_borrowing_access(p_game);v_internal_terms:=private.internal_borrowing_terms(p_game);
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
 need:=round(greatest(0,-balance)+credit+v_oil_change,8);
 uncertainty:=greatest(.025,least(.2,.04+abs(e)*.001+abs(t)*.001+abs(p.inflation-(a->>'inflation')::numeric)*.003));
 select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at,r.id),'[]'::jsonb) into tr from (select r.*,f.name region_name,c.title event_title from budget_transfer_requests r join fiscal_region_reference f on f.code=r.region_code left join event_cases c on c.id=r.event_case_id and c.game_id=r.game_id where r.game_id=p_game and r.status<>'rejected' and d->'transfer_ids' ? r.id::text) r;
 return jsonb_build_object('budget_year',2027,'baseline_year',2026,'income_lines',il,'income_details',private.budget_income_details(p_game,d,il,activity,oil),'expense_lines',el,'expense_items',coalesce(d->'expense_items','[]'::jsonb),'program_expenses',private.server_budget_program_expenses(p_game,coalesce(d->'expense_items','[]'::jsonb)),'transfer_requests',tr,'income_rounding',(b->>'income_rounding')::numeric,'revenue_adjustment',s.revenue_adjustment,'revenue',rev,'expenditure',exp,'balance',balance,'deficit',greatest(0,-balance),'surplus',greatest(0,balance),
 'deficit_pct_gdp',greatest(0,-balance)/(b->>'gdp')::numeric*100,'financing',round(fin,8),'funding_need',need,'funding_gap',round(greatest(0,need-fin),8),'cash_excess',round(greatest(0,fin-need)+greatest(0,balance),8),
 'internal_debt',intr,'external_debt',extr,'debt_total',intr+extr,'debt_pct_gdp',(intr+extr)/(b->>'gdp')::numeric*100,'annual_interest',annual,'interest_delta',interest,'transfer_expense',transfer_exp,'credit_outflow',credit,
 'reserve_remaining',round(s.reserve_remaining+v_oil_change-(d->'financing'->>'reserves')::numeric+case when s.last_plan_id is not null then (s.last_financing->>'reserves')::numeric else 0 end,8),
 'activity',activity,'cost',cost,'fx',fx,'uncertainty',uncertainty,'model_b_additional_channels',v_aux,
 'external_borrowing_limit',(v_access->>'annual_limit')::numeric,'external_borrowing_available',(v_access->>'available')::numeric,
 'external_borrowing_used',(v_access->>'used')::numeric,'external_borrowing_rate',(v_access->>'rate')::numeric,
 'external_borrowing_new',v_external_new,'external_borrowing_over_limit',v_external_over,
 'external_refinance',v_refinance,'external_refinance_eligible',v_due,
 'external_refinance_allocated',v_refinance_allowed,'external_refinance_over_limit',v_refinance_over,'revenue_low',rev*(1-uncertainty),'revenue_high',rev*(1+uncertainty),'expenditure_low',exp*(1-uncertainty),'expenditure_high',exp*(1+uncertainty))||
 jsonb_build_object('internal_borrowing_limit',(v_internal_terms->>'annual_limit')::numeric,
 'internal_borrowing_available',(v_internal_terms->>'available')::numeric,
 'internal_borrowing_used',(v_internal_terms->>'used')::numeric,
 'internal_borrowing_new',v_internal_new,'internal_borrowing_over_limit',v_internal_over,
 'internal_interest_over_limit',v_internal_interest_over,
 'internal_borrowing_premium',private.internal_borrowing_premium(p.key_rate,p.inflation),
 'fnb_oil_allocation',v_oil_saving,'fnb_oil_change',v_oil_change,'fnb_total',s.fnb_total+v_oil_change-(d->'financing'->>'reserves')::numeric+case when s.last_plan_id is not null then (s.last_financing->>'reserves')::numeric else 0 end);
end$function$;

CREATE OR REPLACE FUNCTION private.server_budget_program_expenses(p_game uuid, items jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
 select coalesce(jsonb_agg(jsonb_build_object('program_id',p.id,'title',p.title,
  'indicators',coalesce((select string_agg(g.indicator_name||case when nullif(g.unit,'') is not null then ' ('||g.unit||')' else '' end,'; ' order by g.created_at,g.id) from state_program_goals g where g.program_id=p.id and g.game_id=p_game),''),
  'expense_breakdown',coalesce((select jsonb_agg(jsonb_build_object('indicator_name',e.indicator_name,'justification',e.justification,'amount',e.amount::text,'budget_year',e.budget_year,'component_title',c.title) order by e.position,e.id)
   from state_program_expenses e join state_program_components c on c.id=e.component_id and c.program_id=e.program_id and c.game_id=e.game_id where e.program_id=p.id and e.game_id=p_game and e.budget_year=2027),'[]'::jsonb)) order by p.title,p.id),'[]'::jsonb)
 from state_programs p where p.game_id=p_game and exists(select 1 from jsonb_array_elements(items) i where lower(i->>'program_id')=p.id::text);
$function$;

CREATE OR REPLACE FUNCTION public.get_signed_state_program_budget(p_game_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_items jsonb;
begin
 if auth.uid() is null or not private.is_game_member(p_game_id) then raise exception 'Нет доступа к бюджету этой игры';end if;
 v_items:=private.signed_program_budget_items(p_game_id);
 return coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'title',p.title,'ministry',p.responsible_ministry,'total_budget',p.total_budget::text,'program_status',p.status,'signed_by',p.signed_by,'signed_at',p.signed_at,'publication_post_id',p.publication_post_id,'budget_expense_item',(select i from jsonb_array_elements(v_items) i where i->>'program_id'=p.id::text),
  'indicators',coalesce((select string_agg(g.indicator_name||case when nullif(g.unit,'') is not null then ' ('||g.unit||')' else '' end,'; ' order by g.created_at,g.id) from state_program_goals g where g.program_id=p.id and g.game_id=p.game_id),''),
  'expense_breakdown',coalesce((select jsonb_agg(jsonb_build_object('indicator_name',e.indicator_name,'justification',e.justification,'amount',e.amount::text,'budget_year',e.budget_year,'component_title',c.title) order by e.position,e.id)
   from state_program_expenses e join state_program_components c on c.id=e.component_id and c.program_id=e.program_id and c.game_id=e.game_id where e.program_id=p.id and e.game_id=p.game_id and e.budget_year=2027),'[]'::jsonb),
  'years',(select jsonb_agg(jsonb_build_object('year',c.budget_year,'amount',c.amount::text,'status',c.status) order by c.budget_year) from state_program_budget_commitments c where c.program_id=p.id and c.game_id=p.game_id)) order by p.signed_at desc)
 from state_programs p where p.game_id=p_game_id and p.signed_at is not null),'[]'::jsonb);
end;$function$;

CREATE OR REPLACE FUNCTION public.save_budget_simulator(p_game_id uuid, p_plan_id uuid, p_draft jsonb, p_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare pl budget_simulator_plans%rowtype;c jsonb;sc uuid;pol game_fiscal_policy%rowtype;st budget_simulator_state%rowtype;begin
 if not private.can_prepare_budget(p_game_id) then raise exception 'Сохранение общего проекта доступно преподавателю и бюджетной команде исполнительной власти.';end if;
 perform private.lock_budget_actor(p_game_id);
 perform pg_advisory_xact_lock(hashtextextended('budget:'||p_game_id::text,0));
 -- Legacy clients multiply billions by 1000; validate raw values before canonicalizing money.
 if not(p_draft ? 'expense_items') and not(p_draft ? 'base_reallocations') and jsonb_typeof(p_draft->'financing')='object' then
  if exists(select 1 from jsonb_each(p_draft->'financing') f where f.key in ('ofz_fixed','ofz_float','bank_credit','external','reserves','privatization','other') and (case when jsonb_typeof(f.value)='number' then (f.value#>>'{}')::numeric::text in ('NaN','Infinity','-Infinity') or (f.value#>>'{}')::numeric not between -50000000 and 50000000 or f.key<>'other' and (f.value#>>'{}')::numeric<0 else true end)) then raise exception 'Источник финансирования должен быть числом в допустимых пределах.';end if;
  p_draft:=jsonb_set(p_draft,'{financing}',coalesce((select jsonb_object_agg(f.key,case when f.key in ('ofz_fixed','ofz_float','bank_credit','external','reserves','privatization','other') then to_jsonb(round((f.value#>>'{}')::numeric,8)) else f.value end) from jsonb_each(p_draft->'financing') f),'{}'::jsonb));
 end if;
 c:=private.calculate_budget_simulator(p_game_id,p_draft);
 p_draft:=jsonb_set(p_draft,'{expense_items}',c->'expense_items',true);
 select * into pol from game_fiscal_policy where game_id=p_game_id;select * into st from budget_simulator_state where game_id=p_game_id;
 if p_plan_id is not null then
  select * into pl from budget_simulator_plans where id=p_plan_id and game_id=p_game_id for update;
  if pl.id is null or pl.status<>'draft' then raise exception 'Этот расчет уже связан с документом. Создайте новый расчет для поправок.';end if;
  if p_revision is distinct from pl.revision then raise exception 'Расчет изменен другим участником. Откройте его последнюю версию перед сохранением.';end if;
  sc:=pl.scenario_id;
 else
  insert into budget_scenarios(game_id,title,budget_year,source_note,gdp,created_by,updated_by) values(p_game_id,p_draft->>'title',2027,'Млн рублей. Планирование на 2027 год на основе первоначального плана 2026 года Минфина России; расчёт по игровым допущениям.',235067000,auth.uid(),auth.uid()) returning id into sc;
  insert into budget_simulator_plans(game_id,title,draft,calculation,scenario_id,created_by,updated_by) values(p_game_id,p_draft->>'title',p_draft,c,sc,auth.uid(),auth.uid()) returning * into pl;
 end if;
 update budget_scenarios set title=p_draft->>'title',oil_price=pol.oil_price,key_rate=pol.key_rate,revenue=(c->>'revenue')::numeric,expenditure=(c->>'expenditure')::numeric,
 debt_start=st.internal_debt+st.external_debt,financing=(c->>'financing')::numeric,balance=(c->>'balance')::numeric,deficit_pct_gdp=(c->>'deficit_pct_gdp')::numeric,debt_end=(c->>'debt_total')::numeric,debt_pct_gdp=(c->>'debt_pct_gdp')::numeric,updated_by=auth.uid(),updated_at=now()
 where id=sc and game_id=p_game_id and status='draft' and formal_document_id is null and budget_year=2027
   and (expenditure<=(c->>'expenditure')::numeric or not exists(
     select 1 from budget_program_allocations a
     where a.scenario_id=sc and a.game_id=p_game_id
     having coalesce(sum(a.amount),0)>(c->>'expenditure')::numeric
   ));
 if not found then
  raise exception 'Зафиксированный бюджетный сценарий, изменённый год либо превышение распределённых ассигнований. Создайте новый расчёт или исправьте распределения.';
 end if;
 if p_plan_id is not null then update budget_simulator_plans set title=p_draft->>'title',draft=p_draft,calculation=c,revision=revision+1,updated_by=auth.uid(),updated_at=now() where id=pl.id returning * into pl;end if;
 return jsonb_build_object('id',pl.id,'revision',pl.revision,'expense_items',c->'expense_items');
end$function$;

CREATE OR REPLACE FUNCTION public.create_budget_simulator_document(p_plan_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare pl budget_simulator_plans%rowtype;c jsonb;body text;l jsonb;pe jsonb;req record;doc uuid;begin
 select * into pl from budget_simulator_plans where id=p_plan_id;
 if pl.id is null or not private.can_prepare_budget(pl.game_id) then raise exception 'Нет права формировать проект бюджета этой игры.';end if;
 perform private.lock_budget_actor(pl.game_id);
 perform pg_advisory_xact_lock(hashtextextended('budget:'||pl.game_id::text,0));select * into pl from budget_simulator_plans where id=p_plan_id for update;
 if pl.document_id is not null then return pl.document_id;end if;
 c:=private.calculate_budget_simulator(pl.game_id,pl.draft);
 if private.budget_program_expense_keys(pl.draft->'expense_items') is distinct from private.budget_program_expense_keys(c->'expense_items') then
 raise exception 'Состав обязательных госпрограмм изменился. Сохраните актуальный расчёт и проверьте баланс перед созданием закона.';end if;
 if (c->>'internal_borrowing_over_limit')::numeric>.00000001
 or (c->>'internal_interest_over_limit')::numeric>.00000001 then
 raise exception 'Внутренние заимствования или расходы на обслуживание долга превышают доступный предел.';end if;
 if (c->>'external_borrowing_over_limit')::numeric>.00000001 or (c->>'external_refinance_over_limit')::numeric>.00000001 then
 raise exception 'Внешние заимствования превышают доступный лимит либо средства на рефинансирование превышают новые кредиты и долг с наступившим сроком.';end if;
 if (c->>'funding_gap')::numeric>0 or (c->>'reserve_remaining')::numeric<0 then raise exception 'Покройте дефицит и выдачу бюджетных кредитов допустимыми источниками. Нельзя использовать резерв сверх остатка.';end if;
 if length(trim(coalesce(pl.draft->>'note','')))<30 then raise exception 'Добавьте пояснительную записку с основанием решений: не менее 30 символов.';end if;
 body:=E'РОССИЙСКАЯ ФЕДЕРАЦИЯ\nПРОЕКТ ФЕДЕРАЛЬНОГО ЗАКОНА\nО федеральном бюджете на 2027 год\n\nСтатья 1. Основные характеристики федерального бюджета\n'||
 'Утвердить доходы '||(c->>'revenue')||' млн рублей, расходы '||(c->>'expenditure')||' млн рублей, '||case when (c->>'balance')::numeric<0 then 'дефицит '||(c->>'deficit') else 'профицит '||(c->>'surplus') end||E' млн рублей.\n'||
 'Расчетный государственный внутренний долг на конец года: '||(c->>'internal_debt')||' млн рублей. Внешний долг в рублевом эквиваленте: '||(c->>'external_debt')||E' млн рублей.\n\nСтатья 2. Распределение доходов\n';
 for l in select jsonb_array_elements(c->'income_lines') loop body:=body||(l->>'label')||': '||(l->>'amount')||E' млн рублей.\n';end loop;
 body:=body||'Корректировка округления: '||(c->>'income_rounding')||' млн рублей. Отдельная игровая корректировка доходов: '||(c->>'revenue_adjustment')||E' млн рублей.\n\nСтатья 3. Распределение расходов по разделам\n';
 for l in select jsonb_array_elements(c->'expense_lines') loop body:=body||(l->>'key')||'. '||(l->>'label')||': '||(l->>'amount')||E' млн рублей.\n';end loop;
 body:=body||E'Корректировка округления: −100 млн рублей.\n\nСтатья 4. Источники финансирования дефицита\n'||
 'ОФЗ с постоянным купоном: '||(pl.draft->'financing'->>'ofz_fixed')||' млн рублей; ОФЗ с переменным купоном: '||(pl.draft->'financing'->>'ofz_float')||E' млн рублей.\n'||
 'Кредиты российских кредитных организаций: '||(pl.draft->'financing'->>'bank_credit')||' млн рублей; внешние заимствования: '||(pl.draft->'financing'->>'external')||E' млн рублей.\n'||
 'Перечисление нефтегазовых поступлений в ФНБ по цене отсечения: '||(c->>'fnb_oil_change')||E' млн рублей. Сумма учтена в потребности в финансировании, а не добавлена повторно к доходам.\n'||
 'Резервные средства ФНБ: '||(pl.draft->'financing'->>'reserves')||' млн рублей; приватизация акций: '||(pl.draft->'financing'->>'privatization')||' млн рублей; прочие источники: '||(pl.draft->'financing'->>'other')||E' млн рублей.\n'||
 'Из новых внешних займов на погашение долга с наступившим сроком: '||(c->>'external_refinance')||' млн рублей; средства для финансирования дефицита после рефинансирования: '||(c->>'financing')||' млн рублей; потребность с учетом бюджетных кредитов: '||(c->>'funding_need')||E' млн рублей.\n\nСтатья 5. Межбюджетные отношения\n';
 for req in select r.*,f.name from budget_transfer_requests r join fiscal_region_reference f on f.code=r.region_code where r.game_id=pl.game_id and pl.draft->'transfer_ids' ? r.id::text loop
  body:=body||req.name||': '||case req.kind when 'grant' then 'дотация' when 'subsidy' then 'субсидия' when 'subvention' then 'субвенция' else 'бюджетный кредит' end||' '||req.amount||' млн рублей; софинансирование '||req.cofinancing||' млн рублей. '||req.purpose||E'\n';
 end loop;
 body:=body||E'Целевые трансферты включены в профильные разделы, дотации — в раздел 14. Бюджетные кредиты являются возвратным финансированием.\n\nПОЯСНИТЕЛЬНАЯ ЗАПИСКА\n'||(pl.draft->>'note')||E'\n\nИСХОДНЫЕ ДАННЫЕ И ДОПУЩЕНИЯ\nИсходная база для игрового проекта на 2027 год — первоначально утвержденный план 2026 года: Минфин России, «Бюджет для граждан 2026–2028», https://ob.ulminfin.ru/images/brochure/Byudjet_federal/2026f/BDG_2026.pdf. Все суммы — млн рублей. Изменения активности, процентные условия и риски — учебная модель. Налоговые ставки изменяются отдельными НПА.\n\nПолномочия и процедура: БК РФ, статьи 103, 129–133, 192, 199–207; Конституция РФ, статьи 104–107. Подписи и дата фиксируются участниками процедуры в реестре НПА.';
 body:=body||E'\n\nПРИЛОЖЕНИЕ 1. РАСЧЁТ ДОХОДОВ ПО СТАТЬЯМ\n';
 for l in select jsonb_array_elements(c->'income_details') loop
  body:=body||(l->>'label')||': ставка '||(l->>'rate')||case l->>'rate_unit' when 'rubles' then ' рублей за единицу' else ' %' end||', база '||(l->>'base')||case l->>'base_unit' when 'units' then ' единиц' else ' млн рублей' end||', доля федерального бюджета '||((l->>'federal_share')::numeric*100)||' %; доход '||(l->>'amount')||E' млн рублей.\n';
 end loop;
 body:=body||E'Эффективные ставки и распределение внутри доходных групп учебные; НДС и налог на прибыль используют действующие ставки игры. Округление и отдельные корректировки указаны отдельно.\n\nПРИЛОЖЕНИЕ 2. ОБОСНОВАННЫЕ РАСХОДЫ\n';
 for l in select jsonb_array_elements(c->'expense_items') loop
  body:=body||'Раздел '||(l->>'section_key')||'. '||(l->>'title')||'. Показатель: '||(l->>'indicator')||'. Обоснование: '||(l->>'justification')||'. Сумма: '||((l->>'amount')::numeric*1000000)||' рублей.'||case when nullif(l->>'program_id','') is not null then ' Госпрограмма: '||(select title from state_programs where id=(l->>'program_id')::uuid and game_id=pl.game_id)||'; год 2027.' else '' end||E'\n';
 end loop;
 for pe in select jsonb_array_elements(c->'program_expenses') loop
  body:=body||E'\nПОДПИСАННАЯ ГОСПРОГРАММА: '||(pe->>'title')||E'\nПоказатели программы: '||(pe->>'indicators')||E'\n';
  for l in select jsonb_array_elements(pe->'expense_breakdown') loop
   body:=body||(l->>'component_title')||'. '||(l->>'indicator_name')||'. Основание: '||(l->>'justification')||'. 2027 год: '||(l->>'amount')||E' рублей.\n';
  end loop;
 end loop;
 body:=body||E'\nПРИЛОЖЕНИЕ 3. РЕГИОНАЛЬНЫЕ СОБЫТИЯ И ЗАПРОСЫ\n';
 for l in select jsonb_array_elements(c->'transfer_requests') loop
  body:=body||(l->>'region_name')||'. Событие: '||coalesce(l->>'event_title','Запрос предыдущей редакции')||'. Основание: '||(l->>'purpose')||'. Ожидаемый результат: '||coalesce(l->>'expected_result','Указан в обосновании запроса')||'. Федеральная сумма: '||((l->>'amount')::numeric*1000000)||' рублей. Софинансирование: '||((l->>'cofinancing')::numeric*1000000)||E' рублей.\n';
 end loop;
 body:=body||E'\n\nРасчетные приложения закреплены за этим проектом. До первого чтения новая редакция числовых приложений готовится в разделе «Бюджет». После первого чтения перераспределения вносятся через таблицу поправок второго чтения в реестре НПА; выбранный пакет голосуется Государственной Думой и изменяет приложения только после принятия. Редактирование пояснений само по себе не меняет расчётные суммы.';
 for req in select a.*,v.result_yes,v.result_no,v.result_abstain from budget_faction_amendments a left join game_votes v on v.id=a.vote_id where a.plan_id=pl.id and a.status='applied' order by a.applied_revision loop
  body:=body||E'\n\nИСТОРИЯ ПОДГОТОВКИ: ПОПРАВКА '||req.party_name||E'\n'||req.title||'. Перераспределение из раздела '||req.from_section||' в раздел '||req.to_section||': '||req.amount||' млн рублей. Включена в редакцию '||req.applied_revision||E'.\n'||req.reason||E'\nПредварительное голосование: за '||coalesce(req.result_yes,0)||', против '||coalesce(req.result_no,0)||', воздержались '||coalesce(req.result_abstain,0)||' мандатов. Итоговые суммы определяются расчетными приложениями проекта.';
 end loop;
 perform set_config('gos.official_budget_plan_creation',pl.id::text,true);
 doc:=public.create_formal_document(pl.game_id,13,pl.title,'federal_budget','government','Правительство Российской Федерации',body,null,null,null,'budget',jsonb_build_object('budget_simulator_plan_id',pl.id,'budget_scenario_id',pl.scenario_id,'budget_base_plan_id',(select last_plan_id from budget_simulator_state where game_id=pl.game_id),'budget_year',2027,'unit','million_rubles','budget_snapshot',c,'budget_draft',pl.draft,'revision',1,'educational_draft',true));
 perform set_config('gos.official_budget_plan_creation','',true);
 update formal_documents set metadata=metadata||jsonb_build_object('budget_amendments',
  (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'title',a.title,'party_name',a.party_name,'reason',a.reason,'amount',a.amount,'from_section',a.from_section,'to_section',a.to_section,'applied_revision',a.applied_revision,'vote_id',a.vote_id,'yes',v.result_yes,'no',v.result_no,'abstain',v.result_abstain) order by a.applied_revision),'[]'::jsonb) from budget_faction_amendments a left join game_votes v on v.id=a.vote_id where a.plan_id=pl.id and a.status='applied')) where id=doc;
 update budget_simulator_plans set status='document',document_id=doc,calculation=c,updated_at=now() where id=pl.id;
 update budget_scenarios set status='final',formal_document_id=doc,updated_at=now() where id=pl.scenario_id;
 insert into budget_simulator_ledger(game_id,kind,note,amount,source_key) values(pl.game_id,'document','Сформирован проект закона; экономические изменения ожидают опубликования.',(c->>'expenditure')::numeric,'document:'||doc);
 return doc;
end$function$;

CREATE OR REPLACE FUNCTION private.apply_budget_simulator_plan(p_game uuid, p_plan_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare doc formal_documents%rowtype;pl budget_simulator_plans%rowtype;s budget_simulator_state%rowtype;c jsonb;fresh jsonb;req budget_transfer_requests%rowtype;before_row jsonb;after_row jsonb;k text;old_amount numeric;new_amount numeric;delta numeric;leftover numeric;ct budget_finance_contracts%rowtype;caseid uuid;total_internal numeric;total_external numeric;base_plan text;v_refinance_left numeric;v_repay numeric;v_principal numeric;v_due_rub numeric;begin
 select d.* into doc from formal_documents d join budget_simulator_plans p on p.document_id=d.id and p.game_id=d.game_id where p.id=p_plan_id and p.game_id=p_game;
 if doc.id is null or doc.status_code<>'published' or doc.doc_type<>'federal_budget' or doc.workflow_key<>'budget' or not doc.metadata ? 'budget_simulator_plan_id' then return false;end if;
 if not exists(select 1 from games where id=doc.game_id and status not in ('finished','archived')) then raise exception 'Завершённая или архивная игра не исполняет новые бюджетные обязательства.';end if;
 if auth.uid() is not null then perform private.lock_budget_actor(doc.game_id);end if;
 perform pg_advisory_xact_lock(hashtextextended('budget:'||doc.game_id::text,0));
 select * into pl from budget_simulator_plans where id::text=doc.metadata->>'budget_simulator_plan_id' and game_id=doc.game_id and document_id=doc.id for update;
 if pl.id is null then raise exception 'Не найден расчет, связанный с этим проектом бюджета.';end if;
 if pl.status='published' then return false;end if;
 select * into s from budget_simulator_state where game_id=doc.game_id for update;
 base_plan:=doc.metadata->>'budget_base_plan_id';
 if base_plan is distinct from s.last_plan_id::text then raise exception 'После подготовки проекта опубликован другой бюджет. Создайте обновленный расчет и проект с учетом действующего бюджета.';end if;
 c:=pl.calculation;fresh:=private.calculate_budget_simulator(doc.game_id,pl.draft);
 if private.budget_program_expense_keys(c->'expense_items') is distinct from private.budget_program_expense_keys(fresh->'expense_items') then
 raise exception 'Состав подписанных госпрограмм изменился после подготовки закона. Нужна новая редакция бюджета с полными ассигнованиями.';end if;
 if (fresh->>'internal_borrowing_over_limit')::numeric>.00000001
 or (fresh->>'internal_interest_over_limit')::numeric>.00000001 then
 raise exception 'Недоступная сумма внутренних облигаций и кредитов либо превышен предел расходов на обслуживание долга.';end if;
 if (fresh->>'external_borrowing_over_limit')::numeric>.00000001 or (fresh->>'external_refinance_over_limit')::numeric>.00000001 then
 raise exception 'После изменения международного положения лимит новых внешних кредитов или допустимое рефинансирование нарушены. Составьте новый бюджет.';end if;
 if (c->>'funding_gap')::numeric>(case when c ? 'expense_items' then 0 else 1 end)
   or coalesce((fresh->>'funding_gap')::numeric,1e12)>(case when fresh ? 'expense_items' then 0 else 1 end)
   or (fresh->>'reserve_remaining')::numeric<0 then
   raise exception 'Актуальный расчет бюджета не обеспечен финансированием либо доступный резерв изменился. Обновите проект до исполнения.';
 end if;
 insert into budget_simulator_ledger(game_id,kind,note,amount,source_key) values(pl.game_id,'publication','Опубликован '||doc.registry_no||'. Применены источники финансирования и включенные региональные запросы.',(c->>'expenditure')::numeric,'published:'||pl.id) on conflict do nothing;
 if not found then return false;end if;
 -- Only newly included requests are paid. Reprinting a granted request in an amendment never pays twice.
 for req in select * from budget_transfer_requests where game_id=pl.game_id and status='requested' and pl.draft->'transfer_ids' ? id::text for update loop
  select to_jsonb(r) into before_row from game_fiscal_regions r where game_id=pl.game_id and region_code=req.region_code for update;
  update game_fiscal_regions set transfer_in=transfer_in+case when req.kind<>'budget_credit' then req.amount else 0 end,budget_credit_cash=budget_credit_cash+case when req.kind='budget_credit' then req.amount else 0 end,expenditure=expenditure+case when req.kind='subsidy' then req.amount+req.cofinancing when req.kind='subvention' then req.amount else 0 end,
   debt=debt+case when req.kind='budget_credit' then req.amount else 0 end,updated_at=now()
  where game_id=pl.game_id and region_code=req.region_code returning to_jsonb(game_fiscal_regions.*) into after_row;
  update budget_transfer_requests set status='granted',plan_id=pl.id,document_id=doc.id,decided_at=now(),maturity_month=case when req.kind='budget_credit' then s.month+12 else null end where id=req.id;
  insert into fiscal_change_ledger(game_id,region_code,source_type,source_id,note,before_values,after_values,actor_id) values(pl.game_id,req.region_code,'budget_transfer',req.id::text,'Бюджетный запрос исполнен по '||doc.registry_no||': '||req.purpose,before_row,after_row,doc.author_id) on conflict do nothing;
  insert into budget_simulator_ledger(game_id,kind,note,amount,source_key) values(pl.game_id,'transfer','Перечислено региону '||(select name from fiscal_region_reference where code=req.region_code)||'. '||req.purpose,req.amount,'transfer:'||req.id) on conflict do nothing;
 end loop;
 foreach k in array array['ofz_fixed','ofz_float','bank_credit','external'] loop
  new_amount:=(pl.draft->'financing'->>k)::numeric;
  -- Official debt at the end of 2026 already incorporates the initial net borrowing plan.
  -- The first simulated law creates its obligations without adding that same plan to debt again.
  old_amount:=case when s.last_plan_id is null then 0 else (s.last_financing->>k)::numeric end;delta:=new_amount-old_amount;
  if delta>0 then
   insert into budget_finance_contracts(game_id,plan_id,source_key,principal,annual_rate,maturity_month,issued_month,issued_rubles)
   values(pl.game_id,pl.id,k,case when k='external' then round(delta/(fresh->>'fx')::numeric*(s.anchor->>'fx_rate')::numeric,8) else delta end,case when k='external' then (fresh->>'external_borrowing_rate')::numeric
 else private.budget_financing_rate(k,(select key_rate from game_fiscal_policy where game_id=pl.game_id))
  +private.internal_borrowing_premium(
    (select key_rate from game_fiscal_policy where game_id=pl.game_id),
    (select inflation from game_fiscal_policy where game_id=pl.game_id))
  *case when s.last_plan_id is null then
     greatest(0,new_amount-coalesce((s.last_financing->>k)::numeric,0))/greatest(new_amount,.00000001)
    else 1 end
 end,
 s.month+coalesce((pl.draft->'terms'->>k)::integer,60),case when k='external' or s.last_plan_id is not null or
    greatest(0,new_amount-coalesce((s.last_financing->>k)::numeric,0))>0 then s.month else null end,
 case when k='external' or s.last_plan_id is not null then delta
  else greatest(0,new_amount-coalesce((s.last_financing->>k)::numeric,0)) end);
  elsif delta<0 then
   leftover:=-delta;
   for ct in select * from budget_finance_contracts where game_id=pl.game_id and source_key=k and status in ('active','due') order by maturity_month,id for update loop
    delta:=least(ct.principal,leftover);update budget_finance_contracts set principal=principal-delta,status=case when principal-delta=0 then 'paid' else status end where id=ct.id;leftover:=leftover-delta;if leftover<=0 then exit;end if;
   end loop;
  end if;
  if new_amount>0 then
   select id into caseid from event_cases where game_id=pl.game_id and case_key='budget-risk-2026-'||k;
   if caseid is not null then insert into private.budget_deferred_risks(game_id,case_id,source_key,due_at,due_month) values(pl.game_id,caseid,k,now()+interval '15 minutes',s.month+1) on conflict(game_id,source_key) do nothing;end if;
  end if;
 end loop;
 foreach k in array array['reserves','privatization'] loop
  if (pl.draft->'financing'->>k)::numeric>0 then
   select id into caseid from event_cases where game_id=pl.game_id and case_key='budget-risk-2026-'||k;
   if caseid is not null then insert into private.budget_deferred_risks(game_id,case_id,source_key,due_at,due_month) values(pl.game_id,caseid,k,now()+interval '15 minutes',s.month+1) on conflict(game_id,source_key) do nothing;end if;
  end if;
 end loop;
 v_refinance_left:=coalesce((fresh->>'external_refinance_allocated')::numeric,0);
 if v_refinance_left>0 then
  for ct in select * from budget_finance_contracts
  where game_id=pl.game_id and status='due' and maturity_month<=s.month and principal>0 order by maturity_month,id for update loop
   exit when v_refinance_left<=0;
   v_due_rub:=case when ct.source_key='external' then ct.principal*(fresh->>'fx')::numeric/(s.anchor->>'fx_rate')::numeric else ct.principal end;
   v_repay:=least(v_refinance_left,v_due_rub);
   v_principal:=case when ct.source_key='external' then v_repay*(s.anchor->>'fx_rate')::numeric/(fresh->>'fx')::numeric else v_repay end;
   update budget_finance_contracts set principal=greatest(0,round(principal-v_principal,8)),
    status=case when round(principal-v_principal,8)<=0 then 'paid' else status end where id=ct.id;
   insert into budget_simulator_ledger(game_id,kind,note,amount,source_key)
    values(pl.game_id,'principal','Погашение долга за счёт новых внешних заимствований по '||doc.registry_no||'.',round(v_repay,8),'external-refinance:'||pl.id||':'||ct.id) on conflict do nothing;
   v_refinance_left:=greatest(0,v_refinance_left-v_repay);
  end loop;
  if v_refinance_left>.00000001 then raise exception 'Обязательства для рефинансирования изменились. Пересчитайте бюджет.';end if;
 end if;
 update budget_simulator_state set internal_debt=(fresh->>'internal_debt')::numeric,
  -- Store foreign-currency principal in anchor-FX equivalent to prevent compounding FX revaluation.
  external_debt=round((fresh->>'external_debt')::numeric/(fresh->>'fx')::numeric*(anchor->>'fx_rate')::numeric,8),
  reserve_remaining=(fresh->>'reserve_remaining')::numeric,
  fnb_last_oil_allocation=(fresh->>'fnb_oil_allocation')::numeric,
  fnb_total=greatest(0,fnb_total-(s.reserve_remaining-(fresh->>'reserve_remaining')::numeric)),
  fnb_fx_units=least(fnb_fx_units,greatest(0,(fresh->>'reserve_remaining')::numeric/greatest(.01,(select fx_rate from game_fiscal_policy where game_id=pl.game_id)))),
  financing_rates=coalesce((select jsonb_object_agg(q.source_key,q.rate) from (select source_key,sum(principal*annual_rate)/nullif(sum(principal),0) rate from budget_finance_contracts where game_id=pl.game_id and status in ('active','due') and principal>0 group by source_key)q),financing_rates),
  last_financing=pl.draft->'financing',last_plan_id=pl.id,last_document_id=doc.id,version=version+1,updated_at=now() where game_id=pl.game_id;
 if (fresh->>'fnb_oil_change')::numeric<>0 then
  insert into budget_simulator_ledger(game_id,kind,note,amount,source_key)
  values(pl.game_id,'fnb_oil','Распределение нефтегазовых поступлений по цене отсечения, решение '||doc.registry_no,
   (fresh->>'fnb_oil_change')::numeric,'fnb-oil-plan:'||pl.id) on conflict do nothing;
 end if;
 update budget_simulator_plans set status='published',updated_at=now() where id=pl.id;
 insert into game_events(game_id,round_no,category,severity,title,body,created_by) values(pl.game_id,13,'Бюджет','notice','Федеральный бюджет принят и опубликован',
  doc.registry_no||'. Доходы: '||(c->>'revenue')||' млн ₽; расходы: '||(c->>'expenditure')||' млн ₽; дефицит: '||(c->>'deficit')||' млн ₽; профицит: '||(c->>'surplus')||' млн ₽. Региональные запросы и долговые обязательства отражены в общем симуляторе.',doc.author_id);
 return true;
end$function$;

CREATE OR REPLACE FUNCTION private.guard_budget_law_document()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
begin
 if old.workflow_key<>'budget' or old.doc_type<>'federal_budget' then return case when tg_op='DELETE' then old else new end;end if;
 if tg_op='DELETE' then
  if exists(select 1 from games where id=old.game_id) and exists(select 1 from budget_law_amendments where document_id=old.id) then raise exception 'История бюджетных поправок сохраняется до удаления игры.';end if;
  return old;
 end if;
 if exists(select 1 from budget_law_amendments where document_id=old.id and status in ('submitted','voting')) and (
  new.status_code is distinct from old.status_code or new.current_step is distinct from old.current_step or new.current_owner_key is distinct from old.current_owner_key
  or new.workflow_key is distinct from old.workflow_key or new.workflow_steps is distinct from old.workflow_steps or new.doc_type is distinct from old.doc_type or new.game_id is distinct from old.game_id)
  then raise exception 'Сначала рассмотрите или отзовите все поправки ко II чтению бюджета.';end if;
 if exists(select 1 from budget_law_amendment_packs where document_id=old.id and status in ('opening','voting')) and (
  new.body_text is distinct from old.body_text or new.title is distinct from old.title or new.metadata->>'revision' is distinct from old.metadata->>'revision'
  or new.metadata->'budget_snapshot' is distinct from old.metadata->'budget_snapshot' or new.metadata->'budget_draft' is distinct from old.metadata->'budget_draft')
  then raise exception 'Редакция бюджета зафиксирована до завершения голосования по пакету.';end if;
 if old.metadata ? 'budget_first_reading_snapshot' and (
  new.metadata->'budget_snapshot' is distinct from old.metadata->'budget_snapshot' or new.metadata->'budget_draft' is distinct from old.metadata->'budget_draft') and not exists(
   select 1 from budget_law_amendment_packs p where p.document_id=old.id and p.game_id=old.game_id and p.status='accepted'
    and p.source_revision=coalesce((old.metadata->>'revision')::integer,1) and p.source_calculation=old.metadata->'budget_snapshot' and p.source_draft=old.metadata->'budget_draft' and p.source_body_text=coalesce(old.body_text,'')
    and p.result_calculation=new.metadata->'budget_snapshot' and p.result_draft=new.metadata->'budget_draft' and p.result_body_text=new.body_text and coalesce((new.metadata->>'revision')::integer,1)=p.source_revision+1)
  then raise exception 'Числовые приложения после I чтения меняются только принятыми бюджетными поправками.';end if;
 -- Prevent first reading/publication of a stale 2027 programme allocation set.
 if new.status_code is distinct from old.status_code and new.status_code in ('reading1','published')
 and new.metadata->>'budget_year'='2027' and new.metadata ? 'budget_simulator_plan_id'
 and private.budget_program_expense_keys(new.metadata->'budget_snapshot'->'expense_items') is distinct from private.budget_program_expense_keys(private.signed_program_budget_items(new.game_id)) then
 raise exception 'В проекте бюджета не учтены актуальные подписанные госпрограммы. Подготовьте обновлённый расчёт.';end if;
 return new;
end;$function$;

CREATE OR REPLACE FUNCTION private.budget_forecast_signature(p_game uuid, p_draft jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
 SELECT md5(jsonb_build_array(
  'budget_2027_signed_programmes_v1',
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
  (select coalesce(jsonb_agg(jsonb_build_array(c.source_key,c.issued_month,c.issued_rubles,c.status,c.principal) order by c.id),'[]'::jsonb) from public.budget_finance_contracts c where c.game_id=p_game),
  (select coalesce(jsonb_agg(jsonb_build_array(t.id,t.title) order by t.id),'[]'::jsonb) from public.event_cases t where t.game_id=p_game and exists(select 1 from public.budget_transfer_requests r where r.game_id=p_game and r.event_case_id=t.id)),
  (select coalesce(jsonb_agg(jsonb_build_array(t.code,t.name) order by t.code),'[]'::jsonb) from public.fiscal_region_reference t where exists(select 1 from public.budget_transfer_requests r where r.game_id=p_game and r.region_code=t.code))
 )::text);
$function$;

CREATE OR REPLACE FUNCTION public.get_budget_pulse(p_game_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare plan jsonb;draft jsonb;base jsonb;calculation jsonb;latest budget_income_history%rowtype;
 v_mode text;v_note text;v_metric_id uuid;new_value numeric;old_value numeric;sync_before text;
 v_signature text;v_is_observer boolean;
begin
 if auth.uid() is null or not private.is_game_member(p_game_id) then raise exception 'Нет доступа к бюджету этой игры.';end if;
 perform private.settle_monetary_inflation(p_game_id);
 perform pg_advisory_xact_lock(hashtextextended('gos-budget-pulse:'||p_game_id::text,0));
 perform private.prepare_budget_simulator(p_game_id);
 -- Reuse the existing observer membership check for both write paths:
 -- one check rather than a second query on every budget refresh.
 v_is_observer:=exists(select 1 from game_members
  where game_id=p_game_id and user_id=auth.uid() and kind='observer');
 -- The simulator selects only the latest 30 plans, preferring saved drafts.
 -- Keep the same JSON construction and order without loading contracts,
 -- regional case bodies, requests, ledger or the entire simulator response.
 select to_jsonb(p) into plan
 from (
  select pl.*,d.registry_no
  from budget_simulator_plans pl
  left join formal_documents d on d.id=pl.document_id
  where pl.game_id=p_game_id
  order by pl.updated_at desc limit 30
 ) p
 order by case when p.status='draft' then 0 else 1 end,p.updated_at desc
 limit 1;
 if plan is null then
  select data into base from private.budget_baseline where year=2026;
  draft:=jsonb_build_object('title','Проект федерального бюджета на 2027 год','note','','income_changes','{}'::jsonb,'spending_changes','{}'::jsonb,'revenue_adjustments','{}'::jsonb,
   'financing',base->'financing','terms',jsonb_build_object('ofz_fixed',60,'ofz_float',60,'bank_credit',12,'external',60),'transfer_ids','[]'::jsonb);
  v_mode:='baseline';v_note:='Прогноз на 2027 год на основе исходного плана 2026 года и подписанных госпрограмм.';
 else
  draft:=plan->'draft';v_mode:=plan->>'status';v_note:=case v_mode when 'draft' then 'Общий сохраненный черновик' when 'document' then 'Проект закона в реестре' else 'Опубликованный игровой бюджет' end||': '||(plan->>'title')||'.';
 end if;
 v_signature:=private.budget_forecast_signature(p_game_id,draft);
 select c.calculation into calculation
 from private.budget_forecast_cache c
 where c.game_id=p_game_id and c.input_signature=v_signature;
 if calculation is null then
  calculation:=private.calculate_budget_simulator(p_game_id,draft);
  insert into private.budget_forecast_cache(game_id,input_signature,calculation)
  values(p_game_id,v_signature,calculation)
  on conflict(game_id) do update set
   input_signature=excluded.input_signature,
   calculation=excluded.calculation,
   updated_at=clock_timestamp()
  where budget_forecast_cache.input_signature is distinct from excluded.input_signature;
 end if;
 new_value:=(calculation->>'revenue')::numeric;
 select * into latest from budget_income_history where game_id=p_game_id order by id desc limit 1;
 if not v_is_observer and (latest.id is null or latest.value is distinct from new_value or latest.expenditure is distinct from (calculation->>'expenditure')::numeric
  or latest.plan_id is distinct from (plan->>'id')::uuid or latest.mode is distinct from v_mode) then
  insert into budget_income_history(game_id,plan_id,value,previous_value,expenditure,mode,note)
  values(p_game_id,(plan->>'id')::uuid,new_value,latest.value,(calculation->>'expenditure')::numeric,v_mode,v_note) returning * into latest;
 end if;
 select id,value into v_metric_id,old_value from state_metrics where game_id=p_game_id and metric_key='budget';
 -- Observers receive the same calculated forecast but write neither budget
 -- history nor state_metrics; the above existing role check is reused.
 if not v_is_observer then
 sync_before:=current_setting('gos.budget_income_sync',true);perform set_config('gos.budget_income_sync','on',true);
 if v_metric_id is null then
  insert into state_metrics(game_id,metric_key,label,value,previous_value,unit,is_public,group_key,description,min_value,max_value,sort_order)
  values(p_game_id,'budget','Доходы бюджета',new_value,new_value,'млн ₽',true,'economy','Общий прогноз федеральных доходов на 2027 год. До опубликования закона это прогноз, а не исполнение бюджета.',null,null,3) returning id into v_metric_id;
 else
  update state_metrics set label='Доходы бюджета',value=new_value,previous_value=coalesce(latest.previous_value,new_value),unit='млн ₽',min_value=null,max_value=null,
   updated_at=case when value is distinct from new_value then clock_timestamp() else updated_at end,
   description='Общий прогноз федеральных доходов на 2027 год. До опубликования закона это прогноз, а не исполнение бюджета.'
   where id=v_metric_id and (label is distinct from 'Доходы бюджета' or value is distinct from new_value or unit is distinct from 'млн ₽'
     or max_value is not null or coalesce(description,'') not like 'Общий прогноз федеральных доходов на 2027 год.%');
 end if;
 perform set_config('gos.budget_income_sync',coalesce(sync_before,''),true);
 end if;
 return jsonb_build_object('game_id',p_game_id,'mode',v_mode,'plan_id',plan->>'id','document_id',plan->>'document_id','plan_revision',plan->'revision','note',v_note,
  'calculation',calculation,'as_of',clock_timestamp(),'history',(select coalesce(jsonb_agg(to_jsonb(h) order by h.id),'[]'::jsonb) from
   (select id,game_id,v_metric_id as metric_id,'budget'::text as metric_key,value,previous_value,value-coalesce(previous_value,value) as delta,
    'budget_forecast'::text as source_type,plan_id::text as source_id,null::uuid as actor_id,note,recorded_at
    from budget_income_history where game_id=p_game_id order by id desc limit 300)h));
end$function$;

CREATE OR REPLACE FUNCTION private.reconcile_budget_driver(p_game uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
 v_plan jsonb;v_draft jsonb;v_base jsonb;v_calc jsonb;v_sig text;
 v_metric uuid;v_old numeric;v_new numeric;v_exp numeric;
 v_latest public.budget_income_history%rowtype;
 v_mode text;v_note text;v_sync text;
BEGIN
 -- Do not initialize a simulator or create a new budget for unrelated games.
 IF NOT EXISTS (SELECT 1 FROM public.budget_simulator_state WHERE game_id=p_game) THEN RETURN; END IF;
 SELECT id,value INTO v_metric,v_old FROM public.state_metrics
 WHERE game_id=p_game AND metric_key='budget';
 IF v_metric IS NULL THEN RETURN; END IF;

 -- Shared transaction key with get_budget_pulse avoids overwriting newer results.
 PERFORM pg_advisory_xact_lock(hashtextextended('gos-budget-pulse:'||p_game::text,0));

 -- Exactly the current pulse's plan policy: latest 30 plans, prefer a draft.
 SELECT to_jsonb(p) INTO v_plan FROM (
   SELECT pl.* FROM (
     SELECT * FROM public.budget_simulator_plans
     WHERE game_id=p_game ORDER BY updated_at DESC LIMIT 30
   ) pl
   ORDER BY CASE WHEN pl.status='draft' THEN 0 ELSE 1 END,pl.updated_at DESC LIMIT 1
 ) p;
 IF v_plan IS NULL THEN
   SELECT data INTO v_base FROM private.budget_baseline WHERE year=2026;
   v_draft:=jsonb_build_object(
     'title','Проект федерального бюджета на 2027 год','note','',
     'income_changes','{}'::jsonb,'spending_changes','{}'::jsonb,
     'revenue_adjustments','{}'::jsonb,
     'financing',v_base->'financing',
     'terms',jsonb_build_object('ofz_fixed',60,'ofz_float',60,'bank_credit',12,'external',60),
     'transfer_ids','[]'::jsonb);
   v_mode:='baseline';
   v_note:='Прогноз на 2027 год на основе исходного плана 2026 года и подписанных госпрограмм.';
 ELSE
   v_draft:=v_plan->'draft';
   v_mode:=v_plan->>'status';
   v_note:=CASE v_mode
     WHEN 'draft' THEN 'Общий сохраненный черновик'
     WHEN 'document' THEN 'Проект закона в реестре'
     ELSE 'Опубликованный игровой бюджет'
   END||': '||(v_plan->>'title')||'.';
 END IF;
 v_sig:=private.budget_forecast_signature(p_game,v_draft);
 SELECT calculation INTO v_calc FROM private.budget_forecast_cache
 WHERE game_id=p_game AND input_signature=v_sig;
 IF v_calc IS NULL THEN
   v_calc:=private.calculate_budget_simulator(p_game,v_draft);
   INSERT INTO private.budget_forecast_cache(game_id,input_signature,calculation)
   VALUES(p_game,v_sig,v_calc)
   ON CONFLICT(game_id) DO UPDATE SET input_signature=excluded.input_signature,
     calculation=excluded.calculation,updated_at=clock_timestamp()
   WHERE private.budget_forecast_cache.input_signature IS DISTINCT FROM excluded.input_signature;
 END IF;
 v_new:=(v_calc->>'revenue')::numeric;
 v_exp:=(v_calc->>'expenditure')::numeric;
 IF v_new IS NULL OR v_exp IS NULL THEN
   RAISE EXCEPTION 'Missing calculated federal budget for game %',p_game;
 END IF;
 SELECT * INTO v_latest FROM public.budget_income_history
 WHERE game_id=p_game ORDER BY id DESC LIMIT 1;
 IF v_latest.id IS NULL OR v_latest.value IS DISTINCT FROM v_new
  OR v_latest.expenditure IS DISTINCT FROM v_exp
  OR v_latest.plan_id IS DISTINCT FROM (v_plan->>'id')::uuid
  OR v_latest.mode IS DISTINCT FROM v_mode THEN
   INSERT INTO public.budget_income_history(game_id,plan_id,value,previous_value,expenditure,mode,note)
   VALUES(p_game,(v_plan->>'id')::uuid,v_new,v_latest.value,v_exp,v_mode,v_note);
 END IF;
 IF v_old IS DISTINCT FROM v_new THEN
   v_sync:=current_setting('gos.budget_income_sync',true);
   PERFORM set_config('gos.budget_income_sync','on',true);
   UPDATE public.state_metrics
   SET previous_value=value,value=v_new,updated_at=clock_timestamp()
   WHERE id=v_metric AND value IS DISTINCT FROM v_new;
   PERFORM set_config('gos.budget_income_sync',coalesce(v_sync,''),true);
 END IF;
END
$function$;
