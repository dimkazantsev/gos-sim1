-- Only the STRUCTURE is committed to the public repository.
-- Future episodes, documents, endings and coefficients MUST NEVER be committed.
-- No triggers, cron jobs, realtime subscriptions, or automatic polling.
CREATE TABLE IF NOT EXISTS private.story_campaigns (
 game_id uuid PRIMARY KEY REFERENCES public.games(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT false,
 current_episode integer NOT NULL DEFAULT 0 CHECK(current_episode BETWEEN 0 AND 24),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 prepared_by uuid NOT NULL,
 prepared_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT story_campaign_locked_until_approved CHECK (NOT enabled)
);
CREATE TABLE IF NOT EXISTS private.story_episode_drafts (
 episode_no integer PRIMARY KEY CHECK(episode_no BETWEEN 1 AND 24),
 stage_no integer NOT NULL CHECK(stage_no BETWEEN 4 AND 14),
 draft jsonb NOT NULL DEFAULT '{}'::jsonb,
 approved boolean NOT NULL DEFAULT false CHECK (NOT approved),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.story_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.story_episode_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.story_campaigns,private.story_episode_drafts FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_story_campaign_teacher(p_game_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE r private.story_campaigns%rowtype; n integer;
BEGIN
 IF auth.uid() IS NULL OR NOT private.is_game_teacher(p_game_id) THEN
  RAISE EXCEPTION 'Доступ разрешён только преподавателю игры.' USING ERRCODE='42501';
 END IF;
 SELECT * INTO r FROM private.story_campaigns WHERE game_id=p_game_id;
 SELECT count(*) INTO n FROM private.story_episode_drafts WHERE approved;
 RETURN jsonb_build_object(
  'prepared',r.game_id IS NOT NULL,
  'enabled',coalesce(r.enabled,false),
  'current_episode',coalesce(r.current_episode,0),
  'approved_episodes',n,
  'total_episodes',24,
  'metrics_enabled',false,
  'publication_enabled',false
 );
END $fn$;

CREATE OR REPLACE FUNCTION public.prepare_story_campaign_teacher(p_game_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $fn$
BEGIN
 IF auth.uid() IS NULL OR NOT private.is_game_teacher(p_game_id) THEN
  RAISE EXCEPTION 'Доступ разрешён только преподавателю игры.' USING ERRCODE='42501';
 END IF;
 INSERT INTO private.story_campaigns(game_id,prepared_by)
 VALUES(p_game_id,auth.uid())
 ON CONFLICT(game_id) DO NOTHING;
 RETURN public.get_story_campaign_teacher(p_game_id);
END $fn$;

REVOKE ALL ON FUNCTION public.get_story_campaign_teacher(uuid),public.prepare_story_campaign_teacher(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_story_campaign_teacher(uuid),public.prepare_story_campaign_teacher(uuid) TO authenticated;
COMMENT ON TABLE private.story_episode_drafts IS 'Private storyboard content only. No future text or metrics are served to participants.';
COMMENT ON TABLE private.story_campaigns IS 'Teacher-only, inactive-by-default campaign shell with no triggers or pollers.';
