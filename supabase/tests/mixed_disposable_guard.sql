-- Install only on a physically separate disposable stack, before fixtures; this does not inspect other tables.
do $$
begin
 if exists(select 1 from auth.users limit 1) or exists(select 1 from public.games limit 1) then
  raise exception 'Disposable test database must be empty';
 end if;
end $$;
create table public.qa_mixed_disposable_guard(marker text primary key);
insert into public.qa_mixed_disposable_guard(marker) values ('gos-id-disposable-mixed-v1');
revoke all on public.qa_mixed_disposable_guard from public, anon, authenticated;
grant select on public.qa_mixed_disposable_guard to service_role;
