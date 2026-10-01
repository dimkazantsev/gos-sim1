-- Protected, replay-safe helpers. No trigger is attached in this migration.
create table private.fiscal_metric_applied(ledger_id bigint not null references public.fiscal_change_ledger(id) on delete cascade,metric_key text not null,primary key(ledger_id,metric_key));
create table private.fiscal_periods(game_id uuid not null references public.games(id) on delete cascade,stage_no integer not null,created_at timestamptz not null default now(),primary key(game_id,stage_no));
revoke all on private.fiscal_metric_applied,private.fiscal_periods from public,anon,authenticated;

create or replace function private.apply_fiscal_metrics(p_ledger bigint) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
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
end$$;

create or replace function private.apply_published_fiscal_act(p_document uuid) returns boolean language plpgsql security definer set search_path=public,private,pg_temp as $$
declare d formal_documents%rowtype;p fiscal_rate_proposals%rowtype;old_rate numeric;begin
 select * into d from formal_documents where id=p_document;
 if d.id is null or d.status_code<>'published' or d.workflow_key<>'bill' then return false;end if;
 select * into p from fiscal_rate_proposals where document_id=d.id and game_id=d.game_id and status='pending' and region_code='00' limit 1 for update;
 if p.id is null then return false;end if;
 old_rate:=coalesce((select rate from game_fiscal_rates where game_id=p.game_id and region_code=p.region_code and tax_key=p.tax_key),(select default_rate from fiscal_tax_catalog where tax_key=p.tax_key));
 insert into game_fiscal_rates(game_id,region_code,tax_key,rate) values(p.game_id,p.region_code,p.tax_key,p.new_rate) on conflict(game_id,region_code,tax_key) do update set rate=excluded.rate,updated_at=now();
 update fiscal_rate_proposals set status='applied' where id=p.id;
 insert into fiscal_change_ledger(game_id,region_code,source_type,source_id,note,before_values,after_values,actor_id) values(p.game_id,p.region_code,'act',d.id::text||':'||p.tax_key,'Ставка учебного прогноза изменена по опубликованному '||d.registry_no,jsonb_build_object('rate',old_rate),jsonb_build_object('rate',p.new_rate),d.author_id) on conflict do nothing;
 return true;
end$$;

create or replace function private.advance_fiscal_period(p_game uuid,p_stage integer) returns integer language plpgsql security definer set search_path=public,private,pg_temp as $$
declare r game_fiscal_regions%rowtype;profit numeric;property numeric;burden numeric;after_row jsonb;changed integer:=0;
begin
 if not exists(select 1 from game_stages where game_id=p_game and stage_no=p_stage and status='completed') then return 0;end if;
 insert into private.fiscal_periods(game_id,stage_no) values(p_game,p_stage) on conflict do nothing;if not found then return 0;end if;
 perform private.ensure_fiscal_game(p_game);
 profit:=coalesce((select rate from game_fiscal_rates where game_id=p_game and region_code='00' and tax_key='profit'),25);
 for r in select * from game_fiscal_regions where game_id=p_game for update loop
  property:=coalesce((select rate from game_fiscal_rates where game_id=p_game and region_code=r.region_code and tax_key='corporate_property'),2.2);
  burden:=greatest(-.12,least(.12,(profit+property-27.2)*.003));
  if burden=0 then continue;end if;
  update game_fiscal_regions set activity_multiplier=greatest(.1,least(5,activity_multiplier*(1-burden))),updated_at=now() where game_id=r.game_id and region_code=r.region_code returning to_jsonb(game_fiscal_regions.*) into after_row;
  insert into fiscal_change_ledger(game_id,region_code,source_type,source_id,note,before_values,after_values) values(p_game,r.region_code,'period',p_stage::text,'Сценарный период после завершения этапа '||p_stage,to_jsonb(r),after_row) on conflict do nothing;
  changed:=changed+1;
 end loop;return changed;
end$$;
revoke all on function private.apply_fiscal_metrics(bigint),private.apply_published_fiscal_act(uuid),private.advance_fiscal_period(uuid,integer) from public,anon,authenticated;
