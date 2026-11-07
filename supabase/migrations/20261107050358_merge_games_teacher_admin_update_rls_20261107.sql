-- ГОС.ID: merge two logically equivalent permissive UPDATE branches on public.games.
-- Before: (admin USING A CHECK A) OR (teacher USING T CHECK T).
-- After:  (A OR T) USING and WITH CHECK. No additional grants or SELECT access.
-- Fail closed on unexpected policy drift.
DO $migration$
DECLARE a record; t record;
BEGIN
 SELECT polname,polcmd,polpermissive,polroles,pg_get_expr(polqual,polrelid) qual,
        pg_get_expr(polwithcheck,polrelid) check_expr
 INTO a FROM pg_policy WHERE polrelid='public.games'::regclass AND polname='games_platform_admin_update';
 SELECT polname,polcmd,polpermissive,polroles,pg_get_expr(polqual,polrelid) qual,
        pg_get_expr(polwithcheck,polrelid) check_expr
 INTO t FROM pg_policy WHERE polrelid='public.games'::regclass AND polname='games_teacher_update';
 IF a.polname IS NULL OR t.polname IS NULL
    OR a.polcmd <> 'w' OR t.polcmd <> 'w'
    OR NOT a.polpermissive OR NOT t.polpermissive
    OR a.polroles <> t.polroles
    OR a.qual <> 'private.is_platform_admin()'
    OR a.check_expr <> 'private.is_platform_admin()'
    OR t.qual <> 'private.is_game_teacher(id)'
    OR t.check_expr <> 'private.is_game_teacher(id)'
 THEN
  RAISE EXCEPTION 'games UPDATE RLS differs from reviewed baseline; refusing to modify';
 END IF;
 EXECUTE 'ALTER POLICY games_teacher_update ON public.games USING (private.is_platform_admin() OR private.is_game_teacher(id)) WITH CHECK (private.is_platform_admin() OR private.is_game_teacher(id))';
 EXECUTE 'DROP POLICY games_platform_admin_update ON public.games';
END
$migration$;