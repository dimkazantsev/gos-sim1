-- Do not start destructive Storage cleanup if any account file of any
-- teacher is still physically stored inside the game being deleted.
-- Check *after* the owner has moved their own legacy files.
CREATE OR REPLACE FUNCTION public.assert_game_teacher_assets_safe_to_purge(p_game uuid,p_code text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE g public.games%rowtype;
BEGIN
 SELECT * INTO g FROM public.games WHERE id=p_game;
 IF g.id IS NULL THEN RAISE EXCEPTION 'Игра не найдена'; END IF;
 IF (select auth.uid()) IS NULL
   OR (g.owner_id<>(select auth.uid()) AND NOT private.is_platform_admin())
 THEN RAISE EXCEPTION 'Проверять удаление может только владелец или администратор'; END IF;
 IF upper(trim(p_code))<>g.game_code THEN RAISE EXCEPTION 'Введите точный код игры'; END IF;
 IF g.status<>'archived' THEN RAISE EXCEPTION 'Игра должна быть в архиве'; END IF;
 IF EXISTS (
   SELECT 1 FROM public.teacher_profiles t
   JOIN storage.objects o ON o.bucket_id='game-assets'
     AND (o.name=t.avatar_path OR o.name=t.signature_path)
   WHERE t.avatar_path LIKE p_game::text||'/%'
      OR t.signature_path LIKE p_game::text||'/%'
 ) THEN
   RAISE EXCEPTION 'Среди файлов игры есть личные фото или подписи преподавателей. Перенесите их в постоянные профили до удаления игры.';
 END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.assert_game_teacher_assets_safe_to_purge(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.assert_game_teacher_assets_safe_to_purge(uuid,text) TO authenticated;
