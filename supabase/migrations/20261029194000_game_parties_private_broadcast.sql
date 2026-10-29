-- ГОС.ID, шаг 3/9: узкое private Broadcast-уведомление об изменении партий.
-- Сообщение не содержит сведений о партии, её лидере, составе или документах.
-- Существующие RLS, игровая логика, функции регистрации и публикация WAL не меняются.
create or replace function private.broadcast_game_parties_invalidation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target_game uuid;
begin
  if tg_op = 'DELETE' then
    target_game := old.game_id;
  else
    target_game := new.game_id;
  end if;
  if target_game is not null then
    perform realtime.send(
      jsonb_build_object('table', 'game_parties'),
      'game_parties_changed',
      'gos-id-live:' || target_game::text,
      true
    );
  end if;

  -- If a party ever moves between games, the previous game's list must
  -- also be invalidated; this is not a new permission to move parties.
  if tg_op = 'UPDATE' and old.game_id is distinct from new.game_id
     and old.game_id is not null then
    perform realtime.send(
      jsonb_build_object('table', 'game_parties'),
      'game_parties_changed',
      'gos-id-live:' || old.game_id::text,
      true
    );
  end if;
  return null;
end;
$function$;

revoke all on function private.broadcast_game_parties_invalidation() from public, anon, authenticated;

create trigger broadcast_game_parties_invalidation
after insert or update or delete on public.game_parties
for each row
execute function private.broadcast_game_parties_invalidation();
