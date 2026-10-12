
create or replace function public.blitz_issue_today(p_game uuid)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); st integer; d date:=(now() at time zone 'Europe/Moscow')::date; n integer; made integer;
begin
 if uid is null or not exists(select 1 from public.game_members where game_id=p_game and user_id=uid and kind='student') then raise exception 'Not a student' using errcode='42501'; end if;
 select current_round into st from public.games where id=p_game;
 if st is null then raise exception 'Game missing'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_game::text||uid::text||d::text,0));
 if exists(select 1 from public.blitz_daily_plans where game_id=p_game and user_id=uid and assigned_day=d) then return 0; end if;
 n:=3+floor(random()*3)::integer;
 insert into public.blitz_daily_plans values(p_game,uid,d,st,n);
 with candidates as (
  select q.id,q.topic,row_number() over(partition by topic order by random()) as rank_topic
  from public.blitz_questions q where q.verified and not exists (
  select 1 from public.blitz_assignments a where a.game_id=p_game and a.user_id=uid and a.question_id=q.id
  )
 ), chosen as (
  select id from candidates order by rank_topic,random() limit n
 )
 insert into public.blitz_assignments(game_id,user_id,question_id,stage_no,assigned_day,available_at)
 select p_game,uid,id,st,d, (d::timestamp + interval '9 hours' + random()*interval '12 hours') at time zone 'Europe/Moscow' from chosen;
 get diagnostics made=row_count;
 return made;
end $$;
revoke all on function public.blitz_issue_today(uuid) from public,anon;
grant execute on function public.blitz_issue_today(uuid) to authenticated;
create or replace function public.blitz_open(p_game uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); a record; q record;
begin
 if uid is null or not exists(select 1 from public.game_members where game_id=p_game and user_id=uid and kind='student') then raise exception 'Forbidden' using errcode='42501'; end if;
 select * into a from public.blitz_assignments where game_id=p_game and user_id=uid and answered_at is null and available_at<=clock_timestamp() order by available_at limit 1 for update skip locked;
 if not found then return null; end if;
 if a.started_at is null then update public.blitz_assignments set started_at=clock_timestamp() where id=a.id returning * into a; end if;
 select * into q from public.blitz_questions where id=a.question_id;
 return jsonb_build_object('id',a.id,'question',q.question,'options',q.options,'topic',q.topic,'deadline',a.started_at+interval '20 seconds','stage_no',a.stage_no);
end $$;
revoke all on function public.blitz_open(uuid) from public,anon;
grant execute on function public.blitz_open(uuid) to authenticated;
create or replace function public.blitz_answer(p_id uuid,p_choice integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); a record; q record; choice_result integer; current_at timestamptz:=clock_timestamp();
begin
 if uid is null then raise exception 'Forbidden' using errcode='42501'; end if;
 select * into a from public.blitz_assignments where id=p_id and user_id=uid for update;
 if not found then raise exception 'Forbidden' using errcode='42501'; end if;
 select * into q from public.blitz_questions where id=a.question_id;
 if a.answered_at is null then
  choice_result:=case when a.started_at is not null and current_at<=a.started_at+interval '20 seconds' and p_choice>=0 and p_choice<jsonb_array_length(q.options) then p_choice else null end;
  update public.blitz_assignments set chosen_index=choice_result,is_correct=(choice_result is not null and choice_result=q.correct_index),answered_at=current_at where id=p_id returning * into a;
 end if;
 return jsonb_build_object('id',a.id,'is_correct',a.is_correct,'chosen_index',a.chosen_index,'correct_index',q.correct_index,'legal_act',q.legal_act,'article',q.article,'source_url',q.source_url,'explanation',q.explanation,'timed_out',a.chosen_index is null);
end $$;
revoke all on function public.blitz_answer(uuid,integer) from public,anon;
grant execute on function public.blitz_answer(uuid,integer) to authenticated;
create or replace function public.blitz_archive(p_game uuid,p_student uuid default null,p_offset integer default 0,p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); target uuid:=coalesce(p_student,auth.uid()); teacher boolean; payload jsonb;
begin
 teacher:=exists(select 1 from public.game_members where game_id=p_game and user_id=uid and kind='teacher');
 if uid is null or (uid<>target and not teacher) or not exists(select 1 from public.game_members where game_id=p_game and user_id=target) then raise exception 'Forbidden' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into payload from (
  select a.id,a.stage_no,a.available_at,a.answered_at,a.chosen_index,a.is_correct,
   q.question,q.topic,q.options,
   case when a.answered_at is not null or teacher then q.correct_index else null end correct_index,
   case when a.answered_at is not null or teacher then q.explanation else null end explanation,
   case when a.answered_at is not null or teacher then q.legal_act else null end legal_act,
   case when a.answered_at is not null or teacher then q.article else null end article,
   case when a.answered_at is not null or teacher then q.source_url else null end source_url
  from public.blitz_assignments a join public.blitz_questions q on q.id=a.question_id
  where a.game_id=p_game and a.user_id=target order by a.available_at desc offset greatest(0,p_offset) limit least(100,greatest(1,p_limit))
 ) t;
 return payload;
end $$;
revoke all on function public.blitz_archive(uuid,uuid,integer,integer) from public,anon;
grant execute on function public.blitz_archive(uuid,uuid,integer,integer) to authenticated;
create or replace function public.blitz_vsn(p_game uuid,p_student uuid,p_stage integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); total_q int; correct_q int; answered_q int; cases_n int; correct_cases int; acts int; c numeric; a numeric; b numeric; completion numeric;
begin
 if uid is null or (uid<>p_student and not exists(select 1 from public.game_members where game_id=p_game and user_id=uid and kind='teacher')) or not exists(select 1 from public.game_members where game_id=p_game and user_id=p_student) then raise exception 'Forbidden' using errcode='42501'; end if;
 select count(*),count(*) filter(where is_correct),count(*) filter(where chosen_index is not null)
 into total_q,correct_q,answered_q from public.blitz_assignments where game_id=p_game and user_id=p_student and stage_no=p_stage;
 select count(*),count(*) filter(where coalesce((o.option->>'lawful')::boolean,false) and coalesce((o.option->>'protects_role_interest')::boolean,false))
 into cases_n,correct_cases from public.event_decisions d
 join public.event_cases ec on ec.id=d.case_id
 left join lateral (select x as option from jsonb_array_elements(coalesce(ec.effect_plan->'options','[]'::jsonb)) x where x->>'key'=d.choice limit 1) o on true
 where d.game_id=p_game and d.actor_id=p_student
 and exists(select 1 from public.game_stages s where s.game_id=p_game and s.stage_no=p_stage and d.created_at>=coalesce(s.opened_at,'-infinity'::timestamptz) and d.created_at<=coalesce(s.completed_at,'infinity'::timestamptz));
 select count(*) into acts from public.player_actions where game_id=p_game and author_id=p_student and round_no=p_stage and status='accepted';
 c:=case when cases_n>0 then 0.30*correct_cases::numeric/cases_n else 0 end;
 a:=0.30*least(1,acts::numeric/3);
 b:=case when total_q>0 then 0.30*correct_q::numeric/total_q else 0 end;
 completion:=case when total_q>0 then 0.10*answered_q::numeric/total_q else 0 end;
 return jsonb_build_object('score',round(c+a+b+completion,2),'cases',round(c,2),'actions',round(a,2),'blitz',round(b,2),'completion',round(completion,2),'cases_total',cases_n,'cases_right',correct_cases,'actions_right',acts,'quiz_total',total_q,'quiz_right',correct_q,'quiz_answered',answered_q);
end $$;
revoke all on function public.blitz_vsn(uuid,uuid,integer) from public,anon;
grant execute on function public.blitz_vsn(uuid,uuid,integer) to authenticated;
