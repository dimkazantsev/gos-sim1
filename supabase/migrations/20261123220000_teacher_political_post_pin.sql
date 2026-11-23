-- ГОС.ID: одно закрепление в политическом процессе; только преподаватель.
-- Повторно используем существующий political_posts.pinned и текущую ленту.
CREATE UNIQUE INDEX IF NOT EXISTS political_posts_one_active_pin_per_game
  ON public.political_posts (game_id) WHERE pinned AND deleted_at IS NULL;

-- Защита распространяется и на прямые записи в Data API,
-- не только на кнопку интерфейса.
CREATE OR REPLACE FUNCTION private.guard_political_pin_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $guard$
BEGIN
 IF TG_OP='INSERT' THEN
   IF NOT private.is_game_teacher(NEW.game_id) THEN
     RAISE EXCEPTION 'Закрепление публикаций доступно только преподавателю' USING ERRCODE='42501';
   END IF;
   RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN
   IF NOT private.is_game_teacher(OLD.game_id) THEN
     RAISE EXCEPTION 'Снять закрепление может только преподаватель' USING ERRCODE='42501';
   END IF;
   RETURN OLD;
 END IF;
 IF NOT private.is_game_teacher(OLD.game_id) OR NOT private.is_game_teacher(NEW.game_id) THEN
   RAISE EXCEPTION 'Закреплением публикаций управляет только преподаватель' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END;
$guard$;
REVOKE ALL ON FUNCTION private.guard_political_pin_change() FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS teacher_pin_insert_guard ON public.political_posts;
CREATE TRIGGER teacher_pin_insert_guard BEFORE INSERT ON public.political_posts
FOR EACH ROW WHEN (NEW.pinned IS TRUE)
EXECUTE FUNCTION private.guard_political_pin_change();

DROP TRIGGER IF EXISTS teacher_pin_update_guard ON public.political_posts;
CREATE TRIGGER teacher_pin_update_guard
BEFORE UPDATE OF pinned,game_id,deleted_at ON public.political_posts
FOR EACH ROW WHEN (
  OLD.pinned IS DISTINCT FROM NEW.pinned
  OR ((OLD.pinned OR NEW.pinned)
      AND (OLD.game_id IS DISTINCT FROM NEW.game_id OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at))
)
EXECUTE FUNCTION private.guard_political_pin_change();

DROP TRIGGER IF EXISTS teacher_pin_delete_guard ON public.political_posts;
CREATE TRIGGER teacher_pin_delete_guard BEFORE DELETE ON public.political_posts
FOR EACH ROW WHEN (OLD.pinned IS TRUE)
EXECUTE FUNCTION private.guard_political_pin_change();

-- Два обновления выполняются в одной транзакции с блокировкой на игру.
-- Одновременные нажатия не создают два закрепления.
CREATE OR REPLACE FUNCTION public.set_political_post_pin(p_post_id uuid,p_pin boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $rpc$
DECLARE
 v_game uuid;
 v_pinned boolean;
BEGIN
 IF auth.uid() IS NULL OR p_post_id IS NULL OR p_pin IS NULL THEN
   RAISE EXCEPTION 'Нет прав на закрепление публикации' USING ERRCODE='42501';
 END IF;
 SELECT p.game_id INTO v_game FROM public.political_posts p
 WHERE p.id=p_post_id AND p.deleted_at IS NULL;
 IF v_game IS NULL OR NOT private.is_game_teacher(v_game) THEN
   RAISE EXCEPTION 'Закреплять публикации может только преподаватель' USING ERRCODE='42501';
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('political-post-pin:'||v_game::text,0));
 SELECT p.pinned INTO v_pinned FROM public.political_posts p
 WHERE p.id=p_post_id AND p.game_id=v_game AND p.deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Публикация не найдена' USING ERRCODE='22023';
 END IF;
 IF p_pin THEN
   UPDATE public.political_posts p SET pinned=false
   WHERE p.game_id=v_game AND p.pinned IS TRUE AND p.id<>p_post_id AND p.deleted_at IS NULL;
   IF NOT v_pinned THEN
     UPDATE public.political_posts p SET pinned=true WHERE p.id=p_post_id;
   END IF;
 ELSIF v_pinned THEN
   UPDATE public.political_posts p SET pinned=false WHERE p.id=p_post_id;
 END IF;
END;
$rpc$;
REVOKE ALL ON FUNCTION public.set_political_post_pin(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_political_post_pin(uuid,boolean) TO authenticated;

-- Полнотекстовый режим поиска также возвращает закреплённую старую запись
-- в первых 250 публикациях, не запрашивая её отдельно.
CREATE OR REPLACE FUNCTION public.get_political_wall_projection(p_game_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or not private.is_game_member(p_game_id) then
  raise exception 'Нет доступа к игре.' using errcode='42501';
 end if;
 return jsonb_build_object(
  'posts', coalesce((select jsonb_agg(to_jsonb(x) order by x.pinned desc, x.created_at desc, x.id desc) from (select * from public.political_posts where game_id=p_game_id order by pinned desc, created_at desc, id desc limit 250) x),'[]'::jsonb),
  'media', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from public.political_post_media x where x.game_id=p_game_id),'[]'::jsonb),
  'formal_links', coalesce((select jsonb_agg(to_jsonb(x)) from public.political_post_formal_links x where x.game_id=p_game_id),'[]'::jsonb),
  'metric_history', coalesce((select jsonb_agg(to_jsonb(x) order by x.recorded_at asc, x.id asc) from (select * from public.state_metric_history where game_id=p_game_id order by recorded_at desc, id desc limit 50) x),'[]'::jsonb),
  'support_history', coalesce((select jsonb_agg(to_jsonb(x) order by x.recorded_at asc, x.id asc) from (select * from public.party_support_history where game_id=p_game_id order by recorded_at desc, id desc limit 50) x),'[]'::jsonb),
  'metrics', coalesce((select jsonb_agg(to_jsonb(x) order by x.sort_order asc) from public.state_metrics x where x.game_id=p_game_id),'[]'::jsonb)
 );
end;
$function$

