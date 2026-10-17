-- Student KSRF actions need an actually open stage *after* agenda + attendance.
-- Does not reopen historic stages, mutate old results, or block pre-stage meeting setup.
CREATE OR REPLACE FUNCTION private.require_game_meeting_registration(p_game uuid, p_user uuid, p_stage integer, p_institution text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
begin
 if p_user is null or not exists (
  select 1 from public.game_members m where m.game_id=p_game and m.user_id=p_user
    and m.kind='student' and m.roster_archived_at is null
 ) then
  if p_user=(select auth.uid()) and private.is_game_teacher(p_game) then return;end if;
  raise exception 'Требуются полномочия действующего участника';
 end if;
 if not private.vote_member_has_office(p_game,p_user,p_institution) then
   raise exception 'Для этого органа отсутствуют полномочия';
 end if;
 -- The old games may contain attendance records created without any agenda.
 -- Attendance alone must never unlock KSRF proceedings on stages 2 or 3.
 if p_institution='ksrf' and p_stage in (2,3) and not exists(
   select 1 from public.institution_meeting_records m
   join public.formal_documents d on d.game_id=m.game_id and d.id=m.agenda_document_id
   where m.game_id=p_game and m.stage_no=p_stage and m.institution_key='ksrf'
     and m.agenda_approved_at is not null and d.status_code='published'
     and length(btrim(coalesce(m.agenda_body,'')))>=30
 ) then
   raise exception 'Сначала составьте и утвердите повестку заседания КСРФ';
 end if;
 -- A registered chair cannot resume substantive work in an officially
 -- completed/paused stage. Agenda preparation and check-in are separate RPCs.
 if p_institution='ksrf' and p_stage in (2,3) and not exists(
   select 1 from public.game_stages s join public.games g on g.id=s.game_id
   where s.game_id=p_game and s.stage_no=p_stage and s.status='open'
     and g.status='running' and g.turn_open
     and (s.deadline is null or s.deadline>clock_timestamp())
     and (g.turn_ends_at is null or g.turn_ends_at>clock_timestamp())
 ) then
   raise exception 'Этап завершён или ещё не открыт. Для работы требуется открытый этап КСРФ.';
 end if;
 if not exists (
  select 1 from public.institution_session_registrations r
  where r.game_id=p_game and r.user_id=p_user and r.stage_no=p_stage and r.institution_key=p_institution
 ) then
   raise exception 'Сначала зарегистрируйтесь на заседание органа: %',p_institution;
 end if;
end $function$;
