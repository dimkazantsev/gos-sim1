-- GOС.ID · Restore teacher-visible assigned events without exposing answer keys.
-- The previous projection read event_cases.effect_plan as SECURITY INVOKER,
-- but this column is deliberately REVOKEd from authenticated users.
-- Keep it protected. Only completed winning outcomes are read by the narrow
-- authorized helper; all other feed tables retain their own invoker RLS.
-- One existing RPC, no new HTTP, poll, Realtime channel, trigger or table.
SET LOCAL lock_timeout='1500ms';
SET LOCAL statement_timeout='15s';
DO $preflight$
BEGIN
 IF md5(pg_get_functiondef('public.get_event_workspace_projection(uuid,boolean)'::regprocedure)) <> '0eee069fdb4ed91bb9a7abb6a31ebaf0' THEN
   RAISE EXCEPTION 'Event feed projection drift; review before changing';
 END IF;
 IF has_column_privilege('authenticated','public.event_cases','effect_plan','SELECT') THEN
   RAISE EXCEPTION 'Secret event answers unexpectedly exposed';
 END IF;
END $preflight$;
CREATE OR REPLACE FUNCTION private.event_winning_outcomes_visible(p_game_id uuid, p_case_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_actor uuid := (SELECT auth.uid());
 v_teacher boolean;
 v_observer boolean;
 v_results jsonb;
BEGIN
 IF v_actor IS NULL OR p_game_id IS NULL OR cardinality(p_case_ids)>400
    OR NOT private.is_game_member(p_game_id) THEN
   RAISE EXCEPTION 'Нет доступа к событиям этой игры.' USING ERRCODE='42501';
 END IF;
 v_teacher:=private.is_game_teacher(p_game_id);
 SELECT EXISTS(SELECT 1 FROM public.game_members gm
   WHERE gm.game_id=p_game_id AND gm.user_id=v_actor AND gm.kind='observer'
     AND gm.roster_archived_at IS NULL) INTO v_observer;
 IF NOT v_teacher AND NOT v_observer AND coalesce(cardinality(p_case_ids),0)=0 THEN
   RETURN '{}'::jsonb;
 END IF;
 -- Definer access is limited to outcomes that already exist. Do not expose
 -- a nonwinning option, case text, or the source effect_plan column.
 SELECT coalesce(jsonb_object_agg(o.case_id::text,jsonb_build_object(
   'winning_fiscal_effect',CASE WHEN o.winner ~ '^option_[1-9][0-9]*$'
     THEN c.effect_plan->'options'->(substring(o.winner from 8)::integer-1)->'fiscal_effect'
     ELSE NULL END,
   'winning_description',CASE WHEN o.winner ~ '^option_[1-9][0-9]*$'
     THEN c.effect_plan->'options'->(substring(o.winner from 8)::integer-1)->>'description'
     ELSE NULL END)), '{}'::jsonb)
 INTO v_results
 FROM public.event_case_outcomes o
 JOIN public.event_cases c ON c.id=o.case_id AND c.game_id=o.game_id
 WHERE o.game_id=p_game_id
   AND (v_teacher OR v_observer
        OR (o.case_id=ANY(p_case_ids)
            AND (EXISTS(SELECT 1 FROM public.event_assignments a
                  WHERE a.game_id=o.game_id AND a.case_id=o.case_id AND a.recipient_id=v_actor)
              OR EXISTS(SELECT 1 FROM public.event_collaboration_invites i
                  WHERE i.game_id=o.game_id AND i.case_id=o.case_id AND i.recipient_id=v_actor))));
 RETURN v_results;
END;
$function$;
REVOKE ALL ON FUNCTION private.event_winning_outcomes_visible(uuid,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.event_winning_outcomes_visible(uuid,uuid[]) TO authenticated;
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
 v_winning jsonb;
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
 -- Evaluate only the publicly resolved winning option, never a case answer key.
 v_winning:=private.event_winning_outcomes_visible(p_game_id,v_cases);
 RETURN jsonb_build_object(
  'assignments',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)
   FROM (SELECT id,case_id,game_id,recipient_id,status,created_at FROM public.event_assignments
    WHERE game_id=p_game_id AND (v_full_view OR case_id=ANY(v_cases))) x),'[]'::jsonb),
  'decisions',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)
   FROM (SELECT id,case_id,actor_id,choice,role_snapshot FROM public.event_decisions
    WHERE game_id=p_game_id AND (v_full_view OR case_id=ANY(v_cases))) x),'[]'::jsonb),
  'outcomes',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.case_id)
   FROM (SELECT o.case_id,o.winner,o.trust_delta,o.votes_count,o.assignments_count,o.media_post_id,o.requested_trust_delta,o.resolution_kind,
     (v_winning->(o.case_id::text)->'winning_fiscal_effect') AS winning_fiscal_effect,
     (v_winning->(o.case_id::text)->>'winning_description') AS winning_description
   FROM public.event_case_outcomes o
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
REVOKE ALL ON FUNCTION public.get_event_workspace_projection(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_event_workspace_projection(uuid,boolean) TO authenticated;
