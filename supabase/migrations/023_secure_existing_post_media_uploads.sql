-- Restrict wall media additions to the post author or a teacher.
drop policy if exists game_assets_wall_insert on storage.objects;
create policy game_assets_wall_insert
on storage.objects for insert to authenticated
with check (
  bucket_id='game-assets'
  and split_part(name,'/',2)='wall'
  and private.is_game_member((split_part(name,'/',1))::uuid)
  and exists(
    select 1
    from public.political_posts pp
    where pp.id=(split_part(storage.objects.name,'/',3))::uuid
      and pp.game_id=(split_part(storage.objects.name,'/',1))::uuid
      and (
        pp.author_id=(select auth.uid())
        or private.is_game_teacher(pp.game_id)
      )
  )
);

drop policy if exists political_post_media_insert on public.political_post_media;
create policy political_post_media_insert
on public.political_post_media
for insert to authenticated
with check(
  private.is_game_member(game_id)
  and uploader_id=(select auth.uid())
  and exists(
    select 1
    from public.political_posts pp
    where pp.id=political_post_media.post_id
      and pp.game_id=political_post_media.game_id
      and (
        pp.author_id=(select auth.uid())
        or private.is_game_teacher(pp.game_id)
      )
  )
);
