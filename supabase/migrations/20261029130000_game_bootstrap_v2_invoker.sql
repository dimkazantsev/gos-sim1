-- Classroom step 1: 11 read-only game queries share one PostgREST round trip.
-- SECURITY INVOKER ensures each subquery retains its own table RLS policies.
-- Personal game membership/role and full roster are checked separately by the client.
create or replace function public.get_game_bootstrap_v2(p_game_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
 if auth.uid() is null or not private.is_game_member(p_game_id) then
   raise exception 'Нет доступа к игре.' using errcode='42501';
 end if;
 return jsonb_build_object(
  'game', (select to_jsonb(g) from public.games g where g.id=p_game_id),
  'metrics', (select coalesce(jsonb_agg(to_jsonb(x) order by x.label),'[]'::jsonb) from public.state_metrics x where x.game_id=p_game_id),
  'events', (select coalesce(jsonb_agg(to_jsonb(x) order by x.published_at desc),'[]'::jsonb) from (select * from public.game_events where game_id=p_game_id order by published_at desc limit 100) x),
  'channels', (select coalesce(jsonb_agg(to_jsonb(x) order by x.name),'[]'::jsonb) from public.chat_channels x where x.game_id=p_game_id),
  'stages', (select coalesce(jsonb_agg(to_jsonb(x) order by x.stage_no),'[]'::jsonb) from public.game_stages x where x.game_id=p_game_id),
  'votes', (select coalesce(jsonb_agg(to_jsonb(x) order by x.opened_at desc),'[]'::jsonb) from public.game_votes x where x.game_id=p_game_id),
  'evaluations', (select coalesce(jsonb_agg(to_jsonb(x) order by x.stage_no),'[]'::jsonb) from public.game_evaluations x where x.game_id=p_game_id),
  'crises', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) from public.game_crises x where x.game_id=p_game_id),
  'documents', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) from public.game_documents x where x.game_id=p_game_id),
  'profiles', (select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from public.game_profiles x where x.game_id=p_game_id),
  'formal_documents', (select coalesce(jsonb_agg(to_jsonb(x) order by x.updated_at desc),'[]'::jsonb) from public.formal_documents x where x.game_id=p_game_id)
 );
end;
$function$;
-- Do not expose to unauthenticated visitors: anonymous-game users have
-- a real Supabase authenticated role and must still pass private.is_game_member.
revoke all on function public.get_game_bootstrap_v2(uuid) from public, anon;
grant execute on function public.get_game_bootstrap_v2(uuid) to authenticated;
