-- ГОС.ID: avoid maintaining two equivalent game-stage btree indexes.
-- Keep the UNIQUE constraint-backed (game_id, stage_no) index and its RLS paths.
-- Preflight avoids altering a schema that changed since this audit.
DO $guard$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM pg_indexes
  WHERE schemaname='public' AND tablename='game_stages'
    AND indexname='game_stages_game_idx'
    AND indexdef='CREATE INDEX game_stages_game_idx ON public.game_stages USING btree (game_id, stage_no)'
 ) OR NOT EXISTS (
  SELECT 1 FROM pg_indexes
  WHERE schemaname='public' AND tablename='game_stages'
    AND indexname='game_stages_game_id_stage_no_key'
    AND indexdef='CREATE UNIQUE INDEX game_stages_game_id_stage_no_key ON public.game_stages USING btree (game_id, stage_no)'
 ) OR NOT EXISTS (
  SELECT 1 FROM pg_constraint
  WHERE conindid='public.game_stages_game_id_stage_no_key'::regclass
 ) OR EXISTS (
  SELECT 1 FROM pg_constraint
  WHERE conindid='public.game_stages_game_idx'::regclass
 ) THEN
   RAISE EXCEPTION 'game_stages index definitions or constraints changed; refusing migration';
 END IF;
END
$guard$;
DROP INDEX public.game_stages_game_idx;