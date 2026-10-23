-- Keep authenticated export RPCs bounded instead of serializing every game table in one request.
-- This preserves the original export allowlist and teacher authorization.
create or replace function public.export_game_manifest(p_game uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_game jsonb;v_tables text[];
begin
 if not private.is_game_teacher(p_game) then raise exception 'Доступ преподавателя обязателен';end if;
 select to_jsonb(g) into v_game from public.games g where g.id=p_game;
 if v_game is null then raise exception 'Игра не найдена';end if;
 select array_agg(name order by name) into v_tables from (
  select distinct c.table_name as name from information_schema.columns c
  where c.table_schema='public' and c.column_name='game_id'
   and c.table_name not in ('invite_codes','member_login_emails')
   and exists (select 1 from pg_catalog.pg_tables t where t.schemaname='public' and t.tablename=c.table_name)
  union select 'game_ballots' where to_regclass('public.game_ballots') is not null
  union select 'channel_members' where to_regclass('public.channel_members') is not null
 ) allowed;
 return jsonb_build_object('format','GOS-SIMS','schema',2,'exported_at',now(),
  'game',v_game,'tables',coalesce(to_jsonb(v_tables),'[]'::jsonb),
  'note','Пароли, коды приглашений и адреса входа исключены. Файлы находятся в архиве Media.');
end;$$;

create or replace function public.export_game_data_batch(p_game uuid,p_tables text[],p_offset integer default 0,p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_table text;v_rows jsonb;v_result jsonb:='{}'::jsonb;v_order text;
begin
 if not private.is_game_teacher(p_game) then raise exception 'Доступ преподавателя обязателен';end if;
 if p_tables is null or cardinality(p_tables)<1 or cardinality(p_tables)>5
    or p_offset is null or p_offset<0 or p_offset>1000000
    or p_limit is null or p_limit<1 or p_limit>100
 then raise exception 'Недопустимый диапазон экспорта';end if;
 foreach v_table in array p_tables loop
  if v_table='game_ballots' then
   select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into v_rows from (
    select b.* from public.game_ballots b
    where exists(select 1 from public.game_votes v where v.id=b.vote_id and v.game_id=p_game)
    order by b.ctid limit p_limit offset p_offset
   ) t;
  elsif v_table='channel_members' then
   select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into v_rows from (
    select m.* from public.channel_members m
    where exists(select 1 from public.chat_channels c where c.id=m.channel_id and c.game_id=p_game)
    order by m.ctid limit p_limit offset p_offset
   ) t;
  else
   if v_table is null or not exists (
    select 1 from information_schema.columns c
    where c.table_schema='public' and c.column_name='game_id' and c.table_name=v_table
     and c.table_name not in ('invite_codes','member_login_emails')
     and exists(select 1 from pg_catalog.pg_tables t where t.schemaname='public' and t.tablename=c.table_name)
   ) then raise exception 'Таблица не разрешена для экспорта';end if;
   select string_agg(format('x.%I',a.attname),', ' order by k.ordinality) into v_order
   from pg_catalog.pg_class c
   join pg_catalog.pg_namespace n on n.oid=c.relnamespace
   join pg_catalog.pg_index i on i.indrelid=c.oid and i.indisprimary
   join unnest(i.indkey) with ordinality k(attnum,ordinality) on true
   join pg_catalog.pg_attribute a on a.attrelid=c.oid and a.attnum=k.attnum
   where n.nspname='public' and c.relname=v_table;
   execute format('select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from (
     select x.* from public.%I x where x.game_id=$1 order by %s limit $2 offset $3
   ) t',v_table,coalesce(v_order,'x.ctid')) into v_rows using p_game,p_limit,p_offset;
  end if;
  v_result:=v_result||jsonb_build_object(v_table,v_rows);
 end loop;
 return v_result;
end;$$;

revoke all on function public.export_game_manifest(uuid) from public,anon;
revoke all on function public.export_game_data_batch(uuid,text[],integer,integer) from public,anon;
grant execute on function public.export_game_manifest(uuid) to authenticated;
grant execute on function public.export_game_data_batch(uuid,text[],integer,integer) to authenticated;
