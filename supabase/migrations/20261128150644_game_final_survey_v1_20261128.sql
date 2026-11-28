-- Final survey V1. No scoring trigger or realtime subscription.
CREATE TABLE public.game_final_surveys (
 game_id uuid NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 version integer NOT NULL DEFAULT 1 CHECK(version=1),
 answers jsonb NOT NULL,
 proposal text NOT NULL,
 word_count integer NOT NULL CHECK(word_count>=300),
 role_title text, team text, group_name text,
 submitted_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(game_id,user_id)
);
ALTER TABLE public.game_final_surveys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.game_final_surveys FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.game_final_surveys TO authenticated;
CREATE POLICY final_survey_read ON public.game_final_surveys FOR SELECT TO authenticated USING (
 private.is_game_teacher(game_id) OR
 (user_id=(SELECT auth.uid()) AND EXISTS(SELECT 1 FROM public.game_members m WHERE m.game_id=game_final_surveys.game_id AND m.user_id=game_final_surveys.user_id AND m.kind='student' AND m.roster_archived_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM public.game_member_access_blocks b WHERE b.game_id=game_final_surveys.game_id AND b.user_id=(SELECT auth.uid())))
);
CREATE FUNCTION private.final_survey_validate(p_answers jsonb,p_proposal text) RETURNS integer
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $f$
DECLARE i int; v jsonb; words int; upper_bound int; 
BEGIN
 IF p_answers IS NULL OR jsonb_typeof(p_answers) IS DISTINCT FROM 'array' OR jsonb_array_length(p_answers)<>40 THEN RAISE EXCEPTION 'Ответьте на все 40 вопросов'; END IF;
 FOR i IN 0..39 LOOP
  v:=p_answers->i;
  IF i IN (36,37,38) THEN
   upper_bound:=CASE WHEN i=36 THEN 16 ELSE 8 END;
   IF jsonb_typeof(v) IS DISTINCT FROM 'array' OR jsonb_array_length(v) NOT BETWEEN 1 AND upper_bound THEN RAISE EXCEPTION 'Выберите ответ на вопрос %',i+1; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(v) x WHERE jsonb_typeof(x)<>'number' OR x::text !~ '^(0|[1-9][0-9]?)$' OR (x::text)::int NOT BETWEEN 0 AND upper_bound) OR (SELECT count(DISTINCT x) FROM jsonb_array_elements(v) x)<>jsonb_array_length(v) OR (v @> '[0]'::jsonb AND jsonb_array_length(v)<>1) THEN RAISE EXCEPTION 'Недопустимый ответ на вопрос %',i+1; END IF;
  ELSE
   IF jsonb_typeof(v) IS DISTINCT FROM 'number' OR v::text !~ '^(0|[1-9][0-9]?)$' THEN RAISE EXCEPTION 'Ответьте на вопрос %',i+1; END IF;
   IF (v::text)::int NOT BETWEEN (CASE WHEN i=39 THEN 1 ELSE 0 END) AND (CASE WHEN i=39 THEN 10 ELSE 5 END) THEN RAISE EXCEPTION 'Недопустимый ответ на вопрос %',i+1; END IF;
  END IF;
 END LOOP;
 IF p_proposal IS NULL OR char_length(p_proposal)>40000 THEN RAISE EXCEPTION 'Текст предложения превышает допустимый объём'; END IF;
 SELECT count(*)::int INTO words FROM regexp_matches(p_proposal,'[[:alnum:]]+([-–][[:alnum:]]+)*','g');
 IF words<300 THEN RAISE EXCEPTION 'Минимальный объём предложения — 300 слов'; END IF;
 RETURN words;
END $f$;
REVOKE ALL ON FUNCTION private.final_survey_validate(jsonb,text) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.submit_game_final_survey(p_game_id uuid,p_answers jsonb,p_proposal text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE uid uuid:=(SELECT auth.uid()); member public.game_members%rowtype; words int;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'Требуется вход в игру'; END IF;
 PERFORM 1 FROM public.game_stages WHERE game_id=p_game_id AND stage_no=16 AND status='open' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Анкетирование доступно на открытом этапе 16'; END IF;
 SELECT * INTO member FROM public.game_members WHERE game_id=p_game_id AND user_id=uid AND kind='student' AND roster_archived_at IS NULL FOR SHARE;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM public.game_member_access_blocks WHERE game_id=p_game_id AND user_id=uid) THEN RAISE EXCEPTION 'Анкета доступна только действующим участникам'; END IF;
 words:=private.final_survey_validate(p_answers,p_proposal);
 INSERT INTO public.game_final_surveys(game_id,user_id,answers,proposal,word_count,role_title,team,group_name)
 VALUES(p_game_id,uid,p_answers,btrim(p_proposal),words,member.role_title,member.team,member.group_name)
 ON CONFLICT(game_id,user_id) DO NOTHING;
 -- A repeated request may be a network retry. It cannot overwrite a submitted response.
 SELECT word_count INTO words FROM public.game_final_surveys WHERE game_id=p_game_id AND user_id=uid;
 RETURN words;
END $f$;
REVOKE ALL ON FUNCTION public.submit_game_final_survey(uuid,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_game_final_survey(uuid,jsonb,text) TO authenticated;
