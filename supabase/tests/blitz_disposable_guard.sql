-- Only install in an empty, isolated test stack. Never apply as a game migration.
do $$
begin
 if exists(select 1 from auth.users limit 1) or exists(select 1 from public.games limit 1) then
  raise exception 'Disposable test database must be empty';
 end if;
end $$;
create table public.qa_blitz_disposable_guard(marker text primary key);
insert into public.qa_blitz_disposable_guard(marker) values ('gos-id-disposable-blitz-v1');
revoke all on public.qa_blitz_disposable_guard from public, anon, authenticated;
grant select on public.qa_blitz_disposable_guard to service_role;
