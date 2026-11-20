-- ГОС.ID: Add winner-only regional data to existing event projection.
-- Already applied on Supabase as 20261120142502; safe for new environments
-- using unchanged client access and role checks, no new network queries.
SET LOCAL lock_timeout='1500ms';
SET LOCAL statement_timeout='12s';
DO $guard$ BEGIN
 IF to_regprocedure('public.get_event_workspace_projection(uuid,boolean)') IS NULL THEN
  RAISE EXCEPTION 'Event projection missing';
 END IF;
 IF position('private.is_game_member' in pg_get_functiondef('public.get_event_workspace_projection(uuid,boolean)'::regprocedure))=0 THEN
  RAISE EXCEPTION 'Event projection authorization changed';
 END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.get_event_workspace_projection(p_game_id uuid, p_include_ready_count boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
 v_teacher boolean;
 v_full_view boolean;
 v_cases uuid[];
BEGIN
 IF auth.uid() IS NULL OR NOT private.is_game_member(p_game_id) THEN
  RAISE EXCEPTION 'Нет доступа к игре.' USING ERRCODE='42501';
 END IF;
 v_teacher:=private.is_game_teacher(p_game_id);
 v_full_view:=v_teacher OR EXISTS(
  SELECT 1 FROM public.game_members gm WHERE gm.game_id=p_game_id AND gm.user_id=(SELECT auth.uid())
    AND gm.kind='observer' AND gm.roster_archived_at IS NULL);
 IF NOT v_full_view THEN
  SELECT coalesce(array_agg(DISTINCT x.case_id),ARRAY[]::uuid[]) INTO v_cases
  FROM (
   SELECT a.case_id FROM public.event_assignments a
    WHERE a.game_id=p_game_id AND a.recipient_id=(SELECT auth.uid())
   UNION
   SELECT i.case_id FROM public.event_collaboration_invites i
    WHERE i.game_id=p_game_id AND i.recipient_id=(SELECT auth.uid())
  ) x;
 END IF;
 RETURN jsonb_build_object(
  'assignments',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)
   FROM (SELECT id,case_id,game_id,recipient_id,status,created_at FROM public.event_assignments
    WHERE game_id=p_game_id AND (v_full_view OR case_id=ANY(v_cases))) x),'[]'::jsonb),
  'decisions',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)
   FROM (SELECT id,case_id,actor_id,choice,role_snapshot FROM public.event_decisions
    WHERE game_id=p_game_id AND (v_full_view OR case_id=ANY(v_cases))) x),'[]'::jsonb),
  'outcomes',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.case_id)
   FROM (SELECT o.case_id,o.winner,o.trust_delta,o.votes_count,o.assignments_count,o.media_post_id,o.requested_trust_delta,o.resolution_kind,
    CASE WHEN o.winner ~ '^option_[1-9][0-9]*$' THEN
      c.effect_plan->'options'->(substring(o.winner from 8)::integer-1)->'fiscal_effect'
      ELSE NULL END AS winning_fiscal_effect,
    CASE WHEN o.winner ~ '^option_[1-9][0-9]*$' THEN
      c.effect_plan->'options'->(substring(o.winner from 8)::integer-1)->>'description'
      ELSE NULL END AS winning_description
   FROM public.event_case_outcomes o JOIN public.event_cases c ON c.id=o.case_id AND c.game_id=o.game_id
   WHERE o.game_id=p_game_id AND (v_full_view OR o.case_id=ANY(v_cases))) x),'[]'::jsonb),
  'invitations',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)
   FROM (SELECT id,case_id,inviter_id,recipient_id,status FROM public.event_collaboration_invites
    WHERE game_id=p_game_id AND (v_full_view OR case_id=ANY(v_cases))) x),'[]'::jsonb),
  'authority',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.decision_id)
   FROM (SELECT decision_id,case_id,actor_id,authority_ok,lawful,strategy_point,role_snapshot,legal_basis
   FROM public.event_authority_evidence WHERE game_id=p_game_id AND (v_full_view OR case_id=ANY(v_cases))) x),'[]'::jsonb),
  'ready_case_count',CASE WHEN p_include_ready_count AND v_teacher THEN
   (SELECT count(*) FROM public.event_cases WHERE game_id=p_game_id AND status='ready')
   ELSE NULL END
 );
END $function$;
