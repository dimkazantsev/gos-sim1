-- Issued fixed-rate debt retains its quoted coupon; only new borrowing is repriced.
alter table public.budget_simulator_state add column financing_rates jsonb not null default '{}'::jsonb;
create or replace function private.calculate_budget_simulator(p_game uuid,d jsonb) returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare b jsonb;s budget_simulator_state%rowtype;p game_fiscal_policy%rowtype;a jsonb;e numeric;t numeric;fx numeric;activity numeric;cost numeric;oil numeric;firms numeric;vat numeric;profit numeric;
 il jsonb:='[]';el jsonb:='[]';l jsonb;k text;n numeric;driver numeric;tax numeric;rev numeric;exp numeric;annual numeric:=0;interest numeric;transfer_exp numeric;credit numeric;fin numeric:=0;intr numeric:=0;extr numeric;balance numeric;need numeric;uncertainty numeric;issued numeric;locked_rate numeric;quote numeric;
begin
 perform private.ensure_budget_simulator(p_game);perform private.validate_budget_draft(p_game,d);
 select data into b from private.budget_baseline where year=2026;select * into s from budget_simulator_state where game_id=p_game;select * into p from game_fiscal_policy where game_id=p_game;a:=s.anchor;
 e:=coalesce((select value from state_metrics where game_id=p_game and metric_key='economy'),(a->>'economy')::numeric)-(a->>'economy')::numeric;
 t:=coalesce((select value from state_metrics where game_id=p_game and metric_key='public_trust'),(a->>'trust')::numeric)-(a->>'trust')::numeric;
 fx:=p.fx_rate*greatest(.75,least(1.3,1-e*.001-t*.001-(p.key_rate-(a->>'key_rate')::numeric)*.0015));
 select coalesce(sum(enterprises*activity_multiplier),0)/greatest(1,(a->>'enterprises')::numeric) into firms from game_fiscal_regions where game_id=p_game;
 activity:=greatest(.2,least(2,firms*(1-(p.key_rate-(a->>'key_rate')::numeric)*.007+e*.002+t*.001)));
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
  k:=l->>'key';select coalesce(sum(amount),0) into n from budget_transfer_requests where game_id=p_game and status<>'rejected' and kind<>'budget_credit' and section_key=k and d->'transfer_ids' ? id::text;
  n:=round(greatest(0,(l->>'amount')::numeric*(1+coalesce((d->'spending_changes'->>k)::numeric,0)/100)*cost+case when k='13' then interest else 0 end+n),2);
  el:=el||jsonb_build_array(jsonb_build_object('key',k,'label',l->>'label','baseline',(l->>'amount')::numeric,'amount',n));exp:=exp+n;
 end loop;
 intr:=round(greatest(0,s.internal_debt+intr),2);extr:=round(greatest(0,s.external_debt*fx/(a->>'fx_rate')::numeric+(d->'financing'->>'external')::numeric-(s.last_financing->>'external')::numeric),2);
 rev:=round(rev,2);exp:=round(exp,2);balance:=rev-exp;need:=greatest(0,-balance)+credit;
 uncertainty:=greatest(.025,least(.2,.04+abs(e)*.001+abs(t)*.001+abs(p.inflation-(a->>'inflation')::numeric)*.003));
 return jsonb_build_object('income_lines',il,'expense_lines',el,'revenue',rev,'expenditure',exp,'balance',balance,'deficit',greatest(0,-balance),'surplus',greatest(0,balance),
 'deficit_pct_gdp',greatest(0,-balance)/(b->>'gdp')::numeric*100,'financing',fin,'funding_need',need,'funding_gap',greatest(0,need-fin),'cash_excess',greatest(0,fin-need)+greatest(0,balance),
 'internal_debt',intr,'external_debt',extr,'debt_total',intr+extr,'debt_pct_gdp',(intr+extr)/(b->>'gdp')::numeric*100,'annual_interest',annual,'interest_delta',interest,'transfer_expense',transfer_exp,'credit_outflow',credit,
 'reserve_remaining',s.reserve_remaining-(d->'financing'->>'reserves')::numeric+case when s.last_plan_id is not null then (s.last_financing->>'reserves')::numeric else 0 end,
 'activity',activity,'cost',cost,'fx',fx,'uncertainty',uncertainty,'revenue_low',rev*(1-uncertainty),'revenue_high',rev*(1+uncertainty),'expenditure_low',exp*(1-uncertainty),'expenditure_high',exp*(1+uncertainty));
end$$;

-- Targeted help creates the associated regional expense; a credit is liquidity, not income.
create or replace function private.apply_budget_simulator_plan(p_game uuid,p_plan_id uuid) returns boolean language plpgsql security definer set search_path=public,private,pg_temp as $$
declare doc formal_documents%rowtype;pl budget_simulator_plans%rowtype;s budget_simulator_state%rowtype;c jsonb;fresh jsonb;req budget_transfer_requests%rowtype;before_row jsonb;after_row jsonb;k text;old_amount numeric;new_amount numeric;delta numeric;leftover numeric;ct budget_finance_contracts%rowtype;caseid uuid;total_internal numeric;total_external numeric;base_plan text;begin
 select d.* into doc from formal_documents d join budget_simulator_plans p on p.document_id=d.id and p.game_id=d.game_id where p.id=p_plan_id and p.game_id=p_game;
 if doc.id is null or doc.status_code<>'published' or doc.doc_type<>'federal_budget' or doc.workflow_key<>'budget' or not doc.metadata ? 'budget_simulator_plan_id' then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended('budget:'||doc.game_id::text,0));
 select * into pl from budget_simulator_plans where id::text=doc.metadata->>'budget_simulator_plan_id' and game_id=doc.game_id and document_id=doc.id for update;
 if pl.id is null then raise exception 'Не найден расчет, связанный с этим проектом бюджета.';end if;
 if pl.status='published' then return false;end if;
 select * into s from budget_simulator_state where game_id=doc.game_id for update;
 base_plan:=doc.metadata->>'budget_base_plan_id';
 if base_plan is distinct from s.last_plan_id::text then raise exception 'После подготовки проекта опубликован другой бюджет. Создайте обновленный расчет и проект с учетом действующего бюджета.';end if;
 c:=pl.calculation;fresh:=private.calculate_budget_simulator(doc.game_id,pl.draft);
 if (c->>'funding_gap')::numeric>1 or (fresh->>'reserve_remaining')::numeric<0 then raise exception 'Проект не обеспечен финансированием либо доступный резерв изменился. Обновите расчет.';end if;
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
   insert into budget_finance_contracts(game_id,plan_id,source_key,principal,annual_rate,maturity_month)
   values(pl.game_id,pl.id,k,case when k='external' then delta/(fresh->>'fx')::numeric*(s.anchor->>'fx_rate')::numeric else delta end,private.budget_financing_rate(k,(select key_rate from game_fiscal_policy where game_id=pl.game_id)),s.month+coalesce((pl.draft->'terms'->>k)::integer,60));
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
 update budget_simulator_state set internal_debt=(fresh->>'internal_debt')::numeric,
  -- Store foreign-currency principal in anchor-FX equivalent to prevent compounding FX revaluation.
  external_debt=(fresh->>'external_debt')::numeric/(fresh->>'fx')::numeric*(anchor->>'fx_rate')::numeric,
  reserve_remaining=(fresh->>'reserve_remaining')::numeric,
  financing_rates=coalesce((select jsonb_object_agg(q.source_key,q.rate) from (select source_key,sum(principal*annual_rate)/nullif(sum(principal),0) rate from budget_finance_contracts where game_id=pl.game_id and status in ('active','due') and principal>0 group by source_key)q),financing_rates),
  last_financing=pl.draft->'financing',last_plan_id=pl.id,last_document_id=doc.id,version=version+1,updated_at=now() where game_id=pl.game_id;
 update budget_simulator_plans set status='published',updated_at=now() where id=pl.id;
 insert into game_events(game_id,round_no,category,severity,title,body,created_by) values(pl.game_id,13,'Бюджет','notice','Федеральный бюджет принят и опубликован',
  doc.registry_no||'. Доходы: '||(c->>'revenue')||' млн ₽; расходы: '||(c->>'expenditure')||' млн ₽; дефицит: '||(c->>'deficit')||' млн ₽; профицит: '||(c->>'surplus')||' млн ₽. Региональные запросы и долговые обязательства отражены в общем симуляторе.',doc.author_id);
 return true;
end$$;

