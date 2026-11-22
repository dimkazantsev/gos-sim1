-- Model B. New domestic bonds and loans risk: inflation premium capped at +5pp;
-- annual gross domestic borrowing cap 4.5% GDP, pressure from inflation/key rate;
-- annual debt-interest ceiling 10% of federal revenue. Coefficients are model assumptions.
CREATE OR REPLACE FUNCTION private.internal_borrowing_terms(p_game uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','private','pg_temp'
AS $fn$
WITH x AS (SELECT s.month,p.inflation,p.key_rate,(b.data->>'gdp')::numeric gdp,
 coalesce((SELECT sum(c.issued_rubles) FROM budget_finance_contracts c WHERE c.game_id=p_game
  AND c.source_key IN ('ofz_fixed','ofz_float','bank_credit')
  AND c.issued_month BETWEEN (s.month/12)*12 AND (s.month/12)*12+11),0) used
 FROM budget_simulator_state s JOIN game_fiscal_policy p ON p.game_id=s.game_id
 CROSS JOIN private.budget_baseline b WHERE s.game_id=p_game AND b.year=2026)
SELECT jsonb_build_object('annual_limit',round(gdp*.045*greatest(.3,least(1,1-greatest(0,inflation-8)*.04-greatest(0,key_rate-16)*.015)),8),
 'used',used,'available',greatest(0,round(gdp*.045*greatest(.3,least(1,1-greatest(0,inflation-8)*.04-greatest(0,key_rate-16)*.015))-used,8)),
 'inflation',inflation,'key_rate',key_rate,'service_share_limit',.10) FROM x
$fn$;
REVOKE ALL ON FUNCTION private.internal_borrowing_terms(uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION private.internal_borrowing_premium(p_rate numeric,p_inflation numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $fn$ SELECT least(5,greatest(0,p_inflation-p_rate)*.25) $fn$;
REVOKE ALL ON FUNCTION private.internal_borrowing_premium(numeric,numeric) FROM PUBLIC,anon,authenticated;
DO $migration$ DECLARE f text; BEGIN
SELECT pg_get_functiondef('private.calculate_budget_simulator(uuid,jsonb)'::regprocedure) INTO f;
IF position('v_collection_adj numeric;' in f)=0 THEN RAISE EXCEPTION 'Source mismatch private.calculate_budget_simulator(uuid,jsonb) #1';END IF;
f:=replace(f,'v_collection_adj numeric;','v_collection_adj numeric;v_internal_terms jsonb;v_internal_new numeric:=0;v_internal_over numeric:=0;v_internal_interest_over numeric:=0;');
IF position('v_access:=private.external_borrowing_access(p_game);' in f)=0 THEN RAISE EXCEPTION 'Source mismatch private.calculate_budget_simulator(uuid,jsonb) #2';END IF;
f:=replace(f,'v_access:=private.external_borrowing_access(p_game);','v_access:=private.external_borrowing_access(p_game);v_internal_terms:=private.internal_borrowing_terms(p_game);');
IF position('issued:=case when s.last_plan_id is null then 0 else least(n,(s.last_financing->>k)::numeric) end;quote:=case when k=''external'' then (v_access->>''rate'')::numeric else private.budget_financing_rate(k,p.key_rate) end;' in f)=0 THEN RAISE EXCEPTION 'Source mismatch private.calculate_budget_simulator(uuid,jsonb) #3';END IF;
f:=replace(f,'issued:=case when s.last_plan_id is null then 0 else least(n,(s.last_financing->>k)::numeric) end;quote:=case when k=''external'' then (v_access->>''rate'')::numeric else private.budget_financing_rate(k,p.key_rate) end;','issued:=least(n,coalesce((s.last_financing->>k)::numeric,0));
 quote:=case when k=''external'' then (v_access->>''rate'')::numeric
 else private.budget_financing_rate(k,p.key_rate)+private.internal_borrowing_premium(p.key_rate,p.inflation) end;
 if k in (''ofz_fixed'',''ofz_float'',''bank_credit'') then
  v_internal_new:=v_internal_new+greatest(0,n-coalesce((s.last_financing->>k)::numeric,0));end if;');
IF position('v_external_over:=greatest(0,v_external_new-(v_access->>''available'')::numeric);' in f)=0 THEN RAISE EXCEPTION 'Source mismatch private.calculate_budget_simulator(uuid,jsonb) #4';END IF;
f:=replace(f,'v_external_over:=greatest(0,v_external_new-(v_access->>''available'')::numeric);','v_external_over:=greatest(0,v_external_new-(v_access->>''available'')::numeric);
 v_internal_over:=greatest(0,v_internal_new-(v_internal_terms->>''available'')::numeric);
 v_internal_interest_over:=greatest(0,annual-rev*.10);');
IF position('''expenditure_high'',exp*(1+uncertainty));' in f)=0 THEN RAISE EXCEPTION 'Source mismatch private.calculate_budget_simulator(uuid,jsonb) #5';END IF;
f:=replace(f,'''expenditure_high'',exp*(1+uncertainty));','''expenditure_high'',exp*(1+uncertainty))||
 jsonb_build_object(''internal_borrowing_limit'',(v_internal_terms->>''annual_limit'')::numeric,
 ''internal_borrowing_available'',(v_internal_terms->>''available'')::numeric,
 ''internal_borrowing_used'',(v_internal_terms->>''used'')::numeric,
 ''internal_borrowing_new'',v_internal_new,''internal_borrowing_over_limit'',v_internal_over,
 ''internal_interest_over_limit'',v_internal_interest_over,
 ''internal_borrowing_premium'',private.internal_borrowing_premium(p.key_rate,p.inflation));');
EXECUTE f;
SELECT pg_get_functiondef('private.apply_budget_simulator_plan(uuid,uuid)'::regprocedure) INTO f;
IF position('if (fresh->>''external_borrowing_over_limit'')::numeric>' in f)=0 THEN RAISE EXCEPTION 'Source mismatch private.apply_budget_simulator_plan(uuid,uuid) #1';END IF;
f:=replace(f,'if (fresh->>''external_borrowing_over_limit'')::numeric>','if (fresh->>''internal_borrowing_over_limit'')::numeric>.00000001
 or (fresh->>''internal_interest_over_limit'')::numeric>.00000001 then
 raise exception ''Недоступная сумма внутренних облигаций и кредитов либо превышен предел расходов на обслуживание долга.'';end if;
 if (fresh->>''external_borrowing_over_limit'')::numeric>');
IF position('case when k=''external'' then (fresh->>''external_borrowing_rate'')::numeric else private.budget_financing_rate(k,(select key_rate from game_fiscal_policy where game_id=pl.game_id)) end,' in f)=0 THEN RAISE EXCEPTION 'Source mismatch private.apply_budget_simulator_plan(uuid,uuid) #2';END IF;
f:=replace(f,'case when k=''external'' then (fresh->>''external_borrowing_rate'')::numeric else private.budget_financing_rate(k,(select key_rate from game_fiscal_policy where game_id=pl.game_id)) end,','case when k=''external'' then (fresh->>''external_borrowing_rate'')::numeric
 else private.budget_financing_rate(k,(select key_rate from game_fiscal_policy where game_id=pl.game_id))
  +private.internal_borrowing_premium(
    (select key_rate from game_fiscal_policy where game_id=pl.game_id),
    (select inflation from game_fiscal_policy where game_id=pl.game_id))
  *case when s.last_plan_id is null then
     greatest(0,new_amount-coalesce((s.last_financing->>k)::numeric,0))/greatest(new_amount,.00000001)
    else 1 end
 end,');
IF position('case when k=''external'' then s.month else null end,
 case when k=''external'' then delta else null end' in f)=0 THEN RAISE EXCEPTION 'Source mismatch private.apply_budget_simulator_plan(uuid,uuid) #3';END IF;
f:=replace(f,'case when k=''external'' then s.month else null end,
 case when k=''external'' then delta else null end','case when k=''external'' or s.last_plan_id is not null or
    greatest(0,new_amount-coalesce((s.last_financing->>k)::numeric,0))>0 then s.month else null end,
 case when k=''external'' or s.last_plan_id is not null then delta
  else greatest(0,new_amount-coalesce((s.last_financing->>k)::numeric,0)) end');
EXECUTE f;
SELECT pg_get_functiondef('create_budget_simulator_document(uuid)'::regprocedure) INTO f;
IF position('if (c->>''external_borrowing_over_limit'')::numeric>' in f)=0 THEN RAISE EXCEPTION 'Source mismatch create_budget_simulator_document(uuid) #1';END IF;
f:=replace(f,'if (c->>''external_borrowing_over_limit'')::numeric>','if (c->>''internal_borrowing_over_limit'')::numeric>.00000001
 or (c->>''internal_interest_over_limit'')::numeric>.00000001 then
 raise exception ''Внутренние заимствования или расходы на обслуживание долга превышают доступный предел.'';end if;
 if (c->>''external_borrowing_over_limit'')::numeric>');
EXECUTE f;
SELECT pg_get_functiondef('private.budget_forecast_signature(uuid,jsonb)'::regprocedure) INTO f;
IF position('''economy_b_activity_tax_compliance_v1''' in f)=0 THEN RAISE EXCEPTION 'Source mismatch private.budget_forecast_signature(uuid,jsonb) #1';END IF;
f:=replace(f,'''economy_b_activity_tax_compliance_v1''','''economy_b_domestic_borrowing_v1''');
IF position('(select coalesce(jsonb_agg(jsonb_build_array(t.id,t.title) order by t.id),''[]''::jsonb) from public.event_cases' in f)=0 THEN RAISE EXCEPTION 'Source mismatch private.budget_forecast_signature(uuid,jsonb) #2';END IF;
f:=replace(f,'(select coalesce(jsonb_agg(jsonb_build_array(t.id,t.title) order by t.id),''[]''::jsonb) from public.event_cases','(select coalesce(jsonb_agg(jsonb_build_array(c.source_key,c.issued_month,c.issued_rubles,c.status,c.principal) order by c.id),''[]''::jsonb) from public.budget_finance_contracts c where c.game_id=p_game),
  (select coalesce(jsonb_agg(jsonb_build_array(t.id,t.title) order by t.id),''[]''::jsonb) from public.event_cases');
EXECUTE f;
END $migration$;