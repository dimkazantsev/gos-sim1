-- ГОС.ID: repair chat-media insert scope and retire audio/video after one hour.
-- Storage bytes are removed only through the Storage API (Edge Function),
-- never by deleting storage.objects directly.
drop policy if exists game_media_insert on storage.objects;
create policy game_media_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'game-media'
  and array_length(string_to_array(storage.objects.name, '/'), 1) = 4
  and split_part(storage.objects.name, '/', 3) = (select auth.uid())::text
  and split_part(storage.objects.name, '/', 4) <> ''
  and exists (
    select 1 from public.chat_channels c
    where c.id::text = split_part(storage.objects.name, '/', 2)
      and c.game_id::text = split_part(storage.objects.name, '/', 1)
      and private.can_access_channel(c.id)
      and not private.is_game_observer(c.game_id)
  )
);

-- A recording disappears from all authenticated readers at the one-hour mark,
-- even if the asynchronous Storage removal is still in progress.
drop policy if exists chat_media_one_hour_visibility on public.chat_messages;
create policy chat_media_one_hour_visibility
on public.chat_messages as restrictive for select to authenticated
using (
  kind not in ('audio', 'video')
  or created_at > now() - interval '1 hour'
);

-- Only return objects eligible for deletion; a failed upload leaves an orphan
-- that must also be reclaimed after one hour. Keep all non-audio/video files.
create or replace function public.chat_media_expired_candidates(p_limit integer default 100)
returns table(storage_path text, message_id uuid)
language sql security definer
set search_path = ''
as $function$
  select o.name, m.id
  from storage.objects o
  left join public.chat_messages m
    on m.storage_path = o.name and m.kind in ('audio', 'video')
  where o.bucket_id = 'game-media'
    and (
      (m.id is not null and m.created_at <= now() - interval '1 hour')
      or (
        m.id is null
        and o.created_at <= now() - interval '1 hour'
        and lower(coalesce(o.metadata->>'mimetype', '')) ~ '^(audio|video)/'
        and not exists (
          select 1 from public.chat_messages linked
          where linked.storage_path = o.name
        )
      )
    )
  order by coalesce(m.created_at, o.created_at)
  limit least(greatest(coalesce(p_limit, 100), 1), 100);
$function$;

-- Database rows are deleted only after Storage has removed the object.
-- Foreign keys take care of pins and mentions; documents are unaffected.
create or replace function public.chat_media_finalize_expired()
returns integer
language plpgsql security definer
set search_path = ''
as $function$
declare removed integer;
begin
  delete from public.chat_messages m
  where m.kind in ('audio', 'video')
    and m.storage_path is not null
    and m.created_at <= now() - interval '1 hour'
    and not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'game-media' and o.name = m.storage_path
    );
  get diagnostics removed = row_count;
  return removed;
end;
$function$;

-- Called by the Edge Function only. A random secret is stored in Vault, not
-- in the source repository, SQL cron text, or a client application.
create or replace function public.chat_media_cleanup_token_valid(p_token text)
returns boolean
language sql security definer
set search_path = ''
as $function$
  select length(coalesce(p_token, '')) >= 32
    and exists (
      select 1 from vault.decrypted_secrets s
      where s.name = 'gos_chat_media_cleanup_token'
        and s.decrypted_secret = p_token
    );
$function$;

revoke all on function public.chat_media_expired_candidates(integer) from public, anon, authenticated;
revoke all on function public.chat_media_finalize_expired() from public, anon, authenticated;
revoke all on function public.chat_media_cleanup_token_valid(text) from public, anon, authenticated;
grant execute on function public.chat_media_expired_candidates(integer) to service_role;
grant execute on function public.chat_media_finalize_expired() to service_role;
grant execute on function public.chat_media_cleanup_token_valid(text) to service_role;

select vault.create_secret(
  encode(gen_random_bytes(32), 'hex'),
  'gos_chat_media_cleanup_token',
  'Secret for server-to-server chat audio/video expiry cleanup'
)
where not exists (
  select 1 from vault.secrets where name = 'gos_chat_media_cleanup_token'
);

-- pg_net sends the periodic request. The target URL is installation-specific,
-- so cron.schedule is configured separately after deploying the Edge Function.
create extension if not exists pg_net with schema extensions;
