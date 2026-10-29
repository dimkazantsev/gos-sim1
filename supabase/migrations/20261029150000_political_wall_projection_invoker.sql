-- Step 2/9 continuation: single snapshot for political feed and metric history.
-- Read-time, per-request projection: never stores private party news or replies.
-- SECURITY INVOKER is critical: political_posts contains complex RLS for
-- unpublished Minjust party registration materials.
create or replace function public.get_political_wall_projection(p_game_id uuid)
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
  'posts', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select * from public.political_posts where game_id=p_game_id order by created_at desc limit 250) x),'[]'::jsonb),
  'media', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from public.political_post_media x where x.game_id=p_game_id),'[]'::jsonb),
  'formal_links', coalesce((select jsonb_agg(to_jsonb(x)) from public.political_post_formal_links x where x.game_id=p_game_id),'[]'::jsonb),
  'metric_history', coalesce((select jsonb_agg(to_jsonb(x) order by x.recorded_at asc) from (select * from public.state_metric_history where game_id=p_game_id order by recorded_at asc limit 3000) x),'[]'::jsonb),
  'support_history', coalesce((select jsonb_agg(to_jsonb(x) order by x.recorded_at asc) from (select * from public.party_support_history where game_id=p_game_id order by recorded_at asc limit 3000) x),'[]'::jsonb),
  'metrics', coalesce((select jsonb_agg(to_jsonb(x) order by x.sort_order asc) from public.state_metrics x where x.game_id=p_game_id),'[]'::jsonb)
 );
end;
$function$;
revoke all on function public.get_political_wall_projection(uuid) from public, anon;
grant execute on function public.get_political_wall_projection(uuid) to authenticated;
