-- Follow-up security hardening for already-applied Government meeting migration.
-- Only Chair may prepare, change or approve the Cabinet agenda. Other game bodies unchanged.
CREATE OR REPLACE FUNCTION private.can_approve_government_agenda(p_game uuid,p_user uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','private','pg_temp'
AS $chair$
 SELECT p_user IS NOT NULL
  AND private.is_game_member(p_game)
  AND private.role_is_available(p_game,p_user)
  AND (
   private.game_role(p_game,p_user) ~* '^[[:space:]]*председатель[[:space:]]+правительства([[:space:]]|$)'
   OR EXISTS(
    SELECT 1 FROM public.game_office_assignments a
     WHERE a.game_id=p_game AND a.user_id=p_user AND a.status='active'
      AND a.role_title ~* '^[[:space:]]*председатель[[:space:]]+правительства([[:space:]]|$)'
   )
  );
$chair$;
REVOKE ALL ON FUNCTION private.can_approve_government_agenda(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.add_government_session_question(p_session_id uuid, p_title text, p_description text DEFAULT ''::text, p_duration_minutes integer DEFAULT 10, p_program_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare s public.government_sessions%rowtype;v_uid uuid:=(select auth.uid());v_id uuid;v_agenda uuid;p public.state_programs%rowtype;v_no integer;
begin
 select * into s from public.government_sessions where id=p_session_id for update;
 if s.id is null or v_uid is null or not private.can_approve_government_agenda(s.game_id,v_uid) then raise exception 'Недостаточно прав на повестку'; end if;
 -- Drafting the agenda is a prerequisite for registration, not an attended action.
 -- Already checked: private.can_approve_government_agenda(game, actor).
 if s.agenda_approved_at is not null then raise exception 'Повестка утверждена и недоступна для изменения';end if;
 if s.status<>'draft' then raise exception 'Повестка закрыта для редактирования'; end if;
 if length(btrim(coalesce(p_title,'')))<3 or length(p_title)>500 then raise exception 'Введите название вопроса (3–500 символов)'; end if;
 if p_duration_minutes not between 1 and 60 then raise exception 'Время доклада: 1–60 минут';end if;
 if p_program_id is not null then
   select * into p from public.state_programs where id=p_program_id and game_id=s.game_id;
   if p.id is null or p.status<>'ready' then raise exception 'В повестку можно внести только согласованную и готовую к рассмотрению программу'; end if;
   if exists(select 1 from public.government_program_agenda where session_id=s.id and program_id=p.id) then raise exception 'Программа уже включена в повестку'; end if;
   select coalesce(max(agenda_no),0)+1 into v_no from public.government_program_agenda where session_id=s.id;
   insert into public.government_program_agenda(session_id,game_id,program_id,agenda_no,report_minutes)
      values(s.id,s.game_id,p.id,v_no,p_duration_minutes) returning id into v_agenda;
 end if;
 insert into public.government_session_questions(session_id,game_id,title,description,duration_minutes,program_agenda_id,created_by)
 values(s.id,s.game_id,btrim(p_title),left(coalesce(p_description,''),6000),p_duration_minutes,v_agenda,v_uid) returning id into v_id;
 return v_id;
end;$function$;

CREATE OR REPLACE FUNCTION public.add_program_to_government_agenda(p_session_id uuid, p_program_id uuid, p_report_minutes integer DEFAULT 7)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare s public.government_sessions%rowtype;p public.state_programs%rowtype;v_uid uuid:=(select auth.uid());v_no integer;v_id uuid;
begin
 select * into s from public.government_sessions where id=p_session_id for update;
 if s.id is null then raise exception 'Government session not found'; end if;
 if not private.can_approve_government_agenda(s.game_id,v_uid) then raise exception 'Government session management access required'; end if;
 if s.agenda_approved_at is not null then raise exception 'Повестка утверждена и недоступна для изменения';end if;
 if s.status<>'draft' then raise exception 'Agenda is locked after the session opens'; end if;
 select * into p from public.state_programs where id=p_program_id;
 if p.id is null or p.game_id<>s.game_id then
  raise exception 'Государственная программа не принадлежит этому заседанию'; end if;
 if not (
  (p.status='ready' and p.signed_at is null)
  or (
    p.status='government_vote' and p.signed_at is not null and p.government_vote_id is not null
    and exists(select 1 from public.game_votes v where v.id=p.government_vote_id
       and v.game_id=p.game_id and v.status='open' and v.stage_no=11
       and v.procedure_key='state_program' and v.institution_key='government')
    and not exists(select 1 from public.game_ballots b where b.vote_id=p.government_vote_id)
    and not exists(select 1 from public.government_program_agenda a where a.program_id=p.id)
  )
 ) then raise exception 'Для включения необходима согласованная программа без незавершённых или повторных голосований'; end if;
 select coalesce(max(agenda_no),0)+1 into v_no from public.government_program_agenda where session_id=s.id;
 insert into public.government_program_agenda(session_id,game_id,program_id,agenda_no,report_minutes)
 values(s.id,s.game_id,p.id,v_no,greatest(1,least(60,p_report_minutes))) returning id into v_id;
 return v_id;
end;$function$;

CREATE OR REPLACE FUNCTION public.create_government_session(p_game_id uuid, p_title text, p_time_limit_minutes integer DEFAULT 60)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_uid uuid:=(select auth.uid());v_no integer;v_id uuid;
begin
 if v_uid is null or not private.can_approve_government_agenda(p_game_id,v_uid) then raise exception 'Подготовить заседание может только Председатель Правительства'; end if;
 if exists(select 1 from public.government_sessions where game_id=p_game_id and status='open') then raise exception 'Close the active Government session first'; end if;
 select coalesce(max(session_no),0)+1 into v_no from public.government_sessions where game_id=p_game_id;
 insert into public.government_sessions(game_id,session_no,title,time_limit_minutes,chair_user_id,created_by)
 values(p_game_id,v_no,coalesce(nullif(trim(p_title),''),'Заседание Правительства №'||v_no),greatest(5,least(240,p_time_limit_minutes)),v_uid,v_uid)
 returning id into v_id;
 return v_id;
end;$function$;

CREATE OR REPLACE FUNCTION public.remove_government_session_question(p_question_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare q public.government_session_questions%rowtype;s public.government_sessions%rowtype;
begin
 select * into q from public.government_session_questions where id=p_question_id for update;
 if q.id is null then return;end if;
 select * into s from public.government_sessions where id=q.session_id;
 if s.agenda_approved_at is not null or not private.can_approve_government_agenda(q.game_id,(select auth.uid())) or s.status<>'draft' then raise exception 'Удаление недоступно';end if;
 delete from public.government_session_questions where id=q.id;
 if q.program_agenda_id is not null then delete from public.government_program_agenda where id=q.program_agenda_id;end if;
end;$function$;

CREATE OR REPLACE FUNCTION public.update_government_session_question(p_question_id uuid, p_title text, p_description text, p_duration_minutes integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare q public.government_session_questions%rowtype;s public.government_sessions%rowtype;
begin
 select * into q from public.government_session_questions where id=p_question_id for update;
 if q.id is null then raise exception 'Вопрос не найден';end if;
 select * into s from public.government_sessions where id=q.session_id;
 if s.agenda_approved_at is not null or not private.can_approve_government_agenda(q.game_id,(select auth.uid())) or s.status<>'draft' then raise exception 'Редактирование недоступно';end if;
 if not private.is_game_teacher(q.game_id) then perform private.require_game_meeting_registration(q.game_id,(select auth.uid()),s.stage_no,'government');end if;
 if length(btrim(coalesce(p_title,''))) not between 3 and 500 or p_duration_minutes not between 1 and 60 then raise exception 'Проверьте название и время доклада';end if;
 update public.government_session_questions set title=btrim(p_title),description=left(coalesce(p_description,''),6000),duration_minutes=p_duration_minutes where id=q.id;
 if q.program_agenda_id is not null then update public.government_program_agenda set report_minutes=p_duration_minutes where id=q.program_agenda_id;end if;
end;$function$;
