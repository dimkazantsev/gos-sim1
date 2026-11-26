-- Isolated schema fixture: production column names, no real users or rows.
CREATE SCHEMA auth; CREATE SCHEMA private; CREATE ROLE anon; CREATE ROLE authenticated;
CREATE TABLE public.games(id uuid PRIMARY KEY,status text);
CREATE TABLE public.game_fiscal_policy(game_id uuid PRIMARY KEY,key_rate numeric,fx_rate numeric,oil_price numeric,cutoff_price numeric,inflation numeric,federal_expenditure numeric,municipal_expenditure numeric,baseline_economy numeric,baseline_trust numeric,updated_at timestamptz,activity_override numeric,activity_reference numeric,collection_lawfulness_reference numeric);
CREATE TABLE public.budget_simulator_state(game_id uuid PRIMARY KEY,anchor jsonb,internal_debt numeric,external_debt numeric,reserve_remaining numeric,service_adjustment numeric DEFAULT 0,revenue_adjustment numeric DEFAULT 0,last_financing jsonb,month int DEFAULT 0,version int DEFAULT 1,last_document_id uuid,last_plan_id uuid,updated_at timestamptz,financing_rates jsonb DEFAULT '{}',fnb_total numeric DEFAULT 10000000,fnb_fx_units numeric,fnb_last_oil_allocation numeric DEFAULT 0);
CREATE TABLE public.game_fiscal_regions(game_id uuid,region_code text,enterprises int,activity_multiplier numeric,expenditure numeric,PRIMARY KEY(game_id,region_code));
CREATE TABLE public.game_fiscal_rates(game_id uuid,region_code text,tax_key text,rate numeric);
CREATE TABLE public.state_metrics(game_id uuid,metric_key text,value numeric,is_public boolean DEFAULT true,PRIMARY KEY(game_id,metric_key));
CREATE TABLE public.budget_transfer_requests(id uuid,game_id uuid,region_code text,kind text,amount numeric,section_key text,status text,created_at timestamptz,event_case_id uuid);
CREATE TABLE public.budget_finance_contracts(id uuid,game_id uuid,source_key text,principal numeric,maturity_month int,status text);
CREATE TABLE public.fiscal_region_reference(code text,name text);
CREATE TABLE public.event_cases(id uuid,game_id uuid,title text);
CREATE TABLE public.game_members(game_id uuid,user_id uuid,kind text,role_title text,roster_archived_at timestamptz);
CREATE TABLE public.game_office_assignments(game_id uuid,user_id uuid,role_title text,status text);
CREATE TABLE public.formal_documents(id uuid,game_id uuid,author_id uuid,doc_type text,status_code text,metadata jsonb);
CREATE TABLE public.fiscal_change_ledger(id bigint GENERATED ALWAYS AS IDENTITY,game_id uuid,source_type text,source_id text,note text,before_values jsonb,after_values jsonb,actor_id uuid,region_code text);
CREATE TABLE private.budget_baseline(year int PRIMARY KEY,data jsonb);
CREATE TABLE private.reconcile_calls(game_id uuid,calculation jsonb);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $f$;
CREATE FUNCTION private.is_game_member(g uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT EXISTS(SELECT 1 FROM public.game_members WHERE game_id=g AND user_id=auth.uid()) $f$;
CREATE FUNCTION private.is_game_teacher(g uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT EXISTS(SELECT 1 FROM public.game_members WHERE game_id=g AND user_id=auth.uid() AND kind='teacher') $f$;
CREATE FUNCTION private.role_is_available(g uuid,u uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT EXISTS(SELECT 1 FROM public.game_members WHERE game_id=g AND user_id=u AND roster_archived_at IS NULL) $f$;
CREATE FUNCTION private.can_issue_bank_rate_decision(g uuid,u uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT false $f$;
CREATE FUNCTION private.ensure_fiscal_game(g uuid) RETURNS void LANGUAGE plpgsql AS $f$ BEGIN RETURN; END $f$;
CREATE FUNCTION private.settle_monetary_inflation(g uuid) RETURNS void LANGUAGE plpgsql AS $f$ BEGIN RETURN; END $f$;
CREATE FUNCTION private.validate_budget_draft(g uuid,d jsonb) RETURNS void LANGUAGE plpgsql AS $f$ BEGIN RETURN; END $f$;
CREATE FUNCTION private.signed_program_budget_items(g uuid) RETURNS jsonb LANGUAGE sql AS $f$ SELECT '[]'::jsonb $f$;
CREATE FUNCTION private.server_budget_program_expenses(g uuid,d jsonb) RETURNS jsonb LANGUAGE sql AS $f$ SELECT '[]'::jsonb $f$;
CREATE FUNCTION private.external_borrowing_access(g uuid) RETURNS jsonb LANGUAGE sql AS $f$ SELECT '{"annual_limit":1000000,"available":1000000,"used":0,"rate":12}'::jsonb $f$;
CREATE FUNCTION private.internal_borrowing_terms(g uuid) RETURNS jsonb LANGUAGE sql AS $f$ SELECT '{"annual_limit":10000000,"available":10000000,"used":0}'::jsonb $f$;
-- Forward references to the candidate are resolved at execution.
CREATE FUNCTION private.reconcile_budget_driver(g uuid) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE b jsonb;d jsonb;BEGIN SELECT data INTO b FROM private.budget_baseline WHERE year=2026;
 d:=jsonb_build_object('financing',b->'financing','income_changes','{}'::jsonb,'spending_changes','{}'::jsonb,'revenue_adjustments','{}'::jsonb,'transfer_ids','[]'::jsonb);
 INSERT INTO private.reconcile_calls VALUES(g,private.calculate_budget_simulator(g,d));END $f$;
-- Model the existing immediate ledger consequences, then exercise actual deferred sync.
CREATE FUNCTION private.test_macro_effect() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN IF NEW.source_type='macro' AND (NEW.before_values->'activity_override') IS DISTINCT FROM (NEW.after_values->'activity_override') THEN
 UPDATE public.state_metrics SET value=value+1 WHERE game_id=NEW.game_id AND metric_key='economy';
 END IF;RETURN NEW;END $f$;
CREATE TRIGGER test_macro_effect AFTER INSERT ON public.fiscal_change_ledger FOR EACH ROW EXECUTE FUNCTION private.test_macro_effect();
CREATE OR REPLACE FUNCTION private.budget_aux_impact(p_game uuid, p_anchor jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
WITH shifted AS (
 SELECT m.metric_key,m.value AS level,m.value-coalesce((p_anchor->'aux_metrics'->>m.metric_key)::numeric,m.value) AS delta
 FROM public.state_metrics m WHERE m.game_id=p_game AND m.metric_key IN ('social_stability','security','elite_support','international_standing','social_tension','legitimacy','media_climate')
), groups AS (
 SELECT coalesce(sum(case when metric_key in ('social_stability','security','elite_support','international_standing') then delta else 0 end),0)/5 AS activity_points,
        coalesce(sum(case when metric_key in ('legitimacy','media_climate') then delta else 0 end),0)/2 AS collection_points,
        max(case when metric_key='social_tension' then level end) AS tension_level
 FROM shifted
)
SELECT jsonb_build_object('activity_adjustment',greatest(-.03,least(.03,activity_points*.002))-least(.04,greatest(0,coalesce(tension_level,0)-60)*.001),
 'collection_adjustment',greatest(-.01,least(.01,collection_points*.0005))) FROM groups
$function$;

CREATE OR REPLACE FUNCTION private.budget_financing_rate(p_key text, p_rate numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select case p_key when 'external' then 7.5 when 'bank_credit' then p_rate+3 when 'ofz_float' then p_rate+.5 when 'ofz_fixed' then p_rate else 0 end
$function$;

CREATE OR REPLACE FUNCTION private.budget_income_details(p_game uuid, d jsonb, groups jsonb, p_activity numeric, p_oil numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare model jsonb:='[{"key":"oil_ndpi","group_key":"oil_gas","label":"Налоги на добычу нефти и газа","share":0.8,"reference_rate":40,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":true,"base_label":"Расчётная стоимость добычи","driver_note":"Цена нефти и курс рубля"},{"key":"oil_extra","group_key":"oil_gas","label":"Дополнительные нефтегазовые поступления","share":0.2,"reference_rate":25,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":true,"base_label":"Расчётный доход нефтегазового сектора","driver_note":"Цена нефти и курс рубля"},{"key":"vat","group_key":"turnover","label":"НДС","share":0.72,"reference_rate":22,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":false,"base_label":"Облагаемый оборот без НДС","driver_note":"Предприятия, занятость, спрос и решения в игре"},{"key":"excise","group_key":"turnover","label":"Акцизы","share":0.18,"reference_rate":20,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":true,"base_label":"Расчётная стоимость подакцизных товаров","driver_note":"Деловая активность и объём потребления"},{"key":"customs","group_key":"turnover","label":"Таможенные пошлины","share":0.1,"reference_rate":10,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":true,"base_label":"Расчётная стоимость облагаемого импорта","driver_note":"Деловая активность и внешняя торговля"},{"key":"profit","group_key":"income","label":"Налог на прибыль · федеральная часть","share":0.8,"reference_rate":25,"rate_unit":"percent","base_unit":"million_rubles","federal_share":0.32,"model_rate":false,"base_label":"Облагаемая прибыль организаций","driver_note":"Предприятия, активность и принятые налоговые решения"},{"key":"personal_income","group_key":"income","label":"Федеральные поступления налога на доходы физических лиц","share":0.2,"reference_rate":15,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":true,"base_label":"Расчётная база федеральных поступлений","driver_note":"Деловая активность; ставка усреднена для игры"},{"key":"dividends","group_key":"assets","label":"Дивиденды по государственной доле","share":0.6,"reference_rate":100,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":true,"base_label":"Прогноз выплат по государственной доле","driver_note":"Прогноз распределяемых выплат"},{"key":"asset_interest","group_key":"assets","label":"Доходы от размещения средств и использования имущества","share":0.4,"reference_rate":100,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":true,"base_label":"Прогноз процентных, арендных и иных платежей","driver_note":"Утверждённый прогноз неналоговых поступлений"},{"key":"rent","group_key":"rent","label":"Платежи за другие природные ресурсы","share":1,"reference_rate":8,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":true,"base_label":"Расчётная стоимость использования ресурсов","driver_note":"Объём производства и деловая активность"},{"key":"recycling","group_key":"recycling","label":"Утилизационный сбор","share":1,"reference_rate":200000,"rate_unit":"rubles","base_unit":"units","federal_share":1,"model_rate":true,"base_label":"Количество объектов, с которых взимается сбор","driver_note":"Производство и ввоз; рублёвая ставка усреднена для игры"},{"key":"other","group_key":"other","label":"Прочие налоговые и неналоговые доходы","share":1,"reference_rate":100,"rate_unit":"percent","base_unit":"million_rubles","federal_share":1,"model_rate":true,"base_label":"Прогноз остальных поступлений","driver_note":"Подтверждённые изменения прогнозных поступлений"}]'::jsonb;
 b jsonb;l jsonb;m jsonb;rate numeric;divisor numeric;driver numeric;raw_group numeric;group_tax numeric;scale numeric;tax_base numeric;amount numeric;vat numeric;profit numeric;collection numeric;v_collection numeric;rows jsonb:='[]';
begin
 select data into b from private.budget_baseline where year=2026;
 vat:=coalesce((select r.rate from game_fiscal_rates r where r.game_id=p_game and r.region_code='00' and r.tax_key='vat'),22);
 profit:=coalesce((select r.rate from game_fiscal_rates r where r.game_id=p_game and r.region_code='00' and r.tax_key='profit'),25);
 select greatest(.85,least(.995,.95+(coalesce(m.value,p.collection_lawfulness_reference)-coalesce(p.collection_lawfulness_reference,m.value))*.0003+coalesce((t.value-p.baseline_trust)*.0005,0))) into v_collection
 from game_fiscal_policy p left join state_metrics m on m.game_id=p.game_id and m.metric_key='lawfulness'
 left join state_metrics t on t.game_id=p.game_id and t.metric_key='public_trust'
 where p.game_id=p_game;
 v_collection:=greatest(.85,least(.995,coalesce(v_collection,.95)+
   private.budget_tax_compliance_shift(p_activity,(select anchor from budget_simulator_state where game_id=p_game))+
   coalesce((private.budget_aux_impact(p_game,(select anchor from budget_simulator_state where game_id=p_game))->>'collection_adjustment')::numeric,0)));
 for m in select jsonb_array_elements(model) loop
  select value into l from jsonb_array_elements(b->'income_lines') where value->>'key'=m->>'group_key';
  driver:=case l->>'driver' when 'oil' then p_oil when 'activity' then p_activity else 1 end*(1+coalesce((d->'income_changes'->>(l->>'key'))::numeric,0)/100);
  group_tax:=case l->>'key' when 'turnover' then 1+.72*(vat/22-1) when 'income' then 1+.8*(profit/25-1) else 1 end;
  raw_group:=(l->>'amount')::numeric*driver*group_tax;
  select case when raw_group>0 then (value->>'amount')::numeric/raw_group else 0 end into scale from jsonb_array_elements(groups) where value->>'key'=l->>'key';
  rate:=case m->>'key' when 'vat' then vat when 'profit' then profit else (m->>'reference_rate')::numeric end;
  divisor:=case m->>'rate_unit' when 'rubles' then (m->>'reference_rate')::numeric/1000000 else (m->>'reference_rate')::numeric/100 end;
  collection:=case when m->>'key' in ('dividends','asset_interest','other') then 1 else v_collection end;
  tax_base:=(l->>'amount')::numeric*(m->>'share')::numeric/(divisor*(m->>'federal_share')::numeric)*driver*scale/collection;
  amount:=tax_base*case m->>'rate_unit' when 'rubles' then rate/1000000 else rate/100 end*collection*(m->>'federal_share')::numeric;
  rows:=rows||jsonb_build_array(m||jsonb_build_object('rate',rate,'base',tax_base,'collection',collection,'amount',amount,'baseline',(l->>'amount')::numeric*(m->>'share')::numeric));
 end loop;
 return rows;
end;$function$;

CREATE OR REPLACE FUNCTION private.budget_tax_compliance_shift(p_activity numeric, p_anchor jsonb)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
SELECT greatest(-.06,least(.015,(coalesce(p_activity,1)/greatest(.01,coalesce((p_anchor->>'tax_activity_reference')::numeric,1))-1)*.12))
$function$;

CREATE OR REPLACE FUNCTION private.fiscal_activity_reference(p_key_rate numeric, p_fx_rate numeric, p_economy_delta numeric, p_trust_delta numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
 SELECT greatest(.65,least(1.4,
  1-(p_key_rate-16)*.007+p_economy_delta*.002+p_trust_delta*.001
   -(p_fx_rate*greatest(.75,least(1.3,
      1-p_economy_delta*.001-p_trust_delta*.001-(p_key_rate-16)*.0015
     ))/80-1)*.06
 ));
$function$;

CREATE OR REPLACE FUNCTION private.internal_borrowing_premium(p_rate numeric, p_inflation numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$ SELECT least(5,greatest(0,p_inflation-p_rate)*.25) $function$;

CREATE OR REPLACE FUNCTION private.reconcile_budget_driver_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
BEGIN
 IF TG_OP='UPDATE' AND NEW.metric_key IN
  ('lawfulness','economy','public_trust','social_stability','security',
   'elite_support','international_standing','social_tension','legitimacy','media_climate')
 AND NEW.value IS DISTINCT FROM OLD.value THEN
  BEGIN
   PERFORM private.reconcile_budget_driver_once(NEW.game_id);
  EXCEPTION WHEN OTHERS THEN
   RAISE WARNING 'ГОС.ID: budget sync failed for game %, SQLSTATE %',NEW.game_id,SQLSTATE;
  END;
 END IF;
 RETURN NEW;
END;
$function$;
