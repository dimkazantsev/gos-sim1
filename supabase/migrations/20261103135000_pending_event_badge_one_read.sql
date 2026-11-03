-- ГОС.ID: one RLS-protected indexed read for pending situation badges.
-- Replaces two queries per participant; intentionally does not touch events,
-- vote results, scoring, or authoritative documents.
CREATE OR REPLACE FUNCTION public.get_my_pending_event_count(p_game_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $fn$
  SELECT count(*)::integer
  FROM (
    SELECT a.case_id FROM public.event_assignments a
    WHERE a.game_id = p_game_id AND a.recipient_id = (SELECT auth.uid())
      AND a.status = 'pending'
    UNION
    SELECT i.case_id FROM public.event_collaboration_invites i
    WHERE i.game_id = p_game_id AND i.recipient_id = (SELECT auth.uid())
      AND i.status = 'pending'
  ) pending_cases;
$fn$;

REVOKE ALL ON FUNCTION public.get_my_pending_event_count(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_pending_event_count(uuid) TO authenticated;
