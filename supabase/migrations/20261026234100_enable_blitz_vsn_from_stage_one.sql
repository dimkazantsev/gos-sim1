-- ГОС.ID. Подключаем уже утверждённую формулу правовых знаний:
-- блиц учитывается внутри критерия «Право и правила» с Этапа 1.
-- Не меняем формулу, ответы, исторические записи и итоговые оценки.
DO $enable_blitz$
DECLARE
 v_game uuid;
 v_active_count integer;
 v_updated integer;
 v_student record;
BEGIN
 SELECT COUNT(*) INTO v_active_count
 FROM public.games WHERE status='running';
 IF v_active_count<>1 THEN
  RAISE EXCEPTION 'Требуется ровно одна действующая игра, найдено %',v_active_count;
 END IF;
 SELECT id INTO v_game FROM public.games WHERE status='running' FOR UPDATE;
 IF NOT EXISTS (
  SELECT 1 FROM public.game_stages
  WHERE game_id=v_game AND stage_no=1 AND status='open' AND score_closed_at IS NULL
 ) THEN
  RAISE EXCEPTION 'Открытый Этап 1 должен быть доступен для безопасного включения';
 END IF;
 IF EXISTS (
  SELECT 1 FROM public.stage_assessments
  WHERE game_id=v_game AND status='final'
 ) THEN
  RAISE EXCEPTION 'Обнаружены утверждённые оценки: требуется отдельное согласование';
 END IF;
 IF EXISTS (
  SELECT 1 FROM public.games
  WHERE id=v_game AND settings ? 'blitz_vsn_from_stage'
    AND settings->>'blitz_vsn_from_stage'<>'1'
 ) THEN
  RAISE EXCEPTION 'Действующее значение настройки отличается от согласованного';
 END IF;
 UPDATE public.games
 SET settings=jsonb_set(settings,'{blitz_vsn_from_stage}',to_jsonb('1'::text),true)
 WHERE id=v_game AND settings->>'blitz_vsn_from_stage' IS DISTINCT FROM '1';
 GET DIAGNOSTICS v_updated=ROW_COUNT;
 IF (SELECT settings->>'blitz_vsn_from_stage' FROM public.games WHERE id=v_game)<>'1'
 THEN RAISE EXCEPTION 'Активация учёта блица не подтверждена'; END IF;
 -- Предварительные оценки открытого этапа пересчитываем один раз.
 -- Утверждённые оценки никогда не трогаем; участники без черновика
 -- оцениваются существующим штатным механизмом.
 FOR v_student IN
   SELECT DISTINCT user_id
   FROM public.stage_assessments
   WHERE game_id=v_game AND stage_no=1 AND status='draft'
   ORDER BY user_id
   LIMIT 40
 LOOP
   PERFORM private.compute_vsn_assessment(v_game,v_student.user_id,1,'manual');
 END LOOP;
END;
$enable_blitz$;
