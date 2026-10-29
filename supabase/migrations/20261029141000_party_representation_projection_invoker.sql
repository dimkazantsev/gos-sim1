-- Step 2/9 continued: party representation is a read-time projection.
-- SECURITY INVOKER keeps invitation-specific RLS (teacher / invitee / party leader).
-- No tables, triggers, materialized stale role data or additional write traffic.
create or replace function public.get_party_representation_projection(p_game_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
 select jsonb_build_object(
  'invitations',coalesce((
    select jsonb_agg(to_jsonb(i) order by i.created_at desc)
    from public.party_invitations i where i.game_id=p_game_id
  ),'[]'::jsonb),
  'mandates',coalesce((
    select jsonb_agg(to_jsonb(m) order by m.party_id,m.user_id)
    from public.party_member_mandates m where m.game_id=p_game_id
  ),'[]'::jsonb),
  'agreements',coalesce((
    select jsonb_agg(to_jsonb(a) order by a.created_at desc)
    from public.party_agreements a where a.game_id=p_game_id
  ),'[]'::jsonb)
 )
 where (select auth.uid()) is not null and private.is_game_member(p_game_id)
$function$;

revoke all on function public.get_party_representation_projection(uuid) from public, anon;
grant execute on function public.get_party_representation_projection(uuid) to authenticated;
