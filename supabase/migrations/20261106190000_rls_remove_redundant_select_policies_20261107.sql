-- ГОС.ID, 2026-11-07: remove redundant OR authorization checks on frequently read game tables.
-- Preserve WRITE USING/WITH CHECK predicates exactly; leave separate SELECT policies unchanged.
-- Preconditions verified: private.is_game_teacher(game_id) => private.is_game_member(game_id)
-- and platform-admin => private.is_game_member(id), for existing, unmatched and random identities.
-- DDL executes atomically under Supabase migrations; fail closed if policy shapes have changed.
DO $guard$ DECLARE v_count integer; BEGIN
SELECT count(*) INTO v_count
FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND p.polpermissive
AND (c.relname,p.polname,p.polcmd) IN (
('games','games_platform_admin_read','r'),
('game_crises','game_crises_teacher','*'),
('game_documents','docs_teacher_all','*'),
('game_evaluations','game_evaluations_teacher','*'),
('game_profiles','game_profiles_own_write','*')
);
IF v_count <> 5 THEN RAISE EXCEPTION 'Expected RLS policy layout changed: found % of 5',v_count; END IF;
SELECT count(*) INTO v_count FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND p.polcmd='r' AND p.polpermissive
AND (c.relname,p.polname) IN (
('games','games_read'),
('game_crises','game_crises_read'),
('game_documents','docs_read'),
('game_evaluations','game_evaluations_read'),
('game_profiles','game_profiles_read')
);
IF v_count <> 5 THEN RAISE EXCEPTION 'Required SELECT access policies changed: % of 5',v_count; END IF;
IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='is_game_member' AND pg_get_functiondef(p.oid) LIKE '%public.platform_admins%')
THEN RAISE EXCEPTION 'Platform-admin membership invariant was removed'; END IF;
END $guard$;

DROP POLICY "games_platform_admin_read" ON public.games;

-- Existing SELECT policy already permits every row matched by "game_crises_teacher".
DROP POLICY "game_crises_teacher" ON public.game_crises;
CREATE POLICY "game_crises_teacher_insert" ON public.game_crises AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (private.is_game_teacher(game_id));
CREATE POLICY "game_crises_teacher_update" ON public.game_crises AS PERMISSIVE FOR UPDATE TO authenticated USING (private.is_game_teacher(game_id)) WITH CHECK (private.is_game_teacher(game_id));
CREATE POLICY "game_crises_teacher_delete" ON public.game_crises AS PERMISSIVE FOR DELETE TO authenticated USING (private.is_game_teacher(game_id));

-- Existing SELECT policy already permits every row matched by "docs_teacher_all".
DROP POLICY "docs_teacher_all" ON public.game_documents;
CREATE POLICY "docs_teacher_insert" ON public.game_documents AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (private.is_game_teacher(game_id));
CREATE POLICY "docs_teacher_update" ON public.game_documents AS PERMISSIVE FOR UPDATE TO authenticated USING (private.is_game_teacher(game_id)) WITH CHECK (private.is_game_teacher(game_id));
CREATE POLICY "docs_teacher_delete" ON public.game_documents AS PERMISSIVE FOR DELETE TO authenticated USING (private.is_game_teacher(game_id));

-- Existing SELECT policy already permits every row matched by "game_evaluations_teacher".
DROP POLICY "game_evaluations_teacher" ON public.game_evaluations;
CREATE POLICY "game_evaluations_teacher_insert" ON public.game_evaluations AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (private.is_game_teacher(game_id));
CREATE POLICY "game_evaluations_teacher_update" ON public.game_evaluations AS PERMISSIVE FOR UPDATE TO authenticated USING (private.is_game_teacher(game_id)) WITH CHECK (private.is_game_teacher(game_id));
CREATE POLICY "game_evaluations_teacher_delete" ON public.game_evaluations AS PERMISSIVE FOR DELETE TO authenticated USING (private.is_game_teacher(game_id));

-- Existing SELECT policy already permits every row matched by "game_profiles_own_write".
DROP POLICY "game_profiles_own_write" ON public.game_profiles;
CREATE POLICY "game_profiles_own_insert" ON public.game_profiles AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((user_id = (select auth.uid()) and private.is_game_member(game_id)));
CREATE POLICY "game_profiles_own_update" ON public.game_profiles AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = (select auth.uid()) and private.is_game_member(game_id))) WITH CHECK ((user_id = (select auth.uid()) and private.is_game_member(game_id)));
CREATE POLICY "game_profiles_own_delete" ON public.game_profiles AS PERMISSIVE FOR DELETE TO authenticated USING ((user_id = (select auth.uid()) and private.is_game_member(game_id)));
