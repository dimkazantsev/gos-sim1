SET LOCAL lock_timeout = '2s';
DO $guard$
BEGIN
 IF EXISTS(SELECT 1 FROM public.game_presence WHERE last_seen_at>now()-interval '3 minutes') THEN RAISE EXCEPTION 'Active classroom; defer budget migration'; END IF;
 IF to_regprocedure('private.read_current_budget_pulse(uuid)') IS NOT NULL THEN RAISE EXCEPTION 'Read helper already exists'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='get_budget_pulse' AND md5(pg_get_functiondef(p.oid))='112efe704f7b3fc5bfdf565c8babdaf7') THEN RAISE EXCEPTION 'Changed dependency: public.get_budget_pulse'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='prepare_budget_simulator' AND md5(pg_get_functiondef(p.oid))='0ac77b3ce4ff0dc6792da990e2fc9ad5') THEN RAISE EXCEPTION 'Changed dependency: private.prepare_budget_simulator'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='ensure_budget_simulator' AND md5(pg_get_functiondef(p.oid))='17751cf5db02e51d910aa8db9af0cadb') THEN RAISE EXCEPTION 'Changed dependency: private.ensure_budget_simulator'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='ensure_fiscal_game' AND md5(pg_get_functiondef(p.oid))='eff25b1b4eac78ce7863944576affa1a') THEN RAISE EXCEPTION 'Changed dependency: private.ensure_fiscal_game'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='budget_seed_status' AND md5(pg_get_functiondef(p.oid))='159258364f9e65fc67b0a4adb5195a10') THEN RAISE EXCEPTION 'Changed dependency: private.budget_seed_status'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='settle_monetary_inflation' AND md5(pg_get_functiondef(p.oid))='14f08a81a6888f2194a7b21b402b5281') THEN RAISE EXCEPTION 'Changed dependency: private.settle_monetary_inflation'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='dispatch_budget_risks' AND md5(pg_get_functiondef(p.oid))='04a3c4ecb499dccf9349de40ee3d9700') THEN RAISE EXCEPTION 'Changed dependency: private.dispatch_budget_risks'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='budget_forecast_signature' AND md5(pg_get_functiondef(p.oid))='acfc7aa455d21c48a5d9761d6f17947d') THEN RAISE EXCEPTION 'Changed dependency: private.budget_forecast_signature'; END IF;
END
$guard$;
-- Verified conservative budget snapshot; existing write and fallback path retained.
-- Exact conservative read-only snapshot; called solely from the authorized public wrapper.
CREATE OR REPLACE FUNCTION private.read_current_budget_pulse(p_game_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $read$
WITH ready AS MATERIALIZED (
 SELECT c.game_id,c.calculation,pl.plan,
  COALESCE(pl.plan->>'status','baseline') AS mode,
  CASE WHEN pl.plan IS NULL THEN 'Прогноз на 2027 год на основе исходного плана 2026 года и подписанных госпрограмм.'
   ELSE (CASE pl.plan->>'status' WHEN 'draft' THEN 'Общий сохраненный черновик' WHEN 'document' THEN 'Проект закона в реестре' ELSE 'Опубликованный игровой бюджет' END)||': '||(pl.plan->>'title')||'.' END AS note,
  m.id AS metric_id
 FROM private.budget_forecast_cache c
 CROSS JOIN private.budget_baseline b
 LEFT JOIN LATERAL (
  SELECT to_jsonb(p) AS plan
  FROM (SELECT pl.*,d.registry_no FROM public.budget_simulator_plans pl
   LEFT JOIN public.formal_documents d ON d.id=pl.document_id
   WHERE pl.game_id=c.game_id ORDER BY pl.updated_at DESC LIMIT 30) p
  ORDER BY CASE WHEN p.status='draft' THEN 0 ELSE 1 END,p.updated_at DESC LIMIT 1
 ) pl ON true
 JOIN public.state_metrics m ON m.game_id=c.game_id AND m.metric_key='budget'
 JOIN LATERAL (SELECT h.* FROM public.budget_income_history h WHERE h.game_id=c.game_id ORDER BY h.id DESC LIMIT 1) h ON true
 CROSS JOIN LATERAL private.budget_seed_status(c.game_id) seed
 WHERE c.game_id=p_game_id AND b.year=2026 AND c.calculation IS NOT NULL
  AND EXISTS(SELECT 1 FROM public.game_fiscal_policy p WHERE p.game_id=c.game_id)
  AND EXISTS(SELECT 1 FROM public.budget_simulator_state s WHERE s.game_id=c.game_id)
  AND NOT EXISTS(SELECT 1 FROM public.fiscal_region_reference d WHERE NOT EXISTS(
   SELECT 1 FROM public.game_fiscal_regions r WHERE r.game_id=c.game_id AND r.region_code=d.code))
  AND seed.templates_missing IS FALSE AND seed.regions_missing IS FALSE
  AND NOT EXISTS(SELECT 1 FROM public.budget_simulator_plans p JOIN public.formal_documents d ON d.id=p.document_id AND d.game_id=p.game_id
   WHERE p.game_id=c.game_id AND p.status='document' AND d.status_code='published')
  AND NOT EXISTS(SELECT 1 FROM public.event_cases e JOIN public.event_case_outcomes o ON o.case_id=e.id AND o.game_id=e.game_id
   WHERE e.game_id=c.game_id AND e.case_key LIKE 'budget-risk-%'
    AND NOT EXISTS(SELECT 1 FROM public.budget_simulator_ledger l WHERE l.game_id=c.game_id AND l.source_key='outcome:'||e.id))
  AND NOT EXISTS(SELECT 1 FROM private.budget_deferred_risks q JOIN public.event_cases e ON e.id=q.case_id JOIN public.budget_simulator_state s ON s.game_id=q.game_id
   WHERE q.game_id=c.game_id AND q.dispatched_at IS NULL AND (q.due_at<=now() OR q.due_month<=s.month))
  AND NOT EXISTS(SELECT 1 FROM public.game_fiscal_policy p JOIN public.fiscal_change_ledger l ON l.game_id=p.game_id
   WHERE p.game_id=c.game_id AND p.monetary_last_settled_on<(now() AT TIME ZONE 'Asia/Barnaul')::date
    AND l.source_type='macro' AND l.created_at>p.monetary_started_at AND l.before_values?'key_rate' AND l.after_values?'key_rate'
    AND (l.before_values->>'key_rate') IS DISTINCT FROM (l.after_values->>'key_rate')
    AND (l.created_at AT TIME ZONE 'Asia/Barnaul')::date+1<=(now() AT TIME ZONE 'Asia/Barnaul')::date
    AND (l.created_at AT TIME ZONE 'Asia/Barnaul')::date+10>p.monetary_last_settled_on)
  AND h.value IS NOT DISTINCT FROM (c.calculation->>'revenue')::numeric
  AND h.expenditure IS NOT DISTINCT FROM (c.calculation->>'expenditure')::numeric
  AND h.plan_id IS NOT DISTINCT FROM (pl.plan->>'id')::uuid
  AND h.mode IS NOT DISTINCT FROM COALESCE(pl.plan->>'status','baseline')
  AND m.label='Доходы бюджета' AND m.value=(c.calculation->>'revenue')::numeric AND m.unit='млн ₽' AND m.max_value IS NULL
  AND coalesce(m.description,'') LIKE 'Общий прогноз федеральных доходов на 2027 год.%'
  AND c.input_signature=private.budget_forecast_signature(c.game_id,CASE WHEN pl.plan IS NULL THEN
   jsonb_build_object('title','Проект федерального бюджета на 2027 год','note','','income_changes','{}'::jsonb,'spending_changes','{}'::jsonb,'revenue_adjustments','{}'::jsonb,
    'financing',b.data->'financing','terms',jsonb_build_object('ofz_fixed',60,'ofz_float',60,'bank_credit',12,'external',60),'transfer_ids','[]'::jsonb)
   ELSE pl.plan->'draft' END)
)
SELECT jsonb_build_object('game_id',r.game_id,'mode',r.mode,'plan_id',r.plan->>'id','document_id',r.plan->>'document_id','plan_revision',r.plan->'revision','note',r.note,
 'calculation',r.calculation,'as_of',clock_timestamp(),'history',(SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.id),'[]'::jsonb) FROM
  (SELECT id,game_id,r.metric_id AS metric_id,'budget'::text AS metric_key,value,previous_value,value-coalesce(previous_value,value) AS delta,
   'budget_forecast'::text AS source_type,plan_id::text AS source_id,NULL::uuid AS actor_id,note,recorded_at
   FROM public.budget_income_history WHERE game_id=r.game_id ORDER BY id DESC LIMIT 300)h))
FROM ready r
$read$;
REVOKE ALL ON FUNCTION private.read_current_budget_pulse(uuid) FROM PUBLIC, anon, authenticated;

-- Activate only after tests below; verify installed definition hash 112efe704f7b3fc5bfdf565c8babdaf7 before replacing.
CREATE OR REPLACE FUNCTION public.get_budget_pulse(p_game_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare plan jsonb;draft jsonb;base jsonb;calculation jsonb;latest budget_income_history%rowtype;
 v_mode text;v_note text;v_metric_id uuid;new_value numeric;old_value numeric;sync_before text;
 v_signature text;v_is_observer boolean;v_read_snapshot jsonb;
begin
 if auth.uid() is null or not private.is_game_member(p_game_id) then raise exception 'Нет доступа к бюджету этой игры.';end if;
 -- No lock, preparation, history or state writes when one consistent snapshot is already current.
 v_read_snapshot:=private.read_current_budget_pulse(p_game_id);
 if v_read_snapshot is not null then return v_read_snapshot;end if;
 -- Unchanged slow path: all mandatory initialization, monetary/risk settlement and recalculation remain.
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

DO $verify$
BEGIN
 IF has_function_privilege('anon','public.get_budget_pulse(uuid)','execute') OR NOT has_function_privilege('authenticated','public.get_budget_pulse(uuid)','execute') OR has_function_privilege('anon','private.read_current_budget_pulse(uuid)','execute') OR has_function_privilege('authenticated','private.read_current_budget_pulse(uuid)','execute') THEN RAISE EXCEPTION 'Unexpected budget RPC privilege'; END IF;
END
$verify$;
