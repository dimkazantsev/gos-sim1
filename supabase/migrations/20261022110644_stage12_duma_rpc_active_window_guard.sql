-- Guard State Duma action RPCs according to the originating session stage.
-- Historical Stage 6 minutes and ballots remain intact. Teachers retain their
-- existing administrative override. Students may mutate only an active stage.
-- Role and attendance checks remain in each RPC.
CREATE OR REPLACE FUNCTION private.require_duma_stage_open(p_game uuid,p_stage integer)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO 'pg_catalog','public','private','pg_temp'
AS $duma_stage$
BEGIN
 IF private.is_game_teacher(p_game) THEN RETURN; END IF;
 IF NOT EXISTS (
  SELECT 1 FROM public.game_stages st
  JOIN public.games g ON g.id=st.game_id
  WHERE st.game_id=p_game AND st.stage_no=p_stage
   AND st.status='open'
   AND (st.deadline IS NULL OR st.deadline>clock_timestamp())
   AND g.status='running' AND g.turn_open
   AND (g.turn_ends_at IS NULL OR g.turn_ends_at>clock_timestamp())
 ) THEN
  RAISE EXCEPTION 'Этап % ещё не открыт или срок работы истёк',p_stage
  USING ERRCODE='42501';
 END IF;
END;
$duma_stage$;
REVOKE ALL ON FUNCTION private.require_duma_stage_open(uuid,integer) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.add_duma_agenda_item(p_session_id uuid, p_document_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare s public.duma_sessions%rowtype;d public.formal_documents%rowtype;v_uid uuid:=(select auth.uid());v_no integer;v_id uuid;
begin
 select * into s from public.duma_sessions where id=p_session_id for update;
 if s.id is null then raise exception 'Session not found'; end if;
 if not private.can_manage_duma_session(s.game_id,v_uid) then raise exception 'State Duma chair / teacher access required'; end if;
 perform private.require_duma_stage_open(s.game_id,s.stage_no);
 if not private.is_game_teacher(s.game_id) then perform private.require_game_meeting_registration(s.game_id,v_uid,s.stage_no,'gd');end if;
 if s.status<>'draft' then raise exception 'Agenda can be changed only before the session opens'; end if;
 select * into d from public.formal_documents where id=p_document_id;
 if d.id is null or d.game_id<>s.game_id then raise exception 'Document not found in this game'; end if;
 if d.workflow_key not in ('bill','budget','gd_resolution') then raise exception 'Only parliamentary documents may enter the Duma agenda'; end if;
 if d.status_code in ('rejected','published') or d.current_owner_key='system' then
   raise exception 'Завершённый или отклонённый документ нельзя включить в новую повестку' using errcode='23514';
 end if;
 select coalesce(max(agenda_no),0)+1 into v_no from public.duma_agenda_items where session_id=s.id;
 insert into public.duma_agenda_items(session_id,game_id,formal_document_id,agenda_no)
 values(s.id,s.game_id,d.id,v_no) returning id into v_id;
 return v_id;
end;$function$;


CREATE OR REPLACE FUNCTION public.close_duma_session(p_session_id uuid, p_create_next boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare s public.duma_sessions%rowtype;v_uid uuid:=(select auth.uid());v_next uuid;v_next_no integer;v_carried integer;
begin
 select * into s from public.duma_sessions where id=p_session_id for update;
 if s.id is null then raise exception 'Session not found'; end if;
 if not private.can_manage_duma_session(s.game_id,v_uid) then raise exception 'State Duma chair / teacher access required'; end if;
 perform private.require_duma_stage_open(s.game_id,s.stage_no);
 if s.status<>'open' then raise exception 'Session is not open'; end if;

 update public.duma_sessions set status='closed',closed_at=now() where id=s.id;
 select count(*)::integer into v_carried from public.duma_agenda_items where session_id=s.id and status in ('pending','in_progress');
 update public.duma_agenda_items set status='carried_over' where session_id=s.id and status in ('pending','in_progress');

 if p_create_next and v_carried>0 then
   select coalesce(max(session_no),0)+1 into v_next_no from public.duma_sessions where game_id=s.game_id;
   insert into public.duma_sessions(game_id,session_no,title,status,chair_user_id,created_by)
   values(s.game_id,v_next_no,'Заседание Государственной Думы №'||v_next_no,'draft',v_uid,v_uid)
   returning id into v_next;

   insert into public.duma_agenda_items(session_id,game_id,formal_document_id,agenda_no,status)
   select v_next,s.game_id,formal_document_id,row_number() over(order by agenda_no),'pending'
   from public.duma_agenda_items
   where session_id=s.id and status='carried_over'
   order by agenda_no;
 end if;

 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(s.game_id,12,'Заседание ГД','notice','Заседание Государственной Думы закрыто',
   'Рассмотрено: '||(select count(*) from public.duma_agenda_items where session_id=s.id and status='completed')||
   '; перенесено: '||v_carried,v_uid);

 return jsonb_build_object('carried_over',v_carried,'next_session_id',v_next);
end;$function$;


CREATE OR REPLACE FUNCTION public.create_duma_session(p_game_id uuid, p_title text, p_scheduled_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_scheduled_end timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
 v_uid uuid:=(select auth.uid());v_no integer;v_id uuid;
 v_tz text;v_local_date date;v_start timestamptz;v_end timestamptz;
begin
 if v_uid is null or not private.can_manage_duma_session(p_game_id,v_uid) then raise exception 'State Duma chair / teacher access required'; end if;
 perform private.require_duma_stage_open(p_game_id,12);
 if exists(select 1 from public.duma_sessions where game_id=p_game_id and status='open') then raise exception 'Close the current State Duma session first'; end if;

 select coalesce(settings->>'evaluation_timezone','Asia/Barnaul') into v_tz from public.games where id=p_game_id;
 v_local_date:=(now() at time zone v_tz)::date;
 v_start:=coalesce(p_scheduled_start,(v_local_date+time '20:00') at time zone v_tz);
 v_end:=coalesce(p_scheduled_end,((v_local_date+1)+time '00:00') at time zone v_tz);
 if v_end<=v_start then raise exception 'Session end must be later than start'; end if;

 select coalesce(max(session_no),0)+1 into v_no from public.duma_sessions where game_id=p_game_id;
 insert into public.duma_sessions(game_id,session_no,title,scheduled_start,scheduled_end,chair_user_id,created_by)
 values(p_game_id,v_no,coalesce(nullif(trim(p_title),''),'Заседание Государственной Думы №'||v_no),v_start,v_end,v_uid,v_uid)
 returning id into v_id;
 return v_id;
end;$function$;


CREATE OR REPLACE FUNCTION public.open_duma_session(p_session_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare s public.duma_sessions%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into s from public.duma_sessions where id=p_session_id for update;
 if s.id is null then raise exception 'Session not found'; end if;
 if not private.can_manage_duma_session(s.game_id,v_uid) then raise exception 'State Duma chair / teacher access required'; end if;
 perform private.require_duma_stage_open(s.game_id,s.stage_no);
 if s.status<>'draft' then raise exception 'Session is not a draft'; end if;
 if not exists(select 1 from public.duma_agenda_items where session_id=s.id and status='pending')
 then raise exception 'The Duma does not meet without an agenda'; end if;
 update public.duma_sessions set status='open',opened_at=now(),chair_user_id=v_uid where id=s.id;
end;$function$;


CREATE OR REPLACE FUNCTION public.set_duma_agenda_item_status(p_item_id uuid, p_status text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare i public.duma_agenda_items%rowtype;s public.duma_sessions%rowtype;d public.formal_documents%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into i from public.duma_agenda_items where id=p_item_id for update;
 if i.id is null then raise exception 'Вопрос повестки не найден';end if;
 select * into s from public.duma_sessions where id=i.session_id;
 if not private.can_manage_duma_session(i.game_id,v_uid) then raise exception 'Нет полномочий на управление заседанием ГД';end if;
 perform private.require_duma_stage_open(i.game_id,s.stage_no);
 if not private.is_game_teacher(i.game_id) then perform private.require_game_meeting_registration(i.game_id,v_uid,s.stage_no,'gd');end if;
 if s.status<>'open' then raise exception 'Заседание не открыто';end if;
 if p_status not in ('in_progress','completed','withdrawn') then raise exception 'Неизвестный статус вопроса';end if;
 select * into d from public.formal_documents where id=i.formal_document_id;
 if d.id is null then raise exception 'Связанный НПА не найден';end if;
 if p_status='in_progress' then
  if i.status not in ('pending','in_progress') then raise exception 'Этот вопрос уже завершён';end if;
  if exists(select 1 from public.duma_agenda_items x where x.session_id=i.session_id and x.id<>i.id and x.status='in_progress') then
   raise exception 'Сначала завершите предыдущий вопрос повестки';end if;
  update public.duma_agenda_items
    set status='in_progress',started_at=coalesce(started_at,now()),opened_document_step=coalesce(opened_document_step,d.status_code),
      result_note=nullif(btrim(coalesce(p_note,'')),'')
  where id=i.id;
 elsif p_status='completed' then
  if i.status<>'in_progress' then raise exception 'Сначала начните рассмотрение вопроса';end if;
  if exists(select 1 from public.game_votes v where v.formal_document_id=d.id and v.status='open') then
    raise exception 'Сначала завершите голосование по этому документу';end if;
  if d.status_code=coalesce(i.opened_document_step,d.status_code) then
    raise exception 'Стадия документа не изменилась. Проведите чтение или процедурное решение в реестре НПА';end if;
  update public.duma_agenda_items set status='completed',completed_at=now(),
    result_note=nullif(btrim(coalesce(p_note,'')),'')
   where id=i.id;
 else
  if i.status not in ('pending','in_progress') then raise exception 'Этот вопрос уже завершён';end if;
  update public.duma_agenda_items set status='withdrawn',completed_at=now(),
    result_note=nullif(btrim(coalesce(p_note,'')),'') where id=i.id;
 end if;
end;$function$;

