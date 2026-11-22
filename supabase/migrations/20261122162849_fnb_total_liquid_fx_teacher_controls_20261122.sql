-- ГОС.ID: full-size sovereign fund 10 trillion RUB, liquid reserve preserved.
-- Initial 25% FX share of liquid assets is an adjustable model assumption.
ALTER TABLE public.budget_simulator_state ADD COLUMN IF NOT EXISTS fnb_total numeric NOT NULL DEFAULT 10000000;
ALTER TABLE public.budget_simulator_state ADD COLUMN IF NOT EXISTS fnb_fx_units numeric NOT NULL DEFAULT 0;
UPDATE public.budget_simulator_state s
 SET fnb_total=greatest(10000000,s.reserve_remaining),
     fnb_fx_units=round(s.reserve_remaining*.25/greatest(.01,p.fx_rate),8)
 FROM public.game_fiscal_policy p
 WHERE s.game_id=p.game_id AND s.last_plan_id IS NULL AND s.fnb_fx_units=0;
CREATE OR REPLACE FUNCTION private.ensure_budget_simulator(p_game uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare p game_fiscal_policy%rowtype;b jsonb;a jsonb;begin
 perform private.ensure_fiscal_game(p_game);
 -- All existing rows already satisfy the initialization contract.
 -- Avoid repeated conflict inserts, 89-region sums and anchor construction
 -- for every budget viewer, while preserving repairs for incomplete games.
 if exists(select 1 from game_fiscal_policy where game_id=p_game)
    and exists(select 1 from budget_simulator_state where game_id=p_game) then
   return;
 end if;
 insert into game_fiscal_policy(game_id,federal_expenditure,municipal_expenditure,baseline_economy,baseline_trust)
 select p_game,coalesce(sum(expenditure)*.6,0),coalesce(sum(expenditure)*.25,0),coalesce((select value from state_metrics where game_id=p_game and metric_key='economy'),50),coalesce((select value from state_metrics where game_id=p_game and metric_key='public_trust'),50)
 from game_fiscal_regions where game_id=p_game on conflict(game_id) do nothing;
 select * into p from game_fiscal_policy where game_id=p_game;
 select data into b from private.budget_baseline where year=2026;
 a:=jsonb_build_object('enterprises',greatest(1,(select sum(enterprises*activity_multiplier) from game_fiscal_regions where game_id=p_game)),
 'key_rate',p.key_rate,'fx_rate',p.fx_rate,'oil_price',greatest(.01,p.oil_price),'inflation',p.inflation,
 'economy',coalesce((select value from state_metrics where game_id=p_game and metric_key='economy'),50),'trust',coalesce((select value from state_metrics where game_id=p_game and metric_key='public_trust'),50),
 'aux_metrics',(select coalesce(jsonb_object_agg(metric_key,value),'{}'::jsonb)
 from state_metrics where game_id=p_game and metric_key in ('social_stability','security','elite_support','international_standing','social_tension','legitimacy','media_climate')));
 insert into budget_simulator_state(game_id,anchor,internal_debt,external_debt,reserve_remaining,last_financing,fnb_fx_units)
 values(p_game,a,(b->>'internal_debt_end')::numeric,(b->>'external_debt_end')::numeric,(b->>'reserve_available_model')::numeric,b->'financing',round((b->>'reserve_available_model')::numeric*.25/greatest(.01,p.fx_rate),8)) on conflict(game_id) do nothing;
end$function$
;

CREATE OR REPLACE FUNCTION public.get_fiscal_context(p_game_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare answer jsonb;
begin
 if auth.uid() is null or not private.is_game_member(p_game_id) then raise exception 'Нет доступа к бюджетной модели этой игры.';end if;
 perform private.ensure_fiscal_game(p_game_id);
 if not exists(select 1 from budget_simulator_state where game_id=p_game_id) then perform private.ensure_budget_simulator(p_game_id);end if;
 -- Existing policy rows must never contend on ON CONFLICT during a read.
 -- The original INSERT remains the first-read path and is race-safe.
 if not exists (select 1 from game_fiscal_policy where game_id=p_game_id) then
 insert into game_fiscal_policy(game_id,federal_expenditure,municipal_expenditure,baseline_economy,baseline_trust,collection_lawfulness_reference)
 select p_game_id,coalesce(sum(expenditure)*.6,0),coalesce(sum(expenditure)*.25,0),
 coalesce((select value from state_metrics where game_id=p_game_id and metric_key='economy'),50),
 coalesce((select value from state_metrics where game_id=p_game_id and metric_key='public_trust'),50),
 (select value from state_metrics where game_id=p_game_id and metric_key='lawfulness')
 from game_fiscal_regions where game_id=p_game_id on conflict(game_id) do nothing;
 end if;
 select jsonb_build_object('policy',to_jsonb(p)||jsonb_build_object('budget_aux_anchor',coalesce(s.anchor->'aux_metrics','{}'::jsonb),'fnb_total',s.fnb_total,'fnb_liquid',s.reserve_remaining,'fnb_fx_share',case when s.reserve_remaining>0 then round(s.fnb_fx_units*p.fx_rate/s.reserve_remaining*100,4) else 0 end),'can_change_rate',private.is_game_teacher(p_game_id) or exists(
 select 1 from game_members m where m.game_id=p_game_id and m.user_id=auth.uid() and m.kind='student' and m.roster_archived_at is null
 and private.role_is_available(p_game_id,auth.uid())
 and (
   lower(coalesce(m.role_title,'')) ~ 'банк[а-я]* россии|центральн.{0,20}банк'
   or exists (
     select 1 from public.game_office_assignments a
     where a.game_id=p_game_id and a.user_id=m.user_id and a.status='active'
       and a.role_title='Председатель Центрального банка Российской Федерации'
   )
 )),
 'metrics',(select coalesce(jsonb_object_agg(metric_key,value),'{}') from state_metrics where game_id=p_game_id and (is_public or private.is_game_teacher(p_game_id))))
 into answer from game_fiscal_policy p left join budget_simulator_state s on s.game_id=p.game_id where p.game_id=p_game_id;
 return answer;
end$function$
;

CREATE OR REPLACE FUNCTION public.set_fiscal_policy(p_game_id uuid, p_values jsonb, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare old_row jsonb;new_row jsonb;is_teacher boolean;k text;allowed boolean;
 v_context jsonb;v_reference numeric;v_old_fnb budget_simulator_state%rowtype;v_total numeric;v_liquid numeric;v_share numeric;v_fx_old numeric;
begin
 if auth.uid() is null or not private.is_game_member(p_game_id) then
   raise exception 'Нет доступа к этой игре.';
 end if;
 is_teacher:=private.is_game_teacher(p_game_id);
 allowed:=is_teacher or exists(
   select 1 from game_members m where m.game_id=p_game_id and m.user_id=auth.uid()
   and m.kind='student' and m.roster_archived_at is null
 and private.role_is_available(p_game_id,auth.uid())
 and (
   lower(coalesce(m.role_title,'')) ~ 'банк[а-я]* россии|центральн.{0,20}банк'
   or exists (
     select 1 from public.game_office_assignments a
     where a.game_id=p_game_id and a.user_id=m.user_id and a.status='active'
       and a.role_title='Председатель Центрального банка Российской Федерации'
   )
 )
 );
 if not allowed then
   raise exception 'Ключевую ставку меняет Банк России. Параметры сценария задаёт преподаватель.';
 end if;
 if p_values is null or jsonb_typeof(p_values)<>'object' or p_values='{}'::jsonb
    or p_reason is null or length(trim(p_reason))<8 then
   raise exception 'Укажите параметры и содержательное основание решения.';
 end if;
 for k in select jsonb_object_keys(p_values) loop
   if k not in ('key_rate','fx_rate','oil_price','cutoff_price','inflation','federal_expenditure','municipal_expenditure','activity_override','fnb_total','fnb_liquid','fnb_fx_share') then
     raise exception 'Неизвестный параметр бюджетного сценария.';
   end if;
   if not is_teacher and k<>'key_rate' then
     raise exception 'Экономическую основу модели меняет только преподаватель.';
   end if;
   if k='activity_override' then
     if jsonb_typeof(p_values->k) not in ('number','null') then
       raise exception 'Деловая активность должна быть числом или автоматическим расчётом.';
     end if;
     if jsonb_typeof(p_values->k)='number'
       and ((p_values->>k)::numeric < 0 or (p_values->>k)::numeric > 1000) then
       raise exception 'Деловая активность должна быть от 0 до 1000 процентов исходного уровня.';
     end if;
   elsif jsonb_typeof(p_values->k)<>'number' then
     raise exception 'Значение должно быть числом.';
   end if;
 end loop;
 -- For a rate or ordinary macro change, avoid a second full fiscal
 -- context read. Keep the original region seeding on the write path.
 -- Manual activity still uses the original authorized context/metrics.
 if p_values ? 'activity_override' and p_values->>'activity_override' is not null then
   v_context:=public.get_fiscal_context(p_game_id);
 else
   perform private.ensure_fiscal_game(p_game_id);
 end if;
 if p_values ? 'fnb_total' or p_values ? 'fnb_liquid' or p_values ? 'fnb_fx_share' then
  perform pg_advisory_xact_lock(hashtextextended('budget:'||p_game_id::text,0));
  perform private.ensure_budget_simulator(p_game_id);
 end if;
 select to_jsonb(p)||jsonb_build_object('fnb_total',s.fnb_total,'fnb_liquid',s.reserve_remaining,
   'fnb_fx_share',case when s.reserve_remaining>0 then round(s.fnb_fx_units*p.fx_rate/s.reserve_remaining*100,4) else 0 end)
 into old_row from game_fiscal_policy p left join budget_simulator_state s on s.game_id=p.game_id
 where p.game_id=p_game_id for update of p;
 -- Preserve the original initialization behavior for a first direct write.
 if old_row is null then
   v_context:=public.get_fiscal_context(p_game_id);
   select to_jsonb(p)||jsonb_build_object('fnb_total',s.fnb_total,'fnb_liquid',s.reserve_remaining,
  'fnb_fx_share',case when s.reserve_remaining>0 then round(s.fnb_fx_units*p.fx_rate/s.reserve_remaining*100,4) else 0 end)
   into old_row from game_fiscal_policy p left join budget_simulator_state s on s.game_id=p.game_id
   where p.game_id=p_game_id for update of p;
 end if;
 if old_row is null then
   raise exception 'Не удалось получить экономические параметры этой игры.';
 end if;
 -- A stale/repeated request must not write identical policy data or a
 -- misleading fiscal-change ledger record. Evaluate while holding the row lock.
 if not exists (
   select 1 from jsonb_each(p_values) change
   where (change.value #>> '{}')::numeric
     is distinct from (old_row->>change.key)::numeric
 ) then
   raise exception 'Значения параметров не изменились. Обновите данные перед повторным сохранением.';
 end if;
 -- Rebase only when the teacher explicitly submits a new manual value.
 -- A rate change by the Bank of Russia never resets this reference.
 if p_values ? 'activity_override' and p_values->>'activity_override' is not null then
  v_reference:=private.fiscal_activity_reference(
   coalesce((p_values->>'key_rate')::numeric,(old_row->>'key_rate')::numeric),
   coalesce((p_values->>'fx_rate')::numeric,(old_row->>'fx_rate')::numeric),
   coalesce((v_context->'metrics'->>'economy')::numeric,(old_row->>'baseline_economy')::numeric)
    -(old_row->>'baseline_economy')::numeric,
   coalesce((v_context->'metrics'->>'public_trust')::numeric,(old_row->>'baseline_trust')::numeric)
    -(old_row->>'baseline_trust')::numeric
  );
 end if;
 update game_fiscal_policy set
   key_rate=coalesce((p_values->>'key_rate')::numeric,key_rate),
   fx_rate=coalesce((p_values->>'fx_rate')::numeric,fx_rate),
   oil_price=coalesce((p_values->>'oil_price')::numeric,oil_price),
   cutoff_price=coalesce((p_values->>'cutoff_price')::numeric,cutoff_price),
   inflation=coalesce((p_values->>'inflation')::numeric,inflation),
   federal_expenditure=coalesce((p_values->>'federal_expenditure')::numeric,federal_expenditure),
   municipal_expenditure=coalesce((p_values->>'municipal_expenditure')::numeric,municipal_expenditure),
   activity_override=case when p_values ? 'activity_override'
     then (p_values->>'activity_override')::numeric else activity_override end,
   activity_reference=case when p_values ? 'activity_override'
     then v_reference else activity_reference end,
   updated_at=now()
 where game_id=p_game_id returning to_jsonb(game_fiscal_policy.*) into new_row;
 if p_values ? 'fnb_total' or p_values ? 'fnb_liquid' or p_values ? 'fnb_fx_share' then
  select * into v_old_fnb from budget_simulator_state where game_id=p_game_id for update;
  v_fx_old:=greatest(.01,(old_row->>'fx_rate')::numeric);
  v_total:=coalesce((p_values->>'fnb_total')::numeric,v_old_fnb.fnb_total);
  v_liquid:=coalesce((p_values->>'fnb_liquid')::numeric,
   case when p_values ? 'fnb_total' and v_old_fnb.fnb_total>0 then round(v_old_fnb.reserve_remaining*v_total/v_old_fnb.fnb_total,8)
    else v_old_fnb.reserve_remaining end);
  v_share:=coalesce((p_values->>'fnb_fx_share')::numeric,
    case when v_old_fnb.reserve_remaining>0 then round(v_old_fnb.fnb_fx_units*v_fx_old/v_old_fnb.reserve_remaining*100,4) else 0 end);
  if v_total<0 or v_total>50000000 or v_liquid<0 or v_liquid>v_total or v_share<0 or v_share>100
    or v_total::text in ('NaN','Infinity','-Infinity') or v_liquid::text in ('NaN','Infinity','-Infinity')
  then raise exception 'ФНБ: общий объём до 50 трлн рублей, доступная сумма не выше общей, валютная доля от 0 до 100.';end if;
  update budget_simulator_state set fnb_total=v_total,reserve_remaining=v_liquid,
   fnb_fx_units=round(v_liquid*v_share/100/v_fx_old,8),version=version+1,updated_at=now()
   where game_id=p_game_id;
  new_row:=new_row||jsonb_build_object('fnb_total',v_total,'fnb_liquid',v_liquid,'fnb_fx_share',v_share);
 end if;
 insert into fiscal_change_ledger(game_id,source_type,source_id,note,before_values,after_values,actor_id)
 values(p_game_id,'macro',gen_random_uuid()::text,
   case when is_teacher then 'Параметры сценария: ' else 'Решение Банка России: ' end||trim(p_reason),
   old_row,new_row,auth.uid());
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
   values(pl.game_id,pl.id,k,case when k='external' then round(delta/(fresh->>'fx')::numeric*(s.anchor->>'fx_rate')::numeric,8) else delta end,case when k='external' then (fresh->>'external_borrowing_rate')::numeric else private.budget_financing_rate(k,(select key_rate from game_fiscal_policy where game_id=pl.game_id)) end,
 s.month+coalesce((pl.draft->'terms'->>k)::integer,60),case when k='external' then s.month else null end,
 case when k='external' then delta else null end);
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
  fnb_total=greatest(0,fnb_total-(s.reserve_remaining-(fresh->>'reserve_remaining')::numeric)),
  fnb_fx_units=least(fnb_fx_units,greatest(0,(fresh->>'reserve_remaining')::numeric/greatest(.01,(select fx_rate from game_fiscal_policy where game_id=pl.game_id)))),
  financing_rates=coalesce((select jsonb_object_agg(q.source_key,q.rate) from (select source_key,sum(principal*annual_rate)/nullif(sum(principal),0) rate from budget_finance_contracts where game_id=pl.game_id and status in ('active','due') and principal>0 group by source_key)q),financing_rates),
  last_financing=pl.draft->'financing',last_plan_id=pl.id,last_document_id=doc.id,version=version+1,updated_at=now() where game_id=pl.game_id;
 update budget_simulator_plans set status='published',updated_at=now() where id=pl.id;
 insert into game_events(game_id,round_no,category,severity,title,body,created_by) values(pl.game_id,13,'Бюджет','notice','Федеральный бюджет принят и опубликован',
  doc.registry_no||'. Доходы: '||(c->>'revenue')||' млн ₽; расходы: '||(c->>'expenditure')||' млн ₽; дефицит: '||(c->>'deficit')||' млн ₽; профицит: '||(c->>'surplus')||' млн ₽. Региональные запросы и долговые обязательства отражены в общем симуляторе.',doc.author_id);
 return true;
end$function$
;

CREATE OR REPLACE FUNCTION public.repay_budget_finance_contract(p_contract_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare ct budget_finance_contracts%rowtype;s budget_simulator_state%rowtype;amount numeric;begin
 select * into ct from budget_finance_contracts where id=p_contract_id;
 if ct.id is null or not private.can_prepare_budget(ct.game_id) then raise exception 'Погашение доступно бюджетной команде этой игры.';end if;
 perform private.lock_budget_actor(ct.game_id);
 perform pg_advisory_xact_lock(hashtextextended('budget:'||ct.game_id::text,0));select * into ct from budget_finance_contracts where id=p_contract_id for update;select * into s from budget_simulator_state where game_id=ct.game_id for update;
 if ct.status='paid' then return;end if;
 amount:=case when ct.source_key='external' then ct.principal*(private.calculate_budget_simulator(ct.game_id,(select draft from budget_simulator_plans where id=s.last_plan_id))->>'fx')::numeric/(s.anchor->>'fx_rate')::numeric else ct.principal end;amount:=round(amount,8);
 if s.reserve_remaining<amount then raise exception 'Недостаточно доступного резерва. Подготовьте изменения в бюджет и источниках рефинансирования.';end if;
 insert into budget_simulator_ledger(game_id,kind,note,amount,source_key) values(ct.game_id,'principal','Погашен основной долг по '||ct.source_key||' из доступного резерва. Проценты учитываются отдельно.',amount,'repay:'||ct.id) on conflict do nothing;if not found then return;end if;
 update budget_simulator_state set reserve_remaining=round(reserve_remaining-amount,8),fnb_total=greatest(0,round(fnb_total-amount,8)),
 fnb_fx_units=least(fnb_fx_units,greatest(0,(reserve_remaining-amount)/greatest(.01,(select fx_rate from game_fiscal_policy where game_id=ct.game_id)))),internal_debt=round(greatest(0,internal_debt-case when ct.source_key<>'external' then ct.principal else 0 end),8),external_debt=round(greatest(0,external_debt-case when ct.source_key='external' then ct.principal else 0 end),8),version=version+1,updated_at=now() where game_id=ct.game_id;
 update budget_finance_contracts set status='paid',principal=0 where id=ct.id;
end$function$
;

CREATE OR REPLACE FUNCTION private.sync_budget_from_fiscal_ledger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  v_relevant boolean := false;
BEGIN
  IF NEW.source_type IN ('event', 'teacher') THEN
    -- Only these regional fields drive the approved federal forecast.
    v_relevant :=
      (NEW.before_values->'enterprises') IS DISTINCT FROM (NEW.after_values->'enterprises')
      OR (NEW.before_values->'activity_multiplier') IS DISTINCT FROM (NEW.after_values->'activity_multiplier');
  ELSIF NEW.source_type = 'macro' THEN
    -- The simulator already uses these four existing policy inputs.
    v_relevant :=
      (NEW.before_values->'key_rate') IS DISTINCT FROM (NEW.after_values->'key_rate')
      OR (NEW.before_values->'fx_rate') IS DISTINCT FROM (NEW.after_values->'fx_rate')
      OR (NEW.before_values->'oil_price') IS DISTINCT FROM (NEW.after_values->'oil_price')
      OR (NEW.before_values->'inflation') IS DISTINCT FROM (NEW.after_values->'inflation')
    OR (NEW.before_values->'fnb_total') IS DISTINCT FROM (NEW.after_values->'fnb_total')
    OR (NEW.before_values->'fnb_liquid') IS DISTINCT FROM (NEW.after_values->'fnb_liquid')
    OR (NEW.before_values->'fnb_fx_share') IS DISTINCT FROM (NEW.after_values->'fnb_fx_share');
  ELSIF NEW.source_type = 'act' AND NEW.region_code = '00' THEN
    -- Only federal VAT/profit rates are read by the existing simulator.
    v_relevant :=
      split_part(NEW.source_id, ':', 2) IN ('vat', 'profit')
      AND (NEW.before_values->'rate') IS DISTINCT FROM (NEW.after_values->'rate');
  END IF;

  IF v_relevant THEN
    BEGIN
      -- Reuse the same per-game advisory lock, snapshot signature, one cache
      -- row and no-duplicate history logic as the metric-driven reconciliation.
      PERFORM private.reconcile_budget_driver(NEW.game_id);
    EXCEPTION WHEN OTHERS THEN
      -- A forecast failure must not invalidate a completed game action.
      RAISE WARNING 'ГОС.ID: fiscal-ledger budget sync failed for game %, SQLSTATE %',
        NEW.game_id, SQLSTATE;
    END;
  END IF;
  RETURN NEW;
END
$function$
;
CREATE OR REPLACE FUNCTION private.fnb_fx_change()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','private','pg_temp'
 AS $body$
 DECLARE v_delta numeric;v_id bigint;
 BEGIN
  IF NEW.source_type<>'macro' OR (NEW.before_values->'fx_rate') IS NOT DISTINCT FROM (NEW.after_values->'fx_rate') THEN RETURN NEW;END IF;
  IF coalesce((NEW.before_values->>'fx_rate')::numeric,0)<=0 OR coalesce((NEW.after_values->>'fx_rate')::numeric,0)<=0 THEN RETURN NEW;END IF;
  INSERT INTO budget_simulator_ledger(game_id,kind,note,amount,source_key)
  VALUES(NEW.game_id,'fnb_fx','Переоценка валютных активов ФНБ при изменении расчётного курса.',0,'fnb-fx:'||NEW.id::text)
  ON CONFLICT DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN NEW;END IF;
  UPDATE budget_simulator_state
  SET reserve_remaining=greatest(0,round(reserve_remaining+fnb_fx_units*((NEW.after_values->>'fx_rate')::numeric-(NEW.before_values->>'fx_rate')::numeric),8)),
      fnb_total=greatest(0,round(fnb_total+fnb_fx_units*((NEW.after_values->>'fx_rate')::numeric-(NEW.before_values->>'fx_rate')::numeric),8)),
      version=version+1,updated_at=now()
  WHERE game_id=NEW.game_id AND fnb_fx_units>0
  RETURNING fnb_fx_units*((NEW.after_values->>'fx_rate')::numeric-(NEW.before_values->>'fx_rate')::numeric) INTO v_delta;
  UPDATE budget_simulator_ledger SET amount=coalesce(v_delta,0) WHERE id=v_id;
  RETURN NEW;
 END $body$;
REVOKE ALL ON FUNCTION private.fnb_fx_change() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS fnb_fx_change ON public.fiscal_change_ledger;
CREATE TRIGGER fnb_fx_change AFTER INSERT ON public.fiscal_change_ledger
 FOR EACH ROW WHEN (NEW.source_type='macro' AND (NEW.before_values->'fx_rate') IS DISTINCT FROM (NEW.after_values->'fx_rate'))
 EXECUTE FUNCTION private.fnb_fx_change();
