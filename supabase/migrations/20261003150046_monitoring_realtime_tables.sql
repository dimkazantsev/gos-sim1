-- Deliver game-scoped overview and budget changes immediately; existing RLS remains authoritative.
do $$declare t text;begin
 for t in select unnest(array['event_case_outcomes','media_news_proposals','event_assignments']) loop
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
   execute format('alter publication supabase_realtime add table public.%I',t);
  end if;
 end loop;
end$$;
