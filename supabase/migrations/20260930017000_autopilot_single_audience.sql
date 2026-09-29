-- Automatically assign only personal scenarios. All-audience cases must be explicitly dispatched by the teacher.
create or replace function private.run_game_autopilot(p_game uuid)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare s public.event_auto_settings%rowtype;u record;v_case uuid;v_today integer;v_pending integer;
 v_last timestamptz;idle_hours numeric;effective_interval numeric;dispatched integer:=0;v_recent int;
begin
 select * into s from public.event_auto_settings where game_id=p_game for update;
 if not found or not s.enabled then return jsonb_build_object('sent',0,'reason','paused');end if;
 if s.last_run_at is not null and s.last_run_at>now()-interval '55 minutes'
 then return jsonb_build_object('sent',0,'reason','already_checked');end if;
 for u in select gm.user_id,gm.role_title,gp.last_seen_at
 from public.game_members gm
 left join public.game_presence gp on gp.game_id=gm.game_id and gp.user_id=gm.user_id
 where gm.game_id=p_game and gm.kind='student' order by random() loop
   select count(*) into v_today from public.event_assignments
     where game_id=p_game and recipient_id=u.user_id and created_at>=now()-interval '24 hours';
   if v_today>=s.max_daily then continue;end if;
   select count(*),max(created_at) into v_pending,v_last from public.event_assignments
      where game_id=p_game and recipient_id=u.user_id and status='pending';
   if v_pending>=3 then continue;end if;
   select max(created_at) into v_last from public.event_assignments
      where game_id=p_game and recipient_id=u.user_id;
   idle_hours=least(120,greatest(0,extract(epoch from(now()-coalesce(u.last_seen_at,now()-interval '72 hours')))/3600));
   -- I = max(4, base_interval / (1 + activity_weight * min(2, idle_hours/48))).
   effective_interval=greatest(4,s.interval_hours/(1+s.activity_weight*least(2,idle_hours/48)));
   if v_last is not null and v_last>now()-(effective_interval*interval '1 hour') then continue;end if;
   select ec.id into v_case from public.event_cases ec
   where ec.game_id=p_game and ec.status='ready' and ec.audience='single' and ec.case_key like 'bank-%'
     and (coalesce(array_length(ec.allowed_roles,1),0)=0 or exists
         (select 1 from unnest(ec.allowed_roles) role where lower(coalesce(u.role_title,'')) like '%'||lower(role)||'%'))
     and not exists(select 1 from public.event_assignments ea
       where ea.case_id=ec.id and ea.recipient_id=u.user_id)
   order by case when idle_hours>=48 and s.activity_weight>=1 and ec.seriousness='light' then 0
             when idle_hours<48 and ec.seriousness='serious' then 0 else 1 end,random()
   limit 1;
   if v_case is null then continue;end if;
   insert into public.event_assignments(case_id,game_id,recipient_id,created_by)
   values(v_case,p_game,u.user_id,null);
   dispatched=dispatched+1;
 end loop;
 update public.event_auto_settings set last_run_at=now() where game_id=p_game;
 perform private.apply_event_trust(p_game);
 return jsonb_build_object('sent',dispatched,'checked_at',now());
end;
$$;
revoke all on function private.run_game_autopilot(uuid) from public,anon,authenticated;

