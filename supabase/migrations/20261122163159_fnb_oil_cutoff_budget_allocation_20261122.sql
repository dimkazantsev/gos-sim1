-- ФНБ: нефтяные сбережения подтверждаются только при публикации бюджета.
-- Вклад = нефтегазовые доходы × max(0,(нефть - цена отсечения)/нефть).
-- Финансирование дефицита НЕ может повторно расходовать эту сумму: она включена в funding_need.
ALTER TABLE public.budget_simulator_state ADD COLUMN IF NOT EXISTS fnb_last_oil_allocation numeric NOT NULL DEFAULT 0;
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
 return jsonb_build_object('income_lines',il,'income_details',private.budget_income_details(p_game,d,il,activity,oil),'expense_lines',el,'expense_items',coalesce(d->'expense_items','[]'::jsonb),'program_expenses',private.server_budget_program_expenses(p_game,coalesce(d->'expense_items','[]'::jsonb)),'transfer_requests',tr,'income_rounding',(b->>'income_rounding')::numeric,'revenue_adjustment',s.revenue_adjustment,'revenue',rev,'expenditure',exp,'balance',balance,'deficit',greatest(0,-balance),'surplus',greatest(0,balance),
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
end$function$
;

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
end$function$
;

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
 if (c->>'internal_borrowing_over_limit')::numeric>.00000001
 or (c->>'internal_interest_over_limit')::numeric>.00000001 then
 raise exception 'Внутренние заимствования или расходы на обслуживание долга превышают доступный предел.';end if;
 if (c->>'external_borrowing_over_limit')::numeric>.00000001 or (c->>'external_refinance_over_limit')::numeric>.00000001 then
 raise exception 'Внешние заимствования превышают доступный лимит либо средства на рефинансирование превышают новые кредиты и долг с наступившим сроком.';end if;
 if (c->>'funding_gap')::numeric>0 or (c->>'reserve_remaining')::numeric<0 then raise exception 'Покройте дефицит и выдачу бюджетных кредитов допустимыми источниками. Нельзя использовать резерв сверх остатка.';end if;
 if length(trim(coalesce(pl.draft->>'note','')))<30 then raise exception 'Добавьте пояснительную записку с основанием решений: не менее 30 символов.';end if;
 body:=E'РОССИЙСКАЯ ФЕДЕРАЦИЯ\nПРОЕКТ ФЕДЕРАЛЬНОГО ЗАКОНА\nО федеральном бюджете на 2026 год\n\nСтатья 1. Основные характеристики федерального бюджета\n'||
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
 body:=body||E'Целевые трансферты включены в профильные разделы, дотации — в раздел 14. Бюджетные кредиты являются возвратным финансированием.\n\nПОЯСНИТЕЛЬНАЯ ЗАПИСКА\n'||(pl.draft->>'note')||E'\n\nИСХОДНЫЕ ДАННЫЕ И ДОПУЩЕНИЯ\nПервоначально утвержденный план 2026 года: Минфин России, «Бюджет для граждан 2026–2028», https://ob.ulminfin.ru/images/brochure/Byudjet_federal/2026f/BDG_2026.pdf. Все суммы — млн рублей. Изменения активности, процентные условия и риски — учебная модель. Налоговые ставки изменяются отдельными НПА.\n\nПолномочия и процедура: БК РФ, статьи 103, 129–133, 192, 199–207; Конституция РФ, статьи 104–107. Подписи и дата фиксируются участниками процедуры в реестре НПА.';
 body:=body||E'\n\nПРИЛОЖЕНИЕ 1. РАСЧЁТ ДОХОДОВ ПО СТАТЬЯМ\n';
 for l in select jsonb_array_elements(c->'income_details') loop
  body:=body||(l->>'label')||': ставка '||(l->>'rate')||case l->>'rate_unit' when 'rubles' then ' рублей за единицу' else ' %' end||', база '||(l->>'base')||case l->>'base_unit' when 'units' then ' единиц' else ' млн рублей' end||', доля федерального бюджета '||((l->>'federal_share')::numeric*100)||' %; доход '||(l->>'amount')||E' млн рублей.\n';
 end loop;
 body:=body||E'Эффективные ставки и распределение внутри доходных групп учебные; НДС и налог на прибыль используют действующие ставки игры. Округление и отдельные корректировки указаны отдельно.\n\nПРИЛОЖЕНИЕ 2. ОБОСНОВАННЫЕ РАСХОДЫ\n';
 for l in select jsonb_array_elements(c->'expense_items') loop
  body:=body||'Раздел '||(l->>'section_key')||'. '||(l->>'title')||'. Показатель: '||(l->>'indicator')||'. Обоснование: '||(l->>'justification')||'. Сумма: '||((l->>'amount')::numeric*1000000)||' рублей.'||case when nullif(l->>'program_id','') is not null then ' Госпрограмма: '||(select title from state_programs where id=(l->>'program_id')::uuid and game_id=pl.game_id)||'; год 2026.' else '' end||E'\n';
 end loop;
 for pe in select jsonb_array_elements(c->'program_expenses') loop
  body:=body||E'\nПОДПИСАННАЯ ГОСПРОГРАММА: '||(pe->>'title')||E'\nПоказатели программы: '||(pe->>'indicators')||E'\n';
  for l in select jsonb_array_elements(pe->'expense_breakdown') loop
   body:=body||(l->>'component_title')||'. '||(l->>'indicator_name')||'. Основание: '||(l->>'justification')||'. 2026 год: '||(l->>'amount')||E' рублей.\n';
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
 doc:=public.create_formal_document(pl.game_id,13,pl.title,'federal_budget','government','Правительство Российской Федерации',body,null,null,null,'budget',jsonb_build_object('budget_simulator_plan_id',pl.id,'budget_scenario_id',pl.scenario_id,'budget_base_plan_id',(select last_plan_id from budget_simulator_state where game_id=pl.game_id),'budget_year',2026,'unit','million_rubles','budget_snapshot',c,'budget_draft',pl.draft,'revision',1,'educational_draft',true));
 perform set_config('gos.official_budget_plan_creation','',true);
 update formal_documents set metadata=metadata||jsonb_build_object('budget_amendments',
  (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'title',a.title,'party_name',a.party_name,'reason',a.reason,'amount',a.amount,'from_section',a.from_section,'to_section',a.to_section,'applied_revision',a.applied_revision,'vote_id',a.vote_id,'yes',v.result_yes,'no',v.result_no,'abstain',v.result_abstain) order by a.applied_revision),'[]'::jsonb) from budget_faction_amendments a left join game_votes v on v.id=a.vote_id where a.plan_id=pl.id and a.status='applied')) where id=doc;
 update budget_simulator_plans set status='document',document_id=doc,calculation=c,updated_at=now() where id=pl.id;
 update budget_scenarios set status='final',formal_document_id=doc,updated_at=now() where id=pl.scenario_id;
 insert into budget_simulator_ledger(game_id,kind,note,amount,source_key) values(pl.game_id,'document','Сформирован проект закона; экономические изменения ожидают опубликования.',(c->>'expenditure')::numeric,'document:'||doc);
 return doc;
end$function$
;

CREATE OR REPLACE FUNCTION private.budget_forecast_signature(p_game uuid, p_draft jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
 SELECT md5(jsonb_build_array(
  'economy_b_fnb_oil_saving_v1',
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
$function$
;