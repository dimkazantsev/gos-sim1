-- Daytime RPCs read completed results; only this bounded nightly job collects facts.
create table if not exists private.achievement_snapshots(
 game_id uuid not null references public.games(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 facts jsonb not null default '{}'::jsonb,
 checked_at timestamptz,
 last_attempt_at timestamptz,
 attempts integer not null default 0 check(attempts between 0 and 3),
 last_error text,
 primary key(game_id,user_id)
);
alter table private.achievement_snapshots enable row level security;
revoke all on private.achievement_snapshots from public,anon,authenticated;

create or replace function public.evaluate_game_achievements(p_game_id uuid)
returns integer language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 if auth.uid() is null or not exists(
  select 1 from public.game_members where game_id=p_game_id and user_id=auth.uid() and kind='student'
 ) then return 0;end if;
 -- Old open browser tabs must not restart daytime evaluation.
 return 0;
end$$;

create or replace function public.get_game_achievements(p_game_id uuid,p_user_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare u uuid:=coalesce(p_user_id,auth.uid());f jsonb;checked timestamptz;hidden_count integer;
begin
 if auth.uid() is null or not private.is_game_member(p_game_id) or not exists(
  select 1 from public.game_members where game_id=p_game_id and user_id=u
 ) then raise exception 'Награды этого профиля недоступны.';end if;
 select facts,checked_at into f,checked from private.achievement_snapshots where game_id=p_game_id and user_id=u;
 select count(*) into hidden_count from private.achievement_catalog c
 left join public.game_achievement_settings s on s.game_id=p_game_id and s.achievement_id=c.id
 where coalesce(s.hidden,c.hidden);
 return(select coalesce(jsonb_agg(jsonb_build_object(
  'id',c.id,'title',c.title,'description',c.description,'hidden',coalesce(s.hidden,c.hidden),
  'hidden_total',hidden_count,'open_total',100-hidden_count,'earned_at',a.earned_at,'checked_at',checked,
  'progress',case when a.earned_at is not null then 100 else least(100,(
   select coalesce(min(100*coalesce((f->>k.key)::numeric,0)/k.value::numeric),0)
   from jsonb_each_text(c.conditions) k
  )) end
 ) order by c.sort_order),'[]'::jsonb)
 from private.achievement_catalog c
 left join public.game_achievement_settings s on s.game_id=p_game_id and s.achievement_id=c.id
 left join public.game_achievements a on a.achievement_id=c.id and a.game_id=p_game_id and a.user_id=u
 where not coalesce(s.hidden,c.hidden) or a.earned_at is not null);
end$$;

create or replace function private.run_nightly_achievements(p_now timestamptz default clock_timestamp())
returns integer language plpgsql security definer set search_path=public,private,pg_temp as $$
declare member record;f jsonb;local_day date:=(p_now at time zone 'Asia/Novosibirsk')::date;
begin
 if p_now is null or extract(hour from p_now at time zone 'Asia/Novosibirsk')<>3 then return 0;end if;
 if not pg_try_advisory_xact_lock(hashtextextended('gos_id_achievement_nightly',0)) then return 0;end if;
 select m.game_id,m.user_id into member
 from public.game_members m
 left join private.achievement_snapshots s on s.game_id=m.game_id and s.user_id=m.user_id
 where m.kind='student' and m.roster_archived_at is null
 and (s.checked_at is null or (s.checked_at at time zone 'Asia/Novosibirsk')::date<local_day)
 and (
  s.last_attempt_at is null or (s.last_attempt_at at time zone 'Asia/Novosibirsk')::date<local_day
  or (s.attempts<3 and s.last_attempt_at<=p_now-interval '5 minutes')
 )
 order by s.last_attempt_at nulls first,m.game_id,m.user_id limit 1;
 if not found then return 0;end if;
 insert into private.achievement_snapshots(game_id,user_id,last_attempt_at,attempts)
 values(member.game_id,member.user_id,p_now,1)
 on conflict(game_id,user_id) do update set
  attempts=case when (achievement_snapshots.last_attempt_at at time zone 'Asia/Novosibirsk')::date=local_day
   then achievement_snapshots.attempts+1 else 1 end,
  last_attempt_at=p_now;
 begin
  f:=private.achievement_facts(member.game_id,member.user_id);
  insert into public.game_achievements(game_id,user_id,achievement_id)
  select member.game_id,member.user_id,c.id from private.achievement_catalog c
  where not exists(
   select 1 from jsonb_each_text(c.conditions) k where coalesce((f->>k.key)::numeric,0)<k.value::numeric
  ) on conflict(game_id,user_id,achievement_id) do nothing;
  update private.achievement_snapshots set facts=f,checked_at=p_now,last_error=null
  where game_id=member.game_id and user_id=member.user_id;
  return 1;
 exception
  -- OTHERS excludes cancellation; retain its attempt so timeouts cannot monopolise the queue.
  when query_canceled then
   update private.achievement_snapshots set last_error=SQLSTATE where game_id=member.game_id and user_id=member.user_id;
   return 0;
  when others then
   update private.achievement_snapshots set last_error=SQLSTATE where game_id=member.game_id and user_id=member.user_id;
   return 0;
 end;
end$$;
revoke all on function private.run_nightly_achievements(timestamptz) from public,anon,authenticated;
revoke all on function public.evaluate_game_achievements(uuid),public.get_game_achievements(uuid,uuid) from public,anon;
grant execute on function public.evaluate_game_achievements(uuid),public.get_game_achievements(uuid,uuid) to authenticated;

do $schedule$
begin
 if to_regprocedure('cron.schedule(text,text,text)') is null then
  raise exception 'pg_cron is required for nightly achievement processing';
 end if;
 -- shortcut: 56 students per night; increase the batch only after measuring the shared project budget.
 -- 03:01–03:59 Novosibirsk; skip the existing hourly VSN/autopilot minutes 11,31,51.
 perform cron.schedule('gos_id_achievement_nightly','1-10,12-30,32-50,52-59 20 * * *',
  $job$set statement_timeout='15s';select private.run_nightly_achievements();$job$);
end $schedule$;
