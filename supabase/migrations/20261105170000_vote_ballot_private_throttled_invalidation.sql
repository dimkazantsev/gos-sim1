-- ГОС.ID: batch ballot invalidation into the EXISTING authorised game socket.
-- Every subscriber continues to read actual ballots under its existing RLS.
-- Broadcast contains only the vote ID, never the voter, choice or weight.
-- No polling, cron, extra WebSocket, vote-content publication, or vote-result writes.
CREATE TABLE IF NOT EXISTS private.vote_ballot_pulse_window(
 vote_id uuid PRIMARY KEY REFERENCES public.game_votes(id) ON DELETE CASCADE,
 last_pulse_at timestamptz NOT NULL
);
ALTER TABLE private.vote_ballot_pulse_window ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.vote_ballot_pulse_window FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.broadcast_game_ballot_invalidation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $pulse$
DECLARE
 v_vote uuid;
 v_game uuid;
 v_sent uuid;
BEGIN
 v_vote:=CASE WHEN TG_OP='DELETE' THEN OLD.vote_id ELSE NEW.vote_id END;
 SELECT game_id INTO v_game FROM public.game_votes WHERE id=v_vote;
 IF v_game IS NULL THEN RETURN NULL; END IF;

 -- A single pulse covers all casts within four seconds. One tiny row per
 -- vote replaces thousands of repeated full-ballot HTTP reads in a classroom.
 -- INSERT ... WHERE prevents extra writes and serialises burst handling.
 INSERT INTO private.vote_ballot_pulse_window(vote_id,last_pulse_at)
 VALUES(v_vote,clock_timestamp())
 ON CONFLICT (vote_id) DO UPDATE
 SET last_pulse_at=EXCLUDED.last_pulse_at
 WHERE private.vote_ballot_pulse_window.last_pulse_at<=EXCLUDED.last_pulse_at-interval '4 seconds'
 RETURNING vote_id INTO v_sent;

 IF v_sent IS NOT NULL THEN
  PERFORM realtime.send(
   jsonb_build_object('vote_id',v_vote),
   'ballots_changed',
   'gos-id-live:'||v_game::text,
   true
  );
 END IF;
 RETURN NULL;
END;
$pulse$;

REVOKE ALL ON FUNCTION private.broadcast_game_ballot_invalidation()
 FROM PUBLIC,anon,authenticated;

CREATE TRIGGER broadcast_game_ballot_invalidation
AFTER INSERT OR UPDATE OF choice,weight,yes_weight,no_weight,abstain_weight OR DELETE
ON public.game_ballots
FOR EACH ROW EXECUTE FUNCTION private.broadcast_game_ballot_invalidation();
