-- ГОС.ID / presidential election. Stage 6: individual students' decisions
-- and three consecutive calendar dates appointed by the Federation Council.
-- Historical GD proposals and their signed acts remain immutable.
CREATE TABLE IF NOT EXISTS public.presidential_student_system_votes(
 game_id uuid NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
 user_id uuid NOT NULL,
 system_type text NOT NULL CHECK(system_type IN ('relative','absolute','qualified','preferential')),
 threshold_pct numeric,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(game_id,user_id),
 CHECK(system_type<>'qualified' OR threshold_pct BETWEEN 51 AND 100)
);
CREATE INDEX IF NOT EXISTS presidential_student_system_votes_game_idx ON public.presidential_student_system_votes(game_id);
CREATE TABLE IF NOT EXISTS public.presidential_student_system_result(
 game_id uuid PRIMARY KEY REFERENCES public.games(id) ON DELETE CASCADE,
 system_type text NOT NULL,
 threshold_pct numeric,
 votes_total int NOT NULL,
 tally jsonb NOT NULL,
 finalized_at timestamptz NOT NULL DEFAULT now(),
 finalized_by uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.presidential_election_schedule(
 game_id uuid PRIMARY KEY REFERENCES public.games(id) ON DELETE CASCADE,
 first_day date NOT NULL,
 voting_day date GENERATED ALWAYS AS (first_day+2) STORED,
 appointment_document_id uuid REFERENCES public.formal_documents(id),
 updated_by uuid NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.presidential_student_system_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presidential_student_system_result ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presidential_election_schedule ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.presidential_student_system_votes,public.presidential_student_system_result,public.presidential_election_schedule FROM anon,authenticated;
-- Information is exposed through checked RPCs, never by direct student SELECT/UPDATE.

CREATE OR REPLACE FUNCTION public.cast_presidential_student_system_vote(
 p_game_id uuid,p_system_type text,p_threshold_pct numeric DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,private,pg_temp AS $fn$
DECLARE v_uid uuid:=auth.uid();
BEGIN
 IF v_uid IS NULL OR NOT EXISTS(
   SELECT 1 FROM public.game_members m WHERE m.game_id=p_game_id
   AND m.user_id=v_uid AND m.kind='student' AND m.roster_archived_at IS NULL)
 THEN RAISE EXCEPTION 'Голосовать вправе только действующие участники от своего имени' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.game_stages WHERE game_id=p_game_id AND stage_no=6 AND status='open')
 THEN RAISE EXCEPTION 'Голосование относится к открытому шестому этапу';END IF;
 IF EXISTS(SELECT 1 FROM public.presidential_student_system_result WHERE game_id=p_game_id)
 THEN RAISE EXCEPTION 'Решение студентов уже утверждено';END IF;
 IF p_system_type NOT IN ('relative','absolute','qualified','preferential')
 OR (p_system_type='qualified' AND (p_threshold_pct IS NULL OR p_threshold_pct NOT BETWEEN 51 AND 100))
 THEN RAISE EXCEPTION 'Выберите допустимую избирательную систему и порог';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('presidential-student-vote:'||p_game_id::text,0));
 IF EXISTS(SELECT 1 FROM public.presidential_student_system_result WHERE game_id=p_game_id)
 THEN RAISE EXCEPTION 'Голосование закрыто';END IF;
 INSERT INTO public.presidential_student_system_votes(game_id,user_id,system_type,threshold_pct)
 VALUES(p_game_id,v_uid,p_system_type,CASE WHEN p_system_type='qualified' THEN p_threshold_pct END)
 ON CONFLICT(game_id,user_id) DO UPDATE SET system_type=excluded.system_type,
 threshold_pct=excluded.threshold_pct,updated_at=now();
END;$fn$;

CREATE OR REPLACE FUNCTION public.get_presidential_student_system_vote(p_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,private,pg_temp AS $fn$
DECLARE v_uid uuid:=auth.uid();v_choice record;v_result jsonb;v_count int;
BEGIN
 IF v_uid IS NULL OR NOT private.is_game_member(p_game_id) THEN RAISE EXCEPTION 'Доступ к игре обязателен' USING ERRCODE='42501';END IF;
 SELECT system_type,threshold_pct INTO v_choice FROM public.presidential_student_system_votes
 WHERE game_id=p_game_id AND user_id=v_uid;
 SELECT to_jsonb(r) INTO v_result FROM public.presidential_student_system_result r WHERE r.game_id=p_game_id;
 SELECT count(*) INTO v_count FROM public.presidential_student_system_votes WHERE game_id=p_game_id;
 RETURN jsonb_build_object('my_system',v_choice.system_type,'my_threshold',v_choice.threshold_pct,
   'votes_count',v_count,'result',v_result,
   'closed',v_result IS NOT NULL);
END;$fn$;

CREATE OR REPLACE FUNCTION public.finalize_presidential_student_system_vote(p_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,private,pg_temp AS $fn$
DECLARE v_uid uuid:=auth.uid();v_winner text;v_top int;v_ties int;v_total int;v_threshold numeric;v_tally jsonb;v_poll boolean;v_return jsonb;
BEGIN
 PERFORM private.require_active_presidential_teacher(p_game_id);
 IF NOT private.is_game_teacher(p_game_id) THEN RAISE EXCEPTION 'Решение утверждает преподаватель';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('presidential-student-vote:'||p_game_id::text,0));
 IF EXISTS(SELECT 1 FROM public.presidential_student_system_result WHERE game_id=p_game_id)
 THEN RAISE EXCEPTION 'Итоги личного голосования уже утверждены';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.presidential_election_schedule WHERE game_id=p_game_id)
 THEN RAISE EXCEPTION 'Сначала Совет Федерации должен назначить даты выборов';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.presidential_poll_decision WHERE game_id=p_game_id AND status='closed')
 THEN RAISE EXCEPTION 'Сначала завершите личное голосование о социологическом опросе';END IF;
 SELECT result INTO v_poll FROM public.presidential_poll_decision WHERE game_id=p_game_id;
 SELECT count(*) INTO v_total FROM public.presidential_student_system_votes WHERE game_id=p_game_id;
 IF v_total=0 THEN RAISE EXCEPTION 'Студенты ещё не проголосовали'; END IF;
 WITH tally AS (
  SELECT system_type,count(*)::int n FROM public.presidential_student_system_votes
  WHERE game_id=p_game_id GROUP BY system_type
 ) SELECT system_type,n INTO v_winner,v_top FROM tally ORDER BY n DESC,system_type LIMIT 1;
 SELECT count(*) INTO v_ties FROM
  (SELECT system_type FROM public.presidential_student_system_votes
   WHERE game_id=p_game_id GROUP BY system_type HAVING count(*)=v_top) t;
 IF v_ties<>1 THEN RAISE EXCEPTION 'Голоса разделились поровну. Требуется повторное личное голосование студентов';END IF;
 SELECT coalesce(jsonb_object_agg(system_type,n),'{}'::jsonb) INTO v_tally FROM
 (SELECT system_type,count(*)::int n FROM public.presidential_student_system_votes WHERE game_id=p_game_id GROUP BY system_type)t;
 IF v_winner='qualified' THEN
  SELECT round(avg(threshold_pct),0) INTO v_threshold
  FROM public.presidential_student_system_votes WHERE game_id=p_game_id AND system_type='qualified';
 END IF;
 INSERT INTO public.presidential_student_system_result(game_id,system_type,threshold_pct,votes_total,tally,finalized_by)
 VALUES(p_game_id,v_winner,v_threshold,v_total,v_tally,v_uid);
 INSERT INTO public.presidential_election_settings(game_id,system_type,threshold_pct,poll_enabled,status,updated_by)
 VALUES(p_game_id,v_winner,coalesce(v_threshold,50),coalesce(v_poll,false),'setup',v_uid)
 ON CONFLICT(game_id) DO UPDATE SET
  system_type=excluded.system_type,threshold_pct=excluded.threshold_pct,
  poll_enabled=excluded.poll_enabled,updated_at=now(),updated_by=v_uid;
 RETURN jsonb_build_object('system_type',v_winner,'threshold_pct',v_threshold,'votes_total',v_total,'tally',v_tally,'poll_enabled',v_poll);
END;$fn$;

-- Adapt the EXISTING Senate date-issued document RPC (no duplicate legal act).
-- Only route its document, post and existence checks to stage 6.
DO $patch$
DECLARE v_def text;
BEGIN
 SELECT pg_get_functiondef('public.set_presidential_election_date(uuid,date)'::regprocedure) INTO v_def;
 IF v_def IS NULL OR position('stage_no=7' IN v_def)=0 OR
    position('p_game_id,7,' IN v_def)=0 OR position('''stage_no'',7' IN v_def)=0
 THEN RAISE EXCEPTION 'Senate date RPC changed: migration requires manual review';END IF;
 v_def:=replace(v_def,'stage_no=7','stage_no=6');
 v_def:=replace(v_def,'p_game_id,7,','p_game_id,6,');
 v_def:=replace(v_def,'''stage_no'',7','''stage_no'',6');
 EXECUTE v_def;
END;$patch$;

CREATE OR REPLACE FUNCTION public.set_presidential_three_day_election(
 p_game_id uuid,p_first_day date
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,private,pg_temp AS $fn$
DECLARE v_doc uuid;v_voting_day date;v_uid uuid:=auth.uid();v_body text;
BEGIN
 PERFORM private.require_active_presidential_teacher(p_game_id);
 IF NOT private.is_game_teacher(p_game_id) THEN RAISE EXCEPTION 'Даты утверждает преподаватель от имени Совета Федерации';END IF;
 IF p_first_day IS NULL OR p_first_day<current_date THEN RAISE EXCEPTION 'Первый день выборов не может быть в прошлом';END IF;
 IF EXISTS(SELECT 1 FROM public.presidential_election_settings WHERE game_id=p_game_id AND status IN ('runoff','finished','manual_required'))
 THEN RAISE EXCEPTION 'После начала подсчёта переназначение выборов запрещено';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('presidential-election-schedule:'||p_game_id::text,0));
 v_voting_day:=p_first_day+2;
 v_doc:=public.set_presidential_election_date(p_game_id,v_voting_day);
 v_body:='Совет Федерации Федерального Собрания Российской Федерации постановляет:'
  ||E'\n1. Назначить выборы Президента Российской Федерации на три последовательных календарных дня: '
  ||to_char(p_first_day,'DD.MM.YYYY')||', '||to_char(p_first_day+1,'DD.MM.YYYY')||' и '||to_char(v_voting_day,'DD.MM.YYYY')||'.'
  ||E'\n2. Агитационный период начинается в 08:00 первого дня и завершается в 20:00 третьего дня (60 часов, 2,5 суток).'
  ||E'\n3. Голосование проводится в третий день с 20:00; ЦИК подводит итоги не позднее 23:59 местного времени.'
  ||E'\n4. Итоги определяются в соответствии с установленной студентами избирательной системой и действующими правилами игры.';
 INSERT INTO public.presidential_election_schedule(game_id,first_day,appointment_document_id,updated_by)
 VALUES(p_game_id,p_first_day,v_doc,v_uid)
 ON CONFLICT(game_id) DO UPDATE SET first_day=excluded.first_day,
 appointment_document_id=excluded.appointment_document_id,updated_by=v_uid,updated_at=now();
 UPDATE public.formal_documents SET
  body_text=v_body,metadata=metadata||jsonb_build_object(
  'first_day',p_first_day::text,'second_day',(p_first_day+1)::text,
  'election_date',v_voting_day::text,'voting_starts_at','20:00','counting_deadline','23:59',
  'campaign_start','08:00','campaign_end','20:00','stage_no',6),updated_at=now()
 WHERE id=v_doc;
 UPDATE public.political_posts SET
  body='Совет Федерации назначил трёхдневные выборы Президента Российской Федерации: '
       ||to_char(p_first_day,'DD.MM.YYYY')||' — '||to_char(v_voting_day,'DD.MM.YYYY')
       ||'. Агитация: с 08:00 первого дня до 20:00 третьего дня. Голосование с 20:00 третьего дня, итоги ЦИК до 23:59.',
  context=context||jsonb_build_object('stage_no',6,'first_day',p_first_day::text,'election_date',v_voting_day::text),
  updated_at=now()
 WHERE game_id=p_game_id AND internal_ref_id=v_doc::text AND actor_key='sf';
 RETURN v_doc;
END;$fn$;

CREATE OR REPLACE FUNCTION public.get_presidential_three_day_election(p_game_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,private,pg_temp AS $fn$
 SELECT CASE WHEN private.is_game_member(p_game_id)
 THEN (SELECT jsonb_build_object('first_day',first_day,'second_day',first_day+1,
 'voting_day',voting_day,'appointment_document_id',appointment_document_id,
 'campaign_starts_at',to_char(first_day,'YYYY-MM-DD')||' 08:00',
 'voting_starts_at',to_char(voting_day,'YYYY-MM-DD')||' 20:00',
 'counting_deadline',to_char(voting_day,'YYYY-MM-DD')||' 23:59')
 FROM public.presidential_election_schedule WHERE game_id=p_game_id)
 ELSE NULL END;
$fn$;
REVOKE ALL ON FUNCTION public.cast_presidential_student_system_vote(uuid,text,numeric),
 public.get_presidential_student_system_vote(uuid),
 public.finalize_presidential_student_system_vote(uuid),
 public.set_presidential_three_day_election(uuid,date),
 public.get_presidential_three_day_election(uuid)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cast_presidential_student_system_vote(uuid,text,numeric),
 public.get_presidential_student_system_vote(uuid),
 public.finalize_presidential_student_system_vote(uuid),
 public.set_presidential_three_day_election(uuid,date),
 public.get_presidential_three_day_election(uuid) TO authenticated;
