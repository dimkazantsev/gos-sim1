-- Preserve the existing upload rules and narrow them to non-guests.
do $$
declare p record;
begin
 for p in select policyname,with_check from pg_policies
  where schemaname='storage' and tablename='objects'
   and policyname in ('game_assets_formal_insert','game_assets_party_insert')
 loop
  execute format('alter policy %I on storage.objects with check ((%s) and not private.is_game_observer((split_part(name,''/'',1))::uuid))',p.policyname,p.with_check);
 end loop;
end;
$$;
