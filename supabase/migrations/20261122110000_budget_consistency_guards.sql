-- Safe budget safeguards. No coefficient changes, new relations, RPCs, or subscriptions.

-- Publication uses the fresh result that the existing code already calculates.

-- Scenario updates lock the same row they used to read; no extra SQL statements.

-- A budget metric timestamp moves only with an actual value change.

-- apply_budget_simulator_plan
CREATE OR REPLACE FUNCTION private.apply_budget_simulator_plan(p_game uuid, p_plan_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare doc formal_documents%rowtype;pl budget_simulator_plans%rowtype;s budget_simulator_state%rowtype;c jsonb;fresh jsonb;req budget_transfer_requests%rowtype;before_row jsonb;after_row jsonb;k text;old_amount numeric;new_amount numeric;delta numeric;leftover numeric;ct budget_finance_contracts%rowtype;caseid uuid;total_internal numeric;total_external numeric;base_plan text;begin
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
   insert into budget_finance_contracts(game_id,plan_id,source_key,principal,annual_rate,maturity_month)
   values(pl.game_id,pl.id,k,case when k='external' then round(delta/(fresh->>'fx')::numeric*(s.anchor->>'fx_rate')::numeric,8) else delta end,private.budget_financing_rate(k,(select key_rate from game_fiscal_policy where game_id=pl.game_id)),s.month+coalesce((pl.draft->'terms'->>k)::integer,60));
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
  external_debt=round((fresh->>'external_debt')::numeric/(fresh->>'fx')::numeric*(anchor->>'fx_rate')::numeric,8),
  reserve_remaining=(fresh->>'reserve_remaining')::numeric,
  financing_rates=coalesce((select jsonb_object_agg(q.source_key,q.rate) from (select source_key,sum(principal*annual_rate)/nullif(sum(principal),0) rate from budget_finance_contracts where game_id=pl.game_id and status in ('active','due') and principal>0 group by source_key)q),financing_rates),
  last_financing=pl.draft->'financing',last_plan_id=pl.id,last_document_id=doc.id,version=version+1,updated_at=now() where game_id=pl.game_id;
 update budget_simulator_plans set status='published',updated_at=now() where id=pl.id;
 insert into game_events(game_id,round_no,category,severity,title,body,created_by) values(pl.game_id,13,'Бюджет','notice','Федеральный бюджет принят и опубликован',
  doc.registry_no||'. Доходы: '||(c->>'revenue')||' млн ₽; расходы: '||(c->>'expenditure')||' млн ₽; дефицит: '||(c->>'deficit')||' млн ₽; профицит: '||(c->>'surplus')||' млн ₽. Региональные запросы и долговые обязательства отражены в общем симуляторе.',doc.author_id);
 return true;
end$function$
;

-- finalize_budget_scenario
CREATE OR REPLACE FUNCTION public.finalize_budget_scenario(p_scenario_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare s public.budget_scenarios%rowtype;v_role text;v_uid uuid:=(select auth.uid());
begin
 select * into s from public.budget_scenarios where id=p_scenario_id for update;
 if s.id is null then raise exception 'Scenario not found'; end if;
 if s.status is distinct from 'draft' or s.formal_document_id is not null then
  raise exception 'Сценарий уже зафиксирован или связан с проектом закона.';
 end if;
 v_role:=private.game_role(s.game_id,v_uid);
 if not private.is_game_teacher(s.game_id) and not private.has_effective_role_like(s.game_id,v_uid,ARRAY['%председател%правительств%','%министр%финанс%']) then
  raise exception 'Prime Minister / Finance Minister access required';
 end if;
 if (select count(*) from public.budget_workstreams where scenario_id=s.id)<5 then
  raise exception 'All five analytical workstreams must submit their conclusions';
 end if;
 update public.budget_scenarios set status='final',updated_by=v_uid,updated_at=now() where id=s.id;
 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(s.game_id,13,'Федеральный бюджет','notice','Макроэкономический сценарий бюджета зафиксирован',
  s.title||'. Доходы: '||s.revenue||'; расходы: '||s.expenditure||'; баланс: '||s.balance||
  case when s.deficit_pct_gdp is not null then '; дефицит к ВВП: '||round(s.deficit_pct_gdp,2)||'%' else '' end,
  v_uid);
end;
$function$
;

-- get_budget_pulse
CREATE OR REPLACE FUNCTION public.get_budget_pulse(p_game_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare plan jsonb;draft jsonb;base jsonb;calculation jsonb;latest budget_income_history%rowtype;
 v_mode text;v_note text;v_metric_id uuid;new_value numeric;old_value numeric;sync_before text;
 v_signature text;
begin
 if auth.uid() is null or not private.is_game_member(p_game_id) then raise exception 'Нет доступа к бюджету этой игры.';end if;
 perform pg_advisory_xact_lock(hashtextextended('gos-budget-pulse:'||p_game_id::text,0));
 perform private.prepare_budget_simulator(p_game_id);
 -- The simulator selects only the latest 30 plans, preferring saved drafts.
 -- Keep the same JSON construction and order without loading contracts,
 -- regional case bodies, requests, ledger or the entire simulator response.
 select x into plan
 from jsonb_array_elements((
   select coalesce(jsonb_agg(to_jsonb(p) order by p.updated_at desc),'[]'::jsonb)
   from (
    select pl.*,d.registry_no
    from budget_simulator_plans pl
    left join formal_documents d on d.id=pl.document_id
    where pl.game_id=p_game_id order by pl.updated_at desc limit 30
   ) p
 )) with ordinality as ranked(x,n)
 order by case when x->>'status'='draft' then 0 else 1 end,n limit 1;
 if plan is null then
  select data into base from private.budget_baseline where year=2026;
  draft:=jsonb_build_object('title','Проект федерального бюджета на 2026 год','note','','income_changes','{}'::jsonb,'spending_changes','{}'::jsonb,'revenue_adjustments','{}'::jsonb,
   'financing',base->'financing','terms',jsonb_build_object('ofz_fixed',60,'ofz_float',60,'bank_credit',12,'external',60),'transfer_ids','[]'::jsonb);
  v_mode:='baseline';v_note:='Исходный план 2026 года с учетом текущих игровых условий.';
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
 if latest.id is null or latest.value is distinct from new_value or latest.expenditure is distinct from (calculation->>'expenditure')::numeric
  or latest.plan_id is distinct from (plan->>'id')::uuid or latest.mode is distinct from v_mode then
  insert into budget_income_history(game_id,plan_id,value,previous_value,expenditure,mode,note)
  values(p_game_id,(plan->>'id')::uuid,new_value,latest.value,(calculation->>'expenditure')::numeric,v_mode,v_note) returning * into latest;
 end if;
 select id,value into v_metric_id,old_value from state_metrics where game_id=p_game_id and metric_key='budget';
 -- Observers receive the same calculated forecast but never write state_metrics.
 if not exists(select 1 from game_members where game_id=p_game_id and user_id=auth.uid() and kind='observer') then
 sync_before:=current_setting('gos.budget_income_sync',true);perform set_config('gos.budget_income_sync','on',true);
 if v_metric_id is null then
  insert into state_metrics(game_id,metric_key,label,value,previous_value,unit,is_public,group_key,description,min_value,max_value,sort_order)
  values(p_game_id,'budget','Доходы бюджета',new_value,new_value,'млн ₽',true,'economy','Общий прогноз федеральных доходов на 2026 год. До опубликования закона это прогноз, а не исполнение бюджета.',null,null,3) returning id into v_metric_id;
 else
  update state_metrics set label='Доходы бюджета',value=new_value,previous_value=coalesce(latest.previous_value,new_value),unit='млн ₽',min_value=null,max_value=null,
   updated_at=case when value is distinct from new_value then clock_timestamp() else updated_at end,
   description='Общий прогноз федеральных доходов на 2026 год. До опубликования закона это прогноз, а не исполнение бюджета.'
   where id=v_metric_id and (label is distinct from 'Доходы бюджета' or value is distinct from new_value or unit is distinct from 'млн ₽'
     or max_value is not null or coalesce(description,'') not like 'Общий прогноз федеральных доходов на 2026 год.%');
 end if;
 perform set_config('gos.budget_income_sync',coalesce(sync_before,''),true);
 end if;
 return jsonb_build_object('game_id',p_game_id,'mode',v_mode,'plan_id',plan->>'id','document_id',plan->>'document_id','plan_revision',plan->'revision','note',v_note,
  'calculation',calculation,'as_of',clock_timestamp(),'history',(select coalesce(jsonb_agg(to_jsonb(h) order by h.id),'[]'::jsonb) from
   (select id,game_id,v_metric_id as metric_id,'budget'::text as metric_key,value,previous_value,value-coalesce(previous_value,value) as delta,
    'budget_forecast'::text as source_type,plan_id::text as source_id,null::uuid as actor_id,note,recorded_at
    from budget_income_history where game_id=p_game_id order by id desc limit 300)h));
end$function$
;

-- reconcile_budget_driver
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
     'title','Проект федерального бюджета на 2026 год','note','',
     'income_changes','{}'::jsonb,'spending_changes','{}'::jsonb,
     'revenue_adjustments','{}'::jsonb,
     'financing',v_base->'financing',
     'terms',jsonb_build_object('ofz_fixed',60,'ofz_float',60,'bank_credit',12,'external',60),
     'transfer_ids','[]'::jsonb);
   v_mode:='baseline';
   v_note:='Исходный план 2026 года с учетом текущих игровых условий.';
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
$function$
;

-- save_budget_scenario
CREATE OR REPLACE FUNCTION public.save_budget_scenario(p_game_id uuid, p_scenario_id uuid, p_title text, p_budget_year integer, p_source_note text, p_gdp numeric, p_oil_price numeric, p_cutoff_price numeric, p_key_rate numeric, p_fx_change_pct numeric, p_fx_intervention numeric, p_revenue numeric, p_expenditure numeric, p_debt_start numeric, p_financing numeric, p_deficit_limit_pct numeric, p_debt_limit_pct numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_uid uuid:=(select auth.uid());v_role text;v_id uuid;v_balance numeric;v_deficit numeric;v_debt_end numeric;v_debt_pct numeric;v_existing_status text;v_existing_document uuid;
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
  select status,formal_document_id into v_existing_status,v_existing_document
  from public.budget_scenarios where id=p_scenario_id and game_id=p_game_id for update;
  if not found then raise exception 'Scenario not found'; end if;
  if v_existing_status is distinct from 'draft' or v_existing_document is not null then
   raise exception 'Зафиксированный бюджетный сценарий нельзя менять. Создайте новый вариант.';
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
