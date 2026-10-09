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
 c:=private.calculate_budget_simulator(p_game_id,p_draft);select * into pol from game_fiscal_policy where game_id=p_game_id;select * into st from budget_simulator_state where game_id=p_game_id;
 if p_plan_id is not null then
  select * into pl from budget_simulator_plans where id=p_plan_id and game_id=p_game_id for update;
  if pl.id is null or pl.status<>'draft' then raise exception 'Этот расчет уже связан с документом. Создайте новый расчет для поправок.';end if;
  if p_revision is distinct from pl.revision then raise exception 'Расчет изменен другим участником. Откройте его последнюю версию перед сохранением.';end if;
  sc:=pl.scenario_id;
 else
  insert into budget_scenarios(game_id,title,budget_year,source_note,gdp,created_by,updated_by) values(p_game_id,p_draft->>'title',2026,'Млн рублей. Минфин России, первоначальный план 2026; расчет по игровым допущениям. minfin-approved-2026-v1',235067000,auth.uid(),auth.uid()) returning id into sc;
  insert into budget_simulator_plans(game_id,title,draft,calculation,scenario_id,created_by,updated_by) values(p_game_id,p_draft->>'title',p_draft,c,sc,auth.uid(),auth.uid()) returning * into pl;
 end if;
 update budget_scenarios set title=p_draft->>'title',oil_price=pol.oil_price,key_rate=pol.key_rate,revenue=(c->>'revenue')::numeric,expenditure=(c->>'expenditure')::numeric,
 debt_start=st.internal_debt+st.external_debt,financing=(c->>'financing')::numeric,balance=(c->>'balance')::numeric,deficit_pct_gdp=(c->>'deficit_pct_gdp')::numeric,debt_end=(c->>'debt_total')::numeric,debt_pct_gdp=(c->>'debt_pct_gdp')::numeric,updated_by=auth.uid(),updated_at=now() where id=sc;
 if p_plan_id is not null then update budget_simulator_plans set title=p_draft->>'title',draft=p_draft,calculation=c,revision=revision+1,updated_by=auth.uid(),updated_at=now() where id=pl.id returning * into pl;end if;
 return jsonb_build_object('id',pl.id,'revision',pl.revision);
end$function$;
revoke all on function public.save_budget_simulator(uuid,uuid,jsonb,integer) from public,anon;
grant execute on function public.save_budget_simulator(uuid,uuid,jsonb,integer) to authenticated;
