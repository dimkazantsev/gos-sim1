-- ГОС.ID 2026-11-07: stage assessments are indexed twice by the same key sequence.
-- Keep stage_assessments_game_id_stage_no_user_id_key: unique, constraint-backed.
-- Drop only redundant ordinary btree, with no constraints or internal dependencies.
DROP INDEX IF EXISTS public.stage_assessments_game_stage_idx;
