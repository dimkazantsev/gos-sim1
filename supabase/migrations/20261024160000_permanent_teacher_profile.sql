-- Permanent teacher identity; no existing game or profile is deleted.
CREATE TABLE IF NOT EXISTS public.teacher_profiles (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
 full_name text NOT NULL DEFAULT '', bio text,
 gender text CHECK(gender IS NULL OR gender IN('male','female','unspecified')),
 avatar_path text,signature_path text,last_game_id uuid,
 preferences jsonb NOT NULL DEFAULT '{}'::jsonb,updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.teacher_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.teacher_profiles FROM PUBLIC,anon;
GRANT SELECT,INSERT,UPDATE ON public.teacher_profiles TO authenticated;
CREATE POLICY teacher_profile_own_read ON public.teacher_profiles FOR SELECT TO authenticated
 USING(user_id=(select auth.uid()) AND NOT coalesce((auth.jwt()->>'is_anonymous')::boolean,false));
CREATE POLICY teacher_profile_own_update ON public.teacher_profiles FOR UPDATE TO authenticated
 USING(user_id=(select auth.uid()) AND NOT coalesce((auth.jwt()->>'is_anonymous')::boolean,false))
 WITH CHECK(user_id=(select auth.uid()) AND NOT coalesce((auth.jwt()->>'is_anonymous')::boolean,false));
CREATE POLICY teacher_profile_authorized_insert ON public.teacher_profiles FOR INSERT TO authenticated
 WITH CHECK(user_id=(select auth.uid()) AND NOT coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
 AND(private.is_platform_admin() OR EXISTS(SELECT 1 FROM public.games g WHERE g.owner_id=(select auth.uid()))
 OR EXISTS(SELECT 1 FROM public.game_members m WHERE m.user_id=(select auth.uid()) AND m.kind='teacher')));

-- Save existing teacher details before any future archive; keep earlier master records.
INSERT INTO public.teacher_profiles(user_id,full_name,bio,gender,avatar_path,signature_path,last_game_id,updated_at)
SELECT DISTINCT ON(m.user_id) m.user_id,m.full_name,p.bio,p.gender,p.avatar_path,p.signature_path,
 m.game_id,coalesce(p.updated_at,m.joined_at,now())
FROM public.game_members m
LEFT JOIN public.game_profiles p ON p.game_id=m.game_id AND p.user_id=m.user_id
WHERE m.kind='teacher'
ORDER BY m.user_id,p.updated_at DESC NULLS LAST,m.joined_at DESC
ON CONFLICT(user_id) DO NOTHING;
INSERT INTO public.teacher_profiles(user_id,full_name)
SELECT user_id,'Преподаватель' FROM public.platform_admins ON CONFLICT(user_id) DO NOTHING;

-- Restore stable full name when entering a new game.
CREATE OR REPLACE FUNCTION private.teacher_member_restore()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
DECLARE n text;
BEGIN
 IF NEW.kind='teacher' THEN
  SELECT full_name INTO n FROM public.teacher_profiles WHERE user_id=NEW.user_id;
  IF nullif(btrim(coalesce(n,'')),'') IS NOT NULL THEN NEW.full_name:=n; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER teacher_member_restore BEFORE INSERT ON public.game_members
 FOR EACH ROW EXECUTE FUNCTION private.teacher_member_restore();

CREATE OR REPLACE FUNCTION private.teacher_member_persist()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
DECLARE saved public.teacher_profiles%rowtype;
BEGIN
 IF NEW.kind<>'teacher' THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN
  INSERT INTO public.teacher_profiles(user_id,full_name,last_game_id)
   VALUES(NEW.user_id,NEW.full_name,NEW.game_id) ON CONFLICT(user_id) DO NOTHING;
  SELECT * INTO saved FROM public.teacher_profiles WHERE user_id=NEW.user_id;
  INSERT INTO public.game_profiles(game_id,user_id,bio,gender,avatar_path,signature_path)
   VALUES(NEW.game_id,NEW.user_id,saved.bio,saved.gender,saved.avatar_path,saved.signature_path)
   ON CONFLICT(game_id,user_id) DO NOTHING;
 ELSIF NEW.full_name IS DISTINCT FROM OLD.full_name THEN
  UPDATE public.teacher_profiles SET full_name=NEW.full_name,last_game_id=NEW.game_id,updated_at=now()
   WHERE user_id=NEW.user_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER teacher_member_persist AFTER INSERT OR UPDATE OF full_name,kind ON public.game_members
 FOR EACH ROW EXECUTE FUNCTION private.teacher_member_persist();

CREATE OR REPLACE FUNCTION private.teacher_game_profile_persist()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.game_members m
  WHERE m.game_id=NEW.game_id AND m.user_id=NEW.user_id AND m.kind='teacher') THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN
  INSERT INTO public.teacher_profiles(user_id,full_name,bio,gender,avatar_path,signature_path,last_game_id)
   SELECT m.user_id,m.full_name,NEW.bio,NEW.gender,NEW.avatar_path,NEW.signature_path,NEW.game_id
   FROM public.game_members m WHERE m.game_id=NEW.game_id AND m.user_id=NEW.user_id
   ON CONFLICT(user_id) DO NOTHING;
 ELSE
  UPDATE public.teacher_profiles SET
   bio=NEW.bio,gender=NEW.gender,avatar_path=NEW.avatar_path,signature_path=NEW.signature_path,
   last_game_id=NEW.game_id,updated_at=now() WHERE user_id=NEW.user_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER teacher_game_profile_persist AFTER INSERT OR UPDATE OF bio,gender,avatar_path,signature_path ON public.game_profiles
 FOR EACH ROW EXECUTE FUNCTION private.teacher_game_profile_persist();

-- A game cannot be physically deleted while its media backs a permanent profile.
CREATE OR REPLACE FUNCTION private.prevent_teacher_asset_loss()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.teacher_profiles t WHERE
   t.avatar_path LIKE OLD.id::text||'/%' OR t.signature_path LIKE OLD.id::text||'/%') THEN
  RAISE EXCEPTION 'Фотография или подпись преподавателя привязана к этой игре. Архивируйте игру.';
 END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER prevent_teacher_asset_loss BEFORE DELETE ON public.games
 FOR EACH ROW EXECUTE FUNCTION private.prevent_teacher_asset_loss();

CREATE OR REPLACE FUNCTION public.archive_my_teacher_game(p_game uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
DECLARE g public.games%rowtype;
BEGIN
 IF auth.uid() IS NULL OR coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
 THEN RAISE EXCEPTION 'Необходим личный вход преподавателя'; END IF;
 SELECT * INTO g FROM public.games WHERE id=p_game FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Игра не найдена'; END IF;
 IF g.owner_id<>auth.uid() AND NOT private.is_platform_admin()
 THEN RAISE EXCEPTION 'Архивация доступна только владельцу игры'; END IF;
 UPDATE public.games SET status='archived',turn_open=false,turn_ends_at=NULL WHERE id=p_game;
END $$;
REVOKE ALL ON FUNCTION public.archive_my_teacher_game(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.archive_my_teacher_game(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.list_my_teacher_games()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := (select auth.uid());
  v_admin boolean;
  v_allowed boolean;
  v_games jsonb;
begin
  if v_user is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,true)
  then
    raise exception 'Войдите с подтверждённой почтой и личным паролем';
  end if;

  v_admin := private.is_platform_admin();
  v_allowed := v_admin
    or exists (select 1 from public.teacher_profiles tp where tp.user_id=v_user)
    or exists (select 1 from public.games g where g.owner_id=v_user)
    or exists (
      select 1 from public.game_members gm
      where gm.user_id=v_user and gm.kind='teacher'
        and gm.roster_archived_at is null
    );
  if not v_allowed then
    raise exception 'Кабинет доступен только преподавателю или администратору';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object('id',g.id,'title',g.title,
      'status',g.status,'created_at',g.created_at)
    order by g.created_at desc,g.id desc
  ),'[]'::jsonb)
  into v_games
  from public.games g
  where v_admin or g.owner_id=v_user or exists (
    select 1 from public.game_members gm
    where gm.game_id=g.id and gm.user_id=v_user
      and gm.kind='teacher' and gm.roster_archived_at is null
  );
  return jsonb_build_object('is_admin',v_admin,'games',v_games);
end;
$function$

REVOKE ALL ON FUNCTION public.list_my_teacher_games() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_my_teacher_games() TO authenticated;
