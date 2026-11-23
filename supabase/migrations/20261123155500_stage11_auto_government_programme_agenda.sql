
-- ГОС.ID. Auto-prepare Stage 11 Government draft agenda from ready Stage 10 programmes.
-- No cron, no polling, no change to the Prime Minister's personal approval/signature.
CREATE OR REPLACE FUNCTION private.ensure_stage11_government_agenda(p_game uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $body$
DECLARE
 v_pm uuid;
 v_session uuid;
 v_next_no integer;
 v_existing integer;
BEGIN
 IF p_game IS NULL THEN RETURN; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('gos-stage11-auto-agenda:'||p_game::text,0));
 IF NOT EXISTS (
   SELECT 1 FROM public.game_stages s
   WHERE s.game_id=p_game AND s.stage_no=11 AND s.status='open'
 ) THEN RETURN; END IF;
 IF NOT EXISTS (
   SELECT 1 FROM public.state_programs p
   WHERE p.game_id=p_game AND p.stage_no=10 AND p.status='ready'
     AND p.signed_at IS NULL
 ) THEN RETURN; END IF;

 SELECT a.user_id INTO v_pm
 FROM public.game_office_assignments a
 JOIN public.game_members m ON m.game_id=a.game_id AND m.user_id=a.user_id
 WHERE a.game_id=p_game AND a.status='active'
   AND a.role_title ~* '^[[:space:]]*председатель[[:space:]]+правительства([[:space:]]|$)'
   AND m.kind='student' AND m.roster_archived_at IS NULL
 ORDER BY a.created_at DESC LIMIT 1;
 IF v_pm IS NULL THEN RETURN; END IF;

 -- Never alter a meeting after the chair approved its agenda or opened it.
 SELECT s.id INTO v_session
 FROM public.government_sessions s
 WHERE s.game_id=p_game AND s.stage_no=11
   AND s.status='draft' AND s.agenda_approved_at IS NULL
 ORDER BY s.session_no DESC LIMIT 1 FOR UPDATE;
 IF v_session IS NULL THEN
   -- A completed/approved meeting is never silently replaced.
   IF EXISTS (
     SELECT 1 FROM public.government_sessions s
     WHERE s.game_id=p_game AND s.stage_no=11
   ) THEN RETURN; END IF;
   SELECT coalesce(max(s.session_no),0)+1 INTO v_next_no
   FROM public.government_sessions s WHERE s.game_id=p_game;
   INSERT INTO public.government_sessions
     (game_id,stage_no,session_no,title,time_limit_minutes,status,chair_user_id,created_by)
   VALUES(p_game,11,v_next_no,'Заседание Правительства Российской Федерации',60,'draft',v_pm,v_pm)
   RETURNING id INTO v_session;
 END IF;

 SELECT count(*)::integer INTO v_existing
 FROM public.government_program_agenda a WHERE a.session_id=v_session;
 IF v_existing>=30 THEN RETURN; END IF;

 -- Existing agenda trigger refreshes the SAME official draft document.
 -- Existing matches remain intact, keeping manual additions and numbering.
 INSERT INTO public.government_program_agenda
   (session_id,game_id,program_id,agenda_no,report_minutes)
 SELECT v_session,p_game,p.id,
     (v_existing+row_number() OVER (ORDER BY p.responsible_ministry,p.title,p.id))::integer,7
 FROM public.state_programs p
 WHERE p.game_id=p_game AND p.stage_no=10 AND p.status='ready'
   AND p.signed_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.government_program_agenda a
     WHERE a.program_id=p.id
   )
 ORDER BY p.responsible_ministry,p.title,p.id
 LIMIT greatest(0,30-v_existing);
END;
$body$;
REVOKE ALL ON FUNCTION private.ensure_stage11_government_agenda(uuid)
  FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.stage11_government_agenda_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $trigger$
BEGIN
 IF TG_TABLE_NAME='state_programs' THEN
   IF TG_OP='UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status
     AND OLD.signed_at IS NOT DISTINCT FROM NEW.signed_at THEN RETURN NEW; END IF;
   IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND
      (NEW.status='ready' OR OLD.status='ready')) THEN
     PERFORM private.ensure_stage11_government_agenda(NEW.game_id);
   END IF;
 ELSE
   IF NEW.stage_no=11 AND NEW.status='open' THEN
     PERFORM private.ensure_stage11_government_agenda(NEW.game_id);
   END IF;
 END IF;
 RETURN NEW;
END;
$trigger$;
REVOKE ALL ON FUNCTION private.stage11_government_agenda_change()
  FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS stage11_auto_agenda_programs ON public.state_programs;
CREATE TRIGGER stage11_auto_agenda_programs
 AFTER INSERT OR UPDATE OF status,signed_at
 ON public.state_programs FOR EACH ROW
 EXECUTE FUNCTION private.stage11_government_agenda_change();

DROP TRIGGER IF EXISTS stage11_auto_agenda_open ON public.game_stages;
CREATE TRIGGER stage11_auto_agenda_open
 AFTER UPDATE OF status ON public.game_stages FOR EACH ROW
 WHEN (NEW.stage_no=11 AND NEW.status='open' AND OLD.status IS DISTINCT FROM NEW.status)
 EXECUTE FUNCTION private.stage11_government_agenda_change();

-- Repair already opened Stage 11 sessions once, not on each page load.
DO $backfill$
DECLARE x record;
BEGIN
 FOR x IN (
   SELECT s.game_id FROM public.game_stages s
   WHERE s.stage_no=11 AND s.status='open'
 ) LOOP
   PERFORM private.ensure_stage11_government_agenda(x.game_id);
 END LOOP;
END;
$backfill$;
