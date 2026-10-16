-- A bare name inside a party subquery binds to game_parties.name, not the
-- Storage object. Qualify every path reference in both upload destinations.
-- Keep the existing ownership and post-registration document restrictions.
alter policy game_assets_party_insert on storage.objects
with check (
 bucket_id='game-assets' and split_part(storage.objects.name,'/',2)='parties'
 and private.is_game_member(split_part(storage.objects.name,'/',1)::uuid)
 and not private.is_game_observer(split_part(storage.objects.name,'/',1)::uuid)
 and (
  private.is_game_teacher(split_part(storage.objects.name,'/',1)::uuid)
  or exists (
   select 1 from public.game_parties gp join public.game_members gm
    on gm.game_id=gp.game_id and gm.team=gp.name
   where gp.id=split_part(storage.objects.name,'/',3)::uuid
    and gp.game_id=split_part(storage.objects.name,'/',1)::uuid
    and gm.user_id=(select auth.uid()) and gm.kind='student' and gm.roster_archived_at is null
  )
 )
 and (
  split_part(storage.objects.name,'/',4)<>'docs'
  or exists (
   select 1 from public.game_parties gp
   where gp.id=split_part(storage.objects.name,'/',3)::uuid
    and gp.game_id=split_part(storage.objects.name,'/',1)::uuid
    and gp.registration_status<>'registered'
  )
 )
);

alter policy game_assets_party_update on storage.objects
with check (
 bucket_id='game-assets' and split_part(storage.objects.name,'/',2)='parties'
 and private.is_game_member(split_part(storage.objects.name,'/',1)::uuid)
 and not private.is_game_observer(split_part(storage.objects.name,'/',1)::uuid)
 and (
  private.is_game_teacher(split_part(storage.objects.name,'/',1)::uuid)
  or exists (
   select 1 from public.game_parties gp join public.game_members gm
    on gm.game_id=gp.game_id and gm.team=gp.name
   where gp.id=split_part(storage.objects.name,'/',3)::uuid
    and gp.game_id=split_part(storage.objects.name,'/',1)::uuid
    and gm.user_id=(select auth.uid())
  )
 )
);
