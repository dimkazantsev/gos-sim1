-- ГОС.ID · Stage 9: a registered student may serve in multiple ministries.
-- Preserve UNIQUE(unit_id,user_id): the same student occupies one position
-- in a given ministry, but can hold other offices and staff other ministries.
-- No roles, votes, membership, scores, legacy decisions or RPCs are changed.
-- Removing the redundant cross-ministry index lowers write/storage overhead.
SET LOCAL lock_timeout='1500ms';
SET LOCAL statement_timeout='10s';
DROP INDEX IF EXISTS public.institution_assignments_one_staff_ministry_per_student;
