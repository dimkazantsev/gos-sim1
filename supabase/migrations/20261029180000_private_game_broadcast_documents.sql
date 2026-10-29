-- ГОС.ID, модернизация 3/9: приватный Broadcast для инвалидации партийных документов.
-- Не пересылает содержимое, имена файлов, идентификаторы документов или ответы.
-- Существующие RLS таблиц, игровые права, статусы и архив не меняются.
create policy gos_game_broadcast_read
on realtime.messages
for select
to authenticated
using (
  (select auth.uid()) is not null
  and case
    when realtime.topic() ~ '^gos-id-live:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then private.is_game_member(substring(realtime.topic() from 13)::uuid)
    else false
  end
);

create or replace function private.broadcast_party_document_invalidation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target_game uuid;
begin
  target_game := case when tg_op = 'DELETE' then old.game_id else new.game_id end;
  if target_game is not null then
    perform realtime.send(
      jsonb_build_object('table','party_documents'),
      'party_documents_changed',
      'gos-id-live:' || target_game::text,
      true
    );
  end if;
  return null;
end;
$function$;

revoke all on function private.broadcast_party_document_invalidation() from public, anon, authenticated;

create trigger broadcast_party_document_invalidation
after insert or update or delete on public.party_documents
for each row
execute function private.broadcast_party_document_invalidation();
