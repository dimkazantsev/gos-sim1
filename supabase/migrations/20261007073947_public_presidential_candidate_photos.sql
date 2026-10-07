drop policy if exists presidential_candidate_photos_public_read on storage.objects;
create policy presidential_candidate_photos_public_read
on storage.objects
for select
to anon
using (
  bucket_id='game-assets'
  and name ~ '^[0-9a-fA-F-]+/presidential/[0-9a-fA-F-]+/photo-[0-9a-fA-F-]+\.(jpg|jpeg|png|webp)$'
);
