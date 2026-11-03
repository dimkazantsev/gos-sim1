-- Protect only published storyline news, leaving all other political posts unchanged.
-- RLS checks are evaluated during existing SQL operations; no background jobs.
CREATE POLICY story_posts_protected_update
ON public.political_posts AS RESTRICTIVE FOR UPDATE TO authenticated
USING (
 coalesce(context->>'story_campaign','false') <> 'true'
 OR private.is_game_teacher(game_id)
)
WITH CHECK (
 coalesce(context->>'story_campaign','false') <> 'true'
 OR private.is_game_teacher(game_id)
);
CREATE POLICY story_posts_protected_delete
ON public.political_posts AS RESTRICTIVE FOR DELETE TO authenticated
USING (
 coalesce(context->>'story_campaign','false') <> 'true'
 OR private.is_game_teacher(game_id)
);
