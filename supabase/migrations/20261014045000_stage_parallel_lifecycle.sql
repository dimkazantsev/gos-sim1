-- Independent stage lifecycle: multiple stages may be open concurrently.
-- This RPC does not reset or complete unrelated stages.
create or replace function public.manage_game_stage(
 p_game_id uuid,p_stage_no integer,p_action text,p_minutes integer default 30
) returns void language plpgsql security definer
set search_path to 'public','private','pg_temp' as $fn$
declare s public.game_stages%rowtype;v_deadline timestamptz;v_next integer;v_earliest timestamptz;v_count integer;
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher access required' using errcode='42501';end if;
 if p_stage_no not between 1 and 16 or p_action not in ('open','close','extend') then
  raise exception 'Invalid stage operation' using errcode='22023';end if;
 if p_action in ('open','extend') and (p_minutes is null or p_minutes<1 or p_minutes>43200) then
  raise exception 'Duration must be 1–43200 minutes' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('stage-control:'||p_game_id,0));
 select * into s from public.game_stages where game_id=p_game_id and stage_no=p_stage_no for update;
 if not found then raise exception 'Stage not found' using errcode='P0002';end if;
 if p_action='close' then
  if s.status<>'open' then raise exception 'Stage is not open' using errcode='22023';end if;
  update public.game_stages set status='completed',completed_at=clock_timestamp() where id=s.id;
 elsif p_action='open' then
  if s.status='open' then raise exception 'Stage is already open' using errcode='22023';end if;
  v_deadline:=case when s.deadline>clock_timestamp() then s.deadline
   else clock_timestamp()+make_interval(mins=>p_minutes) end;
  update public.game_stages set status='open',
   opened_at=clock_timestamp(),completed_at=null,deadline=v_deadline where id=s.id;
 elsif p_action='extend' then
  if s.status<>'open' then raise exception 'Only open stages can be extended' using errcode='22023';end if;
  v_deadline:=greatest(coalesce(s.deadline,clock_timestamp()),clock_timestamp())+make_interval(mins=>p_minutes);
  update public.game_stages set deadline=v_deadline where id=s.id;
 end if;
 if p_action in ('open','extend') then
  update public.stage_deadline_rules set deadline_at=v_deadline,updated_by=auth.uid(),updated_at=clock_timestamp()
  where game_id=p_game_id and stage_no=p_stage_no;
 end if;
 select count(*),min(deadline) into v_count,v_earliest
 from public.game_stages where game_id=p_game_id and status='open';
 select stage_no into v_next from public.game_stages
 where game_id=p_game_id and status='open' order by deadline nulls last,stage_no limit 1;
 update public.games set
  current_round=coalesce(v_next,current_round),
  turn_open=v_count>0,
  turn_ends_at=case when v_count>0 then v_earliest else null end,
  status=case when v_count>0 then 'running' else 'paused' end
 where id=p_game_id;
 insert into public.audit_log(game_id,actor_id,action,entity_type,payload)
 values(p_game_id,auth.uid(),'manage_game_stage','game_stages',
  jsonb_build_object('stage_no',p_stage_no,'operation',p_action,'minutes',p_minutes,'deadline',v_deadline));
end $fn$;
revoke all on function public.manage_game_stage(uuid,integer,text,integer) from public,anon;
grant execute on function public.manage_game_stage(uuid,integer,text,integer) to authenticated;

-- Automatically complete expired stages even when no player has the page open.
create or replace function public.close_expired_game_stages()
returns integer language plpgsql security definer
set search_path to 'public','private','pg_temp' as $fn$
declare g uuid;n integer:=0;v_total integer;v_earliest timestamptz;v_next integer;
begin
 for g in select distinct game_id from public.game_stages
  where status='open' and deadline is not null and deadline<=clock_timestamp() loop
  perform pg_advisory_xact_lock(hashtextextended('stage-control:'||g,0));
  update public.game_stages set status='completed',completed_at=clock_timestamp()
  where game_id=g and status='open' and deadline is not null and deadline<=clock_timestamp();
  get diagnostics v_total=row_count;n:=n+v_total;
  if v_total>0 then
   select count(*),min(deadline) into v_total,v_earliest from public.game_stages where game_id=g and status='open';
   select stage_no into v_next from public.game_stages where game_id=g and status='open' order by deadline nulls last,stage_no limit 1;
   update public.games set current_round=coalesce(v_next,current_round),
    turn_open=v_total>0,turn_ends_at=case when v_total>0 then v_earliest else null end,
    status=case when v_total>0 then 'running' else 'paused' end where id=g;
  end if;
 end loop;
 return n;
end $fn$;
revoke all on function public.close_expired_game_stages() from public,anon,authenticated;
-- pg_cron executes inside the database, not dependent on a browser tab.
do $cron$
begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  if not exists(select 1 from cron.job where jobname='gos_id_expire_stages') then
   perform cron.schedule('gos_id_expire_stages','* * * * *','select public.close_expired_game_stages()');
  end if;
 end if;
end $cron$;
