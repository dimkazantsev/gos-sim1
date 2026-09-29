-- Students can see only their own activity; teacher read of the classroom remains unchanged.
-- Do not expose other students' presence or teacher-only audit records.
do $migration$
begin
 if not exists (
   select 1 from pg_policies
   where schemaname='public' and tablename='game_activity'
     and policyname='game_activity_student_own_read'
 ) then
   create policy game_activity_student_own_read
     on public.game_activity for select to authenticated
     using (actor_id = (select auth.uid()) and private.is_game_member(game_id));
 end if;
end
$migration$;