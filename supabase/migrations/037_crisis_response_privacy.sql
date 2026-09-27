drop policy if exists crisis_responses_read on public.crisis_responses;
create policy crisis_responses_read on public.crisis_responses
for select to authenticated
using(private.is_game_teacher(game_id) or user_id=(select auth.uid()));