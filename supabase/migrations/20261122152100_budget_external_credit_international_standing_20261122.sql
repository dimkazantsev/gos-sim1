-- 2026-11-22 · Foreign credit availability and debt refinancing, model B.
-- Rates/limits are explicitly adopted teaching coefficients, not real market observations.
-- Direct source paths enforced when preparing and publishing, with preserved legacy debt.
ALTER TABLE public.budget_finance_contracts ADD COLUMN IF NOT EXISTS issued_month integer, ADD COLUMN IF NOT EXISTS issued_rubles numeric;
CREATE OR REPLACE FUNCTION private.external_borrowing_access(p_game uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','private','pg_temp'
AS $access$
WITH basis AS (
 SELECT s.month,greatest(0,least(100,coalesce(m.value,0))) AS standing,(b.data->>'gdp')::numeric AS gdp
 FROM public.budget_simulator_state s
 LEFT JOIN public.state_metrics m ON m.game_id=s.game_id AND m.metric_key='international_standing'
 CROSS JOIN private.budget_baseline b WHERE s.game_id=p_game AND b.year=2026
), drawn AS (
 SELECT basis.*,coalesce(sum(c.issued_rubles) filter(where c.source_key='external'
 and c.issued_month between (basis.month/12)*12 and (basis.month/12)*12+11),0) AS used
 FROM basis LEFT JOIN public.budget_finance_contracts c ON c.game_id=p_game
 GROUP BY basis.month,basis.standing,basis.gdp
)
SELECT jsonb_build_object('standing',standing,'annual_limit',round(gdp*.03*standing/100,8),
 'used',used,'available',greatest(0,round(gdp*.03*standing/100-used,8)),
 'rate',7.5+least(4,greatest(0,3-standing)*.5),'period',month/12) FROM drawn
$access$;
REVOKE ALL ON FUNCTION private.external_borrowing_access(uuid) FROM PUBLIC,anon,authenticated;
DO $migration$ DECLARE f text; BEGIN
SELECT pg_get_functiondef('private.validate_budget_draft(uuid,jsonb)'::regprocedure) INTO f;
IF position('''expense_items'',''base_reallocations''))' in f)=0 THEN RAISE EXCEPTION 'Model B source changed: private.validate_budget_draft(uuid,jsonb) #1'; END IF;
 f:=replace(f,'''expense_items'',''base_reallocations''))','''expense_items'',''base_reallocations'',''external_refinance''))');
IF position('if d ? ''base_reallocations'' then' in f)=0 THEN RAISE EXCEPTION 'Model B source changed: private.validate_budget_draft(uuid,jsonb) #2'; END IF;
 f:=replace(f,'if d ? ''base_reallocations'' then','if d ? ''external_refinance'' then
 if jsonb_typeof(d->''external_refinance'') is distinct from ''number''
 or (d->>''external_refinance'')::numeric::text in (''NaN'',''Infinity'',''-Infinity'')
 or (d->>''external_refinance'')::numeric not between 0 and 50000000
 or round((d->>''external_refinance'')::numeric,8)<>(d->>''external_refinance'')::numeric
 then raise exception ''Рефинансирование должно иметь неотрицательную сумму с точностью до копейки.'';end if;
 end if;
 if d ? ''base_reallocations'' then');
EXECUTE f;
SELECT pg_get_functiondef('private.calculate_budget_simulator(uuid,jsonb)'::regprocedure) INTO f;
IF position('v_collection_adj numeric;' in f)=0 THEN RAISE EXCEPTION 'Model B source changed: private.calculate_budget_simulator(uuid,jsonb) #1'; END IF;
 f:=replace(f,'v_collection_adj numeric;','v_collection_adj numeric;v_access jsonb;v_external_new numeric;v_external_over numeric;v_refinance numeric;v_due numeric;v_refinance_allowed numeric;v_refinance_over numeric;v_refinance_left numeric;v_repay numeric;v_paid_internal numeric:=0;v_paid_external numeric:=0;v_due_ct record;');
IF position('v_collection_adj:=coalesce((v_aux->>''collection_adjustment'')::numeric,0);' in f)=0 THEN RAISE EXCEPTION 'Model B source changed: private.calculate_budget_simulator(uuid,jsonb) #2'; END IF;
 f:=replace(f,'v_collection_adj:=coalesce((v_aux->>''collection_adjustment'')::numeric,0);','v_collection_adj:=coalesce((v_aux->>''collection_adjustment'')::numeric,0);
 v_access:=private.external_borrowing_access(p_game);');
IF position('issued:=case when s.last_plan_id is null then 0 else least(n,(s.last_financing->>k)::numeric) end;quote:=private.budget_financing_rate(k,p.key_rate);' in f)=0 THEN RAISE EXCEPTION 'Model B source changed: private.calculate_budget_simulator(uuid,jsonb) #3'; END IF;
 f:=replace(f,'issued:=case when s.last_plan_id is null then 0 else least(n,(s.last_financing->>k)::numeric) end;quote:=private.budget_financing_rate(k,p.key_rate);','issued:=case when s.last_plan_id is null then 0 else least(n,(s.last_financing->>k)::numeric) end;quote:=case when k=''external'' then (v_access->>''rate'')::numeric else private.budget_financing_rate(k,p.key_rate) end;');
IF position('intr:=round(greatest(0,s.internal_debt+intr),8);extr:=round(greatest(0,s.external_debt*fx/(a->>''fx_rate'')::numeric+(d->''financing''->>''external'')::numeric-(s.last_financing->>''external'')::numeric),8);' in f)=0 THEN RAISE EXCEPTION 'Model B source changed: private.calculate_budget_simulator(uuid,jsonb) #4'; END IF;
 f:=replace(f,'intr:=round(greatest(0,s.internal_debt+intr),8);extr:=round(greatest(0,s.external_debt*fx/(a->>''fx_rate'')::numeric+(d->''financing''->>''external'')::numeric-(s.last_financing->>''external'')::numeric),8);','v_external_new:=greatest(0,(d->''financing''->>''external'')::numeric-case when s.last_plan_id is null then 0 else (s.last_financing->>''external'')::numeric end);
 v_external_over:=greatest(0,v_external_new-(v_access->>''available'')::numeric);
 v_refinance:=coalesce((d->>''external_refinance'')::numeric,0);
 select coalesce(sum(case when c.source_key=''external'' then c.principal*fx/(a->>''fx_rate'')::numeric else c.principal end),0)
 into v_due from budget_finance_contracts c where c.game_id=p_game and c.status=''due'' and c.maturity_month<=s.month and c.principal>0;
 v_refinance_allowed:=least(v_refinance,v_due,v_external_new);
 v_refinance_over:=greatest(0,v_refinance-v_refinance_allowed);
 v_refinance_left:=v_refinance_allowed;
 for v_due_ct in select source_key,principal from budget_finance_contracts
 where game_id=p_game and status=''due'' and maturity_month<=s.month and principal>0 order by maturity_month,id loop
  exit when v_refinance_left<=0;
  v_repay:=least(v_refinance_left,case when v_due_ct.source_key=''external'' then v_due_ct.principal*fx/(a->>''fx_rate'')::numeric else v_due_ct.principal end);
  if v_due_ct.source_key=''external'' then v_paid_external:=v_paid_external+v_repay;else v_paid_internal:=v_paid_internal+v_repay;end if;
  v_refinance_left:=greatest(0,v_refinance_left-v_repay);
 end loop;
 intr:=round(greatest(0,s.internal_debt+intr-v_paid_internal),8);
 extr:=round(greatest(0,s.external_debt*fx/(a->>''fx_rate'')::numeric+(d->''financing''->>''external'')::numeric-(s.last_financing->>''external'')::numeric-v_paid_external),8);
 fin:=fin-v_refinance;');
IF position('''model_b_additional_channels'',v_aux,' in f)=0 THEN RAISE EXCEPTION 'Model B source changed: private.calculate_budget_simulator(uuid,jsonb) #5'; END IF;
 f:=replace(f,'''model_b_additional_channels'',v_aux,','''model_b_additional_channels'',v_aux,
 ''external_borrowing_limit'',(v_access->>''annual_limit'')::numeric,''external_borrowing_available'',(v_access->>''available'')::numeric,
 ''external_borrowing_used'',(v_access->>''used'')::numeric,''external_borrowing_rate'',(v_access->>''rate'')::numeric,
 ''external_borrowing_new'',v_external_new,''external_borrowing_over_limit'',v_external_over,
 ''external_refinance'',v_refinance,''external_refinance_eligible'',v_due,
 ''external_refinance_allocated'',v_refinance_allowed,''external_refinance_over_limit'',v_refinance_over,');
EXECUTE f;
SELECT pg_get_functiondef('public.create_budget_simulator_document(uuid)'::regprocedure) INTO f;
IF position('if (c->>''funding_gap'')::numeric>0' in f)=0 THEN RAISE EXCEPTION 'Model B source changed: public.create_budget_simulator_document(uuid) #1'; END IF;
 f:=replace(f,'if (c->>''funding_gap'')::numeric>0','if (c->>''external_borrowing_over_limit'')::numeric>.00000001 or (c->>''external_refinance_over_limit'')::numeric>.00000001 then
 raise exception ''Внешние заимствования превышают доступный лимит либо средства на рефинансирование превышают новые кредиты и долг с наступившим сроком.'';end if;
 if (c->>''funding_gap'')::numeric>0');
IF position('''Всего источников: ''||(c->>''financing'')||'' млн рублей; потребность с учетом бюджетных кредитов: ''' in f)=0 THEN RAISE EXCEPTION 'Model B source changed: public.create_budget_simulator_document(uuid) #2'; END IF;
 f:=replace(f,'''Всего источников: ''||(c->>''financing'')||'' млн рублей; потребность с учетом бюджетных кредитов: ''','''Из новых внешних займов на погашение долга с наступившим сроком: ''||(c->>''external_refinance'')||'' млн рублей; средства для финансирования дефицита после рефинансирования: ''||(c->>''financing'')||'' млн рублей; потребность с учетом бюджетных кредитов: ''');
EXECUTE f;
SELECT pg_get_functiondef('private.apply_budget_simulator_plan(uuid,uuid)'::regprocedure) INTO f;
IF position('total_external numeric;base_plan text;begin' in f)=0 THEN RAISE EXCEPTION 'Model B source changed: private.apply_budget_simulator_plan(uuid,uuid) #1'; END IF;
 f:=replace(f,'total_external numeric;base_plan text;begin','total_external numeric;base_plan text;v_refinance_left numeric;v_repay numeric;v_principal numeric;v_due_rub numeric;begin');
IF position('if (c->>''funding_gap'')::numeric>' in f)=0 THEN RAISE EXCEPTION 'Model B source changed: private.apply_budget_simulator_plan(uuid,uuid) #2'; END IF;
 f:=replace(f,'if (c->>''funding_gap'')::numeric>','if (fresh->>''external_borrowing_over_limit'')::numeric>.00000001 or (fresh->>''external_refinance_over_limit'')::numeric>.00000001 then
 raise exception ''После изменения международного положения лимит новых внешних кредитов или допустимое рефинансирование нарушены. Составьте новый бюджет.'';end if;
 if (c->>''funding_gap'')::numeric>');
IF position('insert into budget_finance_contracts(game_id,plan_id,source_key,principal,annual_rate,maturity_month)' in f)=0 THEN RAISE EXCEPTION 'Model B source changed: private.apply_budget_simulator_plan(uuid,uuid) #3'; END IF;
 f:=replace(f,'insert into budget_finance_contracts(game_id,plan_id,source_key,principal,annual_rate,maturity_month)','insert into budget_finance_contracts(game_id,plan_id,source_key,principal,annual_rate,maturity_month,issued_month,issued_rubles)');
IF position('private.budget_financing_rate(k,(select key_rate from game_fiscal_policy where game_id=pl.game_id)),s.month+coalesce((pl.draft->''terms''->>k)::integer,60));' in f)=0 THEN RAISE EXCEPTION 'Model B source changed: private.apply_budget_simulator_plan(uuid,uuid) #4'; END IF;
 f:=replace(f,'private.budget_financing_rate(k,(select key_rate from game_fiscal_policy where game_id=pl.game_id)),s.month+coalesce((pl.draft->''terms''->>k)::integer,60));','case when k=''external'' then (fresh->>''external_borrowing_rate'')::numeric else private.budget_financing_rate(k,(select key_rate from game_fiscal_policy where game_id=pl.game_id)) end,
 s.month+coalesce((pl.draft->''terms''->>k)::integer,60),case when k=''external'' then s.month else null end,
 case when k=''external'' then delta else null end);');
IF position(' update budget_simulator_state set internal_debt=' in f)=0 THEN RAISE EXCEPTION 'Model B source changed: private.apply_budget_simulator_plan(uuid,uuid) #5'; END IF;
 f:=replace(f,' update budget_simulator_state set internal_debt=',' v_refinance_left:=coalesce((fresh->>''external_refinance_allocated'')::numeric,0);
 if v_refinance_left>0 then
  for ct in select * from budget_finance_contracts
  where game_id=pl.game_id and status=''due'' and maturity_month<=s.month and principal>0 order by maturity_month,id for update loop
   exit when v_refinance_left<=0;
   v_due_rub:=case when ct.source_key=''external'' then ct.principal*(fresh->>''fx'')::numeric/(s.anchor->>''fx_rate'')::numeric else ct.principal end;
   v_repay:=least(v_refinance_left,v_due_rub);
   v_principal:=case when ct.source_key=''external'' then v_repay*(s.anchor->>''fx_rate'')::numeric/(fresh->>''fx'')::numeric else v_repay end;
   update budget_finance_contracts set principal=greatest(0,round(principal-v_principal,8)),
    status=case when round(principal-v_principal,8)<=0 then ''paid'' else status end where id=ct.id;
   insert into budget_simulator_ledger(game_id,kind,note,amount,source_key)
    values(pl.game_id,''principal'',''Погашение долга за счёт новых внешних заимствований по ''||doc.registry_no||''.'',round(v_repay,8),''external-refinance:''||pl.id||'':''||ct.id) on conflict do nothing;
   v_refinance_left:=greatest(0,v_refinance_left-v_repay);
  end loop;
  if v_refinance_left>.00000001 then raise exception ''Обязательства для рефинансирования изменились. Пересчитайте бюджет.'';end if;
 end if;
 update budget_simulator_state set internal_debt=');
EXECUTE f;
SELECT pg_get_functiondef('private.budget_forecast_signature(uuid,jsonb)'::regprocedure) INTO f;
IF position('''economy_b_all_metrics_derived_v1''' in f)=0 THEN RAISE EXCEPTION 'Model B source changed: private.budget_forecast_signature(uuid,jsonb) #1'; END IF;
 f:=replace(f,'''economy_b_all_metrics_derived_v1''','''economy_b_external_credit_risk_v1''');
EXECUTE f;
END $migration$;