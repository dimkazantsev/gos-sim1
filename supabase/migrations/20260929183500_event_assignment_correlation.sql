-- Explicit outer-table qualification avoids accidental self-matches in RLS subqueries.
drop policy if exists event_case_invited on public.event_cases;
create policy event_case_invited on public.event_cases for select to authenticated
 using(exists(select 1 from public.event_assignments a
 where a.case_id=public.event_cases.id
 and a.game_id=public.event_cases.game_id
 and a.recipient_id=(select auth.uid())));
drop policy if exists event_decision_self on public.event_decisions;
create policy event_decision_self on public.event_decisions for insert to authenticated
 with check(actor_id=(select auth.uid()) and exists(
 select 1 from public.event_assignments a
 where a.id=public.event_decisions.assignment_id
 and a.case_id=public.event_decisions.case_id
 and a.game_id=public.event_decisions.game_id
 and a.recipient_id=(select auth.uid())
 and a.status='pending'));
