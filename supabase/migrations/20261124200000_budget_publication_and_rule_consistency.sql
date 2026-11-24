-- Budget cash identity, executable publication and existing legislative routes.
CREATE OR REPLACE FUNCTION private.calculate_budget_simulator(p_game uuid, d jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare b jsonb;s budget_simulator_state%rowtype;p game_fiscal_policy%rowtype;a jsonb;e numeric;t numeric;fx numeric;v_auto numeric;v_ref numeric;activity numeric;cost numeric;oil numeric;firms numeric;vat numeric;profit numeric;v_collection numeric;v_aux jsonb;v_activity_adj numeric;v_collection_adj numeric;v_internal_terms jsonb;v_internal_new numeric:=0;v_internal_over numeric:=0;v_internal_interest_over numeric:=0;v_oil_saving numeric:=0;v_oil_change numeric:=0;v_access jsonb;v_external_new numeric;v_external_over numeric;v_refinance numeric;v_due numeric;v_refinance_allowed numeric;v_refinance_over numeric;v_refinance_left numeric;v_repay numeric;v_paid_internal numeric:=0;v_paid_external numeric:=0;v_due_ct record;
 il jsonb:='[]';el jsonb:='[]';l jsonb;k text;n numeric;driver numeric;tax numeric;rev numeric;exp numeric;annual numeric:=0;interest numeric;transfer_exp numeric;credit numeric;fin numeric:=0;intr numeric:=0;extr numeric;balance numeric;need numeric;net_need numeric;uncertainty numeric;issued numeric;locked_rate numeric;quote numeric;item_amount numeric;base_amount numeric;transfer_amount numeric;interest_amount numeric;reallocation numeric;tr jsonb;
begin
 if exists(select 1 from games where id=p_game and status not in ('finished','archived')) then perform private.ensure_budget_simulator(p_game);end if;perform private.validate_budget_draft(p_game,d);
 -- Mandatory signed annual amounts are calculated once, independently of manual expenses.
 d:=jsonb_set(d,'{expense_items}',coalesce((select jsonb_agg(i.value order by i.ordinality) from jsonb_array_elements(coalesce(d->'expense_items','[]'::jsonb)) with ordinality i(value,ordinality) where nullif(i.value->>'program_id','') is null),'[]'::jsonb)||private.signed_program_budget_items(p_game),true);
 if jsonb_array_length(d->'expense_items')>100 then raise exception 'Сократите дополнительные ручные расходы: обязательные ГП и мероприятия должны помещаться в 100 строк.';end if;
 select data into b from private.budget_baseline where year=2026;select * into s from budget_simulator_state where game_id=p_game;select * into p from game_fiscal_policy where game_id=p_game;a:=s.anchor;
 e:=coalesce((select value from state_metrics where game_id=p_game and metric_key='economy'),(a->>'economy')::numeric)-(a->>'economy')::numeric;
 t:=coalesce((select value from state_metrics where game_id=p_game and metric_key='public_trust'),(a->>'trust')::numeric)-(a->>'trust')::numeric;
 v_aux:=private.budget_aux_impact(p_game,a);
 v_activity_adj:=coalesce((v_aux->>'activity_adjustment')::numeric,0);
 v_collection_adj:=coalesce((v_aux->>'collection_adjustment')::numeric,0);
 v_access:=private.external_borrowing_access(p_game);v_internal_terms:=private.internal_borrowing_terms(p_game);
 fx:=p.fx_rate*greatest(.75,least(1.3,1-e*.001-t*.001-(p.key_rate-(a->>'key_rate')::numeric)*.0015));
 select coalesce(sum(enterprises*activity_multiplier),0)/greatest(1,(a->>'enterprises')::numeric) into firms from game_fiscal_regions where game_id=p_game;
 activity:=greatest(.2,least(2,firms*(1-(p.key_rate-(a->>'key_rate')::numeric)*.007+e*.002+t*.001+v_activity_adj)));
 cost:=greatest(.7,least(1.6,1+(p.inflation-(a->>'inflation')::numeric)*.004+(fx/(a->>'fx_rate')::numeric-1)*.02));
 oil:=greatest(.1,least(3,p.oil_price/(a->>'oil_price')::numeric*fx/(a->>'fx_rate')::numeric))*greatest(.7,least(1.3,1+e*.002));
 vat:=coalesce((select rate from game_fiscal_rates where game_id=p_game and region_code='00' and tax_key='vat'),22);
 profit:=coalesce((select rate from game_fiscal_rates where game_id=p_game and region_code='00' and tax_key='profit'),25);
 v_collection:=greatest(.85,least(.995,.95+private.budget_tax_compliance_shift(activity,a)+coalesce((select (m.value-p.collection_lawfulness_reference)*.0003 from state_metrics m where m.game_id=p_game and m.metric_key='lawfulness' and p.collection_lawfulness_reference is not null),0)+t*.0005+v_collection_adj));
 rev:=(b->>'income_rounding')::numeric+s.revenue_adjustment;
 for l in select jsonb_array_elements(b->'income_lines') loop
  k:=l->>'key';driver:=case l->>'driver' when 'oil' then oil when 'activity' then activity else 1 end;
  tax:=case k when 'turnover' then 1+.72*(vat/22-1) when 'income' then 1+.8*(profit/25-1) else 1 end;
  n:=round(greatest(0,(l->>'amount')::numeric*driver*tax*(1+coalesce((d->'income_changes'->>k)::numeric,0)/100)*case when k in ('oil_gas','turnover','income','rent','recycling') then v_collection/.95 else 1 end+coalesce((d->'revenue_adjustments'->>k)::numeric,0)),2);
  il:=il||jsonb_build_array(jsonb_build_object('key',k,'label',l->>'label','baseline',(l->>'amount')::numeric,'amount',n));rev:=rev+n;
 end loop;
 for k in select jsonb_object_keys(b->'financing') loop
  n:=(d->'financing'->>k)::numeric;fin:=fin+n;
  if k in ('ofz_fixed','ofz_float','bank_credit','external') then
   issued:=least(n,coalesce((s.last_financing->>k)::numeric,0));
 quote:=case when k='external' then (v_access->>'rate')::numeric
 else private.budget_financing_rate(k,p.key_rate)+private.internal_borrowing_premium(p.key_rate,p.inflation) end;
 if k in ('ofz_fixed','ofz_float','bank_credit') then
  v_internal_new:=v_internal_new+greatest(0,n-coalesce((s.last_financing->>k)::numeric,0));end if;
   locked_rate:=coalesce((s.financing_rates->>k)::numeric,private.budget_financing_rate(k,(a->>'key_rate')::numeric));
   annual:=annual+case when k='ofz_float' then n*quote/100 else (issued*locked_rate+(n-issued)*quote)/100 end;
  end if;
  if k in ('ofz_fixed','ofz_float','bank_credit') then intr:=intr+n-(s.last_financing->>k)::numeric;end if;
 end loop;
 interest:=(annual-(b->'financing'->>'ofz_fixed')::numeric*(a->>'key_rate')::numeric/100)*.5+s.service_adjustment;
 select coalesce(sum(amount) filter(where kind<>'budget_credit'),0),coalesce(sum(amount) filter(where kind='budget_credit'),0) into transfer_exp,credit from budget_transfer_requests where game_id=p_game and status<>'rejected' and d->'transfer_ids' ? id::text;
 exp:=(b->>'expense_rounding')::numeric;
 for l in select jsonb_array_elements(b->'expense_lines') loop
  k:=l->>'key';select coalesce(sum(amount),0) into transfer_amount from budget_transfer_requests where game_id=p_game and status<>'rejected' and kind<>'budget_credit' and section_key=k and d->'transfer_ids' ? id::text;
  select coalesce(sum((i->>'amount')::numeric),0) into item_amount from jsonb_array_elements(coalesce(d->'expense_items','[]'::jsonb)) i where i->>'section_key'=k;
  base_amount:=(l->>'amount')::numeric*(1+coalesce((d->'spending_changes'->>k)::numeric,0)/100)*cost;
  interest_amount:=case when k='13' then interest else 0 end;
  reallocation:=coalesce((d->'base_reallocations'->>k)::numeric,0);
  if round(greatest(0,base_amount+interest_amount),2)+reallocation<0 then raise exception 'Поправка не может уменьшить базовое ассигнование раздела ниже нуля или расходовать защищённые программы и трансферты.';end if;
  n:=round(round(greatest(0,base_amount+interest_amount),2)+reallocation+transfer_amount+item_amount,8);
  el:=el||jsonb_build_array(jsonb_build_object('key',k,'label',l->>'label','baseline',(l->>'amount')::numeric,'base_amount',round(greatest(0,base_amount+interest_amount),2)-interest_amount+reallocation,'base_reallocation_amount',reallocation,'transfer_amount',transfer_amount,'items_amount',item_amount,'interest_amount',interest_amount,'amount',n));exp:=exp+n;
 end loop;
 v_external_new:=greatest(0,(d->'financing'->>'external')::numeric-case when s.last_plan_id is null then 0 else (s.last_financing->>'external')::numeric end);
 v_external_over:=greatest(0,v_external_new-(v_access->>'available')::numeric);
 v_internal_over:=greatest(0,v_internal_new-(v_internal_terms->>'available')::numeric);
 v_internal_interest_over:=greatest(0,annual-rev*.10);
 v_refinance:=coalesce((d->>'external_refinance')::numeric,0);
 select coalesce(sum(case when c.source_key='external' then c.principal*fx/(a->>'fx_rate')::numeric else c.principal end),0)
 into v_due from budget_finance_contracts c where c.game_id=p_game and c.status='due' and c.maturity_month<=s.month and c.principal>0;
 v_refinance_allowed:=least(v_refinance,v_due,v_external_new);
 v_refinance_over:=greatest(0,v_refinance-v_refinance_allowed);
 v_refinance_left:=v_refinance_allowed;
 for v_due_ct in select source_key,principal from budget_finance_contracts
 where game_id=p_game and status='due' and maturity_month<=s.month and principal>0 order by maturity_month,id loop
  exit when v_refinance_left<=0;
  v_repay:=least(v_refinance_left,case when v_due_ct.source_key='external' then v_due_ct.principal*fx/(a->>'fx_rate')::numeric else v_due_ct.principal end);
  if v_due_ct.source_key='external' then v_paid_external:=v_paid_external+v_repay;else v_paid_internal:=v_paid_internal+v_repay;end if;
  v_refinance_left:=greatest(0,v_refinance_left-v_repay);
 end loop;
 intr:=round(greatest(0,s.internal_debt+intr-v_paid_internal),8);
 extr:=round(greatest(0,s.external_debt*fx/(a->>'fx_rate')::numeric+(d->'financing'->>'external')::numeric-(s.last_financing->>'external')::numeric-v_paid_external),8);
 fin:=fin-v_refinance;
 select round(coalesce((i->>'amount')::numeric,0)
 *greatest(0,p.oil_price-p.cutoff_price)/greatest(.01,p.oil_price),8)
 into v_oil_saving from jsonb_array_elements(il) i where i->>'key'='oil_gas';
 v_oil_saving:=coalesce(v_oil_saving,0);
 v_oil_change:=v_oil_saving-s.fnb_last_oil_allocation;
 rev:=round(rev,2);exp:=round(exp,8);balance:=round(rev-exp,8);
 -- Surplus also covers mandatory financial outflows.
 net_need:=round(-balance+credit+v_oil_change,8);
 need:=greatest(0,net_need);
 uncertainty:=greatest(.025,least(.2,.04+abs(e)*.001+abs(t)*.001+abs(p.inflation-(a->>'inflation')::numeric)*.003));
 select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at,r.id),'[]'::jsonb) into tr from (select r.*,f.name region_name,c.title event_title from budget_transfer_requests r join fiscal_region_reference f on f.code=r.region_code left join event_cases c on c.id=r.event_case_id and c.game_id=r.game_id where r.game_id=p_game and r.status<>'rejected' and d->'transfer_ids' ? r.id::text) r;
 return jsonb_build_object('budget_year',2027,'baseline_year',2026,'income_lines',il,'income_details',private.budget_income_details(p_game,d,il,activity,oil),'expense_lines',el,'expense_items',coalesce(d->'expense_items','[]'::jsonb),'program_expenses',private.server_budget_program_expenses(p_game,coalesce(d->'expense_items','[]'::jsonb)),'transfer_requests',tr,'income_rounding',(b->>'income_rounding')::numeric,'revenue_adjustment',s.revenue_adjustment,'revenue',rev,'expenditure',exp,'balance',balance,'deficit',greatest(0,-balance),'surplus',greatest(0,balance),
 'deficit_pct_gdp',greatest(0,-balance)/(b->>'gdp')::numeric*100,'financing',round(fin,8),'funding_need',need,'funding_gap',round(greatest(0,net_need-fin),8),'cash_excess',round(greatest(0,fin-net_need),8),
 'internal_debt',intr,'external_debt',extr,'debt_total',intr+extr,'debt_pct_gdp',(intr+extr)/(b->>'gdp')::numeric*100,'annual_interest',annual,'interest_delta',interest,'transfer_expense',transfer_exp,'credit_outflow',credit,
 'reserve_remaining',round(s.reserve_remaining+v_oil_change-(d->'financing'->>'reserves')::numeric+case when s.last_plan_id is not null then (s.last_financing->>'reserves')::numeric else 0 end,8),
 'activity',activity,'cost',cost,'fx',fx,'uncertainty',uncertainty,'model_b_additional_channels',v_aux,
 'external_borrowing_limit',(v_access->>'annual_limit')::numeric,'external_borrowing_available',(v_access->>'available')::numeric,
 'external_borrowing_used',(v_access->>'used')::numeric,'external_borrowing_rate',(v_access->>'rate')::numeric,
 'external_borrowing_new',v_external_new,'external_borrowing_over_limit',v_external_over,
 'external_refinance',v_refinance,'external_refinance_eligible',v_due,
 'external_refinance_allocated',v_refinance_allowed,'external_refinance_over_limit',v_refinance_over,'revenue_low',rev*(1-uncertainty),'revenue_high',rev*(1+uncertainty),'expenditure_low',exp*(1-uncertainty),'expenditure_high',exp*(1+uncertainty))||
 jsonb_build_object('internal_borrowing_limit',(v_internal_terms->>'annual_limit')::numeric,
 'internal_borrowing_available',(v_internal_terms->>'available')::numeric,
 'internal_borrowing_used',(v_internal_terms->>'used')::numeric,
 'internal_borrowing_new',v_internal_new,'internal_borrowing_over_limit',v_internal_over,
 'internal_interest_over_limit',v_internal_interest_over,
 'internal_borrowing_premium',private.internal_borrowing_premium(p.key_rate,p.inflation),
 'fnb_oil_allocation',v_oil_saving,'fnb_oil_change',v_oil_change,'fnb_total',s.fnb_total+v_oil_change-(d->'financing'->>'reserves')::numeric+case when s.last_plan_id is not null then (s.last_financing->>'reserves')::numeric else 0 end);
end$function$;

CREATE OR REPLACE FUNCTION private.budget_forecast_signature(p_game uuid, p_draft jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
 SELECT md5(jsonb_build_array(
  'budget_2027_net_cash_v2',
  p_draft,
  (select data from private.budget_baseline where year=2026),
  (select status from public.games where id=p_game),
  (select to_jsonb(t) from public.budget_simulator_state t where t.game_id=p_game),
  (select to_jsonb(t) from public.game_fiscal_policy t where t.game_id=p_game),
  (select coalesce(jsonb_agg(jsonb_build_array(t.region_code,t.enterprises,t.activity_multiplier) order by t.region_code),'[]'::jsonb) from public.game_fiscal_regions t where t.game_id=p_game),
  (select coalesce(jsonb_agg(jsonb_build_array(t.tax_key,t.rate) order by t.tax_key),'[]'::jsonb) from public.game_fiscal_rates t where t.game_id=p_game and t.region_code='00' and t.tax_key in ('vat','profit')),
  (select coalesce(jsonb_agg(jsonb_build_array(t.metric_key,t.value) order by t.metric_key),'[]'::jsonb) from public.state_metrics t where t.game_id=p_game and t.metric_key in ('economy','public_trust','lawfulness','social_stability','security','elite_support','international_standing','social_tension','legitimacy','media_climate')),
  (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.budget_transfer_requests t where t.game_id=p_game),
  (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.state_programs t where t.game_id=p_game),
  (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.state_program_goals t where t.game_id=p_game),
  (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.state_program_components t where t.game_id=p_game),
  (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.state_program_expenses t where t.game_id=p_game),
  (select coalesce(jsonb_agg(to_jsonb(t) order by t.program_id,t.budget_year),'[]'::jsonb) from public.state_program_budget_commitments t where t.game_id=p_game),
  (select coalesce(jsonb_agg(jsonb_build_array(c.source_key,c.issued_month,c.issued_rubles,c.status,c.principal) order by c.id),'[]'::jsonb) from public.budget_finance_contracts c where c.game_id=p_game),
  (select coalesce(jsonb_agg(jsonb_build_array(t.id,t.title) order by t.id),'[]'::jsonb) from public.event_cases t where t.game_id=p_game and exists(select 1 from public.budget_transfer_requests r where r.game_id=p_game and r.event_case_id=t.id)),
  (select coalesce(jsonb_agg(jsonb_build_array(t.code,t.name) order by t.code),'[]'::jsonb) from public.fiscal_region_reference t where exists(select 1 from public.budget_transfer_requests r where r.game_id=p_game and r.region_code=t.code))
 )::text);
$function$;

CREATE OR REPLACE FUNCTION private.guard_budget_government_ballot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare d formal_documents%rowtype;weights jsonb;eligible numeric;
begin
 if new.formal_document_id is null then return new;end if;
 select * into d from formal_documents where id=new.formal_document_id and game_id=new.game_id;
 if d.id is null or d.doc_type<>'federal_budget' or d.workflow_key<>'budget' then return new;end if;
 if nullif(trim(coalesce(new.group_name,'')),'') is not null or nullif(trim(coalesce(current_setting('app.vote_group',true),'')),'') is not null then raise exception 'Бюджет голосуется полным составом соответствующего органа: учебная группа не сокращает состав.';end if;
 if d.status_code in ('president_veto','sf_veto') then
  perform private.lock_budget_actor(d.game_id);
  if new.voting_mode is distinct from 'mandate' or new.institution_key is distinct from 'gd'
   or new.procedure_key is distinct from (case when d.status_code='sf_veto' then 'sf_veto_override' else 'presidential_veto_override' end) or new.formal_step_code is distinct from d.status_code
   or new.quorum_kind is distinct from 'fraction' or new.quorum_value is distinct from 0.5
   or new.majority_kind is distinct from 'eligible_fraction' or abs(new.majority_value-2::numeric/3)>0.00000001
   or new.allow_abstain is distinct from true or new.tie_breaker_chair is distinct from false
   or new.pass_transition is distinct from 'advance' or new.fail_transition is distinct from 'reject'
   or new.status is distinct from 'open' or new.created_by is distinct from auth.uid() then raise exception 'Преодоление вето по бюджету требует установленного голосования Государственной Думы.';end if;
  select coalesce(jsonb_object_agg(w.key,w.value),'{}'::jsonb) into weights from jsonb_each(coalesce(new.electorate_snapshot->'weights','{}'::jsonb)) w
   where exists(select 1 from game_members m where m.game_id=new.game_id and m.user_id::text=w.key and m.roster_archived_at is null);
  new.electorate_snapshot:=new.electorate_snapshot||jsonb_build_object('weights',weights,'eligible',450);
  return new;
 end if;
 if d.status_code in ('reading1','reading2','reading3') then
  perform private.lock_budget_actor(d.game_id);
  if new.voting_mode is distinct from 'mandate' or new.institution_key is distinct from 'gd'
   or new.procedure_key is distinct from 'budget_'||d.status_code or new.formal_step_code is distinct from d.status_code
   or new.quorum_kind is distinct from 'fraction' or new.quorum_value is distinct from 0.5
   or new.majority_kind is distinct from 'eligible_majority' or new.majority_value is distinct from 0.5
   or new.allow_abstain is distinct from true or new.tie_breaker_chair is distinct from false
   or new.pass_transition is distinct from 'advance' or new.fail_transition is distinct from (case when d.status_code='reading1' then 'none' else 'reject' end)
   or new.status is distinct from 'open' or new.created_by is distinct from auth.uid() then raise exception 'Чтение бюджета требует голосования Государственной Думы большинством от полного состава при зарегистрированном кворуме.';end if;
  select coalesce(jsonb_object_agg(w.key,w.value),'{}'::jsonb) into weights from jsonb_each(coalesce(new.electorate_snapshot->'weights','{}'::jsonb)) w
   where exists(select 1 from game_members m where m.game_id=new.game_id and m.user_id::text=w.key and m.roster_archived_at is null);
  new.electorate_snapshot:=new.electorate_snapshot||jsonb_build_object('weights',weights,'eligible',450);
  return new;
 end if;
 if not(d.status_code='government' or d.status_code='revision' and d.current_owner_key='government' and d.current_step=1) then raise exception 'На этом шаге бюджет проходит установленную процедуру реестра; произвольное голосование не заменяет её.';end if;
 perform private.lock_budget_actor(d.game_id);
 if nullif(trim(coalesce(new.group_name,'')),'') is not null or nullif(trim(coalesce(current_setting('app.vote_group',true),'')),'') is not null then raise exception 'Внесение федерального бюджета голосуется полным составом Правительства: учебная группа не сокращает состав.';end if;
 if not private.is_game_teacher(d.game_id) and not exists(select 1 from private.formal_user_roles(d.game_id,auth.uid()) r
  where r ~ '^председатель[[:space:]]+правительства([[:space:]]|$)') then raise exception 'Коллегиальное внесение бюджета открывает Председатель Правительства или преподаватель.';end if;
 if new.voting_mode is distinct from 'member' or new.institution_key is distinct from 'government'
  or new.procedure_key is distinct from 'budget_government_submission' or new.formal_step_code is distinct from d.status_code
  or new.quorum_kind is distinct from 'fraction' or new.quorum_value is distinct from 0.5
  or new.majority_kind is distinct from 'present_majority' or new.majority_value is distinct from 0.5
  or new.allow_abstain is distinct from true or new.tie_breaker_chair is distinct from true
  or new.pass_transition is distinct from 'advance' or new.fail_transition is distinct from 'return_author'
  or new.status is distinct from 'open' or new.created_by is distinct from auth.uid() then raise exception 'Для внесения бюджета требуется голосование Правительства с регистрацией, кворумом и решением по установленной процедуре.';end if;
 -- This trigger runs after the common electorate snapshot. Exclude archived
 -- actors only for this new budget ballot; other elections keep their snapshot.
 select coalesce(jsonb_object_agg(w.key,w.value),'{}'::jsonb),coalesce(sum((w.value#>>'{}')::numeric),0)
  into weights,eligible from jsonb_each(coalesce(new.electorate_snapshot->'weights','{}'::jsonb)) w
  where exists(select 1 from game_members m where m.game_id=new.game_id and m.user_id::text=w.key and m.roster_archived_at is null);
 new.electorate_snapshot:=new.electorate_snapshot||jsonb_build_object('weights',weights,'eligible',eligible);
 return new;
end;$function$;

CREATE OR REPLACE FUNCTION private.lawfulness_sf_document_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_law numeric;
begin
 if new.workflow_key not in ('bill','budget')
    or new.doc_type not in ('fz_bill','fkz_bill','federal_budget')
    or new.status_code is not distinct from old.status_code
    or old.status_code not in ('reading3','sf','sf_veto','sf_fkz_blocked') then
  return new;
 end if;
 select value into v_law from public.state_metrics
 where game_id=new.game_id and metric_key='lawfulness';

 if old.status_code in ('reading3','sf') and new.status_code in ('sf','president')
    and coalesce(v_law,100)<30 then
  new.current_step:=case when old.status_code='reading3' then old.current_step+1 else old.current_step end;
  new.status_code:=case when new.doc_type='fkz_bill' then 'sf_fkz_blocked' else 'sf_veto' end;
  new.status_label:=case when new.doc_type='fkz_bill'
   then 'Совет Федерации не одобрил ФКЗ: правовая устойчивость ниже 30%'
   else 'Совет Федерации отклонил ФЗ: требуется 2/3 голосов Государственной Думы' end;
  new.current_owner_key:=case when new.doc_type='fkz_bill' then 'sf' else 'gd_council' end;
  return new;
 end if;

 if old.status_code='sf_fkz_blocked'
    and new.status_code not in ('sf_fkz_blocked','rejected','revision','withdrawn','superseded')
    and coalesce(v_law,100)<30 then
  raise exception 'ФКЗ не может быть принят без необходимого одобрения Совета Федерации; преодоление вето одной Государственной Думой неприменимо.'
    using errcode='42501';
 end if;

 if old.status_code='sf_veto' and new.status_code not in
    ('sf_veto','rejected','revision','withdrawn','superseded')
    and (coalesce(v_law,100)<30 or (old.workflow_key='budget' and old.metadata->>'budget_sf_rejected_by_teacher'='true')) then
  if not exists (
    select 1 from public.game_votes v
    where v.game_id=new.game_id and v.formal_document_id=new.id
      and v.formal_step_code='sf_veto'
      and v.procedure_key='sf_veto_override' and v.institution_key='gd'
      and v.status='closed' and v.result_code='passed' and v.result_quorum_met
      and v.result_eligible>0
      and v.result_yes>=ceil(v.result_eligible*2/3)
  ) then
   raise exception 'Требуется повторное принятие ФЗ не менее чем 2/3 голосов от общего числа депутатов Государственной Думы.'
     using errcode='42501';
  end if;
  if new.status_code='president' and old.metadata->>'budget_sf_rejected_by_teacher'='true' then
   new.metadata:=new.metadata-'budget_sf_rejected_by_teacher';
  end if;
 end if;
 return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.lawfulness_sf_threshold_reconcile()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d public.formal_documents%rowtype; v_step jsonb;
begin
 if old.value>=30 and new.value<30 then
  for d in select * from public.formal_documents
    where game_id=new.game_id and status_code='sf'
      and doc_type in ('fz_bill','fkz_bill','federal_budget')
      and workflow_key in ('bill','budget') for update
  loop
   update public.game_votes set status='closed',closed_at=now(),
      result_code='superseded',result_label='Рассмотрение заменено автоматическим решением Совета Федерации'
   where formal_document_id=d.id and formal_step_code='sf' and status='open';
   update public.formal_documents
   set status_code=case when d.doc_type='fkz_bill' then 'sf_fkz_blocked' else 'sf_veto' end,
       status_label=case when d.doc_type='fkz_bill'
        then 'Совет Федерации не одобрил ФКЗ: правовая устойчивость ниже 30%'
        else 'Совет Федерации отклонил ФЗ: требуется 2/3 голосов Государственной Думы' end,
       current_owner_key=case when d.doc_type='fkz_bill' then 'sf' else 'gd_council' end,updated_at=now()
   where id=d.id;
   insert into public.formal_document_history(document_id,game_id,actor_id,action,
       from_status,to_status,from_owner,to_owner,note)
   values(d.id,d.game_id,null,'Автоматическое решение Совета Федерации при падении правовой устойчивости',
      d.status_code,case when d.doc_type='fkz_bill' then 'sf_fkz_blocked' else 'sf_veto' end,
      d.current_owner_key,case when d.doc_type='fkz_bill' then 'sf' else 'gd_council' end,
      'Правовая устойчивость снизилась ниже 30%; действие является игровым условием');
  end loop;
 elsif old.value<30 and new.value>=30 then
  for d in select * from public.formal_documents
    where game_id=new.game_id and status_code in ('sf_veto','sf_fkz_blocked')
      and not coalesce(metadata->>'budget_sf_rejected_by_teacher'='true',false)
      and doc_type in ('fz_bill','fkz_bill','federal_budget')
      and workflow_key in ('bill','budget') for update
  loop
   v_step:=d.workflow_steps->(d.current_step+1);
   if v_step->>'code' is distinct from 'president' then continue; end if;
   update public.game_votes set status='closed',closed_at=now(),
      result_code='superseded',result_label='Автоматическое отклонение снято после восстановления правовой устойчивости'
   where formal_document_id=d.id and formal_step_code=d.status_code and status='open';
   update public.formal_documents
   set current_step=d.current_step+1,status_code=v_step->>'code',
       status_label=v_step->>'label',current_owner_key=v_step->>'owner',updated_at=now()
   where id=d.id;
   insert into public.formal_document_history(document_id,game_id,actor_id,action,
       from_status,to_status,from_owner,to_owner,note)
   values(d.id,d.game_id,null,'Автоматическое отклонение Совета Федерации снято после восстановления правовой устойчивости',
      d.status_code,v_step->>'code',d.current_owner_key,v_step->>'owner',
      'Правовая устойчивость восстановлена до 30% или выше; действие является игровым условием');
  end loop;
 end if;
 return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.propose_cutoff_price_bill(p_game_id uuid, p_new_price numeric, p_expected_price numeric, p_reason text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_uid uuid:=auth.uid();v_old numeric;v_doc uuid;v_existing uuid;
 v_steps jsonb;v_stage integer;v_no text;v_body text;
BEGIN
 IF NOT private.can_propose_cutoff_price(p_game_id,v_uid) THEN
  RAISE EXCEPTION 'Инициативу вправе подготовить только действующий руководитель Министерства по экономической политике.' USING errcode='42501';
 END IF;
 IF p_request_id IS NULL OR p_new_price IS NULL OR p_expected_price IS NULL
  OR p_new_price<0 OR p_new_price>100000 OR p_new_price<>round(p_new_price,2)
  OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 8 AND 1500 THEN
  RAISE EXCEPTION 'Цена от 0 до 100000, обоснование от 8 до 1500 символов.' USING errcode='22023';END IF;
 SELECT f.cutoff_price INTO v_old FROM public.game_fiscal_policy f WHERE f.game_id=p_game_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Экономические параметры игры не найдены.';END IF;
 SELECT x.document_id INTO v_existing FROM private.cutoff_price_law_proposals x
 WHERE x.game_id=p_game_id AND x.author_id=v_uid AND x.request_id=p_request_id;
 IF v_existing IS NOT NULL THEN RETURN jsonb_build_object('document_id',v_existing,'already_created',true);END IF;
 IF v_old IS DISTINCT FROM p_expected_price THEN
  RAISE EXCEPTION 'Цена отсечения изменилась. Обновите показатели.' USING errcode='40001';END IF;
 IF v_old=p_new_price THEN RAISE EXCEPTION 'Значение совпадает с действующим.' USING errcode='22023';END IF;
 -- Route financial-rule bills through the implemented legislative procedure.
 SELECT st.stage_no INTO v_stage FROM public.game_stages st
 WHERE st.game_id=p_game_id AND st.stage_no=12 AND st.status='open'
  AND (st.deadline IS NULL OR st.deadline>clock_timestamp());
 IF v_stage IS NULL THEN RAISE EXCEPTION 'Для рассмотрения изменения бюджетного правила необходимо открыть Этап 12 (законодательная процедура).' USING errcode='42501';END IF;
 v_doc:=gen_random_uuid();
 v_no:='ГОС.ID-ЗП-ФЗ-'||lpad(nextval('public.formal_registry_seq')::text,4,'0');
 v_steps:=jsonb_insert(private.formal_workflow('bill'),'{1}',jsonb_build_object(
   'code','government','label','Одобрение Правительством Российской Федерации',
   'owner','government','action','Одобрить внесение в Государственную Думу'),false);
 v_body:='Проект федерального закона'||E'\n'
  ||'«О внесении изменения в статью 96.6 Бюджетного кодекса Российской Федерации»'
  ||E'\n\n'||'Статья 1'||E'\n'
  ||'Абзац второй пункта 4 статьи 96.6 Бюджетного кодекса Российской Федерации изложить в следующей редакции:'
  ||E'\n'||'«'||replace(p_new_price::text,'.',',')
  ||' долларов США за один баррель в 2027 году;».'
  ||E'\n\n'||'Статья 2'||E'\n'
  ||'Настоящий Федеральный закон вступает в силу со дня его официального опубликования.'
  ||E'\n\n'||'Обоснование Министерства по экономической политике: '||btrim(p_reason);
 PERFORM set_config('app.gos_registry_independent_id',v_doc::text,true);
 PERFORM set_config('app.gos_cutoff_bill_create_id',v_doc::text,true);
 INSERT INTO public.formal_documents(
   id,game_id,stage_no,registry_no,title,doc_type,subject_key,subject_label,author_id,
   body_text,workflow_key,workflow_steps,current_step,status_code,status_label,current_owner_key,metadata)
 VALUES(v_doc,p_game_id,v_stage,v_no,'Проект ФЗ об изменении базовой цены нефти (цены отсечения)',
  'fz_bill','government','Правительство Российской Федерации',v_uid,
  v_body,'bill',v_steps,0,'draft','Подготовка Министерством по экономической политике',
  'author',jsonb_build_object('registry_independent',true,'cutoff_price_proposal',true,
    'proposal_old_price',v_old,'proposal_new_price',p_new_price,
    'issuer_name','Правительство Российской Федерации','acting_user_id',v_uid,
    'acting_office_title','Министерство по экономической политике',
    'legal_basis','Пункт 4 статьи 96.6 БК РФ; статьи 104–107 Конституции РФ'));
 INSERT INTO private.cutoff_price_law_proposals(
  document_id,game_id,author_id,request_id,old_price,new_price,reason)
 VALUES(v_doc,p_game_id,v_uid,p_request_id,v_old,p_new_price,btrim(p_reason));
 PERFORM set_config('app.gos_cutoff_bill_create_id','',true);
 PERFORM set_config('app.gos_registry_independent_id','',true);
 INSERT INTO public.formal_document_history(document_id,game_id,actor_id,action,to_status,to_owner,note)
 VALUES(v_doc,p_game_id,v_uid,'Министерство подготовило проект изменения цены отсечения',
  'draft','author','Предложено '||p_new_price||' долл./барр. Значение не изменено до вступления ФЗ в силу.');
 RETURN jsonb_build_object('document_id',v_doc,'new_price',p_new_price,'status','draft');
END $function$;

CREATE OR REPLACE FUNCTION public.confirm_cutoff_sf_review(p_document_id uuid, p_approved boolean, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_uid uuid:=auth.uid();d public.formal_documents%rowtype;v_next integer;v_step jsonb;
BEGIN
 SELECT * INTO d FROM public.formal_documents WHERE id=p_document_id FOR UPDATE;
 IF d.id IS NULL OR v_uid IS NULL OR NOT private.is_game_teacher(d.game_id)
   OR d.workflow_key<>'bill' OR d.doc_type<>'fz_bill'
   OR (d.metadata->>'cutoff_price_proposal') IS DISTINCT FROM 'true' OR d.status_code<>'sf'
 THEN RAISE EXCEPTION 'Решение Совета Федерации недоступно для подтверждения.' USING errcode='42501';END IF;
 IF p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 8 AND 1500
 THEN RAISE EXCEPTION 'Обоснование решения Совета Федерации: от 8 до 1500 символов.';END IF;
 IF EXISTS(SELECT 1 FROM public.game_votes v WHERE
  v.formal_document_id=d.id AND v.status='open')
 THEN RAISE EXCEPTION 'Завершите открытое голосование Совета Федерации.';END IF;
 IF p_approved THEN
  v_next:=d.current_step+1;v_step:=d.workflow_steps->v_next;
  IF v_step->>'code'<>'president' THEN RAISE EXCEPTION 'Нарушен маршрут законопроекта.';END IF;
  UPDATE public.formal_documents SET current_step=v_next,status_code='president',
   status_label=v_step->>'label',current_owner_key='president',updated_at=now()
  WHERE id=d.id;
  UPDATE private.cutoff_price_law_proposals SET sf_confirmed_by=v_uid,sf_confirmed_at=now()
  WHERE document_id=d.id;
 ELSE
  UPDATE public.formal_documents SET status_code='rejected',status_label='Отклонён Советом Федерации',
   current_owner_key='system',updated_at=now() WHERE id=d.id;
 END IF;
 INSERT INTO public.formal_document_history(document_id,game_id,actor_id,action,
  from_status,to_status,from_owner,to_owner,note)
 VALUES(d.id,d.game_id,v_uid,CASE WHEN p_approved
  THEN 'Подтверждено одобрение Совета Федерации'
  ELSE 'Подтверждено отклонение Совета Федерации' END,
  'sf',CASE WHEN p_approved THEN 'president' ELSE 'rejected' END,
  'sf',CASE WHEN p_approved THEN 'president' ELSE 'system' END,
  btrim(p_note)||' · Решение подтверждено преподавателем по правилам игровой редукции');
END $function$;


-- Explicit educational confirmation only when there is no assigned chamber.
CREATE OR REPLACE FUNCTION public.confirm_budget_sf_review(p_document_id uuid,p_approved boolean,p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE d public.formal_documents%rowtype;uid uuid:=auth.uid();v_next integer;v_step jsonb;v_status text;
BEGIN
 SELECT * INTO d FROM public.formal_documents WHERE id=p_document_id FOR UPDATE;
 IF uid IS NULL OR d.id IS NULL OR NOT private.is_game_teacher(d.game_id)
  OR d.workflow_key IS DISTINCT FROM 'budget' OR d.doc_type IS DISTINCT FROM 'federal_budget'
  OR d.status_code IS DISTINCT FROM 'sf' OR d.current_owner_key IS DISTINCT FROM 'sf'
  OR NOT (d.metadata ? 'budget_simulator_plan_id') OR p_approved IS NULL
 THEN RAISE EXCEPTION 'Подтверждение решения Совета Федерации по бюджету недоступно.' USING errcode='42501';END IF;
 PERFORM private.lock_budget_actor(d.game_id);
 IF EXISTS(SELECT 1 FROM public.game_members m WHERE m.game_id=d.game_id
   AND m.roster_archived_at IS NULL AND private.vote_member_has_office(d.game_id,m.user_id,'sf'))
 THEN RAISE EXCEPTION 'Совет Федерации сформирован. Решение принимается действующими членами палаты.' USING errcode='42501';END IF;
 IF length(btrim(coalesce(p_note,''))) NOT BETWEEN 8 AND 1500 THEN
  RAISE EXCEPTION 'Укажите основание решения Совета Федерации (8–1500 символов).';END IF;
 IF EXISTS(SELECT 1 FROM public.game_votes WHERE formal_document_id=d.id AND status='open') THEN
  RAISE EXCEPTION 'Сначала завершите открытое голосование.';END IF;
 IF (SELECT count(DISTINCT formal_step_code) FROM public.game_votes
  WHERE game_id=d.game_id AND formal_document_id=d.id AND formal_step_code IN ('reading1','reading2','reading3')
   AND procedure_key='budget_'||formal_step_code AND status='closed' AND result_code='passed'
   AND result_quorum_met AND result_yes>=226)<>3 THEN
  RAISE EXCEPTION 'Бюджет не прошёл три чтения Государственной Думы.' USING errcode='42501';END IF;
 v_next:=d.current_step+1;v_step:=d.workflow_steps->v_next;
 IF v_step->>'code' IS DISTINCT FROM 'president' THEN RAISE EXCEPTION 'Нарушен маршрут бюджета.';END IF;
 IF p_approved THEN
  IF coalesce((SELECT value FROM public.state_metrics WHERE game_id=d.game_id AND metric_key='lawfulness'),100)<30 THEN
   RAISE EXCEPTION 'При правовой устойчивости ниже 30%% применяется предусмотренное игрой отклонение Совета Федерации.';END IF;
  UPDATE public.formal_documents SET current_step=v_next,status_code='president',
   status_label=v_step->>'label',current_owner_key='president',updated_at=now()
   WHERE id=d.id RETURNING status_code INTO v_status;
  IF v_status<>'president' THEN RAISE EXCEPTION 'Игровые условия рассмотрения изменились.';END IF;
 ELSE
  UPDATE public.formal_documents SET status_code='sf_veto',
   status_label='Совет Федерации отклонил бюджет: повторное принятие в ГД не менее чем 2/3 голосов',
   current_owner_key='gd_council',metadata=metadata||jsonb_build_object('budget_sf_rejected_by_teacher',true),updated_at=now()
   WHERE id=d.id;
 END IF;
 INSERT INTO public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
 VALUES(d.id,d.game_id,uid,CASE WHEN p_approved THEN 'Подтверждено одобрение бюджета Советом Федерации'
   ELSE 'Подтверждено отклонение бюджета Советом Федерации' END,'sf',
   CASE WHEN p_approved THEN 'president' ELSE 'sf_veto' END,'sf',
   CASE WHEN p_approved THEN 'president' ELSE 'gd_council' END,
   btrim(p_note)||' · Игровое подтверждение при отсутствии назначенных сенаторов');
END;
$function$;
REVOKE ALL ON FUNCTION public.confirm_budget_sf_review(uuid,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_budget_sf_review(uuid,boolean,text) TO authenticated;

-- Publication and financial application are one atomic operation.
CREATE OR REPLACE FUNCTION private.apply_budget_on_publication()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE plan_id uuid;
BEGIN
 IF OLD.status_code IS DISTINCT FROM 'president'
  OR NOT private.matches_formal_owner(NEW.game_id,auth.uid(),'president',NEW.author_id)
  OR NOT EXISTS(SELECT 1 FROM public.game_profiles gp WHERE gp.game_id=NEW.game_id
      AND gp.user_id=auth.uid() AND nullif(gp.signature_path,'') IS NOT NULL)
 THEN RAISE EXCEPTION 'Закон о бюджете подписывает действующий Президент Российской Федерации.' USING ERRCODE='42501';END IF;
 plan_id:=(NEW.metadata->>'budget_simulator_plan_id')::uuid;
 IF plan_id IS NULL OR NOT private.apply_budget_simulator_plan(NEW.game_id,plan_id) THEN
  RAISE EXCEPTION 'Не удалось применить утверждённый расчёт бюджета. Закон не опубликован.';
 END IF;
 RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.apply_budget_on_publication() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER apply_budget_law_on_publication AFTER UPDATE OF status_code ON public.formal_documents
FOR EACH ROW WHEN (NEW.workflow_key='budget' AND NEW.doc_type='federal_budget'
 AND NEW.status_code='published' AND OLD.status_code IS DISTINCT FROM NEW.status_code)
EXECUTE FUNCTION private.apply_budget_on_publication();
