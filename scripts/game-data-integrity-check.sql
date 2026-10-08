-- Read-only global audit. Detect cross-game references even when an ID FK
-- by itself is valid. PostgreSQL already rejects missing FK targets.
do $audit$
declare fk record;join_condition text;invalid_count bigint;
begin
 for fk in
  select c.oid,c.conrelid,c.confrelid,c.conkey,c.confkey,c.conname
  from pg_constraint c join pg_class child on child.oid=c.conrelid join pg_namespace n on n.oid=child.relnamespace
  where c.contype='f' and n.nspname='public'
  and exists(select 1 from pg_attribute where attrelid=c.conrelid and attname='game_id' and not attisdropped)
  and exists(select 1 from pg_attribute where attrelid=c.confrelid and attname='game_id' and not attisdropped)
 loop
  select string_agg(format('child.%I=parent.%I',a.attname,b.attname),' and ' order by k.ordinality) into join_condition
  from unnest(fk.conkey,fk.confkey) with ordinality k(child_key,parent_key,ordinality)
  join pg_attribute a on a.attrelid=fk.conrelid and a.attnum=k.child_key
  join pg_attribute b on b.attrelid=fk.confrelid and b.attnum=k.parent_key;
  execute format('select count(*) from %s child join %s parent on %s where child.game_id is distinct from parent.game_id',fk.conrelid::regclass,fk.confrelid::regclass,join_condition) into invalid_count;
  if invalid_count>0 then raise exception 'Cross-game reference %: % rows',fk.conname,invalid_count;end if;
 end loop;
 if exists(select 1 from public.games g where (select count(*) from public.game_stages s where s.game_id=g.id)<>16) then raise exception 'Game stage count differs from 16';end if;
 if exists(select 1 from public.game_office_assignments o where not exists(select 1 from public.game_members m where m.game_id=o.game_id and m.user_id=o.user_id)) then raise exception 'Office assignment without same-game member';end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity) then raise exception 'Public table without RLS';end if;
 if exists(select 1 from public.games where title like 'QA stages 8%') then raise exception 'QA fixture persisted';end if;
end;$audit$;
select jsonb_build_object(
 'cross_game_foreign_keys','PASS','office_member_links','PASS','sixteen_stages_per_game','PASS','all_public_tables_rls','PASS','no_persisted_stage_fixture','PASS',
 'games',(select count(*) from public.games),
 'stages',(select count(*) from public.game_stages),
 'members',(select count(*) from public.game_members),
 'public_tables_with_rls',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity),
 'realtime_tables',(select count(*) from pg_publication_tables where pubname='supabase_realtime' and schemaname='public')
) checks;
