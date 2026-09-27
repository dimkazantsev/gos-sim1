-- Fix unified media uploads for the private game-assets bucket.
update storage.buckets
set file_size_limit=104857600,
    allowed_mime_types=array[
      'image/jpeg','image/png','image/webp','image/gif',
      'audio/mpeg','audio/mp4','audio/x-m4a','audio/wav','audio/webm','audio/ogg',
      'video/mp4','video/webm','video/quicktime',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword','text/plain'
    ]::text[]
where id='game-assets';

drop policy if exists game_assets_wall_insert on storage.objects;
create policy game_assets_wall_insert
on storage.objects for insert to authenticated
with check (
  bucket_id='game-assets'
  and split_part(name,'/',2)='wall'
  and private.is_game_member((split_part(name,'/',1))::uuid)
);

drop policy if exists game_assets_party_insert on storage.objects;
create policy game_assets_party_insert
on storage.objects for insert to authenticated
with check (
  bucket_id='game-assets'
  and split_part(name,'/',2)='parties'
  and private.is_game_member((split_part(name,'/',1))::uuid)
  and (
    private.is_game_teacher((split_part(name,'/',1))::uuid)
    or exists(
      select 1
      from public.game_parties gp
      join public.game_members gm on gm.game_id=gp.game_id and gm.team=gp.name
      where gp.id=(split_part(storage.objects.name,'/',3))::uuid
        and gp.game_id=(split_part(storage.objects.name,'/',1))::uuid
        and gm.user_id=(select auth.uid())
    )
  )
);

drop policy if exists game_assets_party_update on storage.objects;
create policy game_assets_party_update
on storage.objects for update to authenticated
using (
  bucket_id='game-assets'
  and split_part(name,'/',2)='parties'
  and private.is_game_member((split_part(name,'/',1))::uuid)
  and (
    private.is_game_teacher((split_part(name,'/',1))::uuid)
    or exists(
      select 1
      from public.game_parties gp
      join public.game_members gm on gm.game_id=gp.game_id and gm.team=gp.name
      where gp.id=(split_part(storage.objects.name,'/',3))::uuid
        and gp.game_id=(split_part(storage.objects.name,'/',1))::uuid
        and gm.user_id=(select auth.uid())
    )
  )
)
with check (bucket_id='game-assets');
