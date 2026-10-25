-- A07 follow-up: protect internal SECURITY DEFINER impact helpers from direct
-- invocation by API roles. Their only observed callers are postgres-owned
-- SECURITY DEFINER functions (private.register_post_decision,
-- private.run_impact_rules, public.approve_post_impact).
-- Avoid modifying any function body, game state, formulas, RLS or schema USAGE.
-- A07 metric and party row locks are preserved unchanged.
--
-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default.
-- Removing both inherited PUBLIC and any role-specific grants prevents direct
-- execution while preserving calls made by the function owner (postgres).

REVOKE EXECUTE ON FUNCTION private.apply_post_effects(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION private.apply_rule_effects(
  uuid, public.impact_rules, text, text, uuid, jsonb, text
) FROM PUBLIC, anon, authenticated;
