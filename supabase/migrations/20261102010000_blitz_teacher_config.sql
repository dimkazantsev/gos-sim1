-- ГОС.ID. Настройки блица. Существующий алгоритм выдачи и resume_day сохраняются.
ALTER TABLE public.blitz_game_settings
 ADD COLUMN IF NOT EXISTS answer_seconds integer NOT NULL DEFAULT 20,
 ADD COLUMN IF NOT EXISTS restore_missed boolean NOT NULL DEFAULT true;
ALTER TABLE public.blitz_game_settings DROP CONSTRAINT IF EXISTS blitz_game_settings_answer_seconds_check;
ALTER TABLE public.blitz_game_settings ADD CONSTRAINT blitz_game_settings_answer_seconds_check CHECK(answer_seconds IN (10,15,20,30,45,60));
ALTER TABLE public.blitz_assignments ADD COLUMN IF NOT EXISTS attempt_seconds integer NOT NULL DEFAULT 20;
ALTER TABLE public.blitz_assignments DROP CONSTRAINT IF EXISTS blitz_assignments_attempt_seconds_check;
ALTER TABLE public.blitz_assignments ADD CONSTRAINT blitz_assignments_attempt_seconds_check CHECK(attempt_seconds IN (10,15,20,30,45,60));

CREATE OR REPLACE FUNCTION public.blitz_teacher_get_settings(p_game uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare n integer; is_enabled boolean; changed_at timestamptz; answer_seconds_value integer; restore_missed_value boolean;
begin
 if auth.uid() is null or not exists (
  select 1 from public.game_members m
  where m.game_id=p_game and m.user_id=auth.uid() and m.kind='teacher'
   and m.roster_archived_at is null
 ) then raise exception 'Forbidden' using errcode='42501'; end if;
 select daily_count,enabled,updated_at,answer_seconds,restore_missed into n,is_enabled,changed_at,answer_seconds_value,restore_missed_value
 from public.blitz_game_settings where game_id=p_game;
 return jsonb_build_object(
  'daily_count',coalesce(n,2),
  'enabled',coalesce(is_enabled,true),
  'answer_seconds',coalesce(answer_seconds_value,20),
  'restore_missed',coalesce(restore_missed_value,true),
  'updated_at',changed_at
 );
end $function$;

CREATE OR REPLACE FUNCTION public.blitz_issue_for_day(p_game uuid, p_student uuid, p_day date, p_stage integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare n integer; ids bigint[]; inserted_count integer; issue_enabled boolean; resume_day date;
begin
 if not exists(select 1 from public.game_members m where m.game_id=p_game and m.user_id=p_student and m.kind='student')
 then return 0; end if;
 perform pg_advisory_xact_lock(hashtextextended('blitz:'||p_game||':'||p_student||':'||p_day,0));
 if exists(select 1 from public.blitz_daily_plans where game_id=p_game and user_id=p_student and assigned_day=p_day)
 then return 0; end if;
 select coalesce(s.daily_count,2),coalesce(s.enabled,true),s.resume_day into n,issue_enabled,resume_day
   from (select 1) seed left join public.blitz_game_settings s on s.game_id=p_game;
   if not issue_enabled or (resume_day is not null and p_day<resume_day) then return 0; end if;
 select array_agg(q.id) into ids from (
  select ranked.id from (
   select z.id,z.topic,row_number() over(partition by z.topic order by random()) as per_topic
   from public.blitz_questions z
   where z.verified and z.legal_review_status='approved'
    and not exists(select 1 from public.blitz_assignments a where a.game_id=p_game and a.user_id=p_student and a.question_id=z.id)
  ) ranked where ranked.per_topic=1 order by random() limit n
 ) q;
 if coalesce(array_length(ids,1),0)<>n then return 0; end if;
 insert into public.blitz_daily_plans(game_id,user_id,assigned_day,stage_no,target_count)
 values(p_game,p_student,p_day,p_stage,n);
 insert into public.blitz_assignments(game_id,user_id,question_id,stage_no,assigned_day,available_at,attempt_seconds)
 select p_game,p_student,a.question_id,p_stage,p_day,
  (p_day::timestamp+interval '9 hours'
   + interval '12 hours' *((a.ord-1)::double precision/n)
   + random()*interval '20 minutes') at time zone 'Europe/Moscow',
  coalesce((select s.answer_seconds from public.blitz_game_settings s where s.game_id=p_game),20)
 from unnest(ids) with ordinality as a(question_id,ord);
 get diagnostics inserted_count=row_count;
 return inserted_count;
end $function$;

CREATE OR REPLACE FUNCTION public.blitz_issue_today(p_game uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare uid uuid:=auth.uid(); st integer; stage_start timestamptz; joined timestamptz; begin_day date; today_day date:=(now() at time zone 'Europe/Moscow')::date; one_day date; total integer:=0;
begin
 if uid is null or not exists(select 1 from public.game_members m where m.game_id=p_game and m.user_id=uid and m.kind='student') then raise exception 'Forbidden' using errcode='42501'; end if;
 select g.current_round into st from public.games g where g.id=p_game;
 select s.opened_at into stage_start from public.game_stages s where s.game_id=p_game and s.stage_no=st and s.status='open';
 if stage_start is null then return 0; end if;
 select m.joined_at into joined from public.game_members m where m.game_id=p_game and m.user_id=uid;
 begin_day:=case when (select restore_missed from public.blitz_game_settings where game_id=p_game) is false then today_day
 else greatest(today_day-30,(stage_start at time zone 'Europe/Moscow')::date,(joined at time zone 'Europe/Moscow')::date) end;
 for one_day in select generate_series(begin_day,today_day,'1 day'::interval)::date loop
  total:=total+public.blitz_issue_for_day(p_game,uid,one_day,st);
 end loop;
 return total;
end $function$;

CREATE OR REPLACE FUNCTION public.blitz_open(p_game uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE uid uuid:=auth.uid(); a record; q record;
BEGIN
 IF uid IS NULL OR NOT EXISTS(SELECT 1 FROM public.game_members WHERE game_id=p_game AND user_id=uid AND kind='student') THEN
  RAISE EXCEPTION 'Forbidden' USING errcode='42501';
 END IF;
 -- Serialize opens for a single participant; never skip a locked row and open another attempt.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_game::text||':'||uid::text, 0));
 SELECT * INTO a FROM public.blitz_assignments
 WHERE game_id=p_game AND user_id=uid AND answered_at IS NULL AND started_at IS NOT NULL
 ORDER BY started_at,available_at,id LIMIT 1 FOR UPDATE;
 IF NOT FOUND THEN
  SELECT * INTO a FROM public.blitz_assignments
  WHERE game_id=p_game AND user_id=uid AND answered_at IS NULL AND available_at<=clock_timestamp()
  ORDER BY available_at,id LIMIT 1 FOR UPDATE;
 END IF;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF a.started_at IS NULL THEN
  UPDATE public.blitz_assignments SET started_at=clock_timestamp() WHERE id=a.id RETURNING * INTO a;
 END IF;
 SELECT * INTO q FROM public.blitz_questions WHERE id=a.question_id;
 RETURN jsonb_build_object('id',a.id,'question',q.question,'options',q.options,'topic',q.topic,
 'deadline',a.started_at+make_interval(secs=>a.attempt_seconds),'stage_no',a.stage_no);
END $function$;

CREATE OR REPLACE FUNCTION public.blitz_open_selected(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
 if a.started_at is not null and a.started_at+make_interval(secs=>a.attempt_seconds+2)<moment then
  update public.blitz_assignments set answered_at=moment,chosen_index=null,is_correct=false
  where id=a.id and answered_at is null;
  return null;
 end if;
 select id into other_id from public.blitz_assignments
 where game_id=a.game_id and user_id=uid and id<>a.id and answered_at is null
 and started_at is not null and started_at+make_interval(secs=>attempt_seconds+2)>moment
 limit 1;
 if other_id is not null then raise exception 'Finish the current Blitz question' using errcode='22023'; end if;
 if a.started_at is null then
  update public.blitz_assignments set started_at=clock_timestamp()
  where id=p_id and answered_at is null and started_at is null returning * into a;
 end if;
 select * into q from public.blitz_questions where id=a.question_id;
 return jsonb_build_object('id',a.id,'question',q.question,'options',q.options,'topic',q.topic,
  'deadline',a.started_at+make_interval(secs=>a.attempt_seconds),'stage_no',a.stage_no,'server_now',clock_timestamp());
end $function$;

CREATE OR REPLACE FUNCTION public.blitz_open_recent(p_game uuid, p_not_before timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
 and started_at+make_interval(secs=>attempt_seconds+2)<moment;
 select * into a from public.blitz_assignments
 where game_id=p_game and user_id=uid and answered_at is null
 and started_at is not null and started_at+make_interval(secs=>attempt_seconds+2)>=moment
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
  'deadline',a.started_at+make_interval(secs=>a.attempt_seconds),'stage_no',a.stage_no,'server_now',clock_timestamp());
end $function$;

CREATE OR REPLACE FUNCTION public.blitz_answer(p_id uuid, p_choice integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE uid uuid:=auth.uid(); a record; q record; choice_result integer; current_at timestamptz;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'Forbidden' USING errcode='42501'; END IF;
 SELECT * INTO a FROM public.blitz_assignments WHERE id=p_id AND user_id=uid FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS (
  SELECT 1 FROM public.game_members WHERE game_id=a.game_id AND user_id=uid AND kind='student'
 ) THEN RAISE EXCEPTION 'Forbidden' USING errcode='42501'; END IF;
 -- Never reveal the key or consume a pending attempt when an ID is guessed before opening.
 IF a.started_at IS NULL THEN RAISE EXCEPTION 'Question not opened' USING errcode='22023'; END IF;
 SELECT * INTO q FROM public.blitz_questions WHERE id=a.question_id;
 IF a.answered_at IS NULL THEN
  current_at:=clock_timestamp(); -- must read AFTER waiting for row lock
  choice_result:=CASE WHEN current_at<=a.started_at+make_interval(secs=>a.attempt_seconds+2)
   AND p_choice>=0 AND p_choice<jsonb_array_length(q.options) THEN p_choice ELSE NULL END;
  UPDATE public.blitz_assignments
  SET chosen_index=choice_result,is_correct=(choice_result IS NOT NULL AND choice_result=q.correct_index),
      answered_at=current_at WHERE id=p_id RETURNING * INTO a;
 END IF;
 RETURN jsonb_build_object('id',a.id,'is_correct',a.is_correct,'chosen_index',a.chosen_index,
 'correct_index',q.correct_index,'legal_act',q.legal_act,'article',q.article,
 'source_url',q.source_url,'explanation',q.explanation,'timed_out',a.chosen_index IS NULL);
END $function$;

CREATE OR REPLACE FUNCTION public.blitz_teacher_save_extended_settings(
 p_game uuid,p_enabled boolean,p_daily_count integer,p_answer_seconds integer,p_restore_missed boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF p_answer_seconds IS NULL OR p_answer_seconds NOT IN (10,15,20,30,45,60)
  OR p_restore_missed IS NULL OR p_daily_count IS NULL OR p_enabled IS NULL
 THEN RAISE EXCEPTION 'Invalid Blitz settings' USING errcode='22023'; END IF;
 -- Delegate authorisation and preserved resume_day behavior to existing teacher RPC.
 PERFORM public.blitz_teacher_set_settings(p_game,p_daily_count,p_enabled);
 UPDATE public.blitz_game_settings SET answer_seconds=p_answer_seconds,restore_missed=p_restore_missed
 WHERE game_id=p_game;
 RETURN public.blitz_teacher_get_settings(p_game);
END $fn$;
REVOKE ALL ON FUNCTION public.blitz_teacher_save_extended_settings(uuid,boolean,integer,integer,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.blitz_teacher_save_extended_settings(uuid,boolean,integer,integer,boolean) TO authenticated;
