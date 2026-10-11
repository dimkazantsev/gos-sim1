create or replace function public.blitz_issue_for_day(p_game uuid,p_student uuid,p_day date,p_stage integer)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer; ids bigint[]; inserted_count integer;
begin
 if not exists(select 1 from public.game_members m where m.game_id=p_game and m.user_id=p_student and m.kind='student') then return 0; end if;
 perform pg_advisory_xact_lock(hashtextextended('blitz:'||p_game||':'||p_student||':'||p_day,0));
 if exists(select 1 from public.blitz_daily_plans where game_id=p_game and user_id=p_student and assigned_day=p_day) then return 0; end if;
 n:=3+floor(random()*3)::integer;
 select array_agg(q.id) into ids from (
  select ranked.id from (
   select z.id,z.topic,row_number() over(partition by z.topic order by random()) as per_topic
   from public.blitz_questions z
   where z.verified and not exists(select 1 from public.blitz_assignments a where a.game_id=p_game and a.user_id=p_student and a.question_id=z.id)
  ) ranked where ranked.per_topic=1 order by random() limit n
 ) q;
 if coalesce(array_length(ids,1),0)<>n then return 0; end if;
 insert into public.blitz_daily_plans(game_id,user_id,assigned_day,stage_no,target_count)
 values(p_game,p_student,p_day,p_stage,n);
 insert into public.blitz_assignments(game_id,user_id,question_id,stage_no,assigned_day,available_at)
 select p_game,p_student,unnest(ids),p_stage,p_day,
 (p_day::timestamp + interval '9 hours' + random()*interval '12 hours') at time zone 'Europe/Moscow';
 get diagnostics inserted_count=row_count;
 return inserted_count;
end $$;
revoke all on function public.blitz_issue_for_day(uuid,uuid,date,integer) from public,anon,authenticated;
create or replace function public.blitz_issue_today(p_game uuid)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); st integer; stage_start timestamptz; joined timestamptz; begin_day date; today_day date:=(now() at time zone 'Europe/Moscow')::date; one_day date; total integer:=0;
begin
 if uid is null or not exists(select 1 from public.game_members m where m.game_id=p_game and m.user_id=uid and m.kind='student') then raise exception 'Forbidden' using errcode='42501'; end if;
 select g.current_round into st from public.games g where g.id=p_game;
 select s.opened_at into stage_start from public.game_stages s where s.game_id=p_game and s.stage_no=st and s.status='open';
 if stage_start is null then return 0; end if;
 select m.joined_at into joined from public.game_members m where m.game_id=p_game and m.user_id=uid;
 begin_day:=greatest(today_day-30,(stage_start at time zone 'Europe/Moscow')::date,(joined at time zone 'Europe/Moscow')::date);
 for one_day in select generate_series(begin_day,today_day,'1 day'::interval)::date loop
  total:=total+public.blitz_issue_for_day(p_game,uid,one_day,st);
 end loop;
 return total;
end $$;
revoke all on function public.blitz_issue_today(uuid) from public,anon;
grant execute on function public.blitz_issue_today(uuid) to authenticated;
create or replace function public.blitz_issue_daily_all()
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare r record; today_day date:=(now() at time zone 'Europe/Moscow')::date; total integer:=0;
begin
 for r in select m.game_id,m.user_id,g.current_round as st from public.game_members m
 join public.games g on g.id=m.game_id
 join public.game_stages s on s.game_id=g.id and s.stage_no=g.current_round
 where m.kind='student' and m.roster_archived_at is null and s.status='open'
 loop
  total:=total+public.blitz_issue_for_day(r.game_id,r.user_id,today_day,r.st);
 end loop;
 return total;
end $$;
revoke all on function public.blitz_issue_daily_all() from public,anon,authenticated;
