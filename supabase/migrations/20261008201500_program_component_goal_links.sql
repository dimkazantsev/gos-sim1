-- Goals describe measurable outcomes; components explicitly reference the outcome they serve.
-- Nullable references keep existing programs and older payloads readable and valid.
alter table public.state_program_components add column target_goal_id uuid;
create unique index state_program_goals_scope_id_idx on public.state_program_goals(id,program_id,game_id);
alter table public.state_program_components add constraint state_program_component_goal_scope_fk
 foreign key(target_goal_id,program_id,game_id) references public.state_program_goals(id,program_id,game_id);
create index state_program_component_goal_idx on public.state_program_components(target_goal_id,program_id,game_id);

create or replace function private.replace_state_program_rows(p_program_id uuid,p_payload jsonb) returns void
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p state_programs%rowtype;v_program_id uuid:=p_program_id;p_game_id uuid;uid uuid:=auth.uid();starts date;ends date;
 x jsonb;c_id uuid;goal_id uuid;goal_ids uuid[]:='{}';goal_no integer;component_ids uuid[]:='{}';component_total numeric;idx integer:=0;year_no integer;component_start date;component_end date;
begin
 perform private.lock_active_program_actor((select game_id from state_programs where id=p_program_id));
 select * into p from state_programs where id=p_program_id for update;
 if p.id is null or not private.can_edit_state_program(p.id,uid) then raise exception 'Нет доступа к строкам программы';end if;
 p_game_id:=p.game_id;starts:=p.start_date;ends:=p.end_date;
 delete from state_program_expenses where program_id=v_program_id and game_id=p_game_id;
 -- Use the existing item APIs so their authorization and locking stay central.
 -- Components reference goals; remove them first, still through guarded item APIs.
 for c_id in select id from state_program_components where program_id=v_program_id and game_id=p_game_id loop
  perform public.delete_state_program_item('component',c_id);
 end loop;
 for c_id in select id from state_program_goals where program_id=v_program_id and game_id=p_game_id loop
  perform public.delete_state_program_item('goal',c_id);
 end loop;
 for c_id in select id from state_program_budget_years where program_id=v_program_id and game_id=p_game_id loop
  perform public.delete_state_program_budget_year(c_id);
 end loop;
 update state_programs set participants=nullif(trim(p_payload->>'participants'),''),presidential_priority_id=nullif(p_payload->>'presidential_priority_id','')::uuid,form_version=2,updated_at=now() where state_programs.id=v_program_id;
 for x in select value from jsonb_array_elements(p_payload->'goals') loop
  if coalesce(nullif(x->>'baseline_value','')::numeric,0)::text in ('NaN','Infinity','-Infinity') or coalesce(nullif(x->>'target_value','')::numeric,0)::text in ('NaN','Infinity','-Infinity') then raise exception 'Значения показателей должны быть конечными числами';end if;
  year_no:=nullif(x->>'target_year','')::integer;
  if year_no is not null and (year_no not between 2000 and 2100 or (starts is not null and year_no<extract(year from starts)) or (ends is not null and year_no>extract(year from ends))) then raise exception 'Целевой год показателя должен входить в срок программы';end if;
  goal_id:=public.add_state_program_goal(v_program_id,x->>'goal_text',x->>'indicator_name',x->>'unit',nullif(x->>'baseline_value','')::numeric,nullif(x->>'target_value','')::numeric,year_no);
  goal_ids:=array_append(goal_ids,goal_id);
 end loop;
 for x in select value from jsonb_array_elements(p_payload->'components') loop
  goal_no:=nullif(x->>'goal_no','')::integer;
  if goal_no is not null and (goal_no<1 or goal_no>coalesce(array_length(goal_ids,1),0)) then raise exception 'Выберите существующую цель этой программы';end if;
  idx:=idx+1;component_start:=nullif(x->>'start_date','')::date;component_end:=nullif(x->>'end_date','')::date;
  if (component_start is not null and starts is not null and component_start<starts) or (component_end is not null and ends is not null and component_end>ends) or (component_start is not null and component_end is not null and component_end<component_start) then raise exception 'Сроки мероприятия должны входить в срок программы';end if;
  select coalesce(sum((value->>'amount')::numeric),0) into component_total from jsonb_array_elements(p_payload->'expenses') where (value->>'component_no')::integer=idx;
  c_id:=public.add_state_program_component(v_program_id,(x->>'direction_no')::integer,x->>'direction_title',x->>'component_kind',x->>'title',x->>'goal_text',component_start,component_end,component_total);
  update state_program_components set target_goal_id=goal_ids[goal_no] where id=c_id and program_id=v_program_id and game_id=p_game_id;
  component_ids:=array_append(component_ids,c_id);
 end loop;
 idx:=0;
 for x in select value from jsonb_array_elements(p_payload->'expenses') loop
  idx:=idx+1;
  insert into state_program_expenses(program_id,game_id,component_id,indicator_name,justification,budget_year,amount,position,created_by)
  values(v_program_id,p_game_id,component_ids[(x->>'component_no')::integer],trim(x->>'indicator_name'),trim(x->>'justification'),(x->>'budget_year')::integer,(x->>'amount')::numeric,idx,uid);
 end loop;
 -- Include zero years, so annual readiness keeps the original rules.
 insert into state_program_budget_years(program_id,game_id,budget_year,amount,created_by)
 select v_program_id,p_game_id,y,coalesce((select sum(amount) from state_program_expenses e where e.program_id=v_program_id and e.budget_year=y),0),uid
 from generate_series(extract(year from starts)::integer,extract(year from ends)::integer) y;
end;$$;
revoke all on function private.replace_state_program_rows(uuid,jsonb) from public,anon,authenticated;

