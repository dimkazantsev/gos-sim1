BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE IF NOT EXISTS private.event_editorial_release_20261025(case_key text PRIMARY KEY,doc jsonb NOT NULL,CHECK(doc->>'case_key'=case_key));
CREATE TABLE IF NOT EXISTS private.event_editorial_catalog_backup_20261024(case_key text PRIMARY KEY,content jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS private.event_editorial_game_backup_20261024(id uuid PRIMARY KEY,saved_row jsonb NOT NULL);
ALTER TABLE private.event_editorial_release_20261025 ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.event_editorial_catalog_backup_20261024 ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.event_editorial_game_backup_20261024 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.event_editorial_release_20261025,private.event_editorial_catalog_backup_20261024,private.event_editorial_game_backup_20261024 FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION private.seed_authored_event_bank(p_game uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $seed$
DECLARE added integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.games WHERE id=p_game) THEN RAISE EXCEPTION 'Игра недоступна'; END IF;
 INSERT INTO public.event_cases(game_id,case_key,title,situation,category,seriousness,audience,allowed_roles,
  decision_options,effect_plan,comic_scene,source_note,source_url,verified,status)
 SELECT p_game,cat.case_key,cat.content->>'title',cat.content->>'situation',cat.content->>'category',cat.content->>'seriousness',
  cat.content->>'audience',ARRAY(SELECT jsonb_array_elements_text(cat.content->'allowed_roles')),
  cat.content->'decision_options',cat.content->'effect_plan',cat.content->'comic_scene',cat.content->>'source_note',cat.content->>'source_url',false,'ready'
 FROM private.authored_event_catalog cat
 WHERE NOT EXISTS(SELECT 1 FROM public.retired_event_cases r WHERE r.game_id=p_game AND r.case_key=cat.case_key)
 ON CONFLICT(game_id,case_key) DO NOTHING;
 GET DIAGNOSTICS added=ROW_COUNT;
 RETURN added;
END;
$seed$;
REVOKE ALL ON FUNCTION private.seed_authored_event_bank(uuid) FROM PUBLIC,anon,authenticated;
COMMIT;
