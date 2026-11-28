ALTER POLICY final_survey_read ON public.game_final_surveys USING (
 private.is_game_teacher(game_id) OR
 (user_id=(SELECT auth.uid()) AND private.is_game_member(game_id)
 AND EXISTS(SELECT 1 FROM public.game_members m WHERE m.game_id=game_final_surveys.game_id AND m.user_id=game_final_surveys.user_id AND m.kind='student' AND m.roster_archived_at IS NULL))
);
