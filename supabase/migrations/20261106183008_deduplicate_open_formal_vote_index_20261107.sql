-- ГОС.ID 2026-11-07. Remove duplicate vote-maintenance overhead.
-- Both indexes had identical unique keys and WHERE predicates; neither
-- backed a SQL constraint. Retain game_votes_one_open_per_formal_step.
DROP INDEX IF EXISTS public.game_vote_open_formal_step_uq;
