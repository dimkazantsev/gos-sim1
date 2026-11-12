-- Budget pulse no longer serializes the whole simulator JSON just to
-- choose one plan. The exact original mutating preamble is shared by both RPCs.
-- Same access checks, consequences, advisory budget pulse lock, formulas,
-- history, state metrics, and plan ordering. No new subscriptions or tables.
CREATE OR REPLACE FUNCTION private.prepare_budget_simulator(p_game_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare row_id uuid;reason text;v_templates_missing boolean;v_regions_missing boolean;begin
 if auth.uid() is null or not private.is_game_member(p_game_id) then raise exception 'Нет доступа к бюджетному симулятору этой игры.';end if;
 if exists(select 1 from games where id=p_game_id and status not in ('finished','archived')) and exists(select 1 from game_members m where m.game_id=p_game_id and m.user_id=auth.uid() and m.roster_archived_at is null) then perform private.ensure_budget_simulator(p_game_id);end if;
 if private.active_budget_actor(p_game_id) then
 select templates_missing,regions_missing into v_templates_missing,v_regions_missing
 from private.budget_seed_status(p_game_id);
 if v_templates_missing then perform private.seed_budget_cases(p_game_id);end if;
 if v_regions_missing then perform private.seed_budget_regional_cases(p_game_id);end if;
 for row_id in select p.id from budget_simulator_plans p join formal_documents d on d.id=p.document_id and d.game_id=p.game_id where p.game_id=p_game_id and p.status='document' and d.status_code='published' order by d.updated_at loop
  begin perform private.apply_budget_simulator_plan(p_game_id,row_id);
  exception when others then
   get stacked diagnostics reason=MESSAGE_TEXT;
   insert into budget_simulator_ledger(game_id,kind,note,source_key) values(p_game_id,'publication_blocked',
    'Расчет '||row_id||' не применен: '||case when sqlstate='P0001' then reason else 'Проверьте связанный проект бюджета и числовые приложения.' end,'blocked:'||row_id) on conflict do nothing;
  end;
 end loop;
 for row_id in select c.id from event_cases c join event_case_outcomes o on o.case_id=c.id and o.game_id=c.game_id where c.game_id=p_game_id and c.case_key like 'budget-risk-%' and not exists(select 1 from budget_simulator_ledger l where l.game_id=p_game_id and l.source_key='outcome:'||c.id) loop perform private.apply_budget_financial_outcome(p_game_id,row_id);end loop;
 perform private.dispatch_budget_risks(p_game_id);
 end if;
end$function$;

REVOKE ALL ON FUNCTION private.prepare_budget_simulator(uuid)
 FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_budget_simulator(p_game_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
begin
 perform private.prepare_budget_simulator(p_game_id);
 return jsonb_build_object('state',(select to_jsonb(s) from budget_simulator_state s where game_id=p_game_id),
 'plans',(select coalesce(jsonb_agg(to_jsonb(p) order by p.updated_at desc),'[]') from (select pl.*,d.registry_no from budget_simulator_plans pl left join formal_documents d on d.id=pl.document_id where pl.game_id=p_game_id order by pl.updated_at desc limit 30)p),
 'requests',(select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc),'[]') from (select r.*,f.name region_name,c.title event_title from budget_transfer_requests r join fiscal_region_reference f on f.code=r.region_code left join event_cases c on c.id=r.event_case_id and c.game_id=r.game_id where r.game_id=p_game_id)r),
 'regional_events',(select coalesce(jsonb_agg(to_jsonb(e) order by e.region_code,e.title),'[]'::jsonb) from (
  select c.id,c.title,c.situation,c.comic_scene->>'region_code' region_code,c.comic_scene->'budget_request' budget_request,
   case when exists(select 1 from event_case_outcomes o where o.case_id=c.id and o.game_id=c.game_id) then 'resolved'
    when exists(select 1 from event_assignments a where a.case_id=c.id and a.game_id=c.game_id) then 'assigned' else 'ready' end status,
   exists(select 1 from event_assignments a where a.case_id=c.id and a.game_id=c.game_id and a.recipient_id=auth.uid()) assigned
  from event_cases c where c.game_id=p_game_id and c.status='ready'
   and jsonb_typeof(c.comic_scene->'budget_request')='object'
   and exists(select 1 from fiscal_region_reference f where f.code=c.comic_scene->>'region_code')
   and (c.case_key like 'budget-region-2026-%' or private.is_game_teacher(p_game_id) or private.can_prepare_budget(p_game_id)
    or exists(select 1 from event_assignments a where a.case_id=c.id and a.game_id=c.game_id and a.recipient_id=auth.uid()))
 ) e),
 'contracts',(select coalesce(jsonb_agg(to_jsonb(c) order by c.maturity_month,c.created_at),'[]') from budget_finance_contracts c where c.game_id=p_game_id),
 'ledger',(select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at desc,l.id desc),'[]') from (select * from budget_simulator_ledger where game_id=p_game_id order by created_at desc,id desc limit 80)l),
 'can_prepare',private.can_prepare_budget(p_game_id),'can_request',private.can_request_budget_transfer(p_game_id),
 'event_count',(select count(*) from event_assignments a join event_cases c on c.id=a.case_id where a.game_id=p_game_id and a.status in ('pending','accepted') and c.case_key like 'budget-%' and (a.recipient_id=auth.uid() or private.is_game_teacher(p_game_id))));
end$function$;

CREATE OR REPLACE FUNCTION public.get_budget_pulse(p_game_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare plan jsonb;draft jsonb;base jsonb;calculation jsonb;latest budget_income_history%rowtype;
 v_mode text;v_note text;v_metric_id uuid;new_value numeric;old_value numeric;sync_before text;
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
 calculation:=private.calculate_budget_simulator(p_game_id,draft);new_value:=(calculation->>'revenue')::numeric;
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
end$function$;
