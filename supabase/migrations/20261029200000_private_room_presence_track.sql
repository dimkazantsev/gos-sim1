-- ГОС.ID шаг 4/9: Presence только в уже существующей приватной комнате игры.
-- Не расширяет права отправки Broadcast. Нет новых каналов, хранилищ или RPC.
-- Membership проверяется сервером по auth.uid(), а не по клиентскому payload.
create policy gos_game_presence_track
on realtime.messages
for insert
to authenticated
with check (
  auth.uid() is not null
  and extension = 'presence'
  and private.is_game_member(substring(realtime.topic() from '^gos-id-live:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$')::uuid)
);
