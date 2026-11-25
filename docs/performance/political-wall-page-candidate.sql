-- Historical candidate. Installed via migration 20261124185203_optimize_political_wall_page_pool.sql.
-- Full JSON response matched old query 12/12 before and 12/12 after installation across three roles.
-- ACL unchanged (anon denied, authenticated allowed), SECURITY INVOKER, STABLE, empty search_path.
-- Nonmember and malformed cursor rejected before installation; guard unchanged. No active presence at installation.
-- 2026-11-25: SELECT-only candidate pool tested under authenticated student, teacher, observer RLS;
-- four cursors each, 12/12 equivalent ordered IDs. Single warm-cache student first-page executions:
-- original 28.230 ms / 2714 shared buffer hits; candidate 2.446 ms / 182 hits.
-- Uses existing indexes; does not alter RLS, ACLs, response shape, or other CTEs.
-- This is not a whole-RPC benchmark. No manual execution of this historical copy is needed.
CREATE OR REPLACE FUNCTION public.get_political_wall_page(p_game_id uuid, p_cursor_pinned boolean DEFAULT NULL::boolean, p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
 v_page jsonb;
begin
 if auth.uid() is null or not private.is_game_member(p_game_id) then
  raise exception 'Нет доступа к игре.' using errcode='42501';
 end if;
 if p_cursor_created_at is not null and p_cursor_id is null then
  raise exception 'Некорректный курсор ленты.' using errcode='22023';
 end if;
 with pool as materialized (
  select * from (
   (select p.* from public.political_posts p
    where p.game_id=p_game_id and p.pinned
     and (p_cursor_created_at is null or
      (coalesce(p_cursor_pinned,false) and (p.created_at,p.id)<(p_cursor_created_at,p_cursor_id)))
    order by p.created_at desc,p.id desc limit 11)
   union all
   (select p.* from public.political_posts p
    where p.game_id=p_game_id and p.pinned is not true
     and (p_cursor_created_at is null or coalesce(p_cursor_pinned,false)
      or (p.created_at,p.id)<(p_cursor_created_at,p_cursor_id))
    order by p.created_at desc,p.id desc limit 11)
  ) q
  order by coalesce(q.pinned,false) desc,q.created_at desc,q.id desc
  limit 11
 ), page as materialized (
  select * from pool
  order by coalesce(pinned,false) desc,created_at desc,id desc
  limit 10
 ), actor_pool as materialized (
  -- Project only the fields used by the first-page count and actor picker.
  -- Reuse the SAME RLS-filtered scan rather than testing permissions twice.
  select p.actor_key,p.actor_label,p.created_at
  from public.political_posts p
  where p.game_id=p_game_id
 )
 select jsonb_build_object(
  'posts',coalesce((select jsonb_agg(to_jsonb(p) order by coalesce(p.pinned,false) desc,p.created_at desc,p.id desc) from page p),'[]'::jsonb),
  'media',coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at desc)
    from public.political_post_media m where m.game_id=p_game_id and m.post_id in (select id from page)),'[]'::jsonb),
  'formal_links',coalesce((select jsonb_agg(to_jsonb(l))
    from public.political_post_formal_links l where l.game_id=p_game_id and l.post_id in (select id from page)),'[]'::jsonb),
  'has_more',(select count(*)>10 from pool),
  'total_posts',case when p_cursor_created_at is null then (select count(*) from actor_pool) else null end,
  'actor_options',case when p_cursor_created_at is null then
   coalesce((select jsonb_agg(jsonb_build_object('actor_key',a.actor_key,'actor_label',a.actor_label))
    from (select distinct on (p.actor_key) p.actor_key,p.actor_label
     from actor_pool p
     order by p.actor_key,p.created_at desc) a),'[]'::jsonb)
   else '[]'::jsonb end,
  'metric_history',case when p_cursor_created_at is null then
   coalesce((select jsonb_agg(to_jsonb(h) order by h.recorded_at asc,h.id asc)
    from (select * from public.state_metric_history where game_id=p_game_id order by recorded_at desc,id desc limit 50) h),'[]'::jsonb)
   else '[]'::jsonb end,
  'support_history',case when p_cursor_created_at is null then
   coalesce((select jsonb_agg(to_jsonb(h) order by h.recorded_at asc,h.id asc)
    from (select * from public.party_support_history where game_id=p_game_id order by recorded_at desc,id desc limit 50) h),'[]'::jsonb)
   else '[]'::jsonb end,
  'metrics',case when p_cursor_created_at is null then
   coalesce((select jsonb_agg(to_jsonb(m) order by m.sort_order asc) from public.state_metrics m where m.game_id=p_game_id),'[]'::jsonb)
   else '[]'::jsonb end
 ) into v_page;
 return v_page;
end;
$function$;
