-- Only ten registry rows are returned per request; the underlying fiscal ledger remains intact.
create or replace function public.get_budget_change_registry_page(
 p_game_id uuid,
 p_offset integer default 0,
 p_limit integer default 10,
 p_query text default '',
 p_category text default '',
 p_focus text default null
) returns jsonb
language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare
 v_all jsonb;
 v_rows jsonb;
 v_categories jsonb;
 v_total integer;
 v_offset integer := greatest(coalesce(p_offset,0),0);
 v_limit integer := least(greatest(coalesce(p_limit,10),1),10);
 v_query text := lower(left(trim(coalesce(p_query,'')),120));
 v_category text := left(coalesce(p_category,''),80);
begin
 -- The original RPC performs server-side authentication and game membership checks.
 v_all := public.get_budget_change_registry(p_game_id);
 select coalesce(jsonb_agg(cat order by cat),'[]'::jsonb) into v_categories
 from (select distinct value->>'category' cat from jsonb_array_elements(v_all)) categories
 where cat is not null;
 select count(*)::integer,
        coalesce(jsonb_agg(value order by rn) filter(where rn>v_offset and rn<=v_offset+v_limit),'[]'::jsonb)
 into v_total,v_rows
 from (
  select e.value,
   row_number() over(order by
    case when p_focus is not null and e.value->>'entry_key'=p_focus then 0 else 1 end,
    e.ord) as rn
  from jsonb_array_elements(v_all) with ordinality as e(value,ord)
  where (v_category='' or e.value->>'category'=v_category)
    and (v_query='' or position(v_query in lower(concat_ws(' ',e.value->>'title',e.value->>'details',e.value->>'category',e.value->>'status')))>0)
 ) filtered;
 return jsonb_build_object('entries',v_rows,'total',v_total,'categories',v_categories);
end;$$;
revoke all on function public.get_budget_change_registry_page(uuid,integer,integer,text,text,text) from public,anon;
grant execute on function public.get_budget_change_registry_page(uuid,integer,integer,text,text,text) to authenticated;
