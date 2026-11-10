-- Teacher-only achievement totals; one aggregated query when statistics are opened.
-- No new client subscriptions, cron tasks, tables, or indexes (uses existing
-- primary keys on game_achievements and game_achievement_settings).
CREATE OR REPLACE FUNCTION public.get_teacher_achievement_stats(p_game_id uuid)
RETURNS TABLE(user_id uuid, opened integer, hidden integer, total integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
BEGIN
 IF (SELECT auth.uid()) IS NULL OR NOT private.is_game_teacher(p_game_id) THEN
  RAISE EXCEPTION 'Статистика наград доступна только преподавателю.';
 END IF;
 RETURN QUERY
 SELECT a.user_id,
        count(*) FILTER(WHERE NOT coalesce(s.hidden,c.hidden))::integer AS opened,
        count(*) FILTER(WHERE coalesce(s.hidden,c.hidden))::integer AS hidden,
        count(*)::integer AS total
 FROM public.game_achievements a
 JOIN public.game_members m ON m.game_id=a.game_id AND m.user_id=a.user_id AND m.kind='student'
 JOIN private.achievement_catalog c ON c.id=a.achievement_id
 LEFT JOIN public.game_achievement_settings s ON s.game_id=a.game_id AND s.achievement_id=a.achievement_id
 WHERE a.game_id=p_game_id
 GROUP BY a.user_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_teacher_achievement_stats(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_teacher_achievement_stats(uuid) TO authenticated;
