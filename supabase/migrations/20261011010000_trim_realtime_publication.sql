-- GOS//SIMS no longer uses Postgres Changes at runtime.
-- Keep Realtime only for the separate ORG quiz tables so publication catalog
-- scans stay small and do not compete with Auth/PostgREST connection bursts.

do $$
declare
  r record;
begin
  for r in
    select schemaname,tablename
    from pg_publication_tables
    where pubname='supabase_realtime'
      and not (schemaname='public' and tablename like 'org_quiz_%')
  loop
    execute format(
      'alter publication supabase_realtime drop table %I.%I',
      r.schemaname,
      r.tablename
    );
  end loop;
end;
$$;
