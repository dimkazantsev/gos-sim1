-- Batch the existing private metadata-only notice by game and SQL statement.
-- A 100-row write in one game emits one notice, not 100. All games touched
-- by an UPDATE (including the old and new game) retain their notice.
-- The client still fetches contents using existing RLS; no row data is sent.
DO $guard$
BEGIN
 IF NOT EXISTS (
   SELECT 1
   FROM pg_trigger t
   JOIN pg_class c ON c.oid=t.tgrelid
   JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname='political_posts'
     AND t.tgname='broadcast_political_posts_invalidation'
     AND NOT t.tgisinternal AND t.tgenabled='O'
     AND pg_get_triggerdef(t.oid) LIKE
       '%FOR EACH ROW EXECUTE FUNCTION private.broadcast_political_posts_invalidation()%'
 ) THEN
   RAISE EXCEPTION 'Unexpected political posts trigger: refuse bulk replacement';
 END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION private.broadcast_political_posts_invalidation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','private','realtime','pg_temp'
AS $function$
DECLARE v_game uuid;
BEGIN
 IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME<>'political_posts'
    OR TG_LEVEL<>'STATEMENT' THEN
  RAISE EXCEPTION 'Unexpected source for political post signal';
 END IF;

 IF TG_OP='INSERT' THEN
  FOR v_game IN SELECT DISTINCT game_id FROM new_posts WHERE game_id IS NOT NULL LOOP
   BEGIN
    PERFORM realtime.send(jsonb_build_object('table','political_posts'),
      'political_posts_changed','gos-id-live:'||v_game::text,true);
   EXCEPTION WHEN OTHERS THEN NULL; -- A Realtime outage must not reject the write.
   END;
  END LOOP;
 ELSIF TG_OP='UPDATE' THEN
  FOR v_game IN
   SELECT DISTINCT game_id FROM (
    SELECT game_id FROM old_posts
    UNION ALL
    SELECT game_id FROM new_posts
   ) changed WHERE game_id IS NOT NULL
  LOOP
   BEGIN
    PERFORM realtime.send(jsonb_build_object('table','political_posts'),
      'political_posts_changed','gos-id-live:'||v_game::text,true);
   EXCEPTION WHEN OTHERS THEN NULL;
   END;
  END LOOP;
 ELSIF TG_OP='DELETE' THEN
  FOR v_game IN SELECT DISTINCT game_id FROM old_posts WHERE game_id IS NOT NULL LOOP
   BEGIN
    PERFORM realtime.send(jsonb_build_object('table','political_posts'),
      'political_posts_changed','gos-id-live:'||v_game::text,true);
   EXCEPTION WHEN OTHERS THEN NULL;
   END;
  END LOOP;
 ELSE
  RAISE EXCEPTION 'Unsupported political post statement operation';
 END IF;
 RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION private.broadcast_political_posts_invalidation()
 FROM PUBLIC,anon,authenticated;

DROP TRIGGER broadcast_political_posts_invalidation ON public.political_posts;
CREATE TRIGGER broadcast_political_posts_invalidation_insert
 AFTER INSERT ON public.political_posts
 REFERENCING NEW TABLE AS new_posts
 FOR EACH STATEMENT EXECUTE FUNCTION private.broadcast_political_posts_invalidation();
CREATE TRIGGER broadcast_political_posts_invalidation_update
 AFTER UPDATE ON public.political_posts
 REFERENCING OLD TABLE AS old_posts NEW TABLE AS new_posts
 FOR EACH STATEMENT EXECUTE FUNCTION private.broadcast_political_posts_invalidation();
CREATE TRIGGER broadcast_political_posts_invalidation_delete
 AFTER DELETE ON public.political_posts
 REFERENCING OLD TABLE AS old_posts
 FOR EACH STATEMENT EXECUTE FUNCTION private.broadcast_political_posts_invalidation();

-- RLS, GRANT, fiscal formulas, published tables and all other triggers unchanged.
