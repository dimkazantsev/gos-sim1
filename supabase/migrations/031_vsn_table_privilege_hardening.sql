-- Restrict direct table access for the VSN assessment journal.
-- All writes must flow through checked RPCs or private server-side functions.

revoke all privileges on table public.stage_assessments from anon, authenticated;
revoke all privileges on table public.stage_assessment_runs from anon, authenticated;
revoke all privileges on table public.stage_debriefs from anon, authenticated;

grant select on table public.stage_assessments to authenticated;
grant select on table public.stage_assessment_runs to authenticated;
grant select on table public.stage_debriefs to authenticated;

do $$
begin
  if to_regclass('public.stage_assessment_runs_id_seq') is not null then
    execute 'revoke all privileges on sequence public.stage_assessment_runs_id_seq from anon, authenticated';
  end if;
end $$;
