-- Stage 4 completion guard: work must finish before any official completion.
-- Retains all other stages' former lifecycle. No RLS, player data or votes changed.
CREATE OR REPLACE FUNCTION public.close_expired_game_stages()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare g uuid;n integer:=0;v_total integer;v_extended integer;v_open integer;v_earliest timestamptz;v_next integer;
begin
 for g in select distinct game_id from public.game_stages
  where status='open' and deadline is not null and deadline<=clock_timestamp() loop
  perform pg_advisory_xact_lock(hashtextextended('stage-control:'||g,0));
  -- Incomplete stage 4 must remain actionable. Renew only its expired deadline;
  -- all other stages retain the previous expiry behavior.
  update public.game_stages s set deadline=clock_timestamp()+interval '30 minutes'
  where s.game_id=g and s.stage_no=4 and s.status='open'
    and s.deadline is not null and s.deadline<=clock_timestamp()
    and not coalesce((private.stage_readiness_json(g,4)->>'ready')::boolean,false);
  get diagnostics v_extended=row_count;
  if v_extended>0 then
   update public.stage_deadline_rules r set
     deadline_at=(select s.deadline from public.game_stages s where s.game_id=g and s.stage_no=4),
     updated_at=clock_timestamp()
   where r.game_id=g and r.stage_no=4;
  end if;
  update public.game_stages set status='completed',completed_at=clock_timestamp()
  where game_id=g and status='open' and deadline is not null and deadline<=clock_timestamp();
  get diagnostics v_total=row_count;n:=n+v_total;
  if v_total>0 or v_extended>0 then
   select count(*),min(deadline) into v_open,v_earliest from public.game_stages where game_id=g and status='open';
   select stage_no into v_next from public.game_stages where game_id=g and status='open' order by deadline nulls last,stage_no limit 1;
   update public.games set current_round=greatest(current_round,coalesce(v_next,current_round)),
    turn_open=v_open>0,turn_ends_at=case when v_open>0 then v_earliest else null end,
    status=case when v_open>0 then 'running' else 'paused' end where id=g;
  end if;
 end loop;
 return n;
end $function$;

CREATE OR REPLACE FUNCTION public.manage_game_stage(p_game_id uuid, p_stage_no integer, p_action text, p_minutes integer DEFAULT 30)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
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
  if p_stage_no=4
    and not coalesce((private.stage_readiness_json(p_game_id,4)->>'ready')::boolean,false)
  then raise exception 'Нельзя завершить этап 4: сначала изберите руководство и председателей пяти комитетов, распределите депутатов и завершите обязательные процедуры' using errcode='23514';end if;
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
  current_round=greatest(current_round,coalesce(v_next,current_round)),
  turn_open=v_count>0,
  turn_ends_at=case when v_count>0 then v_earliest else null end,
  status=case when v_count>0 then 'running' else 'paused' end
 where id=p_game_id;
 insert into public.audit_log(game_id,actor_id,action,entity_type,payload)
 values(p_game_id,auth.uid(),'manage_game_stage','game_stages',
  jsonb_build_object('stage_no',p_stage_no,'operation',p_action,'minutes',p_minutes,'deadline',v_deadline));
end $function$;
