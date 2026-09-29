-- Decisions are visible only to invited participants of this exact case and its teacher.
drop policy if exists event_decision_read on public.event_decisions;
create policy event_decision_read on public.event_decisions for select to authenticated
 using(private.is_game_teacher(game_id)
 or exists(select 1 from public.event_assignments a
 where a.case_id=public.event_decisions.case_id
 and a.game_id=public.event_decisions.game_id
 and a.recipient_id=(select auth.uid())));
