-- Eliminate the impossible registration-before-agenda cycle; ballot registration rules remain intact.
CREATE OR REPLACE FUNCTION public.add_government_session_question(p_session_id uuid, p_title text, p_description text DEFAULT ''::text, p_duration_minutes integer DEFAULT 10, p_program_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare s public.government_sessions%rowtype;v_uid uuid:=(select auth.uid());v_id uuid;v_agenda uuid;p public.state_programs%rowtype;v_no integer;
begin
 select * into s from public.government_sessions where id=p_session_id for update;
 if s.id is null or v_uid is null or not private.can_manage_government_session(s.game_id,v_uid) then raise exception 'Недостаточно прав на повестку'; end if;
 -- Drafting the agenda is a prerequisite for registration, not an attended action.
 -- Already checked: private.can_manage_government_session(game, actor).
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
end;$function$
;