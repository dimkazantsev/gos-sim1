-- ГОС.ID · Economic model B: avoid double budget credit from regional event effects.
-- Current effects already propagate through regions and the economy metric.
-- Retain all historic ledger entries; never recalculate votes, assessments or documents.
-- Same internal functions, no RLS changes, no new queries on budget read.
SET LOCAL lock_timeout='1500ms';
SET LOCAL statement_timeout='12s';
DO $guard$ BEGIN
 IF md5(pg_get_functiondef('private.apply_fiscal_metrics(bigint)'::regprocedure))<>'74c6454ba06a4d116421ba0a9607a20f' THEN
  RAISE EXCEPTION 'Unexpected changes to apply_fiscal_metrics';
 END IF;
 IF md5(pg_get_functiondef('private.fiscal_event_outcome()'::regprocedure))<>'607b3ae13b3abbb7b06ca463dfc48e34' THEN
  RAISE EXCEPTION 'Unexpected changes to fiscal_event_outcome';
 END IF;
END $guard$;
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
  if key='budget' and l.source_type='event' then continue;end if;
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
end$function$;
CREATE OR REPLACE FUNCTION private.fiscal_event_outcome()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare c event_cases%rowtype;fx jsonb;rc text;before_row jsonb;after_row jsonb;opt integer;
begin
 select * into c from event_cases where id=new.case_id and game_id=new.game_id;
 if c.id is null then return new;end if;
 if coalesce(new.winner,'') !~ '^option_[0-9]+$' then return new;end if;
 opt:=substring(new.winner from 8)::integer-1;fx:=c.effect_plan->'options'->opt->'fiscal_effect';rc:=c.comic_scene->>'region_code';
 if jsonb_typeof(fx) is distinct from 'object' or rc is null then return new;end if;
 if exists(select 1 from fiscal_change_ledger where game_id=c.game_id and source_type='event' and source_id=c.id::text and region_code=rc) then return new;end if;
 perform private.ensure_fiscal_game(c.game_id);
 select to_jsonb(r) into before_row from game_fiscal_regions r where game_id=c.game_id and region_code=rc for update;
 if before_row is null then return new;end if;
 -- The row lock serializes competing outcomes within one region.
 -- Recheck after acquiring it, so the same case cannot apply twice.
 if exists(select 1 from fiscal_change_ledger where game_id=c.game_id
   and source_type='event' and source_id=c.id::text and region_code=rc) then return new;end if;
 update game_fiscal_regions set enterprises=least(10000000,greatest(0,enterprises+coalesce((fx->>'enterprises')::int,0))),expenditure=greatest(0,expenditure+coalesce((fx->>'expenditure')::numeric,0)),transfer_in=greatest(0,transfer_in+coalesce((fx->>'transfer_in')::numeric,0)),activity_multiplier=greatest(.05,least(5,activity_multiplier+coalesce((fx->>'activity')::numeric,0))),cost_multiplier=greatest(.05,least(5,cost_multiplier+coalesce((fx->>'cost')::numeric,0))),updated_at=now() where game_id=c.game_id and region_code=rc returning to_jsonb(game_fiscal_regions.*) into after_row;
 insert into fiscal_change_ledger(game_id,region_code,source_type,source_id,note,before_values,after_values) values(c.game_id,rc,'event',c.id::text,'Исход кейса «'||c.title||'»',before_row,after_row);
 return new;
end $function$;
