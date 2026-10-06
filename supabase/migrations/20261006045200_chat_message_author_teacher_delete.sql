drop policy if exists guests_cannot_delete on public.chat_messages;
drop policy if exists messages_delete_author_or_teacher on public.chat_messages;

create policy messages_delete_author_or_teacher
on public.chat_messages
for delete
to authenticated
using (
  (author_id = auth.uid() and private.can_access_channel(channel_id))
  or private.is_game_teacher(game_id)
);

create or replace function public.delete_chat_messages(p_message_ids uuid[])
returns integer
language plpgsql
security definer
set search_path='public','private','pg_temp'
as $$
declare
  v_requested integer;
  v_denied integer;
  v_deleted integer;
begin
  v_requested := coalesce(cardinality(p_message_ids),0);
  if v_requested = 0 then return 0; end if;
  if v_requested > 100 then
    raise exception 'За один раз можно удалить не более 100 сообщений';
  end if;

  select count(*)
  into v_denied
  from public.chat_messages m
  where m.id = any(p_message_ids)
    and not (
      (m.author_id = auth.uid() and private.can_access_channel(m.channel_id))
      or private.is_game_teacher(m.game_id)
    );

  if v_denied > 0 then
    raise exception 'Недостаточно прав для удаления одного или нескольких сообщений';
  end if;

  delete from public.chat_messages m
  where m.id = any(p_message_ids)
    and (
      (m.author_id = auth.uid() and private.can_access_channel(m.channel_id))
      or private.is_game_teacher(m.game_id)
    );

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.delete_chat_messages(uuid[]) from public,anon;
grant execute on function public.delete_chat_messages(uuid[]) to authenticated;
