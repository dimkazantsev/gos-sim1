-- Immutable budget formula; reuse the last authoritative calculation only
-- while EVERY relevant input remains identical. Preparation and consequences
-- still run first, under the existing per-game advisory transaction lock.
CREATE TABLE private.budget_forecast_cache(
 game_id uuid PRIMARY KEY REFERENCES public.games(id) ON DELETE CASCADE,
 input_signature text NOT NULL,
 calculation jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.budget_forecast_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.budget_forecast_cache FROM PUBLIC,anon,authenticated;

-- Per-game signature includes current draft, baseline, stage of game, budget
-- state and policy, all 89 fiscal regions, rates, economy/trust, transfers,
-- related case titles and region names, plus all program validation/expense
-- sources. Only source columns used by the established calculator are read.
CREATE OR REPLACE FUNCTION private.budget_forecast_signature(p_game uuid,p_draft jsonb)
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO 'public','private','pg_temp'
AS $function$
 SELECT md5(jsonb_build_array(
  p_draft,
  (select data from private.budget_baseline where year=2026),
  (select status from public.games where id=p_game),
  (select to_jsonb(t) from public.budget_simulator_state t where t.game_id=p_game),
  (select to_jsonb(t) from public.game_fiscal_policy t where t.game_id=p_game),
  (select coalesce(jsonb_agg(to_jsonb(t) order by t.region_code),'[]'::jsonb) from public.game_fiscal_regions t where t.game_id=p_game),
  (select coalesce(jsonb_agg(to_jsonb(t) order by t.region_code,t.tax_key),'[]'::jsonb) from public.game_fiscal_rates t where t.game_id=p_game),
  (select coalesce(jsonb_agg(to_jsonb(t) order by t.metric_key),'[]'::jsonb) from public.state_metrics t where t.game_id=p_game and t.metric_key in ('economy','public_trust')),
  (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.budget_transfer_requests t where t.game_id=p_game),
  (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.state_programs t where t.game_id=p_game),
  (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.state_program_goals t where t.game_id=p_game),
  (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.state_program_components t where t.game_id=p_game),
  (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.state_program_expenses t where t.game_id=p_game),
  (select coalesce(jsonb_agg(to_jsonb(t) order by t.program_id,t.budget_year),'[]'::jsonb) from public.state_program_budget_commitments t where t.game_id=p_game),
  (select coalesce(jsonb_agg(jsonb_build_array(t.id,t.title) order by t.id),'[]'::jsonb) from public.event_cases t where t.game_id=p_game and exists(select 1 from public.budget_transfer_requests r where r.game_id=p_game and r.event_case_id=t.id)),
  (select coalesce(jsonb_agg(jsonb_build_array(t.code,t.name) order by t.code),'[]'::jsonb) from public.fiscal_region_reference t where exists(select 1 from public.budget_transfer_requests r where r.game_id=p_game and r.region_code=t.code))
 )::text);
$function$;
REVOKE ALL ON FUNCTION private.budget_forecast_signature(uuid,jsonb)
 FROM PUBLIC,anon,authenticated;

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

