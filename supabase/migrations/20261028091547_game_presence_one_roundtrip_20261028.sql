-- One authenticated request updates online presence and, on navigation,
-- records the same activity event that used to require a second HTTP call.
-- SECURITY INVOKER preserves RLS and both existing observer guard triggers.
-- The presence trigger continues to accrue achievement time exactly as before.
CREATE OR REPLACE FUNCTION public.record_my_game_presence(
 p_game_id uuid,
 p_view text,
 p_label text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
 IF auth.uid() IS NULL THEN
  RAISE EXCEPTION 'Authentication required' USING ERRCODE='28000';
 END IF;
 INSERT INTO public.game_presence(game_id,user_id,current_view,last_seen_at)
 VALUES (p_game_id,auth.uid(),p_view,clock_timestamp())
 ON CONFLICT (game_id,user_id) DO UPDATE
  SET current_view=EXCLUDED.current_view,
      last_seen_at=EXCLUDED.last_seen_at;
 IF p_label IS NOT NULL AND p_label <> '' THEN
  INSERT INTO public.game_activity(game_id,actor_id,event_type,label,view_key,payload)
  VALUES(p_game_id,auth.uid(),'navigation',p_label,p_view,'{}'::jsonb);
 END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_my_game_presence(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_my_game_presence(uuid,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_my_game_presence(uuid,text,text) TO authenticated;
COMMENT ON FUNCTION public.record_my_game_presence(uuid,text,text)
 IS 'Atomic navigation presence + activity via existing RLS, with no duplicate network call.';
