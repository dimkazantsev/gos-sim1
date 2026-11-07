-- ГОС.ID / 2026-11-08: restrict only the legacy QWIZ RPC privileges in the OLD project.
-- QWIZ-PARTY uses a separate Supabase project; no live GOС.ID component calls these functions.
-- No function body, data, row policy, Realtime publication or game role is changed.
-- Keep authenticated and service_role effective EXECUTE privileges unchanged.
-- Revoke PUBLIC too: two old functions inherited anonymous EXECUTE via PUBLIC.
REVOKE EXECUTE ON FUNCTION public.qwiz_apply_round_boost() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qwiz_apply_round_boost() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.qwiz_arcade_extras(p_code text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qwiz_arcade_extras(p_code text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.qwiz_arcade_state(p_code text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qwiz_arcade_state(p_code text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.qwiz_audience_active_room() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qwiz_audience_active_room() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.qwiz_geo_projection(p_code text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qwiz_geo_projection(p_code text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.qwiz_lobby_view(p_room uuid, p_public boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qwiz_lobby_view(p_room uuid, p_public boolean) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.qwiz_party_arcade(p_code text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qwiz_party_arcade(p_code text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.qwiz_party_projection(p_code text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qwiz_party_projection(p_code text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.qwiz_projector_music(p_room uuid, p_enable boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qwiz_projector_music(p_room uuid, p_enable boolean) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.qwiz_public_screen(p_code text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qwiz_public_screen(p_code text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.qwiz_release_countdown(p_code text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qwiz_release_countdown(p_code text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.qwiz_result_deadline() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qwiz_result_deadline() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.qwiz_tick(p_code text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qwiz_tick(p_code text) TO authenticated, service_role;
