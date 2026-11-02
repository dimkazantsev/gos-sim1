-- Consolidate five Duma/procedure Postgres Changes subscriptions into one
-- private Broadcast invalidation on the already-authorised game socket.
-- The payload contains no documents, votes, names or RLS-protected rows.
create or replace function private.broadcast_duma_procedure_invalidation()
returns trigger language plpgsql security definer
set search_path = '' as $$
declare
 target_game uuid;
begin
 target_game:=case when tg_op='DELETE' then old.game_id else new.game_id end;
 if target_game is not null then
  perform realtime.send(
   jsonb_build_object('table',tg_table_name),
   'duma_procedure_changed',
   'gos-id-live:'||target_game::text,
   true
  );
 end if;
 -- In the unlikely event of a game move, invalidate both scoped lists.
 if tg_op='UPDATE' and old.game_id is distinct from new.game_id and old.game_id is not null then
  perform realtime.send(
   jsonb_build_object('table',tg_table_name),
   'duma_procedure_changed',
   'gos-id-live:'||old.game_id::text,
   true
  );
 end if;
 return null;
end; $$;
revoke all on function private.broadcast_duma_procedure_invalidation() from public,anon,authenticated;
do $duma$
declare t text;
begin
 foreach t in array array[
  'duma_sessions','duma_agenda_items','institution_session_registrations',
  'bill_amendments','bill_amendment_packs'
 ] loop
  execute format('drop trigger if exists broadcast_duma_procedure_invalidation on public.%I',t);
  execute format(
   'create trigger broadcast_duma_procedure_invalidation after insert or update or delete on public.%I for each row execute function private.broadcast_duma_procedure_invalidation()',t
  );
 end loop;
end $duma$;
