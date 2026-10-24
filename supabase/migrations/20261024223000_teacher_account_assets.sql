-- Teacher identity files live independently of game sessions.
-- No existing file is deleted or relinked by this migration.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('teacher-assets','teacher-assets',false,5242880,ARRAY['image/png','image/webp']::text[])
ON CONFLICT(id) DO NOTHING;

-- Personal assets are readable by the owner and by members of a game in
-- which the account acts as a teacher; never by unrelated authenticated users.
CREATE POLICY teacher_assets_member_read ON storage.objects FOR SELECT TO authenticated
USING (
 bucket_id='teacher-assets' AND (
   split_part(name,'/',1)=(select auth.uid())::text
   OR EXISTS(
     SELECT 1 FROM public.game_members tm
     WHERE tm.user_id::text=split_part(name,'/',1)
       AND tm.kind='teacher'
       AND private.is_game_member(tm.game_id)
   )
 )
);
CREATE POLICY teacher_assets_owner_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
 bucket_id='teacher-assets'
 AND name ~ '^[0-9a-f-]{36}/(avatar-[0-9a-f-]{36}[.]webp|signature-[0-9a-f-]{36}[.]png)$'
 AND split_part(name,'/',1)=(select auth.uid())::text
 AND NOT coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
 AND EXISTS(SELECT 1 FROM public.teacher_profiles t WHERE t.user_id=(select auth.uid()))
);
CREATE POLICY teacher_assets_owner_delete ON storage.objects FOR DELETE TO authenticated
USING (
 bucket_id='teacher-assets'
 AND split_part(name,'/',1)=(select auth.uid())::text
 AND NOT coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
 AND EXISTS(SELECT 1 FROM public.teacher_profiles t WHERE t.user_id=(select auth.uid()))
);

-- Changes made from the permanent account profile also reach all games.
CREATE OR REPLACE FUNCTION private.teacher_profile_sync_games()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
BEGIN
 IF pg_trigger_depth()>1 THEN RETURN NEW; END IF;
 UPDATE public.game_profiles p
 SET bio=NEW.bio,gender=COALESCE(NEW.gender,'unspecified'),
     avatar_path=NEW.avatar_path,signature_path=NEW.signature_path,updated_at=now()
 FROM public.game_members gm
 WHERE gm.game_id=p.game_id AND gm.user_id=p.user_id
   AND gm.kind='teacher' AND gm.user_id=NEW.user_id
   AND (p.bio,p.gender,p.avatar_path,p.signature_path)
       IS DISTINCT FROM (NEW.bio,COALESCE(NEW.gender,'unspecified'),NEW.avatar_path,NEW.signature_path);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS teacher_profile_sync_games ON public.teacher_profiles;
CREATE TRIGGER teacher_profile_sync_games
AFTER UPDATE OF bio,gender,avatar_path,signature_path ON public.teacher_profiles
FOR EACH ROW EXECUTE FUNCTION private.teacher_profile_sync_games();

-- A change in any teacher's game profile is also propagated to their other
-- games. Nested updates must not bounce back and overwrite the master.
CREATE OR REPLACE FUNCTION private.teacher_game_profile_persist()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
DECLARE teacher_name text;
BEGIN
 IF pg_trigger_depth()>1 THEN RETURN NEW; END IF;
 SELECT gm.full_name INTO teacher_name FROM public.game_members gm
 WHERE gm.game_id=NEW.game_id AND gm.user_id=NEW.user_id AND gm.kind='teacher';
 IF NOT FOUND THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN
   INSERT INTO public.teacher_profiles(user_id,full_name,bio,gender,avatar_path,signature_path,last_game_id)
   VALUES(NEW.user_id,teacher_name,NEW.bio,NEW.gender,NEW.avatar_path,NEW.signature_path,NEW.game_id)
   ON CONFLICT(user_id) DO NOTHING;
 ELSE
   UPDATE public.teacher_profiles
   SET bio=NEW.bio,gender=NEW.gender,avatar_path=NEW.avatar_path,
       signature_path=NEW.signature_path,last_game_id=NEW.game_id,updated_at=now()
   WHERE user_id=NEW.user_id;
   UPDATE public.game_profiles p
   SET bio=NEW.bio,gender=NEW.gender,avatar_path=NEW.avatar_path,
       signature_path=NEW.signature_path,updated_at=now()
   FROM public.game_members gm
   WHERE gm.game_id=p.game_id AND gm.user_id=p.user_id AND gm.kind='teacher'
     AND p.user_id=NEW.user_id AND p.game_id<>NEW.game_id
     AND (p.bio,p.gender,p.avatar_path,p.signature_path)
          IS DISTINCT FROM (NEW.bio,NEW.gender,NEW.avatar_path,NEW.signature_path);
 END IF;
 RETURN NEW;
END $$;

-- An existing physical object must first be copied to the account bucket.
-- Stale paths without any Storage object must not make a game undeletable.
CREATE OR REPLACE FUNCTION private.prevent_teacher_asset_loss()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
BEGIN
 IF EXISTS(
   SELECT 1 FROM public.teacher_profiles t
   JOIN storage.objects o ON o.bucket_id='game-assets'
     AND (o.name=t.avatar_path OR o.name=t.signature_path)
   WHERE t.avatar_path LIKE OLD.id::text||'/%'
      OR t.signature_path LIKE OLD.id::text||'/%'
 ) THEN
   RAISE EXCEPTION 'Фотография или подпись преподавателя ещё хранится в этой игре. Сначала перенесите личные файлы.';
 END IF;
 RETURN OLD;
END $$;

-- Repair inherited teacher paths for all games, without rewriting any documents.
UPDATE public.game_profiles p
SET avatar_path=t.avatar_path,signature_path=t.signature_path
FROM public.teacher_profiles t,public.game_members gm
WHERE gm.game_id=p.game_id AND gm.user_id=p.user_id
  AND gm.kind='teacher' AND t.user_id=p.user_id
  AND (p.avatar_path,p.signature_path) IS DISTINCT FROM (t.avatar_path,t.signature_path);
