-- Storage combines policies for game-assets and game-media. Authenticated
-- inserts can evaluate the municipal-project predicate even for chat files.
-- Allow this SECURITY DEFINER boolean permission checker to be evaluated by
-- authenticated users; its caller remains auth.uid() in the Storage policy.
-- It never mutates projects or grants editing rights by itself.
revoke all on function private.can_edit_municipal_project(uuid,uuid) from public,anon;
grant execute on function private.can_edit_municipal_project(uuid,uuid) to authenticated;
