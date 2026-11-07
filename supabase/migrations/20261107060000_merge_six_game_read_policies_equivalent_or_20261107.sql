-- ГОС.ID • Merge six pairs of redundant PERMISSIVE SELECT RLS policies.
-- Logical OR is exactly PostgreSQL's prior permissive-policy combination.
-- Preserve existing student, teacher, guest, revoked, and cross-game access;
-- preserve all INSERT/UPDATE/DELETE and RESTRICTIVE policies.
-- No new permissions, indexes, triggers, or role grants; no UI changes.
DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='event_decisions' AND policyname='event_decision_public_read' AND cmd='SELECT' AND permissive='PERMISSIVE' AND roles='{authenticated}' AND qual='private.is_game_member(game_id)') THEN RAISE EXCEPTION 'Policy changed: event_decisions.event_decision_public_read'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='event_decisions' AND policyname='event_decision_read' AND cmd='SELECT' AND permissive='PERMISSIVE' AND roles='{authenticated}' AND qual='(private.is_game_teacher(game_id) OR (EXISTS ( SELECT 1
   FROM event_assignments a
  WHERE ((a.case_id = event_decisions.case_id) AND (a.game_id = event_decisions.game_id) AND (a.recipient_id = ( SELECT auth.uid() AS uid))))))') THEN RAISE EXCEPTION 'Policy changed: event_decisions.event_decision_read'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='game_activity' AND policyname='game_activity_student_own_read' AND cmd='SELECT' AND permissive='PERMISSIVE' AND roles='{authenticated}' AND qual='((actor_id = ( SELECT auth.uid() AS uid)) AND private.is_game_member(game_id))') THEN RAISE EXCEPTION 'Policy changed: game_activity.game_activity_student_own_read'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='game_activity' AND policyname='game_activity_teacher_read' AND cmd='SELECT' AND permissive='PERMISSIVE' AND roles='{authenticated}' AND qual='private.is_game_teacher(game_id)') THEN RAISE EXCEPTION 'Policy changed: game_activity.game_activity_teacher_read'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='presidential_campaign_materials' AND policyname='presidential_campaign_read' AND cmd='SELECT' AND permissive='PERMISSIVE' AND roles='{authenticated}' AND qual='(private.is_game_member(game_id) AND ((status = ''approved''::text) OR (author_id = ( SELECT auth.uid() AS uid)) OR private.is_game_teacher(game_id)))') THEN RAISE EXCEPTION 'Policy changed: presidential_campaign_materials.presidential_campaign_read'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='presidential_campaign_materials' AND policyname='presidential_campaign_party_pending_read' AND cmd='SELECT' AND permissive='PERMISSIVE' AND roles='{authenticated}' AND qual='(private.is_game_member(game_id) AND private.can_submit_presidential_campaign_material(candidate_id, ( SELECT auth.uid() AS uid)))') THEN RAISE EXCEPTION 'Policy changed: presidential_campaign_materials.presidential_campaign_party_pending_read'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='presidential_candidate_documents' AND policyname='presidential_documents_read' AND cmd='SELECT' AND permissive='PERMISSIVE' AND roles='{authenticated}' AND qual='(EXISTS ( SELECT 1
   FROM presidential_candidates c
  WHERE ((c.id = presidential_candidate_documents.candidate_id) AND ((c.user_id = ( SELECT auth.uid() AS uid)) OR (c.created_by = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
           FROM game_parties p
          WHERE ((p.id = c.party_id) AND (p.leader_user_id = ( SELECT auth.uid() AS uid))))) OR (presidential_candidate_documents.is_submitted AND private.is_game_teacher(c.game_id))))))') THEN RAISE EXCEPTION 'Policy changed: presidential_candidate_documents.presidential_documents_read'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='presidential_candidate_documents' AND policyname='gos_party_presidential_documents_read' AND cmd='SELECT' AND permissive='PERMISSIVE' AND roles='{authenticated}' AND qual='(EXISTS ( SELECT 1
   FROM presidential_candidates c
  WHERE ((c.id = presidential_candidate_documents.candidate_id) AND (c.game_id = presidential_candidate_documents.game_id) AND (c.nomination_type = ''party''::text) AND (c.archived_at IS NULL) AND private.can_upload_presidential_candidate_document(c.id, ( SELECT auth.uid() AS uid)))))') THEN RAISE EXCEPTION 'Policy changed: presidential_candidate_documents.gos_party_presidential_documents_read'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='presidential_candidate_program_points' AND policyname='presidential_program_points_read' AND cmd='SELECT' AND permissive='PERMISSIVE' AND roles='{authenticated}' AND qual='(EXISTS ( SELECT 1
   FROM presidential_candidates c
  WHERE ((c.id = presidential_candidate_program_points.candidate_id) AND ((c.cec_submitted_at IS NOT NULL) OR (c.user_id = ( SELECT auth.uid() AS uid)) OR (c.created_by = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
           FROM game_parties p
          WHERE ((p.id = c.party_id) AND (p.leader_user_id = ( SELECT auth.uid() AS uid)))))))))') THEN RAISE EXCEPTION 'Policy changed: presidential_candidate_program_points.presidential_program_points_read'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='presidential_candidate_program_points' AND policyname='gos_party_presidential_program_read' AND cmd='SELECT' AND permissive='PERMISSIVE' AND roles='{authenticated}' AND qual='(EXISTS ( SELECT 1
   FROM presidential_candidates c
  WHERE ((c.id = presidential_candidate_program_points.candidate_id) AND (c.game_id = presidential_candidate_program_points.game_id) AND (c.nomination_type = ''party''::text) AND (c.archived_at IS NULL) AND private.can_upload_presidential_candidate_document(c.id, ( SELECT auth.uid() AS uid)))))') THEN RAISE EXCEPTION 'Policy changed: presidential_candidate_program_points.gos_party_presidential_program_read'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='presidential_candidates' AND policyname='presidential_candidates_read' AND cmd='SELECT' AND permissive='PERMISSIVE' AND roles='{authenticated}' AND qual='(private.is_game_member(game_id) AND ((cec_submitted_at IS NOT NULL) OR (user_id = ( SELECT auth.uid() AS uid)) OR (created_by = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM game_parties p
  WHERE ((p.id = presidential_candidates.party_id) AND (p.leader_user_id = ( SELECT auth.uid() AS uid)))))))') THEN RAISE EXCEPTION 'Policy changed: presidential_candidates.presidential_candidates_read'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='presidential_candidates' AND policyname='gos_party_presidential_candidate_read' AND cmd='SELECT' AND permissive='PERMISSIVE' AND roles='{authenticated}' AND qual='(private.is_game_member(game_id) AND (nomination_type = ''party''::text) AND (party_id IS NOT NULL) AND (archived_at IS NULL) AND (EXISTS ( SELECT 1
   FROM (game_parties p
     JOIN game_members gm ON (((gm.game_id = p.game_id) AND (gm.user_id = ( SELECT auth.uid() AS uid)) AND (gm.kind = ''student''::member_kind) AND (gm.roster_archived_at IS NULL) AND (gm.team = p.name))))
  WHERE ((p.id = presidential_candidates.party_id) AND (p.game_id = presidential_candidates.game_id) AND (p.registration_status = ''registered''::text)))))') THEN RAISE EXCEPTION 'Policy changed: presidential_candidates.gos_party_presidential_candidate_read'; END IF;
END
$preflight$;

-- The prior two PERMISSIVE SELECT predicates combined by OR. Reproduce the exact union.
ALTER POLICY "event_decision_public_read" ON public."event_decisions" USING (
 (private.is_game_member(game_id)) OR ((private.is_game_teacher(game_id) OR (EXISTS ( SELECT 1
   FROM event_assignments a
  WHERE ((a.case_id = event_decisions.case_id) AND (a.game_id = event_decisions.game_id) AND (a.recipient_id = ( SELECT auth.uid() AS uid)))))))
);
DROP POLICY "event_decision_read" ON public."event_decisions";

-- The prior two PERMISSIVE SELECT predicates combined by OR. Reproduce the exact union.
ALTER POLICY "game_activity_student_own_read" ON public."game_activity" USING (
 (((actor_id = ( SELECT auth.uid() AS uid)) AND private.is_game_member(game_id))) OR (private.is_game_teacher(game_id))
);
DROP POLICY "game_activity_teacher_read" ON public."game_activity";

-- The prior two PERMISSIVE SELECT predicates combined by OR. Reproduce the exact union.
ALTER POLICY "presidential_campaign_read" ON public."presidential_campaign_materials" USING (
 ((private.is_game_member(game_id) AND ((status = 'approved'::text) OR (author_id = ( SELECT auth.uid() AS uid)) OR private.is_game_teacher(game_id)))) OR ((private.is_game_member(game_id) AND private.can_submit_presidential_campaign_material(candidate_id, ( SELECT auth.uid() AS uid))))
);
DROP POLICY "presidential_campaign_party_pending_read" ON public."presidential_campaign_materials";

-- The prior two PERMISSIVE SELECT predicates combined by OR. Reproduce the exact union.
ALTER POLICY "presidential_documents_read" ON public."presidential_candidate_documents" USING (
 ((EXISTS ( SELECT 1
   FROM presidential_candidates c
  WHERE ((c.id = presidential_candidate_documents.candidate_id) AND ((c.user_id = ( SELECT auth.uid() AS uid)) OR (c.created_by = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
           FROM game_parties p
          WHERE ((p.id = c.party_id) AND (p.leader_user_id = ( SELECT auth.uid() AS uid))))) OR (presidential_candidate_documents.is_submitted AND private.is_game_teacher(c.game_id))))))) OR ((EXISTS ( SELECT 1
   FROM presidential_candidates c
  WHERE ((c.id = presidential_candidate_documents.candidate_id) AND (c.game_id = presidential_candidate_documents.game_id) AND (c.nomination_type = 'party'::text) AND (c.archived_at IS NULL) AND private.can_upload_presidential_candidate_document(c.id, ( SELECT auth.uid() AS uid))))))
);
DROP POLICY "gos_party_presidential_documents_read" ON public."presidential_candidate_documents";

-- The prior two PERMISSIVE SELECT predicates combined by OR. Reproduce the exact union.
ALTER POLICY "presidential_program_points_read" ON public."presidential_candidate_program_points" USING (
 ((EXISTS ( SELECT 1
   FROM presidential_candidates c
  WHERE ((c.id = presidential_candidate_program_points.candidate_id) AND ((c.cec_submitted_at IS NOT NULL) OR (c.user_id = ( SELECT auth.uid() AS uid)) OR (c.created_by = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
           FROM game_parties p
          WHERE ((p.id = c.party_id) AND (p.leader_user_id = ( SELECT auth.uid() AS uid)))))))))) OR ((EXISTS ( SELECT 1
   FROM presidential_candidates c
  WHERE ((c.id = presidential_candidate_program_points.candidate_id) AND (c.game_id = presidential_candidate_program_points.game_id) AND (c.nomination_type = 'party'::text) AND (c.archived_at IS NULL) AND private.can_upload_presidential_candidate_document(c.id, ( SELECT auth.uid() AS uid))))))
);
DROP POLICY "gos_party_presidential_program_read" ON public."presidential_candidate_program_points";

-- The prior two PERMISSIVE SELECT predicates combined by OR. Reproduce the exact union.
ALTER POLICY "presidential_candidates_read" ON public."presidential_candidates" USING (
 ((private.is_game_member(game_id) AND ((cec_submitted_at IS NOT NULL) OR (user_id = ( SELECT auth.uid() AS uid)) OR (created_by = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM game_parties p
  WHERE ((p.id = presidential_candidates.party_id) AND (p.leader_user_id = ( SELECT auth.uid() AS uid)))))))) OR ((private.is_game_member(game_id) AND (nomination_type = 'party'::text) AND (party_id IS NOT NULL) AND (archived_at IS NULL) AND (EXISTS ( SELECT 1
   FROM (game_parties p
     JOIN game_members gm ON (((gm.game_id = p.game_id) AND (gm.user_id = ( SELECT auth.uid() AS uid)) AND (gm.kind = 'student'::member_kind) AND (gm.roster_archived_at IS NULL) AND (gm.team = p.name))))
  WHERE ((p.id = presidential_candidates.party_id) AND (p.game_id = presidential_candidates.game_id) AND (p.registration_status = 'registered'::text))))))
);
DROP POLICY "gos_party_presidential_candidate_read" ON public."presidential_candidates";
