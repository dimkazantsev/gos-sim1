-- Only ten visible entries are transferred on demand; existing membership check remains in get_budget_change_registry.
create or replace function public.get_budget_change_registry_page(
 p_game_id uuid,p_offset integer default 0,p_limit integer default 10,
 p_category text default null,p_search text default null)
returns jsonb language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare items jsonb; result jsonb;
begin
 if p_offset<0 or p_offset>100000 or p_limit<1 or p_limit>30 then raise exception 'Неверный размер страницы';end if;
 items:=public.get_budget_change_registry(p_game_id);
 select jsonb_build_object(
  'total',count(*),
  'entries',coalesce(jsonb_agg(value order by ordinal) filter(where rn>p_offset and rn<=p_offset+p_limit),'[]'::jsonb))
 into result
 from (
  select value,ordinal,row_number() over(order by ordinal) rn
  from jsonb_array_elements(items) with ordinality as records(value,ordinal)
  where (nullif(p_category,'') is null or p_category='Все' or value->>'category'=p_category)
   and (nullif(trim(p_search),'') is null or strpos(lower(coalesce(value->>'title','')||' '||coalesce(value->>'details','')||' '||coalesce(value->>'status','')),lower(trim(p_search)))>0)
 ) records;
 return result;
end;$$;
revoke all on function public.get_budget_change_registry_page(uuid,integer,integer,text,text) from public,anon;
grant execute on function public.get_budget_change_registry_page(uuid,integer,integer,text,text) to authenticated;