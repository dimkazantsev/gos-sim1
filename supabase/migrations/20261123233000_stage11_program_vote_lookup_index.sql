-- Single compact index for the frequent pre-vote access check.
-- No extra polling or per-user reads; index contains only voted agenda items.
CREATE INDEX IF NOT EXISTS government_program_agenda_voted_program_idx
ON public.government_program_agenda (program_id)
WHERE vote_id IS NOT NULL;
