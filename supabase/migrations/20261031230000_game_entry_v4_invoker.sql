-- ГОС.ID · Этап 8.5. Единая начальная загрузка с сохранением RLS.
-- Базовые 11 разделов берутся из существующего SECURITY INVOKER bootstrap v3.
-- Личная запись, roster и партии читаются под правами вызывающего пользователя.
create or replace function public.get_game_entry_v4(p_game_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
 return public.get_game_bootstrap_v3(p_game_id) || jsonb_build_object(
  'member', (
   select to_jsonb(m) from public.game_members m
   where m.game_id = p_game_id and m.user_id = auth.uid()
  ),
  'roster', (
   select coalesce(jsonb_agg(to_jsonb(m) order by m.full_name), '[]'::jsonb)
   from (
    select game_id, user_id, full_name, group_name, kind, role_title, team, score, joined_at, party_joined_at, roster_archived_at
    from public.game_members where game_id = p_game_id
   ) m
  ),
  'parties', (
   select coalesce(jsonb_agg(to_jsonb(p) order by p.support desc, p.created_at, p.id), '[]'::jsonb)
   from (
    select id, game_id, created_by, name, support, mandates, regions, budget, leader_user_id, color, logo_path, ghost_loss_current, ghost_active, ghost_started_at, representation_penalty, regional_seat_penalty, ghost_risk_weight, presidential_rating_modifier, registration_status, registration_submitted_at, registration_reviewed_at, registration_reviewed_by, mandate_allocation_mode, regional_seats_awarded, created_at, rating
    from public.game_parties where game_id = p_game_id
   ) p
  ),
  -- Preserve the existing global intro semantics, without direct profile reads.
  'intro', public.has_seen_my_intro()
 );
end;
$function$;

revoke all on function public.get_game_entry_v4(uuid) from public, anon;
grant execute on function public.get_game_entry_v4(uuid) to authenticated;
