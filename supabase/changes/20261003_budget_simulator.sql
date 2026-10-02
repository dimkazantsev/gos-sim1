-- Classroom-scoped federal budget simulator. No bulk game writes or background jobs. All money is in millions of RUB.
-- Official 2026 starting plan is immutable; elasticities and loan terms are teaching assumptions.
create table private.budget_baseline(year integer primary key,data jsonb not null);
alter table public.game_fiscal_regions add column budget_credit_cash numeric not null default 0 check(budget_credit_cash>=0);
insert into private.budget_baseline(year,data) values(2026,$baseline${
  "year": 2026,
  "version": "minfin-approved-2026-v1",
  "unit": "million_rubles",
  "baseline_kind": "Первоначально утвержденный план 2026 года; не оперативное исполнение бюджета",
  "source_url": "https://ob.ulminfin.ru/images/brochure/Byudjet_federal/2026f/BDG_2026.pdf",
  "source_label": "Минфин России. Бюджет для граждан к закону о бюджете 2026–2028",
  "source_pages": [
    6,
    7,
    10,
    11,
    14,
    15
  ],
  "revenue_source_url": "https://www.garant.ru/products/ipo/prime/doc/412697173/",
  "revenue_source_note": "Минфин России, Основные направления бюджетной, налоговой и таможенно-тарифной политики 2026–2028, таблица 4.1.2; групповой прогноз, не отдельные суммы каждого налога.",
  "checked_at": "2026-10-02",
  "gdp": 235067000,
  "revenue": 40283300,
  "expenditure": 44069700,
  "income_rounding": 200,
  "expense_rounding": -100,
  "internal_debt_start": 32189900,
  "external_debt_start": 6363200,
  "internal_debt_end": 37436200,
  "external_debt_end": 6231900,
  "reserve_total_reference": 13637000,
  "reserve_available_model": 4490900,
  "reserve_note": "4 490,9 млрд ₽ — оценка резервных активов в макропрогнозе на конец 2025 года. Учебный верхний предел использования; общий объем ФНБ не равен доступным денежным средствам.",
  "internal_debt_other_movement": 1266200,
  "external_debt_other_movement": -131300,
  "macro_reference": {
    "oil_price": 59,
    "fx_rate": 92.2,
    "inflation": 4
  },
  "financing": {
    "ofz_fixed": 3980100,
    "ofz_float": 0,
    "bank_credit": 0,
    "external": 0,
    "reserves": 38500,
    "privatization": 3200,
    "other": -235400
  },
  "income_lines": [
    {
      "key": "oil_gas",
      "label": "Нефтегазовые доходы",
      "amount": 8918500,
      "explanation": "НДПИ, НДД и иные нефтегазовые поступления. Чувствительны к цене нефти и курсу.",
      "driver": "oil"
    },
    {
      "key": "turnover",
      "label": "НДС, акцизы и таможенные пошлины",
      "amount": 20363000,
      "explanation": "Оборотные платежи: потребление, производство подакцизных товаров и импорт.",
      "driver": "activity"
    },
    {
      "key": "income",
      "label": "Налоги на доходы",
      "amount": 4978800,
      "explanation": "Федеральная часть налога на прибыль и предусмотренные законом поступления НДФЛ.",
      "driver": "activity"
    },
    {
      "key": "assets",
      "label": "Использование государственного имущества",
      "amount": 1718200,
      "explanation": "Дивиденды, управление средствами ФНБ, доходы по остаткам Казначейства и проценты по межгосударственным кредитам.",
      "driver": "stable"
    },
    {
      "key": "rent",
      "label": "Прочие рентные доходы",
      "amount": 947000,
      "explanation": "НДПИ горно-металлургического комплекса, отдельные вывозные пошлины, акцизы на природный газ и сталь, СРП. Не дублирует нефтегазовую строку.",
      "driver": "activity"
    },
    {
      "key": "recycling",
      "label": "Утилизационный сбор",
      "amount": 1647500,
      "explanation": "Поступления утилизационного сбора. Это неналоговый платеж.",
      "driver": "activity"
    },
    {
      "key": "other",
      "label": "Другие доходы",
      "amount": 1710100,
      "explanation": "Остальные поступления, включая нерегулярные. Приватизация акций здесь не учитывается: это источник финансирования.",
      "driver": "stable"
    }
  ],
  "expense_lines": [
    {
      "key": "01",
      "label": "Общегосударственные вопросы",
      "amount": 2751300,
      "explanation": "Работа федеральных органов, судов и управление публичными финансами."
    },
    {
      "key": "02",
      "label": "Национальная оборона",
      "amount": 12121000,
      "explanation": "Обеспечение обороны и выполнение принятых обязательств."
    },
    {
      "key": "03",
      "label": "Национальная безопасность и правоохранительная деятельность",
      "amount": 3826700,
      "explanation": "Правоохранительные органы, гражданская защита и безопасность."
    },
    {
      "key": "04",
      "label": "Национальная экономика",
      "amount": 4843700,
      "explanation": "Транспорт, инфраструктура, промышленность и поддержка хозяйственной деятельности."
    },
    {
      "key": "05",
      "label": "Жилищно-коммунальное хозяйство",
      "amount": 2031400,
      "explanation": "Жилье, коммунальная инфраструктура и благоустройство."
    },
    {
      "key": "06",
      "label": "Охрана окружающей среды",
      "amount": 1102500,
      "explanation": "Экология, природоохранные мероприятия и восстановление среды."
    },
    {
      "key": "07",
      "label": "Образование",
      "amount": 1747400,
      "explanation": "Федеральные образовательные организации и образовательные программы."
    },
    {
      "key": "08",
      "label": "Культура и кинематография",
      "amount": 304800,
      "explanation": "Культурное наследие, учреждения культуры и кино."
    },
    {
      "key": "09",
      "label": "Здравоохранение",
      "amount": 1904900,
      "explanation": "Федеральная медицина, программы здравоохранения и поддержка системы."
    },
    {
      "key": "10",
      "label": "Социальная политика",
      "amount": 7838700,
      "explanation": "Пенсионные и социальные обязательства, пособия и поддержка граждан."
    },
    {
      "key": "11",
      "label": "Физическая культура и спорт",
      "amount": 73800,
      "explanation": "Спортивные программы и инфраструктура."
    },
    {
      "key": "12",
      "label": "Средства массовой информации",
      "amount": 148900,
      "explanation": "Расходы на СМИ и информационные программы."
    },
    {
      "key": "13",
      "label": "Обслуживание государственного долга",
      "amount": 3900200,
      "explanation": "Проценты и иные расходы обслуживания. Погашение основного долга учитывается в финансировании."
    },
    {
      "key": "14",
      "label": "Межбюджетные трансферты общего характера",
      "amount": 1474500,
      "explanation": "Дотации и иные трансферты общего характера. Целевые субсидии и субвенции уже входят в отраслевые разделы."
    }
  ],
  "assumptions": [
    "Детализация налоговой чувствительности внутри групп учебная: доля НДС в оборотной группе 72%, доля прибыли в группе налогов на доходы 80%. Это не официальные доли.",
    "Изменение активности от предприятий, ключевой ставки и рейтингов — учебная эластичность; это не прогноз Минфина.",
    "Процентная стоимость новых инструментов — условия учебной сделки, а не котировка рынка.",
    "Округление: доходные группы на 0,2 млрд ₽ меньше общего итога; расходные разделы на 0,1 млрд ₽ больше. Разницы сохранены отдельными строками.",
    "Прочие движения долга — расчетная разница между начальным долгом, чистыми заимствованиями и плановым конечным долгом; не отдельный официальный прогноз гарантий."
  ]
}$baseline$::jsonb);
create table public.budget_simulator_state(
 game_id uuid primary key references public.games(id) on delete cascade,
 anchor jsonb not null,internal_debt numeric not null,external_debt numeric not null,
 reserve_remaining numeric not null,service_adjustment numeric not null default 0,revenue_adjustment numeric not null default 0,
 last_financing jsonb not null,month integer not null default 0,version integer not null default 0,
 last_document_id uuid references public.formal_documents(id) on delete set null,last_plan_id uuid,
 updated_at timestamptz not null default now()
);
create table public.budget_simulator_plans(
 id uuid primary key default gen_random_uuid(),game_id uuid not null references public.games(id) on delete cascade,
 title text not null,draft jsonb not null,calculation jsonb not null,revision integer not null default 1,
 status text not null default 'draft' check(status in ('draft','document','published')),
 document_id uuid references public.formal_documents(id) on delete set null,
 scenario_id uuid not null references public.budget_scenarios(id) on delete cascade,
 created_by uuid not null references auth.users(id),updated_by uuid references auth.users(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index budget_simulator_plans_game on public.budget_simulator_plans(game_id,updated_at desc);
create index budget_simulator_plans_document on public.budget_simulator_plans(document_id);
create index budget_simulator_plans_scenario on public.budget_simulator_plans(scenario_id);
create index budget_simulator_plans_author on public.budget_simulator_plans(created_by);
create index budget_simulator_plans_editor on public.budget_simulator_plans(updated_by);
create index budget_simulator_state_document on public.budget_simulator_state(last_document_id);
create table public.budget_transfer_requests(
 id uuid primary key default gen_random_uuid(),game_id uuid not null references public.games(id) on delete cascade,
 region_code text not null references public.fiscal_region_reference(code),
 kind text not null check(kind in ('grant','subsidy','subvention','budget_credit')),
 amount numeric not null check(amount>0 and amount<=1000000),cofinancing numeric not null default 0 check(cofinancing>=0),
 purpose text not null,section_key text not null,
 status text not null default 'requested' check(status in ('requested','granted','rejected')),
 document_id uuid references public.formal_documents(id) on delete set null,plan_id uuid references public.budget_simulator_plans(id),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),decided_at timestamptz,
 maturity_month integer,repaid_at timestamptz
);
create index budget_transfer_game on public.budget_transfer_requests(game_id,created_at desc);
create index budget_transfer_region on public.budget_transfer_requests(region_code);
create index budget_transfer_author on public.budget_transfer_requests(created_by);
create index budget_transfer_plan on public.budget_transfer_requests(plan_id);
create index budget_transfer_document on public.budget_transfer_requests(document_id);
create table public.budget_finance_contracts(
 id uuid primary key default gen_random_uuid(),game_id uuid not null references public.games(id) on delete cascade,
 plan_id uuid not null references public.budget_simulator_plans(id),source_key text not null,
 principal numeric not null check(principal>=0),annual_rate numeric not null,maturity_month integer not null,
 status text not null default 'active' check(status in ('active','due','paid')),created_at timestamptz not null default now()
);
create index budget_finance_game on public.budget_finance_contracts(game_id,status,maturity_month);
create index budget_finance_plan on public.budget_finance_contracts(plan_id);
create table public.budget_simulator_ledger(
 id bigint generated always as identity primary key,game_id uuid not null references public.games(id) on delete cascade,
 kind text not null,note text not null,amount numeric,source_key text not null,created_at timestamptz not null default now(),
 unique(game_id,source_key)
);
create index budget_simulator_ledger_game on public.budget_simulator_ledger(game_id,created_at desc);
create table private.budget_deferred_risks(
 id uuid primary key default gen_random_uuid(),game_id uuid not null references public.games(id) on delete cascade,
 case_id uuid not null references public.event_cases(id) on delete cascade,source_key text not null,
 due_at timestamptz not null,due_month integer not null,dispatched_at timestamptz,
 unique(game_id,source_key)
);
create index budget_risks_pending on private.budget_deferred_risks(due_at) where dispatched_at is null;
create index budget_risks_case on private.budget_deferred_risks(case_id);
revoke all on private.budget_baseline,private.budget_deferred_risks from public,anon,authenticated;
do $$declare t text;begin
 foreach t in array array['budget_simulator_state','budget_simulator_plans','budget_transfer_requests','budget_finance_contracts','budget_simulator_ledger'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy budget_member_read on public.%I for select to authenticated using(private.is_game_member(game_id))',t);
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then execute format('alter publication supabase_realtime add table public.%I',t);end if;
 end loop;
end$$;

create function private.can_prepare_budget(p_game uuid) returns boolean language sql stable security definer set search_path=public,private,pg_temp as $$
 select auth.uid() is not null and private.is_game_member(p_game) and (private.is_game_teacher(p_game) or
 (exists(select 1 from game_members where game_id=p_game and user_id=auth.uid() and kind='student') and private.role_is_available(p_game,auth.uid()) and
 exists(select 1 from private.formal_user_roles(p_game,auth.uid()) r where r ~ 'правительств|министр')))
$$;
create function private.can_request_budget_transfer(p_game uuid) returns boolean language sql stable security definer set search_path=public,private,pg_temp as $$
 select auth.uid() is not null and private.is_game_member(p_game) and (private.is_game_teacher(p_game) or
 (exists(select 1 from game_members where game_id=p_game and user_id=auth.uid() and kind='student') and private.role_is_available(p_game,auth.uid()) and
 exists(select 1 from private.formal_user_roles(p_game,auth.uid()) r where r ~ 'правительств|министр|губернатор|глава|администрац|регион')))
$$;
create function private.ensure_budget_simulator(p_game uuid) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p game_fiscal_policy%rowtype;b jsonb;a jsonb;begin
 perform private.ensure_fiscal_game(p_game);
 insert into game_fiscal_policy(game_id,federal_expenditure,municipal_expenditure,baseline_economy,baseline_trust)
 select p_game,coalesce(sum(expenditure)*.6,0),coalesce(sum(expenditure)*.25,0),coalesce((select value from state_metrics where game_id=p_game and metric_key='economy'),50),coalesce((select value from state_metrics where game_id=p_game and metric_key='public_trust'),50)
 from game_fiscal_regions where game_id=p_game on conflict(game_id) do nothing;
 select * into p from game_fiscal_policy where game_id=p_game;
 select data into b from private.budget_baseline where year=2026;
 a:=jsonb_build_object('enterprises',greatest(1,(select sum(enterprises*activity_multiplier) from game_fiscal_regions where game_id=p_game)),
 'key_rate',p.key_rate,'fx_rate',p.fx_rate,'oil_price',greatest(.01,p.oil_price),'inflation',p.inflation,
 'economy',coalesce((select value from state_metrics where game_id=p_game and metric_key='economy'),50),'trust',coalesce((select value from state_metrics where game_id=p_game and metric_key='public_trust'),50));
 insert into budget_simulator_state(game_id,anchor,internal_debt,external_debt,reserve_remaining,last_financing)
 values(p_game,a,(b->>'internal_debt_end')::numeric,(b->>'external_debt_end')::numeric,(b->>'reserve_available_model')::numeric,b->'financing') on conflict(game_id) do nothing;
end$$;
create function private.budget_financing_rate(p_key text,p_rate numeric) returns numeric language sql immutable set search_path='' as $$
 select case p_key when 'external' then 7.5 when 'bank_credit' then p_rate+3 when 'ofz_float' then p_rate+.5 when 'ofz_fixed' then p_rate else 0 end
$$;
create function private.validate_budget_draft(p_game uuid,d jsonb) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare b jsonb;k text;v jsonb;field text;lo numeric;hi numeric;req text;begin
 select data into b from private.budget_baseline where year=2026;
 if d is null or jsonb_typeof(d)<>'object' or length(trim(coalesce(d->>'title','')))<5 or length(d->>'title')>200 or length(coalesce(d->>'note',''))>20000 then raise exception 'Укажите название расчета от 5 до 200 символов и допустимое обоснование.';end if;
 if exists(select 1 from jsonb_object_keys(d) k where k not in ('title','note','income_changes','spending_changes','revenue_adjustments','financing','terms','transfer_ids')) then raise exception 'Неизвестное поле бюджетного расчета.';end if;
 foreach field in array array['income_changes','spending_changes','revenue_adjustments','financing','terms'] loop
  if jsonb_typeof(d->field) is distinct from 'object' then raise exception 'Бюджетный расчет содержит неверную структуру: %.',field;end if;
  lo:=case field when 'income_changes' then -80 when 'spending_changes' then -80 when 'revenue_adjustments' then -50000000 when 'financing' then -50000000 else 1 end;
  hi:=case when field in ('income_changes','spending_changes') then 200 when field='terms' then 120 else 50000000 end;
  for k,v in select * from jsonb_each(d->field) loop
   if jsonb_typeof(v)<>'number' or (v#>>'{}')::numeric not between lo and hi then raise exception 'Число в поле % выходит за допустимый диапазон.',field;end if;
   if field in ('income_changes','revenue_adjustments') and not exists(select 1 from jsonb_array_elements(b->'income_lines') l where l->>'key'=k) then raise exception 'Неизвестная группа доходов.';end if;
   if field='spending_changes' and not exists(select 1 from jsonb_array_elements(b->'expense_lines') l where l->>'key'=k) then raise exception 'Неизвестный раздел расходов.';end if;
   if field='financing' and (not b->'financing' ? k or (k<>'other' and (v#>>'{}')::numeric<0)) then raise exception 'Источник финансирования должен быть известным и иметь неотрицательную сумму.';end if;
   if field='terms' and (k not in ('ofz_fixed','ofz_float','bank_credit','external') or trunc((v#>>'{}')::numeric)<>(v#>>'{}')::numeric) then raise exception 'Срок кредита должен быть целым числом месяцев от 1 до 120.';end if;
  end loop;
 end loop;
 if (select count(*) from jsonb_object_keys(d->'financing'))<>7 then raise exception 'Укажите все семь источников финансирования, включая нулевые суммы.';end if;
 if jsonb_typeof(d->'transfer_ids') is distinct from 'array' or jsonb_array_length(d->'transfer_ids')>100 then raise exception 'Неверный список региональных запросов.';end if;
 if (select count(distinct value) from jsonb_array_elements_text(d->'transfer_ids'))<>jsonb_array_length(d->'transfer_ids') then raise exception 'Региональный запрос включен дважды.';end if;
 for req in select jsonb_array_elements_text(d->'transfer_ids') loop
  if not exists(select 1 from budget_transfer_requests where id::text=req and game_id=p_game and status<>'rejected') then raise exception 'Запрос не относится к этой игре или уже отклонен.';end if;
 end loop;
end$$;

create function private.calculate_budget_simulator(p_game uuid,d jsonb) returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare b jsonb;s budget_simulator_state%rowtype;p game_fiscal_policy%rowtype;a jsonb;e numeric;t numeric;fx numeric;activity numeric;cost numeric;oil numeric;firms numeric;vat numeric;profit numeric;
 il jsonb:='[]';el jsonb:='[]';l jsonb;k text;n numeric;driver numeric;tax numeric;rev numeric;exp numeric;annual numeric:=0;interest numeric;transfer_exp numeric;credit numeric;fin numeric:=0;intr numeric:=0;extr numeric;balance numeric;need numeric;uncertainty numeric;
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
  if k in ('ofz_fixed','ofz_float','bank_credit','external') then annual:=annual+n*private.budget_financing_rate(k,p.key_rate)/100;end if;
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

create function public.save_budget_simulator(p_game_id uuid,p_plan_id uuid,p_draft jsonb,p_revision integer) returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare pl budget_simulator_plans%rowtype;c jsonb;sc uuid;pol game_fiscal_policy%rowtype;st budget_simulator_state%rowtype;begin
 if not private.can_prepare_budget(p_game_id) then raise exception 'Сохранение общего проекта доступно преподавателю и бюджетной команде исполнительной власти.';end if;
 perform pg_advisory_xact_lock(hashtextextended('budget:'||p_game_id::text,0));
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
end$$;

create function public.create_budget_transfer_request(p_game_id uuid,p_region text,p_kind text,p_amount numeric,p_cofinancing numeric,p_purpose text,p_section text) returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare id uuid;b jsonb;begin
 if not private.can_request_budget_transfer(p_game_id) then raise exception 'Региональный запрос направляет представитель исполнительной власти или преподаватель.';end if;
 if p_kind is null or p_kind not in ('grant','subsidy','subvention','budget_credit') or p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount not between .01 and 1000000
 or p_cofinancing is null or p_cofinancing::text in ('NaN','Infinity','-Infinity') or p_cofinancing<0 or p_cofinancing>1000000 or (p_kind<>'subsidy' and p_cofinancing<>0) or (p_kind='subsidy' and p_cofinancing=0) then raise exception 'Укажите положительную сумму до 1 000 млрд ₽. Для субсидии необходимо положительное софинансирование.';end if;
 if p_purpose is null or length(trim(p_purpose))<30 or length(p_purpose)>10000 then raise exception 'Опишите цель, правовое основание и измеримый результат запроса: от 30 до 10 000 символов.';end if;
 if not exists(select 1 from fiscal_region_reference where code=p_region) then raise exception 'Выберите регион из карты.';end if;
 select data into b from private.budget_baseline where year=2026;
 if p_section is null or not exists(select 1 from jsonb_array_elements(b->'expense_lines') l where l->>'key'=p_section) or (p_kind='grant' and p_section<>'14') or (p_kind in ('subsidy','subvention') and p_section in ('13','14')) then raise exception 'Дотация относится к разделу 14. Субсидию и субвенцию отнесите к профильной отрасли.';end if;
 perform private.ensure_budget_simulator(p_game_id);
 insert into budget_transfer_requests(game_id,region_code,kind,amount,cofinancing,purpose,section_key,created_by) values(p_game_id,p_region,p_kind,round(p_amount,2),round(p_cofinancing,2),trim(p_purpose),p_section,auth.uid()) returning budget_transfer_requests.id into id;
 insert into budget_simulator_ledger(game_id,kind,note,amount,source_key) values(p_game_id,'request','Поступил региональный запрос: '||(select name from fiscal_region_reference where code=p_region)||' · '||trim(p_purpose),p_amount,'request:'||id);
 return id;
end$$;

create function public.create_budget_simulator_document(p_plan_id uuid) returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare pl budget_simulator_plans%rowtype;c jsonb;body text;l jsonb;req record;doc uuid;begin
 select * into pl from budget_simulator_plans where id=p_plan_id;
 if pl.id is null or not private.can_prepare_budget(pl.game_id) then raise exception 'Нет права формировать проект бюджета этой игры.';end if;
 perform pg_advisory_xact_lock(hashtextextended('budget:'||pl.game_id::text,0));select * into pl from budget_simulator_plans where id=p_plan_id for update;
 if pl.document_id is not null then return pl.document_id;end if;
 c:=private.calculate_budget_simulator(pl.game_id,pl.draft);
 if (c->>'funding_gap')::numeric>1 or (c->>'reserve_remaining')::numeric<0 then raise exception 'Покройте дефицит и выдачу бюджетных кредитов допустимыми источниками. Нельзя использовать резерв сверх остатка.';end if;
 if length(trim(coalesce(pl.draft->>'note','')))<30 then raise exception 'Добавьте пояснительную записку с основанием решений: не менее 30 символов.';end if;
 body:=E'РОССИЙСКАЯ ФЕДЕРАЦИЯ\nПРОЕКТ ФЕДЕРАЛЬНОГО ЗАКОНА\nО федеральном бюджете на 2026 год\n\nСтатья 1. Основные характеристики федерального бюджета\n'||
 'Утвердить доходы '||(c->>'revenue')||' млн рублей, расходы '||(c->>'expenditure')||' млн рублей, '||case when (c->>'balance')::numeric<0 then 'дефицит '||(c->>'deficit') else 'профицит '||(c->>'surplus') end||E' млн рублей.\n'||
 'Расчетный государственный внутренний долг на конец года: '||(c->>'internal_debt')||' млн рублей. Внешний долг в рублевом эквиваленте: '||(c->>'external_debt')||E' млн рублей.\n\nСтатья 2. Распределение доходов\n';
 for l in select jsonb_array_elements(c->'income_lines') loop body:=body||(l->>'label')||': '||(l->>'amount')||E' млн рублей.\n';end loop;
 body:=body||E'Корректировка округления: +200 млн рублей.\n\nСтатья 3. Распределение расходов по разделам\n';
 for l in select jsonb_array_elements(c->'expense_lines') loop body:=body||(l->>'key')||'. '||(l->>'label')||': '||(l->>'amount')||E' млн рублей.\n';end loop;
 body:=body||E'Корректировка округления: −100 млн рублей.\n\nСтатья 4. Источники финансирования дефицита\n'||
 'ОФЗ с постоянным купоном: '||(pl.draft->'financing'->>'ofz_fixed')||' млн рублей; ОФЗ с переменным купоном: '||(pl.draft->'financing'->>'ofz_float')||E' млн рублей.\n'||
 'Кредиты российских кредитных организаций: '||(pl.draft->'financing'->>'bank_credit')||' млн рублей; внешние заимствования: '||(pl.draft->'financing'->>'external')||E' млн рублей.\n'||
 'Резервные средства ФНБ: '||(pl.draft->'financing'->>'reserves')||' млн рублей; приватизация акций: '||(pl.draft->'financing'->>'privatization')||' млн рублей; прочие источники: '||(pl.draft->'financing'->>'other')||E' млн рублей.\n'||
 'Всего источников: '||(c->>'financing')||' млн рублей; потребность с учетом бюджетных кредитов: '||(c->>'funding_need')||E' млн рублей.\n\nСтатья 5. Межбюджетные отношения\n';
 for req in select r.*,f.name from budget_transfer_requests r join fiscal_region_reference f on f.code=r.region_code where r.game_id=pl.game_id and pl.draft->'transfer_ids' ? r.id::text loop
  body:=body||req.name||': '||case req.kind when 'grant' then 'дотация' when 'subsidy' then 'субсидия' when 'subvention' then 'субвенция' else 'бюджетный кредит' end||' '||req.amount||' млн рублей; софинансирование '||req.cofinancing||' млн рублей. '||req.purpose||E'\n';
 end loop;
 body:=body||E'Целевые трансферты включены в профильные разделы, дотации — в раздел 14. Бюджетные кредиты являются возвратным финансированием.\n\nПОЯСНИТЕЛЬНАЯ ЗАПИСКА\n'||(pl.draft->>'note')||E'\n\nИСХОДНЫЕ ДАННЫЕ И ДОПУЩЕНИЯ\nПервоначально утвержденный план 2026 года: Минфин России, «Бюджет для граждан 2026–2028», https://ob.ulminfin.ru/images/brochure/Byudjet_federal/2026f/BDG_2026.pdf. Все суммы — млн рублей. Изменения активности, процентные условия и риски — учебная модель. Налоговые ставки изменяются отдельными НПА.\n\nПолномочия и процедура: БК РФ, статьи 103, 129–133, 192, 199–207; Конституция РФ, статьи 104–107. Подписи и дата фиксируются участниками процедуры в реестре НПА.';
 body:=body||E'\n\nРасчетные приложения закреплены за этим проектом. Для изменения сумм используйте калькулятор вкладки «Бюджет» и сформируйте новую редакцию проекта. Редактирование пояснений в реестре само по себе не меняет числовые приложения.';
 doc:=public.create_formal_document(pl.game_id,13,pl.title,'federal_budget','government','Правительство Российской Федерации',body,null,null,null,'budget',jsonb_build_object('budget_simulator_plan_id',pl.id,'budget_scenario_id',pl.scenario_id,'budget_base_plan_id',(select last_plan_id from budget_simulator_state where game_id=pl.game_id),'budget_year',2026,'unit','million_rubles','budget_snapshot',c,'budget_draft',pl.draft,'revision',1,'educational_draft',true));
 update budget_simulator_plans set status='document',document_id=doc,calculation=c,updated_at=now() where id=pl.id;
 update budget_scenarios set status='final',formal_document_id=doc,updated_at=now() where id=pl.scenario_id;
 insert into budget_simulator_ledger(game_id,kind,note,amount,source_key) values(pl.game_id,'document','Сформирован проект закона; экономические изменения ожидают опубликования.',(c->>'expenditure')::numeric,'document:'||doc);
 return doc;
end$$;

-- Private entry points are callable only through checked public RPCs and database triggers.
revoke all on function private.can_prepare_budget(uuid),private.can_request_budget_transfer(uuid),private.ensure_budget_simulator(uuid),private.budget_financing_rate(text,numeric),private.validate_budget_draft(uuid,jsonb),private.calculate_budget_simulator(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.save_budget_simulator(uuid,uuid,jsonb,integer),public.create_budget_transfer_request(uuid,text,text,numeric,numeric,text,text),public.create_budget_simulator_document(uuid) from public,anon;
grant execute on function public.save_budget_simulator(uuid,uuid,jsonb,integer),public.create_budget_transfer_request(uuid,text,text,numeric,numeric,text,text),public.create_budget_simulator_document(uuid) to authenticated;


create table private.budget_case_templates(case_key text primary key,data jsonb not null);
revoke all on private.budget_case_templates from public,anon,authenticated;
insert into private.budget_case_templates(case_key,data) select c->>'case_key',c from jsonb_array_elements($cases$[
  {
    "case_key": "budget-risk-2026-ofz_fixed",
    "title": "Аукцион, который не собрал план",
    "situation": "В учебном плане предусмотрено 1 000 млн ₽ чистого привлечения через ОФЗ с постоянным купоном. На очередном размещении поступили заявки только на 620 млн ₽; требуемая доходность остальных заявок превышает принятую в проекте оценку. Через неделю нужно профинансировать обязательства перед получателями бюджетных средств. Казначейство сообщает, что бухгалтерская запись о плановом выпуске не создала денег на счете. Команда должна выбрать способ закрытия кассового разрыва, проверить лимит заимствований и затем уточнить расчет обслуживания. Нельзя считать непроданные облигации фактически полученными средствами.",
    "category": "Финансирование бюджета",
    "seriousness": "serious",
    "audience": "group",
    "allowed_roles": [
      "министр финансов",
      "правительств",
      "председатель правительства"
    ],
    "decision_options": [
      "Отразить все 1 000 млн ₽ как уже привлеченные и сохранить график",
      "Отразить 620 млн ₽, пересчитать остаток и подготовить допустимый источник покрытия"
    ],
    "effect_plan": {
      "options": [
        {
          "key": "option_1",
          "news": "Аукцион, который не собрал план — решение требует исправления",
          "trust": -2,
          "lawful": false,
          "description": "План размещения не равен исполнению. По БК РФ, статьям 103 и 110, заимствования осуществляет уполномоченный орган в рамках программы; учет должен отражать фактическое привлечение. Бюджетная команда уточняет денежный план, проверяет лимиты и обосновывает источник недостающей суммы. В игре корректное решение ограничивает дополнительную стоимость размещения; фиктивное исполнение повышает цену исправления.",
          "legal_basis": "План размещения не равен исполнению. По БК РФ, статьям 103 и 110, заимствования осуществляет уполномоченный орган в рамках программы; учет должен отражать фактическое привлечение. Бюджетная команда уточняет денежный план, проверяет лимиты и обосновывает источник недостающей суммы. В игре корректное решение ограничивает дополнительную стоимость размещения; фиктивное исполнение повышает цену исправления. Источник: https://www.consultant.ru/document/cons_doc_LAW_19702/",
          "authorized_roles": [
            "министр финансов",
            "правительств",
            "председатель правительства"
          ],
          "public_interest": "harmful",
          "protects_role_interest": false,
          "budget_effect": {
            "service": 1800
          }
        },
        {
          "key": "option_2",
          "news": "Аукцион, который не собрал план — решение обосновано",
          "trust": 1,
          "lawful": true,
          "description": "План размещения не равен исполнению. По БК РФ, статьям 103 и 110, заимствования осуществляет уполномоченный орган в рамках программы; учет должен отражать фактическое привлечение. Бюджетная команда уточняет денежный план, проверяет лимиты и обосновывает источник недостающей суммы. В игре корректное решение ограничивает дополнительную стоимость размещения; фиктивное исполнение повышает цену исправления.",
          "legal_basis": "План размещения не равен исполнению. По БК РФ, статьям 103 и 110, заимствования осуществляет уполномоченный орган в рамках программы; учет должен отражать фактическое привлечение. Бюджетная команда уточняет денежный план, проверяет лимиты и обосновывает источник недостающей суммы. В игре корректное решение ограничивает дополнительную стоимость размещения; фиктивное исполнение повышает цену исправления. Источник: https://www.consultant.ru/document/cons_doc_LAW_19702/",
          "authorized_roles": [
            "министр финансов",
            "правительств",
            "председатель правительства"
          ],
          "public_interest": "protected",
          "protects_role_interest": false,
          "budget_effect": {
            "service": 120
          }
        }
      ]
    },
    "source_url": "https://www.consultant.ru/document/cons_doc_LAW_19702/",
    "source_note": "Авторская учебная ситуация, не сообщение о реальном происшествии. Нормы проверены 02.10.2026; денежные эффекты — параметры игры.",
    "verified": true,
    "status": "draft",
    "comic_scene": {
      "format": "budget-dossier",
      "alt": "Финансовое досье: Аукцион, который не собрал план",
      "case_key": "budget-risk-2026-ofz_fixed",
      "media_label": "Бюджетный обозреватель",
      "version": 1
    }
  },
  {
    "case_key": "budget-risk-2026-ofz_float",
    "title": "Купон с чужой надбавкой",
    "situation": "В принятом бюджете группа использовала ОФЗ с переменным купоном. В условиях учебного выпуска ставка равна ключевой ставке плюс 0,5 процентного пункта. После изменения ставки расчетный агент прислал ведомость, в которой к купону добавлена еще и собственная банковская комиссия в 2 процентных пункта, хотя в условиях выпуска такой надбавки нет. Платеж должен пройти через три дня; ведомость и условия займа доступны финансовой команде. Нужно проверить сумму и принять решение о платеже, сохранив исполнение обязательств по установленной формуле, а не произвольно уменьшив или увеличив купон.",
    "category": "Финансирование бюджета",
    "seriousness": "serious",
    "audience": "group",
    "allowed_roles": [
      "министр финансов",
      "правительств",
      "председатель правительства"
    ],
    "decision_options": [
      "Сверить условия выпуска, исключить неподтвержденную надбавку и оплатить договорный купон",
      "Заплатить ведомость целиком: расчетный агент вправе менять условия"
    ],
    "effect_plan": {
      "options": [
        {
          "key": "option_1",
          "news": "Купон с чужой надбавкой — решение обосновано",
          "trust": 1,
          "lawful": true,
          "description": "Размер обязательства определяется условиями эмиссии и формулой купона, а не односторонней ведомостью агента. БК РФ, статьи 103 и 110, регулирует полномочия и программу заимствований; условия государственного займа фиксируются документами выпуска. Следовало сверить формулу, потребовать исправленную ведомость и исполнить подтвержденный платеж. Изменение ключевой ставки само по себе учитывается симулятором, лишняя надбавка — отдельная ошибка.",
          "legal_basis": "Размер обязательства определяется условиями эмиссии и формулой купона, а не односторонней ведомостью агента. БК РФ, статьи 103 и 110, регулирует полномочия и программу заимствований; условия государственного займа фиксируются документами выпуска. Следовало сверить формулу, потребовать исправленную ведомость и исполнить подтвержденный платеж. Изменение ключевой ставки само по себе учитывается симулятором, лишняя надбавка — отдельная ошибка. Источник: https://www.consultant.ru/document/cons_doc_LAW_19702/",
          "authorized_roles": [
            "министр финансов",
            "правительств",
            "председатель правительства"
          ],
          "public_interest": "protected",
          "protects_role_interest": false,
          "budget_effect": {
            "service": 0
          }
        },
        {
          "key": "option_2",
          "news": "Купон с чужой надбавкой — решение требует исправления",
          "trust": -2,
          "lawful": false,
          "description": "Размер обязательства определяется условиями эмиссии и формулой купона, а не односторонней ведомостью агента. БК РФ, статьи 103 и 110, регулирует полномочия и программу заимствований; условия государственного займа фиксируются документами выпуска. Следовало сверить формулу, потребовать исправленную ведомость и исполнить подтвержденный платеж. Изменение ключевой ставки само по себе учитывается симулятором, лишняя надбавка — отдельная ошибка.",
          "legal_basis": "Размер обязательства определяется условиями эмиссии и формулой купона, а не односторонней ведомостью агента. БК РФ, статьи 103 и 110, регулирует полномочия и программу заимствований; условия государственного займа фиксируются документами выпуска. Следовало сверить формулу, потребовать исправленную ведомость и исполнить подтвержденный платеж. Изменение ключевой ставки само по себе учитывается симулятором, лишняя надбавка — отдельная ошибка. Источник: https://www.consultant.ru/document/cons_doc_LAW_19702/",
          "authorized_roles": [
            "министр финансов",
            "правительств",
            "председатель правительства"
          ],
          "public_interest": "harmful",
          "protects_role_interest": false,
          "budget_effect": {
            "service": 4200
          }
        }
      ]
    },
    "source_url": "https://www.consultant.ru/document/cons_doc_LAW_19702/",
    "source_note": "Авторская учебная ситуация, не сообщение о реальном происшествии. Нормы проверены 02.10.2026; денежные эффекты — параметры игры.",
    "verified": true,
    "status": "draft",
    "comic_scene": {
      "format": "budget-dossier",
      "alt": "Финансовое досье: Купон с чужой надбавкой",
      "case_key": "budget-risk-2026-ofz_float",
      "media_label": "Бюджетный обозреватель",
      "version": 1
    }
  },
  {
    "case_key": "budget-risk-2026-bank_credit",
    "title": "Кредитор лишился лицензии",
    "situation": "Бюджетная команда выбрала кредит учебного банка «Казначейский партнер». После перечисления кредитных средств у банка отозвана лицензия; заемщик получил уведомление временной администрации. Остаток основного долга в учебном договоре составляет 1 200 млн ₽, очередной процентный платеж наступает через пять дней. В чате предлагают списать кредит, поскольку прежние платежные реквизиты перестали работать. Другой участник прислал ссылку на реквизиты, которые размещены только в неофициальном сообщении. Нужно определить, сохраняется ли обязательство и по каким подтвержденным реквизитам исполнять платеж.",
    "category": "Финансирование бюджета",
    "seriousness": "serious",
    "audience": "group",
    "allowed_roles": [
      "министр финансов",
      "правительств",
      "председатель правительства"
    ],
    "decision_options": [
      "Списать долг и остановить платежи до появления нового банка",
      "Сохранить долг, проверить официальные реквизиты и продолжить исполнение договора"
    ],
    "effect_plan": {
      "options": [
        {
          "key": "option_1",
          "news": "Кредитор лишился лицензии — решение требует исправления",
          "trust": -2,
          "lawful": false,
          "description": "Отзыв лицензии не освобождает заемщика от возврата кредита и уплаты процентов. Банк России разъясняет порядок платежей временной администрации и ликвидатору; реквизиты проверяются по официальным источникам. Финансовый орган сохраняет долг в учете и документирует исполнение. В симуляторе банкротство кредитора никогда автоматически не уменьшает государственный долг; ошибка создает дополнительные расходы урегулирования.",
          "legal_basis": "Отзыв лицензии не освобождает заемщика от возврата кредита и уплаты процентов. Банк России разъясняет порядок платежей временной администрации и ликвидатору; реквизиты проверяются по официальным источникам. Финансовый орган сохраняет долг в учете и документирует исполнение. В симуляторе банкротство кредитора никогда автоматически не уменьшает государственный долг; ошибка создает дополнительные расходы урегулирования. Источник: https://www.cbr.ru/faq/bank_s/otzyv_licenzii/",
          "authorized_roles": [
            "министр финансов",
            "правительств",
            "председатель правительства"
          ],
          "public_interest": "harmful",
          "protects_role_interest": false,
          "budget_effect": {
            "service": 1200
          }
        },
        {
          "key": "option_2",
          "news": "Кредитор лишился лицензии — решение обосновано",
          "trust": 1,
          "lawful": true,
          "description": "Отзыв лицензии не освобождает заемщика от возврата кредита и уплаты процентов. Банк России разъясняет порядок платежей временной администрации и ликвидатору; реквизиты проверяются по официальным источникам. Финансовый орган сохраняет долг в учете и документирует исполнение. В симуляторе банкротство кредитора никогда автоматически не уменьшает государственный долг; ошибка создает дополнительные расходы урегулирования.",
          "legal_basis": "Отзыв лицензии не освобождает заемщика от возврата кредита и уплаты процентов. Банк России разъясняет порядок платежей временной администрации и ликвидатору; реквизиты проверяются по официальным источникам. Финансовый орган сохраняет долг в учете и документирует исполнение. В симуляторе банкротство кредитора никогда автоматически не уменьшает государственный долг; ошибка создает дополнительные расходы урегулирования. Источник: https://www.cbr.ru/faq/bank_s/otzyv_licenzii/",
          "authorized_roles": [
            "министр финансов",
            "правительств",
            "председатель правительства"
          ],
          "public_interest": "protected",
          "protects_role_interest": false,
          "budget_effect": {
            "service": 25
          }
        }
      ]
    },
    "source_url": "https://www.cbr.ru/faq/bank_s/otzyv_licenzii/",
    "source_note": "Авторская учебная ситуация, не сообщение о реальном происшествии. Нормы проверены 02.10.2026; денежные эффекты — параметры игры.",
    "verified": true,
    "status": "draft",
    "comic_scene": {
      "format": "budget-dossier",
      "alt": "Финансовое досье: Кредитор лишился лицензии",
      "case_key": "budget-risk-2026-bank_credit",
      "media_label": "Бюджетный обозреватель",
      "version": 1
    }
  },
  {
    "case_key": "budget-risk-2026-external",
    "title": "Валютный платеж в двух валютах",
    "situation": "После внешнего заимствования иностранный кредитор направил график очередного платежа. Обязательство выражено в иностранной валюте, а бюджетные ассигнования и расчеты группы — в рублях. В учебном сценарии рублевый курс валюты долга увеличился на 15 %. Платежный агент сообщает о задержках одного из каналов; договор допускает альтернативного агента после согласования. Часть команды предлагает сохранить старый рублевый эквивалент, поскольку номинал кредита не менялся. Нужно различить валютный номинал, рублевую переоценку и порядок исполнения через допустимого агента.",
    "category": "Финансирование бюджета",
    "seriousness": "serious",
    "audience": "group",
    "allowed_roles": [
      "министр финансов",
      "правительств",
      "председатель правительства"
    ],
    "decision_options": [
      "Пересчитать рублевый эквивалент и согласовать договорный платежный канал",
      "Использовать прежний курс и отправить деньги любому посреднику"
    ],
    "effect_plan": {
      "options": [
        {
          "key": "option_1",
          "news": "Валютный платеж в двух валютах — решение обосновано",
          "trust": 1,
          "lawful": true,
          "description": "Неизменность валютного номинала не исключает рублевой переоценки. По БК РФ, статьям 6, 98 и 103, внешний долг и внешние заимствования учитываются с учетом валюты обязательства. Команда должна обновить рублевую потребность и соблюдать договорный порядок платежа. В обоих исходах курс сценария меняется на 15 %, но неподтвержденный посредник повышает расходы урегулирования.",
          "legal_basis": "Неизменность валютного номинала не исключает рублевой переоценки. По БК РФ, статьям 6, 98 и 103, внешний долг и внешние заимствования учитываются с учетом валюты обязательства. Команда должна обновить рублевую потребность и соблюдать договорный порядок платежа. В обоих исходах курс сценария меняется на 15 %, но неподтвержденный посредник повышает расходы урегулирования. Источник: https://www.consultant.ru/document/cons_doc_LAW_19702/",
          "authorized_roles": [
            "министр финансов",
            "правительств",
            "председатель правительства"
          ],
          "public_interest": "protected",
          "protects_role_interest": false,
          "budget_effect": {
            "fx_change": 0.15,
            "service": 200
          }
        },
        {
          "key": "option_2",
          "news": "Валютный платеж в двух валютах — решение требует исправления",
          "trust": -2,
          "lawful": false,
          "description": "Неизменность валютного номинала не исключает рублевой переоценки. По БК РФ, статьям 6, 98 и 103, внешний долг и внешние заимствования учитываются с учетом валюты обязательства. Команда должна обновить рублевую потребность и соблюдать договорный порядок платежа. В обоих исходах курс сценария меняется на 15 %, но неподтвержденный посредник повышает расходы урегулирования.",
          "legal_basis": "Неизменность валютного номинала не исключает рублевой переоценки. По БК РФ, статьям 6, 98 и 103, внешний долг и внешние заимствования учитываются с учетом валюты обязательства. Команда должна обновить рублевую потребность и соблюдать договорный порядок платежа. В обоих исходах курс сценария меняется на 15 %, но неподтвержденный посредник повышает расходы урегулирования. Источник: https://www.consultant.ru/document/cons_doc_LAW_19702/",
          "authorized_roles": [
            "министр финансов",
            "правительств",
            "председатель правительства"
          ],
          "public_interest": "harmful",
          "protects_role_interest": false,
          "budget_effect": {
            "fx_change": 0.15,
            "service": 2000
          }
        }
      ]
    },
    "source_url": "https://www.consultant.ru/document/cons_doc_LAW_19702/",
    "source_note": "Авторская учебная ситуация, не сообщение о реальном происшествии. Нормы проверены 02.10.2026; денежные эффекты — параметры игры.",
    "verified": true,
    "status": "draft",
    "comic_scene": {
      "format": "budget-dossier",
      "alt": "Финансовое досье: Валютный платеж в двух валютах",
      "case_key": "budget-risk-2026-external",
      "media_label": "Бюджетный обозреватель",
      "version": 1
    }
  },
  {
    "case_key": "budget-risk-2026-reserves",
    "title": "Резерв, который нельзя обналичить сегодня",
    "situation": "В проекте предусмотрено использование резервных средств ФНБ. После опубликования бюджета поступила ведомость активов: часть выбранного резерва вложена в долгосрочные инструменты и не может быть обращена в деньги к сроку ближайших платежей. Учебная оценка недоступной части составляет 10 000 млн ₽. Общая стоимость фонда в отчетности значительно выше доступного денежного остатка, поэтому участник предлагает просто повторить первоначальный расчет. Нужно разделить общую стоимость активов и доступное финансирование, сохранить принятые обязательства и выбрать законный способ устранения кассового разрыва.",
    "category": "Финансирование бюджета",
    "seriousness": "serious",
    "audience": "group",
    "allowed_roles": [
      "министр финансов",
      "правительств",
      "председатель правительства"
    ],
    "decision_options": [
      "Оставить доступный остаток прежним: общая стоимость фонда достаточна",
      "Уточнить ликвидный остаток и обосновать замену источника финансирования"
    ],
    "effect_plan": {
      "options": [
        {
          "key": "option_1",
          "news": "Резерв, который нельзя обналичить сегодня — решение требует исправления",
          "trust": -2,
          "lawful": false,
          "description": "ФНБ не тождественен денежному остатку. БК РФ, статьи 96.10–96.12, устанавливает назначение и управление средствами фонда; использование требует предусмотренного основания и учета доступности активов. Следовало уточнить ликвидный резерв и подготовить допустимый источник вместо недоступной части. В обоих исходах доступность уменьшается на учебные 10 000 млн ₽; ошибка учета создает дополнительные расходы.",
          "legal_basis": "ФНБ не тождественен денежному остатку. БК РФ, статьи 96.10–96.12, устанавливает назначение и управление средствами фонда; использование требует предусмотренного основания и учета доступности активов. Следовало уточнить ликвидный резерв и подготовить допустимый источник вместо недоступной части. В обоих исходах доступность уменьшается на учебные 10 000 млн ₽; ошибка учета создает дополнительные расходы. Источник: https://www.consultant.ru/document/cons_doc_LAW_19702/",
          "authorized_roles": [
            "министр финансов",
            "правительств",
            "председатель правительства"
          ],
          "public_interest": "harmful",
          "protects_role_interest": false,
          "budget_effect": {
            "reserve": -10000,
            "service": 900
          }
        },
        {
          "key": "option_2",
          "news": "Резерв, который нельзя обналичить сегодня — решение обосновано",
          "trust": 1,
          "lawful": true,
          "description": "ФНБ не тождественен денежному остатку. БК РФ, статьи 96.10–96.12, устанавливает назначение и управление средствами фонда; использование требует предусмотренного основания и учета доступности активов. Следовало уточнить ликвидный резерв и подготовить допустимый источник вместо недоступной части. В обоих исходах доступность уменьшается на учебные 10 000 млн ₽; ошибка учета создает дополнительные расходы.",
          "legal_basis": "ФНБ не тождественен денежному остатку. БК РФ, статьи 96.10–96.12, устанавливает назначение и управление средствами фонда; использование требует предусмотренного основания и учета доступности активов. Следовало уточнить ликвидный резерв и подготовить допустимый источник вместо недоступной части. В обоих исходах доступность уменьшается на учебные 10 000 млн ₽; ошибка учета создает дополнительные расходы. Источник: https://www.consultant.ru/document/cons_doc_LAW_19702/",
          "authorized_roles": [
            "министр финансов",
            "правительств",
            "председатель правительства"
          ],
          "public_interest": "protected",
          "protects_role_interest": false,
          "budget_effect": {
            "reserve": -10000,
            "service": 90
          }
        }
      ]
    },
    "source_url": "https://www.consultant.ru/document/cons_doc_LAW_19702/",
    "source_note": "Авторская учебная ситуация, не сообщение о реальном происшествии. Нормы проверены 02.10.2026; денежные эффекты — параметры игры.",
    "verified": true,
    "status": "draft",
    "comic_scene": {
      "format": "budget-dossier",
      "alt": "Финансовое досье: Резерв, который нельзя обналичить сегодня",
      "case_key": "budget-risk-2026-reserves",
      "media_label": "Бюджетный обозреватель",
      "version": 1
    }
  },
  {
    "case_key": "budget-risk-2026-privatization",
    "title": "Проданная доля и исчезнувший дивиденд",
    "situation": "Группа покрыла часть дефицита продажей пакета акций государственного общества. Сделка завершена и поступления учтены как источник финансирования. Через месяц общество утвердило дивиденды; прогноз неналоговых доходов бюджета все еще содержит выплату на уже проданный пакет в размере 500 млн ₽. В финансовом расчете возникло двойное ожидание: и цена пакета, и дивиденды прежнего собственника. Команде нужно уточнить поступления, не объявляя продажу налоговым доходом и не начисляя бюджету дивиденды за долю, которой государство больше не владеет.",
    "category": "Финансирование бюджета",
    "seriousness": "serious",
    "audience": "group",
    "allowed_roles": [
      "министр финансов",
      "правительств",
      "председатель правительства"
    ],
    "decision_options": [
      "Исключить дивиденды проданного пакета из прогноза и уточнить баланс",
      "Сохранить дивиденды: продажа акций не влияет на доходы имущества"
    ],
    "effect_plan": {
      "options": [
        {
          "key": "option_1",
          "news": "Проданная доля и исчезнувший дивиденд — решение обосновано",
          "trust": 1,
          "lawful": true,
          "description": "Поступления от продажи акций и дивиденды относятся к разным бюджетным потокам. БК РФ, статьи 41–42 и 94, различает доходы от имущества и источники финансирования. После перехода права на акции нельзя рассчитывать дивиденды на проданную долю как поступления прежнего собственника. Правильное решение уменьшает прогноз на 500 млн ₽; ошибочное ожидание в игре вызывает дополнительные потери исполнения.",
          "legal_basis": "Поступления от продажи акций и дивиденды относятся к разным бюджетным потокам. БК РФ, статьи 41–42 и 94, различает доходы от имущества и источники финансирования. После перехода права на акции нельзя рассчитывать дивиденды на проданную долю как поступления прежнего собственника. Правильное решение уменьшает прогноз на 500 млн ₽; ошибочное ожидание в игре вызывает дополнительные потери исполнения. Источник: https://www.consultant.ru/document/cons_doc_LAW_19702/",
          "authorized_roles": [
            "министр финансов",
            "правительств",
            "председатель правительства"
          ],
          "public_interest": "protected",
          "protects_role_interest": false,
          "budget_effect": {
            "revenue": -500
          }
        },
        {
          "key": "option_2",
          "news": "Проданная доля и исчезнувший дивиденд — решение требует исправления",
          "trust": -2,
          "lawful": false,
          "description": "Поступления от продажи акций и дивиденды относятся к разным бюджетным потокам. БК РФ, статьи 41–42 и 94, различает доходы от имущества и источники финансирования. После перехода права на акции нельзя рассчитывать дивиденды на проданную долю как поступления прежнего собственника. Правильное решение уменьшает прогноз на 500 млн ₽; ошибочное ожидание в игре вызывает дополнительные потери исполнения.",
          "legal_basis": "Поступления от продажи акций и дивиденды относятся к разным бюджетным потокам. БК РФ, статьи 41–42 и 94, различает доходы от имущества и источники финансирования. После перехода права на акции нельзя рассчитывать дивиденды на проданную долю как поступления прежнего собственника. Правильное решение уменьшает прогноз на 500 млн ₽; ошибочное ожидание в игре вызывает дополнительные потери исполнения. Источник: https://www.consultant.ru/document/cons_doc_LAW_19702/",
          "authorized_roles": [
            "министр финансов",
            "правительств",
            "председатель правительства"
          ],
          "public_interest": "harmful",
          "protects_role_interest": false,
          "budget_effect": {
            "revenue": -1000
          }
        }
      ]
    },
    "source_url": "https://www.consultant.ru/document/cons_doc_LAW_19702/",
    "source_note": "Авторская учебная ситуация, не сообщение о реальном происшествии. Нормы проверены 02.10.2026; денежные эффекты — параметры игры.",
    "verified": true,
    "status": "draft",
    "comic_scene": {
      "format": "budget-dossier",
      "alt": "Финансовое досье: Проданная доля и исчезнувший дивиденд",
      "case_key": "budget-risk-2026-privatization",
      "media_label": "Бюджетный обозреватель",
      "version": 1
    }
  },
  {
    "case_key": "budget-region-2026-54-cluster",
    "title": "Инфраструктура кластера или деньги его резиденту",
    "situation": "Новосибирская область готовит запрос на федеральную субсидию 1 800 млн ₽ для инженерной инфраструктуры промышленного кластера. Региональные ассигнования составляют 400 млн ₽. В проекте соглашения указаны публичные сети и число подключенных предприятий, но в приложенном платежном поручении получателем всей межбюджетной суммы назван один коммерческий резидент. Резидент предлагает сам выбрать остальные площадки без конкурсных правил. До запуска ожидаются 18 новых предприятий; без подключения площадки останутся пустыми. Участникам нужно определить, кто получает межбюджетный трансферт и какое отдельное основание требуется для поддержки коммерческой организации.",
    "category": "Региональные финансы",
    "seriousness": "serious",
    "audience": "group",
    "allowed_roles": [
      "министр финансов",
      "правительств",
      "председатель правительства",
      "губернатор",
      "глава региона",
      "министр экономического развития"
    ],
    "decision_options": [
      "Зачислить субсидию бюджету субъекта, согласовать результаты и отдельно оформить поддержку организаций",
      "Перечислить весь межбюджетный трансферт резиденту по его письму"
    ],
    "effect_plan": {
      "options": [
        {
          "key": "option_1",
          "news": "Инфраструктура кластера или деньги его резиденту — решение обосновано",
          "trust": 1,
          "lawful": true,
          "description": "Субсидия по статье 132 БК РФ предоставляется бюджету субъекта для софинансирования расходного обязательства. Поддержка юридического лица требует собственного основания и условий, в частности по статье 78 БК РФ, и не заменяет межбюджетное соглашение. Региональная исполнительная власть готовит запрос и бюджетные основания; федеральная бюджетная команда обеспечивает правовую форму и распределение. Успешное подключение в учебной модели увеличивает число предприятий, обход процедуры срывает ввод.",
          "legal_basis": "Субсидия по статье 132 БК РФ предоставляется бюджету субъекта для софинансирования расходного обязательства. Поддержка юридического лица требует собственного основания и условий, в частности по статье 78 БК РФ, и не заменяет межбюджетное соглашение. Региональная исполнительная власть готовит запрос и бюджетные основания; федеральная бюджетная команда обеспечивает правовую форму и распределение. Успешное подключение в учебной модели увеличивает число предприятий, обход процедуры срывает ввод. Источник: https://www.consultant.ru/document/cons_doc_LAW_19702/",
          "authorized_roles": [
            "министр финансов",
            "правительств",
            "председатель правительства",
            "губернатор",
            "глава региона",
            "министр экономического развития"
          ],
          "public_interest": "protected",
          "protects_role_interest": false,
          "fiscal_effect": {
            "enterprises": 18,
            "activity": 0.008,
            "expenditure": 400
          }
        },
        {
          "key": "option_2",
          "news": "Инфраструктура кластера или деньги его резиденту — решение требует исправления",
          "trust": -2,
          "lawful": false,
          "description": "Субсидия по статье 132 БК РФ предоставляется бюджету субъекта для софинансирования расходного обязательства. Поддержка юридического лица требует собственного основания и условий, в частности по статье 78 БК РФ, и не заменяет межбюджетное соглашение. Региональная исполнительная власть готовит запрос и бюджетные основания; федеральная бюджетная команда обеспечивает правовую форму и распределение. Успешное подключение в учебной модели увеличивает число предприятий, обход процедуры срывает ввод.",
          "legal_basis": "Субсидия по статье 132 БК РФ предоставляется бюджету субъекта для софинансирования расходного обязательства. Поддержка юридического лица требует собственного основания и условий, в частности по статье 78 БК РФ, и не заменяет межбюджетное соглашение. Региональная исполнительная власть готовит запрос и бюджетные основания; федеральная бюджетная команда обеспечивает правовую форму и распределение. Успешное подключение в учебной модели увеличивает число предприятий, обход процедуры срывает ввод. Источник: https://www.consultant.ru/document/cons_doc_LAW_19702/",
          "authorized_roles": [
            "министр финансов",
            "правительств",
            "председатель правительства",
            "губернатор",
            "глава региона",
            "министр экономического развития"
          ],
          "public_interest": "harmful",
          "protects_role_interest": false,
          "fiscal_effect": {
            "enterprises": -5,
            "activity": -0.012,
            "expenditure": 90
          }
        }
      ]
    },
    "source_url": "https://www.consultant.ru/document/cons_doc_LAW_19702/",
    "source_note": "Авторская учебная ситуация, не сообщение о реальном происшествии. Нормы проверены 02.10.2026; денежные эффекты — параметры игры.",
    "verified": true,
    "status": "ready",
    "comic_scene": {
      "format": "budget-dossier",
      "alt": "Финансовое досье: Инфраструктура кластера или деньги его резиденту",
      "case_key": "budget-region-2026-54-cluster",
      "media_label": "Бюджетный обозреватель",
      "version": 1,
      "region_code": "54",
      "region_name": "Новосибирская область"
    }
  },
  {
    "case_key": "budget-region-2026-05-equalization",
    "title": "Дотация по временно раздутой базе",
    "situation": "Республика Дагестан сверяет исходные данные для распределения дотаций на выравнивание. В справке налогового потенциала разовое поступление от крупной сделки представлено как ежегодный устойчивый доход, а расходные факторы взяты из прошлогодней таблицы. По этой версии потребность в помощи ниже на 900 млн ₽; после сделки повторных поступлений не ожидается. Муниципалитеты сообщают о росте числа получателей услуг. Команда должна выбрать порядок проверки данных и расчет распределения, не подменяя установленную методику простым сравнением фактических налоговых сборов за один месяц.",
    "category": "Региональные финансы",
    "seriousness": "serious",
    "audience": "group",
    "allowed_roles": [
      "министр финансов",
      "правительств",
      "председатель правительства",
      "губернатор",
      "глава региона",
      "министр экономического развития"
    ],
    "decision_options": [
      "Оставить разовый доход как постоянный и запросить произвольную компенсацию",
      "Сверить расчетный налоговый потенциал и расходные факторы по утвержденной методике"
    ],
    "effect_plan": {
      "options": [
        {
          "key": "option_1",
          "news": "Дотация по временно раздутой базе — решение требует исправления",
          "trust": -2,
          "lawful": false,
          "description": "Выравнивание основывается на расчетной бюджетной обеспеченности и установленной методике, а не на произвольном показателе одного поступления. БК РФ, статья 131, предусматривает расчет налогового потенциала и учет факторов стоимости бюджетных услуг. Следовало документально сверить исходные данные и направить обоснованные замечания. Учебный исход отражает устойчивость финансирования услуг и доверие к расчету; дотация не превращается в субсидию на конкретный объект.",
          "legal_basis": "Выравнивание основывается на расчетной бюджетной обеспеченности и установленной методике, а не на произвольном показателе одного поступления. БК РФ, статья 131, предусматривает расчет налогового потенциала и учет факторов стоимости бюджетных услуг. Следовало документально сверить исходные данные и направить обоснованные замечания. Учебный исход отражает устойчивость финансирования услуг и доверие к расчету; дотация не превращается в субсидию на конкретный объект. Источник: https://www.consultant.ru/document/cons_doc_LAW_19702/",
          "authorized_roles": [
            "министр финансов",
            "правительств",
            "председатель правительства",
            "губернатор",
            "глава региона",
            "министр экономического развития"
          ],
          "public_interest": "harmful",
          "protects_role_interest": false,
          "fiscal_effect": {
            "activity": -0.006,
            "expenditure": 70
          }
        },
        {
          "key": "option_2",
          "news": "Дотация по временно раздутой базе — решение обосновано",
          "trust": 1,
          "lawful": true,
          "description": "Выравнивание основывается на расчетной бюджетной обеспеченности и установленной методике, а не на произвольном показателе одного поступления. БК РФ, статья 131, предусматривает расчет налогового потенциала и учет факторов стоимости бюджетных услуг. Следовало документально сверить исходные данные и направить обоснованные замечания. Учебный исход отражает устойчивость финансирования услуг и доверие к расчету; дотация не превращается в субсидию на конкретный объект.",
          "legal_basis": "Выравнивание основывается на расчетной бюджетной обеспеченности и установленной методике, а не на произвольном показателе одного поступления. БК РФ, статья 131, предусматривает расчет налогового потенциала и учет факторов стоимости бюджетных услуг. Следовало документально сверить исходные данные и направить обоснованные замечания. Учебный исход отражает устойчивость финансирования услуг и доверие к расчету; дотация не превращается в субсидию на конкретный объект. Источник: https://www.consultant.ru/document/cons_doc_LAW_19702/",
          "authorized_roles": [
            "министр финансов",
            "правительств",
            "председатель правительства",
            "губернатор",
            "глава региона",
            "министр экономического развития"
          ],
          "public_interest": "protected",
          "protects_role_interest": false,
          "fiscal_effect": {
            "activity": 0.005,
            "cost": -0.003
          }
        }
      ]
    },
    "source_url": "https://www.consultant.ru/document/cons_doc_LAW_19702/",
    "source_note": "Авторская учебная ситуация, не сообщение о реальном происшествии. Нормы проверены 02.10.2026; денежные эффекты — параметры игры.",
    "verified": true,
    "status": "ready",
    "comic_scene": {
      "format": "budget-dossier",
      "alt": "Финансовое досье: Дотация по временно раздутой базе",
      "case_key": "budget-region-2026-05-equalization",
      "media_label": "Бюджетный обозреватель",
      "version": 1,
      "region_code": "05",
      "region_name": "Республика Дагестан"
    }
  },
  {
    "case_key": "budget-region-2026-27-delegated",
    "title": "Две ведомости одного переданного полномочия",
    "situation": "Хабаровский край получил проект расчета субвенции на исполнение переданного федерального полномочия. В одном муниципальном реестре 240 получателей услуги повторно включены в две категории; во втором не учтены 60 новых обращений. Методика предусматривает единый норматив затрат на получателя и сверку исходных сведений. Исполнительный орган предлагает сначала получить всю завышенную сумму, а таблицу исправить после перечисления. Сотрудники муниципалитетов предупреждают, что итоговый отчет невозможно свести. Нужно выбрать действие при сверке, разграничив число обращений и число получателей, и обеспечить исполнение переданного полномочия.",
    "category": "Региональные финансы",
    "seriousness": "serious",
    "audience": "group",
    "allowed_roles": [
      "министр финансов",
      "правительств",
      "председатель правительства",
      "губернатор",
      "глава региона",
      "министр экономического развития"
    ],
    "decision_options": [
      "Провести сверку реестров до распределения и обосновать исправленные данные",
      "Подтвердить обе ведомости, а разницу оставить региону на иные услуги"
    ],
    "effect_plan": {
      "options": [
        {
          "key": "option_1",
          "news": "Две ведомости одного переданного полномочия — решение обосновано",
          "trust": 1,
          "lawful": true,
          "description": "Субвенция обеспечивает переданное полномочие и распределяется по установленной методике. Статья 133 БК РФ предусматривает направление и сверку исходных данных; свободно перенести завышенную сумму на иные задачи нельзя. Следовало проверить повторения, подтвердить единицы расчета и передать исправленный реестр уполномоченному распорядителю. Правильное решение повышает качество учета и уменьшает стоимость исправления в учебном бюджете.",
          "legal_basis": "Субвенция обеспечивает переданное полномочие и распределяется по установленной методике. Статья 133 БК РФ предусматривает направление и сверку исходных данных; свободно перенести завышенную сумму на иные задачи нельзя. Следовало проверить повторения, подтвердить единицы расчета и передать исправленный реестр уполномоченному распорядителю. Правильное решение повышает качество учета и уменьшает стоимость исправления в учебном бюджете. Источник: https://www.consultant.ru/document/cons_doc_LAW_19702/",
          "authorized_roles": [
            "министр финансов",
            "правительств",
            "председатель правительства",
            "губернатор",
            "глава региона",
            "министр экономического развития"
          ],
          "public_interest": "protected",
          "protects_role_interest": false,
          "fiscal_effect": {
            "cost": -0.004,
            "activity": 0.003
          }
        },
        {
          "key": "option_2",
          "news": "Две ведомости одного переданного полномочия — решение требует исправления",
          "trust": -2,
          "lawful": false,
          "description": "Субвенция обеспечивает переданное полномочие и распределяется по установленной методике. Статья 133 БК РФ предусматривает направление и сверку исходных данных; свободно перенести завышенную сумму на иные задачи нельзя. Следовало проверить повторения, подтвердить единицы расчета и передать исправленный реестр уполномоченному распорядителю. Правильное решение повышает качество учета и уменьшает стоимость исправления в учебном бюджете.",
          "legal_basis": "Субвенция обеспечивает переданное полномочие и распределяется по установленной методике. Статья 133 БК РФ предусматривает направление и сверку исходных данных; свободно перенести завышенную сумму на иные задачи нельзя. Следовало проверить повторения, подтвердить единицы расчета и передать исправленный реестр уполномоченному распорядителю. Правильное решение повышает качество учета и уменьшает стоимость исправления в учебном бюджете. Источник: https://www.consultant.ru/document/cons_doc_LAW_19702/",
          "authorized_roles": [
            "министр финансов",
            "правительств",
            "председатель правительства",
            "губернатор",
            "глава региона",
            "министр экономического развития"
          ],
          "public_interest": "harmful",
          "protects_role_interest": false,
          "fiscal_effect": {
            "expenditure": 85,
            "cost": 0.006
          }
        }
      ]
    },
    "source_url": "https://www.consultant.ru/document/cons_doc_LAW_19702/",
    "source_note": "Авторская учебная ситуация, не сообщение о реальном происшествии. Нормы проверены 02.10.2026; денежные эффекты — параметры игры.",
    "verified": true,
    "status": "ready",
    "comic_scene": {
      "format": "budget-dossier",
      "alt": "Финансовое досье: Две ведомости одного переданного полномочия",
      "case_key": "budget-region-2026-27-delegated",
      "media_label": "Бюджетный обозреватель",
      "version": 1,
      "region_code": "27",
      "region_name": "Хабаровский край"
    }
  },
  {
    "case_key": "budget-region-2026-14-credit",
    "title": "Северный завоз и возвратный источник",
    "situation": "Республика Саха (Якутия) запрашивает бюджетный кредит 2 400 млн ₽ на кассовый разрыв во время северного завоза. График подтвержденного возврата опирается на поступления следующих кварталов. В опубликованной презентации сумму ошибочно назвали безвозвратной дотацией и исключили из долга; финансовый орган уже подготовил долговую запись и проект соглашения. Перевозчики ждут оплату, поэтому команда должна определить правовую форму, способ отражения поступления и график возврата. В учебном сценарии своевременный завоз сохраняет работу нескольких предприятий; ошибка учета затрудняет следующий заем.",
    "category": "Региональные финансы",
    "seriousness": "serious",
    "audience": "group",
    "allowed_roles": [
      "министр финансов",
      "правительств",
      "председатель правительства",
      "губернатор",
      "глава региона",
      "министр экономического развития"
    ],
    "decision_options": [
      "Оформить возвратное соглашение, учитывать источник финансирования и долг, обеспечить график",
      "Считать кредит дотацией и не предусматривать возврат"
    ],
    "effect_plan": {
      "options": [
        {
          "key": "option_1",
          "news": "Северный завоз и возвратный источник — решение обосновано",
          "trust": 1,
          "lawful": true,
          "description": "Бюджетный кредит по БК РФ, статье 93.2, является возвратным финансированием на предусмотренных условиях. Получение основной суммы не является налоговым доходом; обязательство нельзя исключать из долгового учета только из-за ошибочного названия в презентации. Следовало оформить надлежащие документы и возвратный график. Финансовые полномочия реализует исполнительная власть; правовые и долговые ограничения проверяются до принятия обязательства.",
          "legal_basis": "Бюджетный кредит по БК РФ, статье 93.2, является возвратным финансированием на предусмотренных условиях. Получение основной суммы не является налоговым доходом; обязательство нельзя исключать из долгового учета только из-за ошибочного названия в презентации. Следовало оформить надлежащие документы и возвратный график. Финансовые полномочия реализует исполнительная власть; правовые и долговые ограничения проверяются до принятия обязательства. Источник: https://www.consultant.ru/document/cons_doc_LAW_19702/",
          "authorized_roles": [
            "министр финансов",
            "правительств",
            "председатель правительства",
            "губернатор",
            "глава региона",
            "министр экономического развития"
          ],
          "public_interest": "protected",
          "protects_role_interest": false,
          "fiscal_effect": {
            "enterprises": 7,
            "activity": 0.006
          }
        },
        {
          "key": "option_2",
          "news": "Северный завоз и возвратный источник — решение требует исправления",
          "trust": -2,
          "lawful": false,
          "description": "Бюджетный кредит по БК РФ, статье 93.2, является возвратным финансированием на предусмотренных условиях. Получение основной суммы не является налоговым доходом; обязательство нельзя исключать из долгового учета только из-за ошибочного названия в презентации. Следовало оформить надлежащие документы и возвратный график. Финансовые полномочия реализует исполнительная власть; правовые и долговые ограничения проверяются до принятия обязательства.",
          "legal_basis": "Бюджетный кредит по БК РФ, статье 93.2, является возвратным финансированием на предусмотренных условиях. Получение основной суммы не является налоговым доходом; обязательство нельзя исключать из долгового учета только из-за ошибочного названия в презентации. Следовало оформить надлежащие документы и возвратный график. Финансовые полномочия реализует исполнительная власть; правовые и долговые ограничения проверяются до принятия обязательства. Источник: https://www.consultant.ru/document/cons_doc_LAW_19702/",
          "authorized_roles": [
            "министр финансов",
            "правительств",
            "председатель правительства",
            "губернатор",
            "глава региона",
            "министр экономического развития"
          ],
          "public_interest": "harmful",
          "protects_role_interest": false,
          "fiscal_effect": {
            "activity": -0.01,
            "expenditure": 120
          }
        }
      ]
    },
    "source_url": "https://www.consultant.ru/document/cons_doc_LAW_19702/",
    "source_note": "Авторская учебная ситуация, не сообщение о реальном происшествии. Нормы проверены 02.10.2026; денежные эффекты — параметры игры.",
    "verified": true,
    "status": "ready",
    "comic_scene": {
      "format": "budget-dossier",
      "alt": "Финансовое досье: Северный завоз и возвратный источник",
      "case_key": "budget-region-2026-14-credit",
      "media_label": "Бюджетный обозреватель",
      "version": 1,
      "region_code": "14",
      "region_name": "Республика Саха (Якутия)"
    }
  },
  {
    "case_key": "budget-region-2026-59-consolidation",
    "title": "Трансферт, посчитанный дважды",
    "situation": "Пермский край получает целевую федеральную субсидию 700 млн ₽ на модернизацию объектов ЖКХ. В федеральной таблице она уже включена в отраслевой раздел 05; в региональной отражены поступление и соответствующие расходы. При подготовке сводной презентации студент добавил еще 700 млн ₽ к разделу 14 федерального бюджета, а затем сложил все уровни без исключения внутреннего перечисления. На слайде возник рост общей помощи на 1 400 млн ₽ без нового решения. Команде нужно исправить классификацию и объяснить разницу между самостоятельными бюджетами и консолидированным показателем.",
    "category": "Региональные финансы",
    "seriousness": "serious",
    "audience": "group",
    "allowed_roles": [
      "министр финансов",
      "правительств",
      "председатель правительства",
      "губернатор",
      "глава региона",
      "министр экономического развития"
    ],
    "decision_options": [
      "Сохранить сумму во всех строках, поскольку у каждого бюджета свой баланс",
      "Оставить отраслевой расход один раз и исключить внутрисистемный трансферт при консолидации"
    ],
    "effect_plan": {
      "options": [
        {
          "key": "option_1",
          "news": "Трансферт, посчитанный дважды — решение требует исправления",
          "trust": -2,
          "lawful": false,
          "description": "Целевая субсидия относится к соответствующему отраслевому разделу, а не повторно к трансфертам общего характера. Понятие консолидированного бюджета в статье 6 БК РФ исключает двойной учет межбюджетных трансфертов между входящими в него бюджетами. Следовало сохранить записи исполнения на обоих уровнях, но исключить внутренний поток в сводном показателе. В игре правильная сверка снижает стоимость учета; фиктивный рост искажает планирование.",
          "legal_basis": "Целевая субсидия относится к соответствующему отраслевому разделу, а не повторно к трансфертам общего характера. Понятие консолидированного бюджета в статье 6 БК РФ исключает двойной учет межбюджетных трансфертов между входящими в него бюджетами. Следовало сохранить записи исполнения на обоих уровнях, но исключить внутренний поток в сводном показателе. В игре правильная сверка снижает стоимость учета; фиктивный рост искажает планирование. Источник: https://www.consultant.ru/document/cons_doc_LAW_19702/",
          "authorized_roles": [
            "министр финансов",
            "правительств",
            "председатель правительства",
            "губернатор",
            "глава региона",
            "министр экономического развития"
          ],
          "public_interest": "harmful",
          "protects_role_interest": false,
          "fiscal_effect": {
            "expenditure": 140,
            "cost": 0.004
          }
        },
        {
          "key": "option_2",
          "news": "Трансферт, посчитанный дважды — решение обосновано",
          "trust": 1,
          "lawful": true,
          "description": "Целевая субсидия относится к соответствующему отраслевому разделу, а не повторно к трансфертам общего характера. Понятие консолидированного бюджета в статье 6 БК РФ исключает двойной учет межбюджетных трансфертов между входящими в него бюджетами. Следовало сохранить записи исполнения на обоих уровнях, но исключить внутренний поток в сводном показателе. В игре правильная сверка снижает стоимость учета; фиктивный рост искажает планирование.",
          "legal_basis": "Целевая субсидия относится к соответствующему отраслевому разделу, а не повторно к трансфертам общего характера. Понятие консолидированного бюджета в статье 6 БК РФ исключает двойной учет межбюджетных трансфертов между входящими в него бюджетами. Следовало сохранить записи исполнения на обоих уровнях, но исключить внутренний поток в сводном показателе. В игре правильная сверка снижает стоимость учета; фиктивный рост искажает планирование. Источник: https://www.consultant.ru/document/cons_doc_LAW_19702/",
          "authorized_roles": [
            "министр финансов",
            "правительств",
            "председатель правительства",
            "губернатор",
            "глава региона",
            "министр экономического развития"
          ],
          "public_interest": "protected",
          "protects_role_interest": false,
          "fiscal_effect": {
            "cost": -0.003
          }
        }
      ]
    },
    "source_url": "https://www.consultant.ru/document/cons_doc_LAW_19702/",
    "source_note": "Авторская учебная ситуация, не сообщение о реальном происшествии. Нормы проверены 02.10.2026; денежные эффекты — параметры игры.",
    "verified": true,
    "status": "ready",
    "comic_scene": {
      "format": "budget-dossier",
      "alt": "Финансовое досье: Трансферт, посчитанный дважды",
      "case_key": "budget-region-2026-59-consolidation",
      "media_label": "Бюджетный обозреватель",
      "version": 1,
      "region_code": "59",
      "region_name": "Пермский край"
    }
  },
  {
    "case_key": "budget-region-2026-38-emergency",
    "title": "Резерв после паводка и новая стройка",
    "situation": "В Иркутской области паводок повредил коммунальную инфраструктуру. Регион запросил 600 млн ₽ на подтвержденные неотложные восстановительные работы с актами обследования. Одновременно в заявку добавили строительство нового туристического центра, который не пострадал и отсутствует в аварийных актах. Министерство располагает ограниченным резервом, а перечень работ нужно утвердить до оплаты. Команда должна отделить чрезвычайные расходы от обычного инвестиционного проекта, проверить основания использования резервного фонда и оформить необходимые изменения. Восстановление сетей возвращает действующие предприятия к работе.",
    "category": "Региональные финансы",
    "seriousness": "serious",
    "audience": "group",
    "allowed_roles": [
      "министр финансов",
      "правительств",
      "председатель правительства",
      "губернатор",
      "глава региона",
      "министр экономического развития"
    ],
    "decision_options": [
      "Отделить подтвержденное восстановление, проверить резервное основание и оформить обычную стройку отдельно",
      "Оплатить туристический центр из аварийного резерва вместе с восстановлением"
    ],
    "effect_plan": {
      "options": [
        {
          "key": "option_1",
          "news": "Резерв после паводка и новая стройка — решение обосновано",
          "trust": 1,
          "lawful": true,
          "description": "Резервный фонд по статье 81 БК РФ предназначен для непредвиденных расходов в установленном порядке. Наличие паводка не превращает любой новый проект в аварийный расход. Следовало опираться на подтверждающие документы, решение уполномоченного органа и целевое основание помощи, отдельно рассмотреть обычную стройку. Учебный исход меняет число работающих предприятий и стоимость восстановления, не утверждает факт реального паводка.",
          "legal_basis": "Резервный фонд по статье 81 БК РФ предназначен для непредвиденных расходов в установленном порядке. Наличие паводка не превращает любой новый проект в аварийный расход. Следовало опираться на подтверждающие документы, решение уполномоченного органа и целевое основание помощи, отдельно рассмотреть обычную стройку. Учебный исход меняет число работающих предприятий и стоимость восстановления, не утверждает факт реального паводка. Источник: https://www.consultant.ru/document/cons_doc_LAW_19702/",
          "authorized_roles": [
            "министр финансов",
            "правительств",
            "председатель правительства",
            "губернатор",
            "глава региона",
            "министр экономического развития"
          ],
          "public_interest": "protected",
          "protects_role_interest": false,
          "fiscal_effect": {
            "enterprises": 12,
            "activity": 0.006,
            "expenditure": 70
          }
        },
        {
          "key": "option_2",
          "news": "Резерв после паводка и новая стройка — решение требует исправления",
          "trust": -2,
          "lawful": false,
          "description": "Резервный фонд по статье 81 БК РФ предназначен для непредвиденных расходов в установленном порядке. Наличие паводка не превращает любой новый проект в аварийный расход. Следовало опираться на подтверждающие документы, решение уполномоченного органа и целевое основание помощи, отдельно рассмотреть обычную стройку. Учебный исход меняет число работающих предприятий и стоимость восстановления, не утверждает факт реального паводка.",
          "legal_basis": "Резервный фонд по статье 81 БК РФ предназначен для непредвиденных расходов в установленном порядке. Наличие паводка не превращает любой новый проект в аварийный расход. Следовало опираться на подтверждающие документы, решение уполномоченного органа и целевое основание помощи, отдельно рассмотреть обычную стройку. Учебный исход меняет число работающих предприятий и стоимость восстановления, не утверждает факт реального паводка. Источник: https://www.consultant.ru/document/cons_doc_LAW_19702/",
          "authorized_roles": [
            "министр финансов",
            "правительств",
            "председатель правительства",
            "губернатор",
            "глава региона",
            "министр экономического развития"
          ],
          "public_interest": "harmful",
          "protects_role_interest": false,
          "fiscal_effect": {
            "enterprises": -8,
            "activity": -0.008,
            "expenditure": 150
          }
        }
      ]
    },
    "source_url": "https://www.consultant.ru/document/cons_doc_LAW_19702/",
    "source_note": "Авторская учебная ситуация, не сообщение о реальном происшествии. Нормы проверены 02.10.2026; денежные эффекты — параметры игры.",
    "verified": true,
    "status": "ready",
    "comic_scene": {
      "format": "budget-dossier",
      "alt": "Финансовое досье: Резерв после паводка и новая стройка",
      "case_key": "budget-region-2026-38-emergency",
      "media_label": "Бюджетный обозреватель",
      "version": 1,
      "region_code": "38",
      "region_name": "Иркутская область"
    }
  },
  {
    "case_key": "budget-region-2026-39-credit-return",
    "title": "Возврат кредита против обещания продления",
    "situation": "Калининградская область должна вернуть 850 млн ₽ бюджетного кредита в конце учебного финансового периода. Соглашение действует, письменного решения о реструктуризации нет. В переписке посредник утверждает, что срок «точно продлят», и предлагает не закладывать платеж, направив остаток на новую закупку. Финансовый орган подготовил два расчета: своевременное погашение и законное обращение о пересмотре условий, которое еще не рассмотрено. Нужно решить, как учитывать действующее обязательство, не выдавая ожидание нового решения за уже измененное условие договора.",
    "category": "Региональные финансы",
    "seriousness": "serious",
    "audience": "group",
    "allowed_roles": [
      "министр финансов",
      "правительств",
      "председатель правительства",
      "губернатор",
      "глава региона",
      "министр экономического развития"
    ],
    "decision_options": [
      "Исключить погашение на основании переписки и потратить остаток",
      "Сохранить платеж по действующему соглашению и отдельно оформить запрос о пересмотре условий"
    ],
    "effect_plan": {
      "options": [
        {
          "key": "option_1",
          "news": "Возврат кредита против обещания продления — решение требует исправления",
          "trust": -2,
          "lawful": false,
          "description": "Условия бюджетного кредита и реструктуризации определяются предусмотренными правом решениями и соглашением; неофициальное обещание не меняет срок исполнения. БК РФ, статья 93.2, требует возвратности и надлежащего оформления условий. Следовало обеспечить действующий график и рассмотреть законное изменение отдельно. В симуляторе возврат кредита не является новым расходом отрасли; просрочка создает дополнительные расходы урегулирования.",
          "legal_basis": "Условия бюджетного кредита и реструктуризации определяются предусмотренными правом решениями и соглашением; неофициальное обещание не меняет срок исполнения. БК РФ, статья 93.2, требует возвратности и надлежащего оформления условий. Следовало обеспечить действующий график и рассмотреть законное изменение отдельно. В симуляторе возврат кредита не является новым расходом отрасли; просрочка создает дополнительные расходы урегулирования. Источник: https://www.consultant.ru/document/cons_doc_LAW_19702/",
          "authorized_roles": [
            "министр финансов",
            "правительств",
            "председатель правительства",
            "губернатор",
            "глава региона",
            "министр экономического развития"
          ],
          "public_interest": "harmful",
          "protects_role_interest": false,
          "fiscal_effect": {
            "expenditure": 60,
            "activity": -0.004
          }
        },
        {
          "key": "option_2",
          "news": "Возврат кредита против обещания продления — решение обосновано",
          "trust": 1,
          "lawful": true,
          "description": "Условия бюджетного кредита и реструктуризации определяются предусмотренными правом решениями и соглашением; неофициальное обещание не меняет срок исполнения. БК РФ, статья 93.2, требует возвратности и надлежащего оформления условий. Следовало обеспечить действующий график и рассмотреть законное изменение отдельно. В симуляторе возврат кредита не является новым расходом отрасли; просрочка создает дополнительные расходы урегулирования.",
          "legal_basis": "Условия бюджетного кредита и реструктуризации определяются предусмотренными правом решениями и соглашением; неофициальное обещание не меняет срок исполнения. БК РФ, статья 93.2, требует возвратности и надлежащего оформления условий. Следовало обеспечить действующий график и рассмотреть законное изменение отдельно. В симуляторе возврат кредита не является новым расходом отрасли; просрочка создает дополнительные расходы урегулирования. Источник: https://www.consultant.ru/document/cons_doc_LAW_19702/",
          "authorized_roles": [
            "министр финансов",
            "правительств",
            "председатель правительства",
            "губернатор",
            "глава региона",
            "министр экономического развития"
          ],
          "public_interest": "protected",
          "protects_role_interest": false,
          "fiscal_effect": {
            "activity": 0.002,
            "cost": -0.001
          }
        }
      ]
    },
    "source_url": "https://www.consultant.ru/document/cons_doc_LAW_19702/",
    "source_note": "Авторская учебная ситуация, не сообщение о реальном происшествии. Нормы проверены 02.10.2026; денежные эффекты — параметры игры.",
    "verified": true,
    "status": "ready",
    "comic_scene": {
      "format": "budget-dossier",
      "alt": "Финансовое досье: Возврат кредита против обещания продления",
      "case_key": "budget-region-2026-39-credit-return",
      "media_label": "Бюджетный обозреватель",
      "version": 1,
      "region_code": "39",
      "region_name": "Калининградская область"
    }
  },
  {
    "case_key": "budget-region-2026-77-recipient-insolvent",
    "title": "Субсидия и конкурсная масса получателя",
    "situation": "В Москве коммерческая организация получила 320 млн ₽ целевой поддержки на создание производственной линии, но не выполнила показатели соглашения. Затем суд открыл конкурсное производство. У публичного органа имеются соглашение, акт проверки и требование о возврате; участник предлагает самостоятельно забрать оборудование со склада, чтобы не ждать других кредиторов. Конкурсный управляющий просит направить документы для учета требования в установленной процедуре. Команда должна защитить публичные средства, различив требование возврата субсидии, обеспеченность требования и порядок действий в деле о банкротстве.",
    "category": "Региональные финансы",
    "seriousness": "serious",
    "audience": "group",
    "allowed_roles": [
      "министр финансов",
      "правительств",
      "председатель правительства",
      "губернатор",
      "глава региона",
      "министр экономического развития"
    ],
    "decision_options": [
      "Зафиксировать нарушение, предъявить обоснованное требование в процедуре банкротства и проверить обеспечение",
      "Самостоятельно изъять любое имущество должника без процессуального основания"
    ],
    "effect_plan": {
      "options": [
        {
          "key": "option_1",
          "news": "Субсидия и конкурсная масса получателя — решение обосновано",
          "trust": 1,
          "lawful": true,
          "description": "Условия возврата субсидии следуют из статьи 78 БК РФ и соглашения; при банкротстве требование реализуется с соблюдением Федерального закона № 127-ФЗ, включая установленный порядок предъявления и учета требований. Самовольное изъятие имущества не заменяет судебную процедуру. Уполномоченный орган документирует нарушение, рассчитывает требование и проверяет обеспечение. В игровом исходе надлежащий учет ограничивает потери, но не обещает полного возврата при недостатке конкурсной массы.",
          "legal_basis": "Условия возврата субсидии следуют из статьи 78 БК РФ и соглашения; при банкротстве требование реализуется с соблюдением Федерального закона № 127-ФЗ, включая установленный порядок предъявления и учета требований. Самовольное изъятие имущества не заменяет судебную процедуру. Уполномоченный орган документирует нарушение, рассчитывает требование и проверяет обеспечение. В игровом исходе надлежащий учет ограничивает потери, но не обещает полного возврата при недостатке конкурсной массы. Источник: https://www.consultant.ru/document/cons_doc_LAW_19702/",
          "authorized_roles": [
            "министр финансов",
            "правительств",
            "председатель правительства",
            "губернатор",
            "глава региона",
            "министр экономического развития"
          ],
          "public_interest": "protected",
          "protects_role_interest": false,
          "fiscal_effect": {
            "expenditure": 30,
            "activity": -0.002
          }
        },
        {
          "key": "option_2",
          "news": "Субсидия и конкурсная масса получателя — решение требует исправления",
          "trust": -2,
          "lawful": false,
          "description": "Условия возврата субсидии следуют из статьи 78 БК РФ и соглашения; при банкротстве требование реализуется с соблюдением Федерального закона № 127-ФЗ, включая установленный порядок предъявления и учета требований. Самовольное изъятие имущества не заменяет судебную процедуру. Уполномоченный орган документирует нарушение, рассчитывает требование и проверяет обеспечение. В игровом исходе надлежащий учет ограничивает потери, но не обещает полного возврата при недостатке конкурсной массы.",
          "legal_basis": "Условия возврата субсидии следуют из статьи 78 БК РФ и соглашения; при банкротстве требование реализуется с соблюдением Федерального закона № 127-ФЗ, включая установленный порядок предъявления и учета требований. Самовольное изъятие имущества не заменяет судебную процедуру. Уполномоченный орган документирует нарушение, рассчитывает требование и проверяет обеспечение. В игровом исходе надлежащий учет ограничивает потери, но не обещает полного возврата при недостатке конкурсной массы. Источник: https://www.consultant.ru/document/cons_doc_LAW_19702/",
          "authorized_roles": [
            "министр финансов",
            "правительств",
            "председатель правительства",
            "губернатор",
            "глава региона",
            "министр экономического развития"
          ],
          "public_interest": "harmful",
          "protects_role_interest": false,
          "fiscal_effect": {
            "expenditure": 130,
            "activity": -0.006
          }
        }
      ]
    },
    "source_url": "https://www.consultant.ru/document/cons_doc_LAW_19702/",
    "source_note": "Авторская учебная ситуация, не сообщение о реальном происшествии. Нормы проверены 02.10.2026; денежные эффекты — параметры игры.",
    "verified": true,
    "status": "ready",
    "comic_scene": {
      "format": "budget-dossier",
      "alt": "Финансовое досье: Субсидия и конкурсная масса получателя",
      "case_key": "budget-region-2026-77-recipient-insolvent",
      "media_label": "Бюджетный обозреватель",
      "version": 1,
      "region_code": "77",
      "region_name": "Москва"
    }
  }
]$cases$::jsonb)c;
create function private.seed_budget_cases(p_game uuid) returns integer language plpgsql security definer set search_path=public,private,pg_temp as $$
declare n integer;begin
 insert into event_cases(game_id,case_key,title,situation,category,seriousness,audience,allowed_roles,decision_options,effect_plan,source_url,source_note,verified,status,comic_scene,created_by)
 select p_game,c.case_key,c.data->>'title',c.data->>'situation',c.data->>'category',c.data->>'seriousness',c.data->>'audience',array(select jsonb_array_elements_text(c.data->'allowed_roles')),c.data->'decision_options',c.data->'effect_plan',c.data->>'source_url',c.data->>'source_note',true,c.data->>'status',c.data->'comic_scene',(select owner_id from games where id=p_game)
 from private.budget_case_templates c on conflict(game_id,case_key) do nothing;
 get diagnostics n=row_count;return n;
end$$;
revoke all on function private.seed_budget_cases(uuid) from public,anon,authenticated;
create function private.dispatch_budget_risks(p_game uuid default null) returns integer language plpgsql security definer set search_path=public,private,pg_temp as $$
declare r record;n integer:=0;recipient uuid;begin
 for r in select q.*,c.title,c.situation from private.budget_deferred_risks q join event_cases c on c.id=q.case_id join budget_simulator_state s on s.game_id=q.game_id
 where q.dispatched_at is null and (p_game is null or q.game_id=p_game) and (q.due_at<=now() or q.due_month<=s.month) for update of q skip locked loop
  -- A classroom with no students keeps the pending case; it is delivered when students join.
  select user_id into recipient from game_members m where game_id=r.game_id and kind='student'
   order by private.can_create_formal_subject(r.game_id,m.user_id,'government') desc,m.joined_at limit 1;
  if recipient is null then continue;end if;
  update event_cases set status='ready' where id=r.case_id;
  insert into event_assignments(case_id,game_id,recipient_id,status) values(r.case_id,r.game_id,recipient,'pending') on conflict(case_id,recipient_id) do nothing;
  update private.budget_deferred_risks set dispatched_at=now() where id=r.id;
  insert into budget_simulator_ledger(game_id,kind,note,source_key) values(r.game_id,'risk','Наступило финансовое событие «'||r.title||'». Откройте «События», примите приглашение и обсудите решение.','risk:'||r.id) on conflict do nothing;
  insert into game_events(game_id,round_no,category,severity,title,body) values(r.game_id,13,'Бюджет','notice',r.title,r.situation);
  n:=n+1;
 end loop;return n;
end$$;

create function private.apply_budget_simulator_plan(p_game uuid,p_plan_id uuid) returns boolean language plpgsql security definer set search_path=public,private,pg_temp as $$
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
  update game_fiscal_regions set transfer_in=transfer_in+case when req.kind<>'budget_credit' then req.amount else 0 end,budget_credit_cash=budget_credit_cash+case when req.kind='budget_credit' then req.amount else 0 end,expenditure=expenditure+case when req.kind='subsidy' then req.cofinancing else 0 end,
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
  reserve_remaining=(fresh->>'reserve_remaining')::numeric,last_financing=pl.draft->'financing',last_plan_id=pl.id,last_document_id=doc.id,version=version+1,updated_at=now() where game_id=pl.game_id;
 update budget_simulator_plans set status='published',updated_at=now() where id=pl.id;
 insert into game_events(game_id,round_no,category,severity,title,body,created_by) values(pl.game_id,13,'Бюджет','notice','Федеральный бюджет принят и опубликован',
  doc.registry_no||'. Доходы: '||(c->>'revenue')||' млн ₽; расходы: '||(c->>'expenditure')||' млн ₽; дефицит: '||(c->>'deficit')||' млн ₽; профицит: '||(c->>'surplus')||' млн ₽. Региональные запросы и долговые обязательства отражены в общем симуляторе.',doc.author_id);
 return true;
end$$;

create function private.apply_budget_financial_outcome(p_game uuid,p_case uuid) returns boolean language plpgsql security definer set search_path=public,private,pg_temp as $$
declare outcome event_case_outcomes%rowtype;c event_cases%rowtype;fx jsonb;begin
 select * into outcome from event_case_outcomes where game_id=p_game and case_id=p_case;
 if outcome.case_id is null then return false;end if;
 if outcome.winner !~ '^option_[0-9]+$' then return false;end if;
 select * into c from event_cases where id=outcome.case_id and game_id=outcome.game_id;
 fx:=c.effect_plan->'options'->(substring(outcome.winner from 8)::integer-1)->'budget_effect';if fx is null then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended('budget:'||c.game_id::text,0));perform private.ensure_budget_simulator(c.game_id);
 insert into budget_simulator_ledger(game_id,kind,note,amount,source_key) values(c.game_id,'outcome','Исход финансового кейса «'||c.title||'». '||(c.effect_plan->'options'->(substring(outcome.winner from 8)::integer-1)->>'description'),coalesce((fx->>'service')::numeric,(fx->>'revenue')::numeric,0),'outcome:'||c.id) on conflict do nothing;
 if not found then return false;end if;
 -- There is deliberately no debt-cancellation parameter. Insolvency of the lender never forgives the loan.
 update budget_simulator_state set service_adjustment=service_adjustment+coalesce((fx->>'service')::numeric,0),revenue_adjustment=revenue_adjustment+coalesce((fx->>'revenue')::numeric,0),reserve_remaining=greatest(0,reserve_remaining+coalesce((fx->>'reserve')::numeric,0)),version=version+1,updated_at=now() where game_id=c.game_id;
 if fx ? 'fx_change' then update game_fiscal_policy set fx_rate=greatest(.01,least(100000,fx_rate*(1+(fx->>'fx_change')::numeric))),updated_at=now() where game_id=c.game_id;end if;
 return true;
end$$;

create function public.advance_budget_simulator(p_game_id uuid,p_version integer) returns integer language plpgsql security definer set search_path=public,private,pg_temp as $$
declare s budget_simulator_state%rowtype;ct budget_finance_contracts%rowtype;n integer;rate numeric;begin
 if auth.uid() is null or not private.is_game_member(p_game_id) or not private.is_game_teacher(p_game_id) then raise exception 'Переход финансового месяца доступен преподавателю этой игры.';end if;
 perform pg_advisory_xact_lock(hashtextextended('budget:'||p_game_id::text,0));perform private.ensure_budget_simulator(p_game_id);select * into s from budget_simulator_state where game_id=p_game_id for update;
 if s.version is distinct from p_version then raise exception 'Финансовые данные уже изменились. Обновите раздел перед переходом месяца.';end if;
 if s.last_plan_id is null then raise exception 'Сначала примите и опубликуйте бюджетный проект.';end if;
 n:=s.month+1;if n>120 then raise exception 'Завершены все 120 учебных финансовых месяцев.';end if;
 for ct in select * from budget_finance_contracts where game_id=p_game_id and status in ('active','due') for update loop
  rate:=case when ct.source_key='ofz_float' then private.budget_financing_rate('ofz_float',(select key_rate from game_fiscal_policy where game_id=p_game_id)) else ct.annual_rate end;
  update budget_finance_contracts set annual_rate=rate,status=case when maturity_month<=n then 'due' else status end where id=ct.id;
  insert into budget_simulator_ledger(game_id,kind,note,amount,source_key) values(p_game_id,'interest','Месяц '||n||': начислены проценты по '||ct.source_key||'. Это расход обслуживания, не погашение основного долга.',round(ct.principal*rate/1200,2),'interest:'||ct.id||':'||n) on conflict do nothing;
  if ct.maturity_month=n then insert into budget_simulator_ledger(game_id,kind,note,amount,source_key) values(p_game_id,'maturity','Наступил срок погашения '||ct.source_key||'. Долг сохраняется до платежа. Погасите из доступного резерва либо подготовьте новый бюджет для рефинансирования.',ct.principal,'maturity:'||ct.id) on conflict do nothing;end if;
 end loop;
 insert into budget_simulator_ledger(game_id,kind,note,amount,source_key)
 select p_game_id,'regional_maturity','Наступил срок возврата бюджетного кредита: '||f.name||'. Верните средства в форме региональных запросов.',r.amount,'regional-maturity:'||r.id from budget_transfer_requests r join fiscal_region_reference f on f.code=r.region_code where r.game_id=p_game_id and r.kind='budget_credit' and r.status='granted' and r.maturity_month=n and r.repaid_at is null on conflict do nothing;
 update budget_simulator_state set month=n,version=version+1,updated_at=now() where game_id=p_game_id;
 perform private.dispatch_budget_risks(p_game_id);return n;
end$$;
create function public.repay_budget_finance_contract(p_contract_id uuid) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare ct budget_finance_contracts%rowtype;s budget_simulator_state%rowtype;amount numeric;begin
 select * into ct from budget_finance_contracts where id=p_contract_id;
 if ct.id is null or not private.can_prepare_budget(ct.game_id) then raise exception 'Погашение доступно бюджетной команде этой игры.';end if;
 perform pg_advisory_xact_lock(hashtextextended('budget:'||ct.game_id::text,0));select * into ct from budget_finance_contracts where id=p_contract_id for update;select * into s from budget_simulator_state where game_id=ct.game_id for update;
 if ct.status='paid' then return;end if;
 amount:=case when ct.source_key='external' then ct.principal*(private.calculate_budget_simulator(ct.game_id,(select draft from budget_simulator_plans where id=s.last_plan_id))->>'fx')::numeric/(s.anchor->>'fx_rate')::numeric else ct.principal end;
 if s.reserve_remaining<amount then raise exception 'Недостаточно доступного резерва. Подготовьте изменения в бюджет и источниках рефинансирования.';end if;
 insert into budget_simulator_ledger(game_id,kind,note,amount,source_key) values(ct.game_id,'principal','Погашен основной долг по '||ct.source_key||' из доступного резерва. Проценты учитываются отдельно.',amount,'repay:'||ct.id) on conflict do nothing;if not found then return;end if;
 update budget_simulator_state set reserve_remaining=reserve_remaining-amount,internal_debt=greatest(0,internal_debt-case when ct.source_key<>'external' then ct.principal else 0 end),external_debt=greatest(0,external_debt-case when ct.source_key='external' then ct.principal else 0 end),version=version+1,updated_at=now() where game_id=ct.game_id;
 update budget_finance_contracts set status='paid',principal=0 where id=ct.id;
end$$;
create function public.repay_budget_transfer(p_request_id uuid) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare r budget_transfer_requests%rowtype;reg game_fiscal_regions%rowtype;before_row jsonb;after_row jsonb;begin
 select * into r from budget_transfer_requests where id=p_request_id;
 if r.id is null or not private.can_request_budget_transfer(r.game_id) then raise exception 'Нет права возвращать бюджетный кредит этой игры.';end if;
 perform pg_advisory_xact_lock(hashtextextended('budget:'||r.game_id::text,0));select * into r from budget_transfer_requests where id=p_request_id for update;
 if r.kind<>'budget_credit' or r.status<>'granted' then raise exception 'Этот запрос не является выданным бюджетным кредитом.';end if;
 if r.repaid_at is not null then return;end if;
 select * into reg from game_fiscal_regions where game_id=r.game_id and region_code=r.region_code for update;
 if reg.budget_credit_cash<r.amount then raise exception 'В учебном остатке региона недостаточно средств для возврата кредита.';end if;
 before_row:=to_jsonb(reg);
 update game_fiscal_regions set budget_credit_cash=budget_credit_cash-r.amount,debt=greatest(0,debt-r.amount),updated_at=now() where game_id=r.game_id and region_code=r.region_code returning to_jsonb(game_fiscal_regions.*) into after_row;
 update budget_transfer_requests set repaid_at=now() where id=r.id;
 update budget_simulator_state set reserve_remaining=reserve_remaining+r.amount,version=version+1,updated_at=now() where game_id=r.game_id;
 insert into fiscal_change_ledger(game_id,region_code,source_type,source_id,note,before_values,after_values,actor_id) values(r.game_id,r.region_code,'budget_repayment',r.id::text,'Возвращен бюджетный кредит',before_row,after_row,auth.uid()) on conflict do nothing;
 insert into budget_simulator_ledger(game_id,kind,note,amount,source_key) values(r.game_id,'regional_repayment','Регион вернул бюджетный кредит. Возврат — источник финансирования, а не налоговый доход.',r.amount,'regional-repay:'||r.id) on conflict do nothing;
end$$;

create function public.get_budget_simulator(p_game_id uuid) returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare row_id uuid;begin
 if auth.uid() is null or not private.is_game_member(p_game_id) then raise exception 'Нет доступа к бюджетному симулятору этой игры.';end if;
 perform private.ensure_budget_simulator(p_game_id);perform private.seed_budget_cases(p_game_id);
 for row_id in select p.id from budget_simulator_plans p join formal_documents d on d.id=p.document_id and d.game_id=p.game_id where p.game_id=p_game_id and p.status='document' and d.status_code='published' order by d.updated_at loop perform private.apply_budget_simulator_plan(p_game_id,row_id);end loop;
 for row_id in select c.id from event_cases c join event_case_outcomes o on o.case_id=c.id and o.game_id=c.game_id where c.game_id=p_game_id and c.case_key like 'budget-risk-%' and not exists(select 1 from budget_simulator_ledger l where l.game_id=p_game_id and l.source_key='outcome:'||c.id) loop perform private.apply_budget_financial_outcome(p_game_id,row_id);end loop;
 perform private.dispatch_budget_risks(p_game_id);
 return jsonb_build_object('state',(select to_jsonb(s) from budget_simulator_state s where game_id=p_game_id),
 'plans',(select coalesce(jsonb_agg(to_jsonb(p) order by p.updated_at desc),'[]') from (select pl.*,d.registry_no from budget_simulator_plans pl left join formal_documents d on d.id=pl.document_id where pl.game_id=p_game_id order by pl.updated_at desc limit 30)p),
 'requests',(select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc),'[]') from (select r.*,f.name region_name from budget_transfer_requests r join fiscal_region_reference f on f.code=r.region_code where game_id=p_game_id)r),
 'contracts',(select coalesce(jsonb_agg(to_jsonb(c) order by c.maturity_month,c.created_at),'[]') from budget_finance_contracts c where c.game_id=p_game_id),
 'ledger',(select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at desc,l.id desc),'[]') from (select * from budget_simulator_ledger where game_id=p_game_id order by created_at desc,id desc limit 80)l),
 'can_prepare',private.can_prepare_budget(p_game_id),'can_request',private.can_request_budget_transfer(p_game_id),
 'event_count',(select count(*) from event_assignments a join event_cases c on c.id=a.case_id where a.game_id=p_game_id and a.status in ('pending','accepted') and c.case_key like 'budget-%' and (a.recipient_id=auth.uid() or private.is_game_teacher(p_game_id))));
end$$;

revoke all on function private.dispatch_budget_risks(uuid),private.apply_budget_simulator_plan(uuid,uuid),private.apply_budget_financial_outcome(uuid,uuid) from public,anon,authenticated;
revoke all on function public.advance_budget_simulator(uuid,integer),public.repay_budget_finance_contract(uuid),public.repay_budget_transfer(uuid),public.get_budget_simulator(uuid) from public,anon;
grant execute on function public.advance_budget_simulator(uuid,integer),public.repay_budget_finance_contract(uuid),public.repay_budget_transfer(uuid),public.get_budget_simulator(uuid) to authenticated;
-- No global triggers, cron jobs or changes to existing classrooms are installed.
-- Each operation is scoped by an authenticated RPC to the selected classroom.
