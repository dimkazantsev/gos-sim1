-- ГОС.ID: атомарное открытие адресного блица и накопление офлайн-назначений.
-- Не меняет ранее принятые ответы и расчёт ВСН.
create or replace function public.blitz_open_selected(p_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp'
as $fn$
declare uid uuid:=auth.uid(); a record; q record; other_id uuid; moment timestamptz;
begin
 if uid is null then raise exception 'Forbidden' using errcode='42501'; end if;
 select game_id into a from public.blitz_assignments where id=p_id and user_id=uid;
 if not found or not exists(select 1 from public.game_members m where m.game_id=a.game_id and m.user_id=uid and m.kind='student' and m.roster_archived_at is null)
 then raise exception 'Forbidden' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(a.game_id::text||':'||uid::text,0));
 select * into a from public.blitz_assignments where id=p_id and user_id=uid for update;
 moment:=clock_timestamp();
 if a.answered_at is not null or a.available_at>moment then return null; end if;
 -- Устаревшую уже начатую попытку нельзя перезапускать.
 if a.started_at is not null and a.started_at+interval '20 seconds'<moment then
  update public.blitz_assignments set answered_at=moment,chosen_index=null,is_correct=false
  where id=a.id and answered_at is null;
  return null;
 end if;
 select id into other_id from public.blitz_assignments
 where game_id=a.game_id and user_id=uid and id<>a.id and answered_at is null
 and started_at is not null and started_at+interval '20 seconds'>moment
 limit 1;
 if other_id is not null then raise exception 'Finish the current Blitz question' using errcode='22023'; end if;
 if a.started_at is null then
  update public.blitz_assignments set started_at=clock_timestamp()
  where id=p_id and answered_at is null and started_at is null returning * into a;
 end if;
 select * into q from public.blitz_questions where id=a.question_id;
 return jsonb_build_object('id',a.id,'question',q.question,'options',q.options,'topic',q.topic,
  'deadline',a.started_at+interval '20 seconds','stage_no',a.stage_no);
end $fn$;

create or replace function public.blitz_open_recent(p_game uuid,p_not_before timestamptz)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp'
as $fn$
declare uid uuid:=auth.uid(); a record; q record; moment timestamptz;
begin
 if uid is null or not exists(select 1 from public.game_members m where m.game_id=p_game and m.user_id=uid
   and m.kind='student' and m.roster_archived_at is null)
 then raise exception 'Forbidden' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_game::text||':'||uid::text,0));
 moment:=clock_timestamp();
 -- Если вкладка закрыта после запуска таймера, попытка истечёт, а не появится снова.
 update public.blitz_assignments set answered_at=moment,chosen_index=null,is_correct=false
 where game_id=p_game and user_id=uid and answered_at is null and started_at is not null
 and started_at+interval '20 seconds'<moment;
 select * into a from public.blitz_assignments
 where game_id=p_game and user_id=uid and answered_at is null
 and started_at is not null and started_at+interval '20 seconds'>=moment
 order by started_at,id limit 1 for update;
 if not found then
  -- Только пришедшие в текущую сессию вопросы показываются автоматически.
  -- Все накопленные до входа назначения остаются в папке «Ответ не дан».
  select * into a from public.blitz_assignments
  where game_id=p_game and user_id=uid and answered_at is null and started_at is null
    and available_at<=moment and available_at>=greatest(p_not_before,moment-interval '12 hours')
  order by available_at,id limit 1 for update;
 end if;
 if not found then return null; end if;
 if a.started_at is null then
  update public.blitz_assignments set started_at=clock_timestamp()
  where id=a.id and answered_at is null returning * into a;
 end if;
 select * into q from public.blitz_questions where id=a.question_id;
 return jsonb_build_object('id',a.id,'question',q.question,'options',q.options,'topic',q.topic,
  'deadline',a.started_at+interval '20 seconds','stage_no',a.stage_no);
end $fn$;

create or replace function public.blitz_archive_filtered(
 p_game uuid,p_student uuid default null,p_state text default 'pending',p_offset integer default 0,p_limit integer default 30
) returns jsonb language plpgsql security definer set search_path to 'public','pg_temp'
as $fn$
declare uid uuid:=auth.uid(); target uuid:=coalesce(p_student,auth.uid()); teacher boolean; payload jsonb;
begin
 teacher:=exists(select 1 from public.game_members where game_id=p_game and user_id=uid and kind='teacher');
 if uid is null or (uid<>target and not teacher) or
    not exists(select 1 from public.game_members where game_id=p_game and user_id=target)
 then raise exception 'Forbidden' using errcode='42501'; end if;
 if p_state not in ('pending','answered') then raise exception 'Invalid state' using errcode='22023'; end if;
 select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into payload from (
  select a.id,a.stage_no,a.available_at,a.started_at,a.answered_at,a.chosen_index,a.is_correct,
   case when a.answered_at is not null or teacher then q.question else null end question,q.topic,
   case when a.answered_at is not null or teacher then q.options else null end options,
   case when a.answered_at is not null or teacher then q.correct_index else null end correct_index,
   case when a.answered_at is not null or teacher then q.explanation else null end explanation,
   case when a.answered_at is not null or teacher then q.legal_act else null end legal_act,
   case when a.answered_at is not null or teacher then q.article else null end article,
   case when a.answered_at is not null or teacher then q.source_url else null end source_url
  from public.blitz_assignments a join public.blitz_questions q on q.id=a.question_id
  where a.game_id=p_game and a.user_id=target and
   ((p_state='pending' and a.answered_at is null) or (p_state='answered' and a.answered_at is not null))
  order by a.available_at desc,a.id desc
  offset greatest(0,p_offset) limit least(100,greatest(1,p_limit))
 ) t;
 return payload;
end $fn$;

create or replace function public.blitz_inbox_counts(p_game uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp'
as $fn$
declare uid uuid:=auth.uid();
begin
 if uid is null or not exists(select 1 from public.game_members m
   where m.game_id=p_game and m.user_id=uid and m.kind='student' and m.roster_archived_at is null)
 then raise exception 'Forbidden' using errcode='42501'; end if;
 return (select jsonb_build_object(
  'pending',count(*) filter(where answered_at is null and available_at<=now()),
  'scheduled',count(*) filter(where answered_at is null and available_at>now()),
  'answered',count(*) filter(where answered_at is not null))
  from public.blitz_assignments where game_id=p_game and user_id=uid);
end $fn$;

-- Привилегии: никакого доступа анонимным лицам к раскрытию вопроса.
revoke all on function public.blitz_open_selected(uuid) from public,anon;
revoke all on function public.blitz_open_recent(uuid,timestamptz) from public,anon;
revoke all on function public.blitz_archive_filtered(uuid,uuid,text,integer,integer) from public,anon;
revoke all on function public.blitz_inbox_counts(uuid) from public,anon;
grant execute on function public.blitz_open_selected(uuid) to authenticated;
grant execute on function public.blitz_open_recent(uuid,timestamptz) to authenticated;
grant execute on function public.blitz_archive_filtered(uuid,uuid,text,integer,integer) to authenticated;
grant execute on function public.blitz_inbox_counts(uuid) to authenticated;

-- План создаётся на стороне БД для всех активных игроков, включая вышедших.
create or replace function private.blitz_issue_offline_today()
returns integer language plpgsql security definer set search_path to 'public','pg_temp'
as $fn$
declare row record; total integer:=0; day_msk date:=(now() at time zone 'Europe/Moscow')::date;
begin
 for row in
  select m.game_id,m.user_id,g.current_round
  from public.game_members m join public.games g on g.id=m.game_id
  join public.game_stages s on s.game_id=g.id and s.stage_no=g.current_round
  where m.kind='student' and m.roster_archived_at is null and s.status='open'
 loop
  total:=total+public.blitz_issue_for_day(row.game_id,row.user_id,day_msk,row.current_round);
 end loop;
 return total;
end $fn$;
revoke all on function private.blitz_issue_offline_today() from public,anon,authenticated;
do $job$
begin
 if to_regclass('cron.job') is not null then
  if not exists(select 1 from cron.job where jobname='gos_blitz_issue_offline_today') then
   perform cron.schedule('gos_blitz_issue_offline_today','45 5 * * *',
    $call$select private.blitz_issue_offline_today()$call$);
  end if;
 else
  raise notice 'pg_cron is not installed in this environment; schedule offline Blitz after installation';
 end if;
end $job$;
