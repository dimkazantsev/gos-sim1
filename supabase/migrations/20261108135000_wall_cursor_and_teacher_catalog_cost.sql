-- ГОС.ID: skip unnecessary actor scans when fetching older political pages,
-- and avoid five identical authorization/role lookups for fixed teacher portfolios.
-- Preserve RLS, role catalog, pagination, JSON keys, and existing GRANTs.
-- On cursor pages total_posts is explicitly null; those pages only use has_more.
-- No new indexes, realtime channels, background tasks or services.

CREATE OR REPLACE FUNCTION public.get_political_wall_page(p_game_id uuid, p_cursor_pinned boolean DEFAULT NULL::boolean, p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY INVOKER
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


CREATE OR REPLACE FUNCTION public.get_process_actors(p_game_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare result jsonb:='[]'::jsonb;k text;label text;a record;
 v_uid uuid:=(select auth.uid());v_teacher boolean;
begin
 if not private.is_game_member(p_game_id) then raise exception 'Нет доступа к игре';end if;
 v_teacher:=private.is_game_teacher(p_game_id);
 foreach k in array array['participant','ksrf','office','party','president','government',
 'gd','sf','ministry','municipality','media','minjust','interior',
 'cec','ks','vs','central_bank','accounts'] loop
  if v_teacher and k in ('ministry','minjust','interior') then continue;end if;
  begin
   if not v_teacher and not private.process_actor_active_now(p_game_id,k) then continue;end if;
   label:=private.process_actor_label(p_game_id,k);
   if label is not null and btrim(label)<>'' then
    result:=result||jsonb_build_array(jsonb_build_object('key',k,'label',label));
   end if;
  exception when others then null;end;
 end loop;
 -- The five ministries are those established by the game rules, not extra ministries.
 if v_teacher then
  -- The label helper verifies non-observer game membership for each portfolio.
  -- Do that identical permission check once before returning the fixed catalog.
  -- Preserve failure for platform admins who have no non-observer member row.
  if not exists(
   select 1 from public.game_members gm
   where gm.game_id=p_game_id and gm.user_id=v_uid and gm.kind<>'observer'
  ) then raise exception 'Публикации доступны участникам игры';end if;
  -- These five identifiers and official names are defined in
  -- private.process_actor_label; never invent additional ministries.
  for a in select x.actor_key,x.actor_label from (values
   ('portfolio:social','Министерство по социальной политике'),
   ('portfolio:economic','Министерство по экономической политике'),
   ('portfolio:foreign','Министерство по внешней политике'),
   ('portfolio:defence','Министерство по обороне и внутренней безопасности'),
   ('portfolio:internal','Министерство по внутренней политике и государству')
  ) as x(actor_key,actor_label) loop
   result:=result||jsonb_build_array(jsonb_build_object('key',a.actor_key,'label',a.actor_label));
  end loop;
 end if;
 -- Only game-instantiated units, parties and official appointments follow.
 for a in select u.id,u.title from public.institution_units u
  where u.game_id=p_game_id and (v_teacher or u.head_user_id=v_uid or exists(
   select 1 from public.institution_assignments ia where ia.game_id=p_game_id
    and ia.unit_id=u.id and ia.user_id=v_uid))
  order by u.title,u.id loop
  result:=result||jsonb_build_array(jsonb_build_object('key','unit:'||a.id::text,'label',a.title));
 end loop;
 for a in select gp.id,gp.name,gp.mandates from public.game_parties gp
  join public.game_members gm on gm.game_id=p_game_id and gm.user_id=v_uid
  where gp.game_id=p_game_id and gp.registration_status='registered' and (v_teacher or gp.leader_user_id=v_uid
    or lower(gp.name)=lower(coalesce(gm.team,'')) or exists(
      select 1 from public.institution_assignments ia where ia.game_id=p_game_id
       and ia.party_id=gp.id and ia.user_id=v_uid))
  order by gp.name,gp.id loop
  result:=result||jsonb_build_array(jsonb_build_object('key','party:'||a.id::text,'label',a.name));
  if coalesce(a.mandates,0)>0 then
   result:=result||jsonb_build_array(jsonb_build_object('key','faction:'||a.id::text,'label','Фракция «'||a.name||'»'));
  end if;
 end loop;
 for a in select distinct on (lower(btrim(role_title))) id from public.game_office_assignments
  where game_id=p_game_id and (v_teacher or user_id=v_uid) and status='active'
  order by lower(btrim(role_title)),created_at loop
  begin
   label:=private.process_actor_label(p_game_id,'office:'||a.id::text);
   result:=result||jsonb_build_array(jsonb_build_object('key','office:'||a.id::text,'label',label));
  exception when others then null;end;
 end loop;
 return result;
end
$function$
;
