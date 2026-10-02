-- Keep obsolete sign-ins out of the current roster while retaining documents,
-- authorship and audit history. No accounts or classroom history are deleted.
alter table public.game_members add column if not exists roster_archived_at timestamptz;
comment on column public.game_members.roster_archived_at is 'Archived classroom roster entry; retained for historical authorship.';

do $$
begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime')
 and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='game_office_assignments') then
  alter publication supabase_realtime add table public.game_office_assignments;
 end if;
end;$$;
