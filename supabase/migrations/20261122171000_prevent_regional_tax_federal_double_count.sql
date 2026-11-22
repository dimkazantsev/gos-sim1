-- ГОС.ID: regional and municipal tax decisions belong to their own budgets.
-- Do not feed their revenue into the federal state_metrics budget, which in turn
-- would add it a second time to the federal simulator revenue_adjustment.
-- Preserve the current federal VAT/profit exclusion (already in the formula)
-- and the nationwide personal-income-tax adjustment route unchanged.
-- No new reads, triggers, tables, subscriptions, network requests or coefficients.
-- Existing data/ledgers and signed documents are never rewritten.
CREATE OR REPLACE FUNCTION private.apply_fiscal_metrics(p_ledger bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare l fiscal_change_ledger%rowtype;m state_metrics%rowtype;r game_fiscal_regions%rowtype;p fiscal_rate_proposals%rowtype;key text;delta numeric;old_value numeric;new_value numeric;base numeric;factor numeric;
begin
 select * into l from fiscal_change_ledger where id=p_ledger;
 if l.id is null or l.source_type not in ('event','act') then return;end if;
 if l.source_type='event' and not exists(select 1 from event_case_outcomes o join event_cases c on c.id=o.case_id where o.case_id::text=l.source_id and c.game_id=l.game_id and c.comic_scene->>'region_code'=l.region_code) then return;end if;
 if l.source_type='act' then
  select * into p from fiscal_rate_proposals where game_id=l.game_id and status='applied' and document_id::text||':'||tax_key=l.source_id and region_code=l.region_code limit 1;
  if p.id is null then return;end if;
 end if;
 foreach key in array array['budget','economy'] loop
  -- Regional event expenditure belongs to the region, never directly to
  -- federal revenue. Its activity/business changes already feed the
  -- authoritative budget formula. Prevent the second budget adjustment.
  if key='budget' and (
   l.source_type='event'
   or (l.source_type='act' and (
     l.region_code IS DISTINCT FROM '00'
     or p.tax_key in ('vat','profit','corporate_property','transport','land','personal_property','tourism','trade')
   ))
  ) then continue;end if;
  delta:=0;
  if l.source_type='event' then
   if key='budget' then delta:=coalesce((l.before_values->>'expenditure')::numeric,0)*coalesce((l.before_values->>'cost_multiplier')::numeric,1)-coalesce((l.after_values->>'expenditure')::numeric,0)*coalesce((l.after_values->>'cost_multiplier')::numeric,1);
   else delta:=100*(coalesce((l.after_values->>'activity_multiplier')::numeric,1)-coalesce((l.before_values->>'activity_multiplier')::numeric,1));end if;
  elsif key='budget' then
   for r in select * from game_fiscal_regions where game_id=l.game_id and (l.region_code='00' or region_code=l.region_code) loop
    base:=case p.tax_key when 'vat' then r.enterprises*r.consumption_per_firm*r.activity_multiplier when 'income' then r.enterprises*r.employees_per_firm*r.monthly_wage*12/1000000 when 'profit' then r.enterprises*r.profit_per_firm*r.activity_multiplier when 'corporate_property' then r.enterprises*18 when 'transport' then r.enterprises*240 when 'land' then r.enterprises*3 when 'personal_property' then r.enterprises*r.employees_per_firm*2.5 when 'tourism' then r.enterprises*(case when (select profile from fiscal_region_reference where code=r.region_code)='tourism' then 3 else .2 end) else 0 end;
    factor:=case when p.tax_key='transport' then .000001 else .01 end;
    delta:=delta+base*((l.after_values->>'rate')::numeric-(l.before_values->>'rate')::numeric)*factor*r.compliance;
   end loop;
  end if;
  if delta=0 then continue;end if;
  select * into m from state_metrics where game_id=l.game_id and metric_key=key for update;
  if m.id is null then continue;end if;
  insert into private.fiscal_metric_applied(ledger_id,metric_key) values(l.id,key) on conflict do nothing;
  if not found then continue;end if;
  old_value:=m.value;new_value:=greatest(coalesce(m.min_value,-1e12),least(coalesce(m.max_value,1e12),old_value+delta));
  if old_value=new_value then continue;end if;
  update state_metrics set value=new_value,previous_value=old_value where id=m.id;
  insert into state_metric_history(game_id,metric_id,metric_key,value,previous_value,delta,source_type,source_id,actor_id,note) values(l.game_id,m.id,key,new_value,old_value,new_value-old_value,'fiscal',l.source_id,l.actor_id,l.note||' · Учебный эффект, регион '||l.region_code);
 end loop;
end$function$
;
