-- ГОС.ID: eliminate overlapping read policies for active game event/presence tables.
-- Equivalent effective SELECT logic: earlier ALL + SELECT policies ORed by PostgreSQL;
-- explicit per-command WRITE policies retain each previous ALL USING and WITH CHECK.
-- No UI, game score, student rights, cross-game visibility, or database rows changed.
-- Abort safely before any mutation if source policies have drifted.
DO $preflight$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='event_assignments' AND policyname='event_assignment_teacher' AND cmd='ALL' AND permissive='PERMISSIVE' AND roles='{authenticated}' AND qual='private.is_game_teacher(game_id)' AND with_check IS NOT DISTINCT FROM 'private.is_game_teacher(game_id)') THEN RAISE EXCEPTION 'RLS baseline changed: event_assignments.event_assignment_teacher'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='event_assignments' AND policyname='event_assignment_public_read' AND cmd='SELECT' AND permissive='PERMISSIVE' AND roles='{authenticated}' AND qual='private.is_game_member(game_id)' AND with_check IS NOT DISTINCT FROM NULL) THEN RAISE EXCEPTION 'RLS baseline changed: event_assignments.event_assignment_public_read'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='event_assignments' AND policyname='event_assignment_read' AND cmd='SELECT' AND permissive='PERMISSIVE' AND roles='{authenticated}' AND qual='(private.is_game_teacher(game_id) OR (recipient_id = ( SELECT auth.uid() AS uid)))' AND with_check IS NOT DISTINCT FROM NULL) THEN RAISE EXCEPTION 'RLS baseline changed: event_assignments.event_assignment_read'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='event_cases' AND policyname='event_case_teacher' AND cmd='ALL' AND permissive='PERMISSIVE' AND roles='{authenticated}' AND qual='private.is_game_teacher(game_id)' AND with_check IS NOT DISTINCT FROM 'private.is_game_teacher(game_id)') THEN RAISE EXCEPTION 'RLS baseline changed: event_cases.event_case_teacher'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='event_cases' AND policyname='event_case_public_assigned' AND cmd='SELECT' AND permissive='PERMISSIVE' AND roles='{authenticated}' AND qual='(private.is_game_member(game_id) AND private.assigned_game_case(id, game_id))' AND with_check IS NOT DISTINCT FROM NULL) THEN RAISE EXCEPTION 'RLS baseline changed: event_cases.event_case_public_assigned'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='event_cases' AND policyname='event_case_invited' AND cmd='SELECT' AND permissive='PERMISSIVE' AND roles='{authenticated}' AND qual='(EXISTS ( SELECT 1
   FROM event_assignments a
  WHERE ((a.case_id = event_cases.id) AND (a.game_id = event_cases.game_id) AND (a.recipient_id = ( SELECT auth.uid() AS uid)))))' AND with_check IS NOT DISTINCT FROM NULL) THEN RAISE EXCEPTION 'RLS baseline changed: event_cases.event_case_invited'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='game_presence' AND policyname='game_presence_own_write' AND cmd='ALL' AND permissive='PERMISSIVE' AND roles='{authenticated}' AND qual='((user_id = ( SELECT auth.uid() AS uid)) AND private.is_game_member(game_id))' AND with_check IS NOT DISTINCT FROM '((user_id = ( SELECT auth.uid() AS uid)) AND private.is_game_member(game_id))') THEN RAISE EXCEPTION 'RLS baseline changed: game_presence.game_presence_own_write'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='game_presence' AND policyname='game_presence_teacher_read' AND cmd='SELECT' AND permissive='PERMISSIVE' AND roles='{authenticated}' AND qual='private.is_game_teacher(game_id)' AND with_check IS NOT DISTINCT FROM NULL) THEN RAISE EXCEPTION 'RLS baseline changed: game_presence.game_presence_teacher_read'; END IF;
END $preflight$;

-- event_assignments: old ALL policy also participated in SELECT.
-- Explicit write policies preserve its USING/WITH CHECK without extra SELECT overlap.
CREATE POLICY "gos_id_rls_write_event_assignments_insert" ON public."event_assignments" FOR INSERT TO authenticated WITH CHECK (private.is_game_teacher(game_id));
CREATE POLICY "gos_id_rls_write_event_assignments_update" ON public."event_assignments" FOR UPDATE TO authenticated USING (private.is_game_teacher(game_id)) WITH CHECK (private.is_game_teacher(game_id));
CREATE POLICY "gos_id_rls_write_event_assignments_delete" ON public."event_assignments" FOR DELETE TO authenticated USING (private.is_game_teacher(game_id));
ALTER POLICY "event_assignment_public_read" ON public."event_assignments" USING ((private.is_game_member(game_id)) OR (private.is_game_teacher(game_id)) OR ((private.is_game_teacher(game_id) OR (recipient_id = ( SELECT auth.uid() AS uid)))));
DROP POLICY "event_assignment_read" ON public."event_assignments";
DROP POLICY "event_assignment_teacher" ON public."event_assignments";

-- event_cases: old ALL policy also participated in SELECT.
-- Explicit write policies preserve its USING/WITH CHECK without extra SELECT overlap.
CREATE POLICY "gos_id_rls_write_event_cases_insert" ON public."event_cases" FOR INSERT TO authenticated WITH CHECK (private.is_game_teacher(game_id));
CREATE POLICY "gos_id_rls_write_event_cases_update" ON public."event_cases" FOR UPDATE TO authenticated USING (private.is_game_teacher(game_id)) WITH CHECK (private.is_game_teacher(game_id));
CREATE POLICY "gos_id_rls_write_event_cases_delete" ON public."event_cases" FOR DELETE TO authenticated USING (private.is_game_teacher(game_id));
ALTER POLICY "event_case_public_assigned" ON public."event_cases" USING (((private.is_game_member(game_id) AND private.assigned_game_case(id, game_id))) OR (private.is_game_teacher(game_id)) OR ((EXISTS ( SELECT 1
   FROM event_assignments a
  WHERE ((a.case_id = event_cases.id) AND (a.game_id = event_cases.game_id) AND (a.recipient_id = ( SELECT auth.uid() AS uid)))))));
DROP POLICY "event_case_invited" ON public."event_cases";
DROP POLICY "event_case_teacher" ON public."event_cases";

-- game_presence: old ALL policy also participated in SELECT.
-- Explicit write policies preserve its USING/WITH CHECK without extra SELECT overlap.
CREATE POLICY "gos_id_rls_write_game_presence_insert" ON public."game_presence" FOR INSERT TO authenticated WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND private.is_game_member(game_id)));
CREATE POLICY "gos_id_rls_write_game_presence_update" ON public."game_presence" FOR UPDATE TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND private.is_game_member(game_id))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND private.is_game_member(game_id)));
CREATE POLICY "gos_id_rls_write_game_presence_delete" ON public."game_presence" FOR DELETE TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND private.is_game_member(game_id)));
ALTER POLICY "game_presence_teacher_read" ON public."game_presence" USING ((private.is_game_teacher(game_id)) OR (((user_id = ( SELECT auth.uid() AS uid)) AND private.is_game_member(game_id))));
DROP POLICY "game_presence_own_write" ON public."game_presence";