-- Separate technical verification from independent legal review.
-- Existing 1000 questions remain pending and cannot be issued until explicitly approved.
ALTER TABLE public.blitz_questions
 ADD COLUMN IF NOT EXISTS legal_review_status text NOT NULL DEFAULT 'pending',
 ADD COLUMN IF NOT EXISTS legal_reviewed_at timestamptz,
 ADD COLUMN IF NOT EXISTS legal_reviewed_by uuid,
 ADD COLUMN IF NOT EXISTS legal_review_note text;

DO $$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM pg_constraint
  WHERE conrelid='public.blitz_questions'::regclass
    AND conname='blitz_questions_legal_review_status_check'
 ) THEN
  ALTER TABLE public.blitz_questions
   ADD CONSTRAINT blitz_questions_legal_review_status_check
   CHECK (legal_review_status IN ('pending','approved','rejected'));
 END IF;
END $$;

UPDATE public.blitz_questions
SET legal_review_status='pending',legal_reviewed_at=NULL,legal_reviewed_by=NULL
WHERE legal_review_status IS DISTINCT FROM 'approved';

CREATE INDEX IF NOT EXISTS blitz_questions_release_pool_idx
 ON public.blitz_questions(verified,legal_review_status,id)
 WHERE verified=true AND legal_review_status='approved';

CREATE OR REPLACE FUNCTION public.blitz_issue_for_day(p_game uuid,p_student uuid,p_day date,p_stage integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE n integer; ids bigint[]; inserted_count integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.game_members m WHERE m.game_id=p_game AND m.user_id=p_student AND m.kind='student') THEN RETURN 0; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('blitz:'||p_game||':'||p_student||':'||p_day,0));
 IF EXISTS(SELECT 1 FROM public.blitz_daily_plans WHERE game_id=p_game AND user_id=p_student AND assigned_day=p_day) THEN RETURN 0; END IF;
 n:=3+floor(random()*3)::integer;
 SELECT array_agg(q.id) INTO ids FROM (
  SELECT ranked.id FROM (
   SELECT z.id,z.topic,row_number() OVER(PARTITION BY z.topic ORDER BY random()) AS per_topic
   FROM public.blitz_questions z
   WHERE z.verified
     AND z.legal_review_status='approved'
     AND NOT EXISTS(
       SELECT 1 FROM public.blitz_assignments a
       WHERE a.game_id=p_game AND a.user_id=p_student AND a.question_id=z.id
     )
  ) ranked WHERE ranked.per_topic=1 ORDER BY random() LIMIT n
 ) q;
 IF coalesce(array_length(ids,1),0)<>n THEN RETURN 0; END IF;
 INSERT INTO public.blitz_daily_plans(game_id,user_id,assigned_day,stage_no,target_count)
 VALUES(p_game,p_student,p_day,p_stage,n);
 INSERT INTO public.blitz_assignments(game_id,user_id,question_id,stage_no,assigned_day,available_at)
 SELECT p_game,p_student,unnest(ids),p_stage,p_day,
 (p_day::timestamp + interval '9 hours' + random()*interval '12 hours') at time zone 'Europe/Moscow';
 GET DIAGNOSTICS inserted_count=row_count;
 RETURN inserted_count;
END $$;
REVOKE ALL ON FUNCTION public.blitz_issue_for_day(uuid,uuid,date,integer) FROM public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.blitz_teacher_questions(p_game uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE payload jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS (
  SELECT 1 FROM public.game_members m
  WHERE m.game_id=p_game AND m.user_id=auth.uid() AND m.kind='teacher'
 ) THEN RAISE EXCEPTION 'Forbidden' USING errcode='42501'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.id),'[]'::jsonb) INTO payload
 FROM (
  SELECT id,topic,question,options,correct_index,legal_act,article,source_url,explanation,
         verified,legal_review_status,legal_reviewed_at,legal_review_note
  FROM public.blitz_questions ORDER BY id LIMIT 2000
 ) q;
 RETURN payload;
END $$;
REVOKE ALL ON FUNCTION public.blitz_teacher_questions(uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.blitz_teacher_questions(uuid) TO authenticated;
