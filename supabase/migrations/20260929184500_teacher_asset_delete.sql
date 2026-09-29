-- Allow teachers to remove party assets after a confirmed, audited party deletion.
drop policy if exists game_assets_teacher_delete on storage.objects;
create policy game_assets_teacher_delete on storage.objects for delete to authenticated
 using(bucket_id='game-assets' and private.is_game_teacher((split_part(name,'/',1))::uuid));
