-- ГОС.ID: reduce redundant calls on the state-metric hot path.
-- Existing function bodies, permissions, values, audit history and budget rules remain unchanged.
-- The original budget bridge immediately returns for non-budget metrics
-- and when the value is unchanged; move those exact guards into the trigger.
drop trigger if exists budget_income_change on public.state_metrics;
create trigger budget_income_change
before update of value on public.state_metrics
for each row
when (old.metric_key = 'budget' and new.value is distinct from old.value)
execute function private.bridge_budget_income_change();

-- The existing clamp function only mutates percentage-valued rows.
-- Preserve INSERT and UPDATE handling (including changes of unit to '%').
drop trigger if exists trg_state_metric_percent_bounds on public.state_metrics;
create trigger trg_state_metric_percent_bounds
before insert or update on public.state_metrics
for each row
when (new.unit = '%')
execute function private.clamp_percentage_state_metric();
