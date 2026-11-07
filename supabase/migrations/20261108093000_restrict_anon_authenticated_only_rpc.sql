-- These two security-definer RPCs require auth.uid() inside their bodies.
-- Anonymous callers always fail already; removing the anonymous EXECUTE
-- grant reduces exposed surface without modifying student/teacher permissions.
-- Public presidential polls intentionally keep their anonymous RPC access.
REVOKE EXECUTE ON FUNCTION public.get_my_game_identity(p_game uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_game_identity(p_game uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.teacher_update_party_statistics(p_party_id uuid, p_rating numeric, p_support numeric, p_mandates integer, p_expected_rating numeric, p_expected_support numeric, p_expected_mandates integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_update_party_statistics(p_party_id uuid, p_rating numeric, p_support numeric, p_mandates integer, p_expected_rating numeric, p_expected_support numeric, p_expected_mandates integer) TO authenticated, service_role;
