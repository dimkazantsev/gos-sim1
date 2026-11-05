-- Existing game-party trigger sends ONLY changed row ID and operation.
-- This is the same private game topic; no extra subscriptions, triggers,
-- cron jobs or user-facing endpoints. Old clients still use payload.table.
CREATE OR REPLACE FUNCTION private.broadcast_game_parties_invalidation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE target_game uuid;changed_party uuid;
BEGIN
 IF tg_op='DELETE' THEN target_game:=old.game_id;changed_party:=old.id;
 ELSE target_game:=new.game_id;changed_party:=new.id; END IF;
 IF target_game IS NOT NULL THEN
  PERFORM realtime.send(
   jsonb_build_object('table','game_parties','party_id',changed_party,'operation',tg_op),
   'game_parties_changed','gos-id-live:'||target_game::text,true
  );
 END IF;
 -- A cross-game move must remove the old party entry, not leak its content.
 IF tg_op='UPDATE' AND old.game_id IS DISTINCT FROM new.game_id
    AND old.game_id IS NOT NULL THEN
  PERFORM realtime.send(
   jsonb_build_object('table','game_parties','party_id',old.id,'operation','DELETE'),
   'game_parties_changed','gos-id-live:'||old.game_id::text,true
  );
 END IF;
 RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION private.broadcast_game_parties_invalidation()
FROM PUBLIC,anon,authenticated;
