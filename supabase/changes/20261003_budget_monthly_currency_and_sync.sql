-- Current-classroom synchronization survives conflicting published amendments.
-- Observers see the shared budget without mutating documents or event assignments.
create or replace function public.get_budget_simulator(p_game_id uuid) returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare row_id uuid;reason text;begin
 if auth.uid() is null or not private.is_game_member(p_game_id) then raise exception 'Нет доступа к бюджетному симулятору этой игры.';end if;
 perform private.ensure_budget_simulator(p_game_id);
 if private.is_game_teacher(p_game_id) or exists(select 1 from game_members where game_id=p_game_id and user_id=auth.uid() and kind='student') then
 perform private.seed_budget_cases(p_game_id);
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
 return jsonb_build_object('state',(select to_jsonb(s) from budget_simulator_state s where game_id=p_game_id),
 'plans',(select coalesce(jsonb_agg(to_jsonb(p) order by p.updated_at desc),'[]') from (select pl.*,d.registry_no from budget_simulator_plans pl left join formal_documents d on d.id=pl.document_id where pl.game_id=p_game_id order by pl.updated_at desc limit 30)p),
 'requests',(select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc),'[]') from (select r.*,f.name region_name from budget_transfer_requests r join fiscal_region_reference f on f.code=r.region_code where game_id=p_game_id)r),
 'contracts',(select coalesce(jsonb_agg(to_jsonb(c) order by c.maturity_month,c.created_at),'[]') from budget_finance_contracts c where c.game_id=p_game_id),
 'ledger',(select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at desc,l.id desc),'[]') from (select * from budget_simulator_ledger where game_id=p_game_id order by created_at desc,id desc limit 80)l),
 'can_prepare',private.can_prepare_budget(p_game_id),'can_request',private.can_request_budget_transfer(p_game_id),
 'event_count',(select count(*) from event_assignments a join event_cases c on c.id=a.case_id where a.game_id=p_game_id and a.status in ('pending','accepted') and c.case_key like 'budget-%' and (a.recipient_id=auth.uid() or private.is_game_teacher(p_game_id))));
end$$;


-- External interest and maturity amounts use the current ruble equivalent.
create or replace function public.advance_budget_simulator(p_game_id uuid,p_version integer) returns integer language plpgsql security definer set search_path=public,private,pg_temp as $$
declare s budget_simulator_state%rowtype;ct budget_finance_contracts%rowtype;n integer;rate numeric;principal_rub numeric;fx_factor numeric;label text;begin
 if auth.uid() is null or not private.is_game_member(p_game_id) or not private.is_game_teacher(p_game_id) then raise exception 'Переход финансового месяца доступен преподавателю этой игры.';end if;
 perform pg_advisory_xact_lock(hashtextextended('budget:'||p_game_id::text,0));perform private.ensure_budget_simulator(p_game_id);select * into s from budget_simulator_state where game_id=p_game_id for update;
 if s.version is distinct from p_version then raise exception 'Финансовые данные уже изменились. Обновите раздел перед переходом месяца.';end if;
 if s.last_plan_id is null then raise exception 'Сначала примите и опубликуйте бюджетный проект.';end if;
 n:=s.month+1;if n>120 then raise exception 'Завершены все 120 учебных финансовых месяцев.';end if;
 fx_factor:=(private.calculate_budget_simulator(p_game_id,(select draft from budget_simulator_plans where id=s.last_plan_id))->>'fx')::numeric/(s.anchor->>'fx_rate')::numeric;
 for ct in select * from budget_finance_contracts where game_id=p_game_id and status in ('active','due') for update loop
  rate:=case when ct.source_key='ofz_float' then private.budget_financing_rate('ofz_float',(select key_rate from game_fiscal_policy where game_id=p_game_id)) else ct.annual_rate end;
  principal_rub:=ct.principal*case when ct.source_key='external' then fx_factor else 1 end;
  label:=case ct.source_key when 'ofz_fixed' then 'ОФЗ с фиксированным купоном' when 'ofz_float' then 'ОФЗ с плавающим купоном' when 'bank_credit' then 'кредиту банка' when 'external' then 'внешнему займу' else 'долговому обязательству' end;
  update budget_finance_contracts set annual_rate=rate,status=case when maturity_month<=n then 'due' else status end where id=ct.id;
  insert into budget_simulator_ledger(game_id,kind,note,amount,source_key) values(p_game_id,'interest','Месяц '||n||': начислены проценты по '||label||'. Это расход обслуживания, не погашение основного долга.',round(principal_rub*rate/1200,2),'interest:'||ct.id||':'||n) on conflict do nothing;
  if ct.maturity_month=n then insert into budget_simulator_ledger(game_id,kind,note,amount,source_key) values(p_game_id,'maturity','Наступил срок погашения '||label||'. Долг сохраняется до платежа. Погасите из доступного резерва либо подготовьте новый бюджет для рефинансирования.',principal_rub,'maturity:'||ct.id) on conflict do nothing;end if;
 end loop;
 insert into budget_simulator_ledger(game_id,kind,note,amount,source_key)
 select p_game_id,'regional_maturity','Наступил срок возврата бюджетного кредита: '||f.name||'. Верните средства в форме региональных запросов.',r.amount,'regional-maturity:'||r.id from budget_transfer_requests r join fiscal_region_reference f on f.code=r.region_code where r.game_id=p_game_id and r.kind='budget_credit' and r.status='granted' and r.maturity_month=n and r.repaid_at is null on conflict do nothing;
 update budget_simulator_state set month=n,version=version+1,updated_at=now() where game_id=p_game_id;
 perform private.dispatch_budget_risks(p_game_id);return n;
end$$;
