-- Official Stage 11 procedure. Keep stages, ballots and prior signatures unchanged.
-- Pre-session agenda draft is built server-side from confirmed programme records.
ALTER TABLE public.government_sessions
 ADD COLUMN IF NOT EXISTS agenda_approved_by uuid,
 ADD COLUMN IF NOT EXISTS agenda_approved_at timestamptz;
ALTER TABLE public.government_program_agenda ADD COLUMN IF NOT EXISTS qa_closed_at timestamptz;

CREATE TABLE IF NOT EXISTS public.government_program_speaker_questions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 game_id uuid NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
 session_id uuid NOT NULL REFERENCES public.government_sessions(id) ON DELETE CASCADE,
 agenda_item_id uuid NOT NULL REFERENCES public.government_program_agenda(id) ON DELETE CASCADE,
 asked_by uuid NOT NULL REFERENCES auth.users(id),
 question_text text NOT NULL CHECK(length(btrim(question_text)) BETWEEN 10 AND 2000),
 answer_text text CHECK(answer_text IS NULL OR length(btrim(answer_text)) BETWEEN 2 AND 4000),
 answered_by uuid REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 answered_at timestamptz
);
CREATE INDEX IF NOT EXISTS gov_speaker_questions_item_idx ON public.government_program_speaker_questions(game_id,agenda_item_id,created_at);
ALTER TABLE public.government_program_speaker_questions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.government_program_speaker_questions FROM PUBLIC, anon;
GRANT SELECT ON public.government_program_speaker_questions TO authenticated;
DROP POLICY IF EXISTS government_speaker_questions_member_read ON public.government_program_speaker_questions;
CREATE POLICY government_speaker_questions_member_read ON public.government_program_speaker_questions FOR SELECT TO authenticated USING(private.is_game_member(game_id));

CREATE OR REPLACE FUNCTION private.can_approve_government_agenda(p_game uuid,p_user uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','private','pg_temp'
AS $can$ SELECT p_user IS NOT NULL AND private.is_game_member(p_game) AND
 (private.is_game_teacher(p_game) OR (
  private.role_is_available(p_game,p_user) AND
  (private.game_role(p_game,p_user) ~* 'председател.*правительств'
    OR EXISTS(SELECT 1 FROM public.game_office_assignments a
      WHERE a.game_id=p_game AND a.user_id=p_user AND a.status='active'
       AND a.role_title ~* 'председател.*правительств'))
 )); $can$;

CREATE OR REPLACE FUNCTION public.sync_government_session_programmes(p_session_id uuid)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','private','pg_temp'
AS $sync$
DECLARE s public.government_sessions%rowtype;p record;n integer:=0;
BEGIN
 SELECT * INTO s FROM public.government_sessions WHERE id=p_session_id FOR UPDATE;
 IF s.id IS NULL OR NOT private.can_approve_government_agenda(s.game_id,auth.uid()) THEN RAISE EXCEPTION 'Недостаточно прав на повестку Правительства';END IF;
 IF s.status<>'draft' OR s.agenda_approved_at IS NOT NULL THEN RAISE EXCEPTION 'Утверждённую повестку менять нельзя';END IF;
 FOR p IN SELECT x.id FROM public.state_programs x
   WHERE x.game_id=s.game_id
   AND ( (x.status='ready' AND x.signed_at IS NULL)
     OR (x.status='government_vote' AND x.signed_at IS NOT NULL
        AND x.government_vote_id IS NOT NULL
        AND EXISTS(SELECT 1 FROM public.game_votes v WHERE v.id=x.government_vote_id
          AND v.game_id=x.game_id AND v.stage_no=11 AND v.status='open'
          AND v.institution_key='government' AND v.procedure_key='state_program')
        AND NOT EXISTS(SELECT 1 FROM public.game_ballots b WHERE b.vote_id=x.government_vote_id)))
   AND NOT EXISTS(SELECT 1 FROM public.government_program_agenda a WHERE a.program_id=x.id)
   ORDER BY x.responsible_ministry,x.title,x.id
 LOOP
  IF n+(SELECT count(*) FROM public.government_program_agenda WHERE session_id=s.id)>=30 THEN
    RAISE EXCEPTION 'Превышен предел 30 вопросов. Проведите отдельное заседание'; END IF;
  PERFORM public.add_program_to_government_agenda(s.id,p.id,7);
  n:=n+1;
 END LOOP;
 RETURN n;
END $sync$;

CREATE OR REPLACE FUNCTION public.create_government_session_from_programmes(p_game_id uuid,p_time_limit_minutes integer DEFAULT 60)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','private','pg_temp'
AS $create$
DECLARE session_id uuid; v_no integer;
BEGIN
 IF NOT private.can_approve_government_agenda(p_game_id,auth.uid()) THEN
  RAISE EXCEPTION 'Подготовить заседание может Председатель Правительства';END IF;
 SELECT id INTO session_id FROM public.government_sessions
 WHERE game_id=p_game_id AND status='draft' AND agenda_approved_at IS NULL
 ORDER BY created_at DESC LIMIT 1;
 IF session_id IS NULL THEN
  session_id:=public.create_government_session(p_game_id,'Заседание Правительства Российской Федерации',greatest(5,least(240,p_time_limit_minutes)));
 END IF;
 PERFORM public.sync_government_session_programmes(session_id);
 IF NOT EXISTS(SELECT 1 FROM public.government_program_agenda WHERE session_id=session_id) THEN
  RAISE EXCEPTION 'Нет согласованных государственных программ. Завершите их подготовку на Этапе 10';END IF;
 RETURN session_id;
END $create$;

CREATE OR REPLACE FUNCTION public.approve_government_session_agenda(p_session_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','private','pg_temp'
AS $approve$
DECLARE s public.government_sessions%rowtype;u uuid:=auth.uid();
BEGIN
 SELECT * INTO s FROM public.government_sessions WHERE id=p_session_id FOR UPDATE;
 IF s.id IS NULL OR NOT private.can_approve_government_agenda(s.game_id,u)
 THEN RAISE EXCEPTION 'Утвердить повестку может только Председатель Правительства';END IF;
 IF s.status<>'draft' THEN RAISE EXCEPTION 'Повестку можно утверждать только до открытия заседания';END IF;
 IF s.agenda_approved_at IS NOT NULL THEN RETURN; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.government_program_agenda WHERE session_id=s.id)
 THEN RAISE EXCEPTION 'В повестке нет государственных программ';END IF;
 UPDATE public.government_sessions SET agenda_approved_by=u,agenda_approved_at=now() WHERE id=s.id;
 PERFORM private.refresh_government_agenda_document(s.id);
 IF NOT EXISTS(SELECT 1 FROM public.formal_documents d
  JOIN public.government_sessions gs ON gs.agenda_document_id=d.id
  WHERE gs.id=s.id AND d.game_id=s.game_id AND d.status_code='published')
 THEN RAISE EXCEPTION 'Не удалось утвердить документ повестки';END IF;
END $approve$;

CREATE OR REPLACE FUNCTION public.ask_government_program_speaker(p_item_id uuid,p_question text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','private','pg_temp'
AS $ask$
DECLARE a public.government_program_agenda%rowtype;s public.government_sessions%rowtype;u uuid:=auth.uid(); q_id uuid;
BEGIN
 SELECT * INTO a FROM public.government_program_agenda WHERE id=p_item_id FOR UPDATE;
 SELECT * INTO s FROM public.government_sessions WHERE id=a.session_id;
 IF a.id IS NULL OR s.status<>'open' OR a.status<>'presenting' OR a.qa_closed_at IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM public.game_stages st WHERE st.game_id=a.game_id AND st.stage_no=11 AND st.status='open')
 THEN RAISE EXCEPTION 'Вопросы принимаются только после начала доклада на открытом заседании';END IF;
 IF u IS NULL OR NOT private.is_game_member(a.game_id) OR private.is_game_observer(a.game_id)
  OR NOT private.role_is_available(a.game_id,u)
 THEN RAISE EXCEPTION 'Требуются полномочия участника';END IF;
 PERFORM private.require_game_meeting_registration(a.game_id,u,11,'government');
 IF length(btrim(coalesce(p_question,''))) NOT BETWEEN 10 AND 2000 THEN RAISE EXCEPTION 'Вопрос должен содержать от 10 до 2000 символов'; END IF;
 IF (SELECT count(*) FROM public.government_program_speaker_questions WHERE agenda_item_id=a.id AND asked_by=u)>=2
 THEN RAISE EXCEPTION 'Можно задать не более двух вопросов к одному докладу';END IF;
 IF (SELECT count(*) FROM public.government_program_speaker_questions WHERE agenda_item_id=a.id)>=80
 THEN RAISE EXCEPTION 'Достигнут предел вопросов к докладу';END IF;
 INSERT INTO public.government_program_speaker_questions(game_id,session_id,agenda_item_id,asked_by,question_text)
 VALUES(a.game_id,s.id,a.id,u,btrim(p_question)) RETURNING id INTO q_id;
 RETURN q_id;
END $ask$;

CREATE OR REPLACE FUNCTION public.answer_government_program_speaker(p_question_id uuid,p_answer text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','private','pg_temp'
AS $answer$
DECLARE q public.government_program_speaker_questions%rowtype;a public.government_program_agenda%rowtype;
s public.government_sessions%rowtype;p public.state_programs%rowtype;u uuid:=auth.uid();
BEGIN
 SELECT * INTO q FROM public.government_program_speaker_questions WHERE id=p_question_id FOR UPDATE;
 IF q.id IS NULL THEN RAISE EXCEPTION 'Вопрос не найден';END IF;
 SELECT * INTO a FROM public.government_program_agenda WHERE id=q.agenda_item_id;
 SELECT * INTO s FROM public.government_sessions WHERE id=a.session_id;
 SELECT * INTO p FROM public.state_programs WHERE id=a.program_id;
 IF s.status<>'open' OR a.status<>'presenting' OR a.qa_closed_at IS NOT NULL OR q.answer_text IS NOT NULL
 THEN RAISE EXCEPTION 'Ответ на этот вопрос недоступен';END IF;
 IF NOT (private.can_approve_government_agenda(a.game_id,u) OR
  (p.responsible_minister_id=u AND private.role_is_available(a.game_id,u)))
 THEN RAISE EXCEPTION 'Отвечать может докладчик или Председатель Правительства';END IF;
 IF length(btrim(coalesce(p_answer,''))) NOT BETWEEN 2 AND 4000 THEN RAISE EXCEPTION 'Ответ должен содержать от 2 до 4000 символов'; END IF;
 UPDATE public.government_program_speaker_questions
 SET answer_text=btrim(p_answer),answered_by=u,answered_at=now() WHERE id=q.id;
END $answer$;

CREATE OR REPLACE FUNCTION public.close_government_program_questions(p_item_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','private','pg_temp'
AS $close$
DECLARE a public.government_program_agenda%rowtype;s public.government_sessions%rowtype;
BEGIN
 SELECT * INTO a FROM public.government_program_agenda WHERE id=p_item_id FOR UPDATE;
 SELECT * INTO s FROM public.government_sessions WHERE id=a.session_id;
 IF a.id IS NULL OR s.status<>'open' OR a.status<>'presenting' OR
   NOT private.can_approve_government_agenda(a.game_id,auth.uid())
 THEN RAISE EXCEPTION 'Закрыть вопросы может только Председатель Правительства на открытом заседании';END IF;
 IF EXISTS(SELECT 1 FROM public.government_program_speaker_questions WHERE agenda_item_id=a.id AND answer_text IS NULL)
 THEN RAISE EXCEPTION 'Сначала необходимо ответить на поступившие вопросы';END IF;
 UPDATE public.government_program_agenda SET qa_closed_at=coalesce(qa_closed_at,now()) WHERE id=a.id;
END $close$;


CREATE OR REPLACE FUNCTION private.refresh_government_agenda_document(p_session uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare s public.government_sessions%rowtype; v_doc uuid;v_registry text;v_steps jsonb;v_body text;v_rows text;v_actor uuid;
begin
 perform set_config('app.gos_government_agenda_session',p_session::text,true);
 select * into s from public.government_sessions where id=p_session;
 if s.id is null then return null; end if;
 v_actor:=coalesce((select auth.uid()),s.created_by);
 select string_agg(format('%s. %s%s%s', q.rn, q.title,
    case when q.description='' then '' else E'\n   '||q.description end,
    E'\n   Доклад: '||q.minutes||' мин.'), E'\n\n' order by q.rn) into v_rows
 from (
   select row_number() over(order by src.sort_at,src.sort_id) as rn,src.title,src.description,src.minutes
   from (
      select q.created_at as sort_at,q.id as sort_id,q.title,q.description,q.duration_minutes as minutes
      from public.government_session_questions q where q.session_id=s.id
      union all
      select a.created_at,a.id,'Рассмотрение государственной программы «'||p.title||'»',
             'Ответственный исполнитель: '||p.responsible_ministry,a.report_minutes
      from public.government_program_agenda a
      join public.state_programs p on p.id=a.program_id
      where a.session_id=s.id and not exists(select 1 from public.government_session_questions q where q.program_agenda_id=a.id)
   ) src
 ) q;
 v_body:='ПОВЕСТКА ЗАСЕДАНИЯ ПРАВИТЕЛЬСТВА РОССИЙСКОЙ ФЕДЕРАЦИИ'
      ||E'\n\n'||s.title||E'\nЗаседание № '||s.session_no
      ||E'\nОбщий регламент: '||s.time_limit_minutes||' мин.'
      ||E'\nСтатус: '||case when s.status='draft' and s.agenda_approved_at is null then 'Проект' when s.status='closed' then 'Заседание завершено' else 'Утверждена' end
      ||E'\n\nВОПРОСЫ ПОВЕСТКИ\n\n'||coalesce(v_rows,'Вопросы повестки пока не внесены.');
 v_doc:=s.agenda_document_id;
 if v_doc is null then
   v_doc:=gen_random_uuid();
   v_registry:='ГОС.ID-ПОВ-'||lpad(nextval('public.formal_registry_seq')::text,4,'0');
   v_steps:=private.formal_workflow('government_act');
   insert into public.formal_documents(
     id,game_id,stage_no,registry_no,title,doc_type,subject_key,subject_label,author_id,
     body_text,workflow_key,workflow_steps,current_step,status_code,status_label,current_owner_key,metadata
   ) values(
     v_doc,s.game_id,11,v_registry,'Повестка заседания Правительства № '||s.session_no,
     'meeting_agenda','government','Правительство Российской Федерации',s.created_by,
     v_body,'government_act',v_steps,0,'draft','Проект повестки','government',
     jsonb_build_object('document_kind','government_session_agenda','government_session_id',s.id,'auto_generated',true)
   );
   update public.government_sessions set agenda_document_id=v_doc where id=s.id;
   insert into public.formal_document_history(document_id,game_id,actor_id,action,to_status,to_owner,note)
     values(v_doc,s.game_id,v_actor,'Создан проект повестки','draft','government','Связан с заседанием Правительства № '||s.session_no);
 else
   update public.formal_documents set body_text=v_body,updated_at=now(),
     status_code=case when s.status='draft' and s.agenda_approved_at is null then 'draft' else 'published' end,
     status_label=case when s.status='draft' and s.agenda_approved_at is null then 'Проект повестки' when s.status='closed' then 'Заседание завершено' else 'Утверждена Председателем Правительства' end,
     current_owner_key=case when s.status='draft' and s.agenda_approved_at is null then 'government' else 'system' end
   where id=v_doc and (body_text is distinct from v_body or status_label is distinct from
      case when s.status='draft' and s.agenda_approved_at is null then 'Проект повестки' when s.status='closed' then 'Заседание завершено' else 'Утверждена Председателем Правительства' end);
 end if;
 perform set_config('app.gos_government_agenda_session','',true);
 return v_doc;
end;$function$;

CREATE OR REPLACE FUNCTION public.open_government_session(p_session_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare s public.government_sessions%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into s from public.government_sessions where id=p_session_id for update;
 if s.id is null then raise exception 'Заседание не найдено'; end if;
 if not private.can_manage_government_session(s.game_id,v_uid) then raise exception 'Недостаточно прав на открытие заседания'; end if;
 if s.status<>'draft' then raise exception 'Заседание уже открыто или завершено'; end if;
 if s.agenda_approved_at is null then raise exception 'Сначала Председатель Правительства должен утвердить сформированную повестку';end if;
 if not private.can_approve_government_agenda(s.game_id,v_uid) then raise exception 'Начать заседание может только Председатель Правительства';end if;
 if not exists(select 1 from public.government_session_questions where session_id=s.id)
    and not exists(select 1 from public.government_program_agenda where session_id=s.id) then
    raise exception 'Добавьте хотя бы один вопрос повестки';
 end if;
 if not exists(select 1 from public.game_stages st where st.game_id=s.game_id and st.stage_no=11 and st.status='open') then
  raise exception 'Сначала преподаватель должен открыть Этап 11';end if;
 update public.government_sessions set status='open',opened_at=now(),chair_user_id=v_uid where id=s.id;
 -- The Government session agenda is the ONE official agenda used by voting registration.
 insert into public.institution_meeting_records(
  game_id,stage_no,institution_key,agenda_document_id,agenda_body,
  agenda_prepared_by,agenda_approved_by,agenda_approved_at)
 select s.game_id,11,'government',d.id,d.body_text,v_uid,v_uid,now()
 from public.government_sessions gs
 join public.formal_documents d on d.id=gs.agenda_document_id and d.game_id=gs.game_id
 where gs.id=s.id and d.status_code='published' and length(btrim(d.body_text))>=30
 on conflict(game_id,stage_no,institution_key) do update
 set agenda_document_id=excluded.agenda_document_id, agenda_body=excluded.agenda_body,
  agenda_prepared_by=excluded.agenda_prepared_by,agenda_approved_by=excluded.agenda_approved_by,
  agenda_approved_at=excluded.agenda_approved_at,updated_at=now()
 where public.institution_meeting_records.agenda_approved_at is null
  and not exists(select 1 from public.institution_session_registrations r
    where r.game_id=s.game_id and r.stage_no=11 and r.institution_key='government');
 if not exists(select 1 from public.institution_meeting_records r
    join public.formal_documents d on d.id=r.agenda_document_id and d.game_id=r.game_id
    where r.game_id=s.game_id and r.stage_no=11 and r.institution_key='government'
    and r.agenda_approved_at is not null and d.status_code='published' and length(btrim(r.agenda_body))>=30) then
  raise exception 'Открытие заседания требует утверждённой повестки';end if;
end;$function$;

CREATE OR REPLACE FUNCTION public.open_program_vote_from_agenda(p_item_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare i public.government_program_agenda%rowtype;s public.government_sessions%rowtype;p public.state_programs%rowtype;v_uid uuid:=(select auth.uid());v_vote uuid;
begin
 select * into i from public.government_program_agenda where id=p_item_id for update;
 if i.id is null then raise exception 'Agenda item not found'; end if;
 select * into s from public.government_sessions where id=i.session_id;
 if not private.can_manage_government_session(i.game_id,v_uid) then raise exception 'Government session management access required'; end if;
 if s.status<>'open' or i.status<>'presenting' then raise exception 'Сначала необходимо представить программу'; end if;
 if i.qa_closed_at is null then raise exception 'Завершите ответы на вопросы к докладчику перед голосованием';end if;
 if exists(select 1 from public.government_program_speaker_questions q where q.agenda_item_id=i.id and q.answer_text is null) then raise exception 'Вопросы к докладчику должны получить ответы';end if;
 select * into p from public.state_programs where id=i.program_id and game_id=i.game_id for update;
 if p.status='government_vote' and p.signed_at is not null and p.government_vote_id is not null then
  -- Legacy signature/post must remain untouched. Reuse ONE still-empty official ballot.
  select v.id into v_vote from public.game_votes v
  where v.id=p.government_vote_id and v.game_id=i.game_id
    and v.stage_no=11 and v.institution_key='government'
    and v.procedure_key='state_program' and v.status='open'
    and not exists(select 1 from public.game_ballots b where b.vote_id=v.id)
  for update;
  if v_vote is null then raise exception 'Ранее открытое голосование уже использовано или закрыто'; end if;
 else
  perform set_config('app.gos_program_agenda_item',i.id::text,true);
  v_vote:=public.open_state_program_government_vote(i.program_id);
  perform set_config('app.gos_program_agenda_item','',true);
 end if;
 update public.government_program_agenda set status='decision',vote_id=v_vote where id=i.id;
 return v_vote;
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
 if not private.can_manage_government_session(s.game_id,v_uid) then raise exception 'Government session management access required'; end if;
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
 if not private.can_manage_government_session(q.game_id,(select auth.uid())) or s.status<>'draft' then raise exception 'Удаление недоступно';end if;
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
 if not private.can_manage_government_session(q.game_id,(select auth.uid())) or s.status<>'draft' then raise exception 'Редактирование недоступно';end if;
 if not private.is_game_teacher(q.game_id) then perform private.require_game_meeting_registration(q.game_id,(select auth.uid()),s.stage_no,'government');end if;
 if length(btrim(coalesce(p_title,''))) not between 3 and 500 or p_duration_minutes not between 1 and 60 then raise exception 'Проверьте название и время доклада';end if;
 update public.government_session_questions set title=btrim(p_title),description=left(coalesce(p_description,''),6000),duration_minutes=p_duration_minutes where id=q.id;
 if q.program_agenda_id is not null then update public.government_program_agenda set report_minutes=p_duration_minutes where id=q.program_agenda_id;end if;
end;$function$;

REVOKE ALL ON FUNCTION public.create_government_session_from_programmes(uuid,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.sync_government_session_programmes(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.approve_government_session_agenda(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.ask_government_program_speaker(uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.answer_government_program_speaker(uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.close_government_program_questions(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_government_session_from_programmes(uuid,integer),
 public.sync_government_session_programmes(uuid),public.approve_government_session_agenda(uuid),
 public.ask_government_program_speaker(uuid,text),public.answer_government_program_speaker(uuid,text),
 public.close_government_program_questions(uuid) TO authenticated;

UPDATE public.game_stages SET summary='Разработайте и согласуйте проекты государственных программ. Представление, голосование, подпись и публикация проходят на Этапе 11.'
WHERE stage_no=10 AND title='Разработка государственных программ'
AND summary='Министерства разрабатывают государственные программы по своим направлениям под руководством министров.';
UPDATE public.game_stages SET summary='ГП с Этапа 10 автоматически входят в проект повестки. После утверждения Председателем Правительства: доклады, вопросы, голосование, подпись и публикация принятых программ.'
WHERE stage_no=11 AND title='Представление государственных программ'
AND summary='Представить государственные программы на заседании Правительства и принять решения по ним.';
