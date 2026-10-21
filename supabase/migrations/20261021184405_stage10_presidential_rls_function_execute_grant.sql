-- RLS on presidential_addresses and presidential_priorities invokes this helper.
-- It must be executable by authenticated readers, independently of the SELECT table grant.
-- The helper checks auth.uid() against its p_user argument and enforces existing office membership.
-- Do not expose a general authorization bypass or add any direct INSERT/UPDATE permissions.
GRANT EXECUTE ON FUNCTION private.can_manage_presidential_policy(uuid, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION private.can_manage_presidential_policy(uuid, uuid) FROM anon, PUBLIC;
