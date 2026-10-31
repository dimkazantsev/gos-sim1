-- Non-breaking paged political-process projection. The existing, fully
-- searchable get_political_wall_projection(uuid) remains unchanged for
-- existing clients and on-demand full-search compatibility.
-- Only data belonging to a page is returned for attached media/documents.
create or replace function public.get_political_wall_page(
 p_game_id uuid,
 p_cursor_pinned boolean default null,
 p_cursor_created_at timestamptz default null,
 p_cursor_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
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
  select p.*
  from public.political_posts p
  where p.game_id=p_game_id
    and (p_cursor_created_at is null or
      (coalesce(p.pinned,false),p.created_at,p.id)
      < (coalesce(p_cursor_pinned,false),p_cursor_created_at,p_cursor_id))
  order by coalesce(p.pinned,false) desc,p.created_at desc,p.id desc
  limit 11
 ), page as materialized (
  select * from pool
  order by coalesce(pinned,false) desc,created_at desc,id desc
  limit 10
 )
 select jsonb_build_object(
  'posts',coalesce((select jsonb_agg(to_jsonb(p) order by coalesce(p.pinned,false) desc,p.created_at desc,p.id desc) from page p),'[]'::jsonb),
  'media',coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at desc)
    from public.political_post_media m where m.game_id=p_game_id and m.post_id in (select id from page)),'[]'::jsonb),
  'formal_links',coalesce((select jsonb_agg(to_jsonb(l))
    from public.political_post_formal_links l where l.game_id=p_game_id and l.post_id in (select id from page)),'[]'::jsonb),
  'has_more',(select count(*)>10 from pool),
  'total_posts',(select count(*) from public.political_posts where game_id=p_game_id),
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
revoke all on function public.get_political_wall_page(uuid,boolean,timestamptz,uuid) from public,anon;
grant execute on function public.get_political_wall_page(uuid,boolean,timestamptz,uuid) to authenticated;
