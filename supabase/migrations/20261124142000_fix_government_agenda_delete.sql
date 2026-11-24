-- Safe deletion and explicit regeneration of a Government agenda before opening the meeting.
CREATE OR REPLACE FUNCTION public.delete_formal_document(p_document_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_uid uuid := (select auth.uid());
  d public.formal_documents%rowtype;
  v_teacher boolean;
  v_vote record;
  v_deleted boolean := false;
  v_session public.government_sessions%rowtype;
begin
  -- Lock a linked government session before the document, matching the
  -- approval/opening workflow. No locks on unrelated sessions.
  select * into d from public.formal_documents where id = p_document_id;
  if d.id is null or v_uid is null or not private.is_game_member(d.game_id) then
    raise exception 'Документ недоступен';
  end if;
  if d.doc_type='meeting_agenda' and d.subject_key='government' then
    select * into v_session from public.government_sessions s
    where s.agenda_document_id=d.id and s.game_id=d.game_id
    for update;
  end if;
  select * into d
  from public.formal_documents
  where id = p_document_id
  for update;

  if d.id is null or v_uid is null or not private.is_game_member(d.game_id) then
    raise exception 'Документ недоступен';
  end if;

  IF d.metadata->>'cutoff_price_proposal'='true' AND d.status_code='published' THEN
   RAISE EXCEPTION 'Вступивший в силу закон об изменении цены отсечения нельзя удалить.' USING errcode='42501';
  END IF;
  IF d.doc_type='bank_rate_decision' THEN raise exception 'Принятое решение по ключевой ставке нельзя удалить. Измените ставку новым решением Банка России.' using errcode='42501';END IF;
  v_teacher := private.is_game_teacher(d.game_id);

  if v_session.id is not null then
    if not (v_teacher or private.can_approve_government_agenda(d.game_id,v_uid)) then
      raise exception 'Удалить повестку может только действующий Председатель Правительства или преподаватель' using errcode='42501';
    end if;
    if v_session.stage_no<>11 or v_session.status<>'draft' or v_session.opened_at is not null
       or not exists(select 1 from public.game_stages st where st.game_id=d.game_id and st.stage_no=11 and st.status='open')
       or exists(select 1 from public.government_program_agenda a
         join public.state_programs p on p.id=a.program_id
         where a.session_id=v_session.id and
          (a.status<>'pending' or a.vote_id is not null or a.started_at is not null
           or a.completed_at is not null or p.government_vote_id is not null))
       or exists(select 1 from public.government_session_questions q
         where q.session_id=v_session.id and q.status<>'pending')
       or exists(select 1 from public.game_votes v where v.formal_document_id=d.id)
    then
      raise exception 'Нельзя удалить повестку после начала заседания или рассмотрения вопросов' using errcode='42501';
    end if;
    -- Clear the approval and reference atomically before the document is
    -- deleted. Keep the session, agenda items and programme records intact.
    update public.government_sessions
    set agenda_approved_at=null,agenda_approved_by=null,agenda_document_id=null
    where id=v_session.id and agenda_document_id=d.id;
    if not found then raise exception 'Повестка уже изменена. Обновите данные.';end if;
  elsif not (v_teacher or d.author_id = v_uid) then
    raise exception 'Удалить НПА может только его автор или преподаватель';
  end if;

  if exists (
    select 1
    from public.game_votes
    where formal_document_id = d.id
      and status = 'open'
  ) and not v_teacher then
    raise exception 'Сначала завершите или удалите открытое голосование по этому НПА';
  end if;

  if v_teacher then
    for v_vote in
      select id
      from public.game_votes
      where formal_document_id = d.id
        and status = 'open'
      order by opened_at
    loop
      perform public.delete_procedural_vote(v_vote.id);
    end loop;
  end if;

  delete from public.formal_documents
  where id = d.id;

  v_deleted := found;

  return jsonb_build_object(
    'deleted', v_deleted,
    'id', d.id,
    'registry_no', d.registry_no
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_government_session_programmes(p_session_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
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
 -- Recreate a deliberately removed draft document even when all five
 -- programme links already exist and no new agenda row was inserted.
 IF EXISTS(SELECT 1 FROM public.government_sessions gs
   WHERE gs.id=s.id AND gs.agenda_document_id IS NULL) THEN
  PERFORM private.refresh_government_agenda_document(s.id);
 END IF;
 RETURN n;
END $function$;
