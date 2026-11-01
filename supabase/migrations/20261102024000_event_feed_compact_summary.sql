-- ГОС.ID: компактный индекс ленты без выдачи полного содержания кейсов.
-- Доступ к названиям повторяет list_visible_event_cases; числовые итоги доступны только преподавателю.
CREATE OR REPLACE FUNCTION public.event_feed_compact_summary(
 p_game_id uuid, p_case_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
 v_teacher boolean;
 v_titles jsonb;
 v_positive integer := 0;
 v_negative integer := 0;
BEGIN
 IF (SELECT auth.uid()) IS NULL OR p_game_id IS NULL OR p_case_ids IS NULL
   OR cardinality(p_case_ids) > 400 OR NOT private.is_game_member(p_game_id) THEN
  RAISE EXCEPTION 'Нет доступа к игре или неверный запрос.' USING errcode='42501';
 END IF;
 v_teacher := private.is_game_teacher(p_game_id);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'title',c.title) ORDER BY c.id),'[]'::jsonb)
 INTO v_titles
 FROM public.event_cases c
 WHERE c.game_id=p_game_id AND c.id=ANY(p_case_ids)
   AND (v_teacher OR (private.is_game_member(c.game_id) AND private.assigned_game_case(c.id,c.game_id)));
 IF v_teacher THEN
  SELECT count(*) FILTER(WHERE score>0),count(*) FILTER(WHERE score<0)
  INTO v_positive,v_negative
  FROM (
   SELECT coalesce((
    c.effect_plan->'options'->(
     CASE WHEN d.choice='accept' THEN 0
          WHEN d.choice='reject' THEN 1
          WHEN d.choice ~ '^option_[0-9]+$' THEN substring(d.choice from 8)::integer-1
          ELSE NULL END
    )->>'trust'
   )::numeric,0) AS score
   FROM public.event_decisions d
   INNER JOIN public.event_cases c ON c.id=d.case_id AND c.game_id=d.game_id
   WHERE d.game_id=p_game_id
  ) evaluated;
 END IF;
 RETURN jsonb_build_object('titles',v_titles,
   'positive',CASE WHEN v_teacher THEN v_positive ELSE NULL END,
   'negative',CASE WHEN v_teacher THEN v_negative ELSE NULL END);
END $fn$;
REVOKE ALL ON FUNCTION public.event_feed_compact_summary(uuid,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.event_feed_compact_summary(uuid,uuid[]) TO authenticated;
