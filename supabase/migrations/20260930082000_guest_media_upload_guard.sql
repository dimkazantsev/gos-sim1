-- A guest can read a public channel but cannot upload an orphan media object.
alter policy game_media_insert on storage.objects to authenticated with check(
 bucket_id='game-media'
 and (storage.foldername(name))[3]=(select auth.uid())::text
 and private.can_access_channel(((storage.foldername(name))[2])::uuid)
 and not private.is_game_observer(((storage.foldername(name))[1])::uuid)
);
