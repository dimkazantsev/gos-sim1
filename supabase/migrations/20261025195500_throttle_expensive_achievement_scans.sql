-- Avoid repeated full-table achievement scans when the same player keeps
-- multiple tabs open or reconnects during PostgREST pool pressure.
CREATE TABLE IF NOT EXISTS private.achievement_evaluation_gate(
 game_id uuid NOT NULL,
 user_id uuid NOT NULL,
 evaluated_at timestamptz NOT NULL,
 PRIMARY KEY(game_id,user_id)
);
ALTER TABLE private.achievement_evaluation_gate ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.achievement_evaluation_gate FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.evaluate_game_achievements(p_game_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path='public','private','pg_temp' AS $evaluate$
DECLARE
 v_user uuid:=(SELECT auth.uid());
 f jsonb;
 c record;
 ok boolean;
 k record;
 added integer:=0;
 permitted boolean;
BEGIN
 IF v_user IS NULL OR NOT EXISTS(
  SELECT 1 FROM public.game_members
  WHERE game_id=p_game_id AND user_id=v_user AND kind='student'
 ) THEN RETURN 0;END IF;
 -- Unique row+conditional update serialises calls across browser tabs and
 -- skips expensive facts collection for eight minutes per game and user.
 INSERT INTO private.achievement_evaluation_gate(game_id,user_id,evaluated_at)
 VALUES(p_game_id,v_user,now())
 ON CONFLICT(game_id,user_id) DO UPDATE
 SET evaluated_at=excluded.evaluated_at
 WHERE private.achievement_evaluation_gate.evaluated_at <= now()-interval '8 minutes'
 RETURNING true INTO permitted;
 IF NOT coalesce(permitted,false) THEN RETURN 0;END IF;
 f:=private.achievement_facts(p_game_id,v_user);
 FOR c IN SELECT * FROM private.achievement_catalog c0
  WHERE NOT EXISTS(
   SELECT 1 FROM public.game_achievements a
   WHERE a.game_id=p_game_id AND a.user_id=v_user AND a.achievement_id=c0.id
  )
 LOOP
  ok:=true;
  FOR k IN SELECT * FROM jsonb_each_text(c.conditions)
  LOOP
   IF coalesce((f->>k.key)::numeric,0)<k.value::numeric THEN
    ok:=false;EXIT;
   END IF;
  END LOOP;
  IF ok THEN
   INSERT INTO public.game_achievements(game_id,user_id,achievement_id)
   VALUES(p_game_id,v_user,c.id) ON CONFLICT DO NOTHING;
   IF FOUND THEN added:=added+1;END IF;
  END IF;
 END LOOP;
 RETURN added;
END;$evaluate$;
REVOKE ALL ON FUNCTION public.evaluate_game_achievements(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.evaluate_game_achievements(uuid) TO authenticated;
