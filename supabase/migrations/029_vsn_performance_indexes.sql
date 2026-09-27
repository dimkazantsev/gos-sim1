-- Performance indexes for automatic VSN assessment.
create index if not exists stage_assessments_user_fk_idx on public.stage_assessments(user_id);
create index if not exists stage_assessments_finalized_by_idx on public.stage_assessments(finalized_by);
create index if not exists stage_assessment_runs_assessment_idx on public.stage_assessment_runs(assessment_id);
create index if not exists stage_assessment_runs_user_idx on public.stage_assessment_runs(user_id,created_at desc);
create index if not exists stage_debriefs_user_idx on public.stage_debriefs(user_id,stage_no);
create index if not exists party_invitations_invited_by_idx on public.party_invitations(invited_by);
create index if not exists formal_document_history_actor_idx on public.formal_document_history(actor_id,created_at desc);
