-- ГОС.ID. Этап 1: строго 20 секунд для выбора и 2 секунды допуска доставки.
-- Проверяем точную редакцию функций, чтобы не потерять сторонние изменения.
-- Время устройства не используется для принятия; бюллетени, попытки и баллы не обновляем.
DO $blitz_stage1$
DECLARE rec record; definition text; occurrences integer;
BEGIN
 FOR rec IN SELECT * FROM (VALUES
   ($frag$public.blitz_answer(uuid,integer)$frag$,$frag$795b4351d0154476cf456182da697200$frag$,$frag$current_at<=a.started_at+interval '20 seconds'$frag$,$frag$current_at<=a.started_at+interval '22 seconds'$frag$),
   ($frag$public.blitz_open_recent(uuid,timestamp with time zone)$frag$,$frag$4d928ceb3c7c17d377326c5982bb9417$frag$,$frag$started_at+interval '20 seconds'<moment$frag$,$frag$started_at+interval '22 seconds'<moment$frag$),
   ($frag$public.blitz_open_recent(uuid,timestamp with time zone)$frag$,$frag$4d928ceb3c7c17d377326c5982bb9417$frag$,$frag$started_at+interval '20 seconds'>=moment$frag$,$frag$started_at+interval '22 seconds'>=moment$frag$),
   ($frag$public.blitz_open_selected(uuid)$frag$,$frag$2e1c2abed52dc36a5b818f43db48f5b6$frag$,$frag$a.started_at+interval '20 seconds'<moment$frag$,$frag$a.started_at+interval '22 seconds'<moment$frag$),
   ($frag$public.blitz_open_selected(uuid)$frag$,$frag$2e1c2abed52dc36a5b818f43db48f5b6$frag$,$frag$started_at+interval '20 seconds'>moment$frag$,$frag$started_at+interval '22 seconds'>moment$frag$),
   ($frag$public.blitz_open_recent(uuid,timestamp with time zone)$frag$,$frag$4d928ceb3c7c17d377326c5982bb9417$frag$,$frag$'deadline',a.started_at+interval '20 seconds','stage_no',a.stage_no$frag$,$frag$'deadline',a.started_at+interval '20 seconds','stage_no',a.stage_no,'server_now',clock_timestamp()$frag$),
   ($frag$public.blitz_open_selected(uuid)$frag$,$frag$2e1c2abed52dc36a5b818f43db48f5b6$frag$,$frag$'deadline',a.started_at+interval '20 seconds','stage_no',a.stage_no$frag$,$frag$'deadline',a.started_at+interval '20 seconds','stage_no',a.stage_no,'server_now',clock_timestamp()$frag$),
   ($frag$public.blitz_inbox_counts(uuid)$frag$,$frag$416a6509def593d0ecf944feb6eceb38$frag$,$frag$started_at+interval '20 seconds'<clock_timestamp()$frag$,$frag$started_at+interval '22 seconds'<clock_timestamp()$frag$)
  ) AS changes(signature,expected_hash,old_sql,new_sql)
 LOOP
  SELECT pg_get_functiondef(rec.signature::regprocedure) INTO definition;
  IF md5(definition) IS DISTINCT FROM rec.expected_hash THEN
   RAISE EXCEPTION 'Изменилась серверная функция %: миграция отменена',rec.signature;
  END IF;
  occurrences:=(length(definition)-length(replace(definition,rec.old_sql,'')))/length(rec.old_sql);
  IF occurrences<>1 THEN
   RAISE EXCEPTION 'Непредвиденная структура функции %: % совпадений',rec.signature,occurrences;
  END IF;
 END LOOP;
 FOR rec IN SELECT * FROM (VALUES
   ($frag$public.blitz_answer(uuid,integer)$frag$,$frag$current_at<=a.started_at+interval '20 seconds'$frag$,$frag$current_at<=a.started_at+interval '22 seconds'$frag$),
   ($frag$public.blitz_open_recent(uuid,timestamp with time zone)$frag$,$frag$started_at+interval '20 seconds'<moment$frag$,$frag$started_at+interval '22 seconds'<moment$frag$),
   ($frag$public.blitz_open_recent(uuid,timestamp with time zone)$frag$,$frag$started_at+interval '20 seconds'>=moment$frag$,$frag$started_at+interval '22 seconds'>=moment$frag$),
   ($frag$public.blitz_open_selected(uuid)$frag$,$frag$a.started_at+interval '20 seconds'<moment$frag$,$frag$a.started_at+interval '22 seconds'<moment$frag$),
   ($frag$public.blitz_open_selected(uuid)$frag$,$frag$started_at+interval '20 seconds'>moment$frag$,$frag$started_at+interval '22 seconds'>moment$frag$),
   ($frag$public.blitz_open_recent(uuid,timestamp with time zone)$frag$,$frag$'deadline',a.started_at+interval '20 seconds','stage_no',a.stage_no$frag$,$frag$'deadline',a.started_at+interval '20 seconds','stage_no',a.stage_no,'server_now',clock_timestamp()$frag$),
   ($frag$public.blitz_open_selected(uuid)$frag$,$frag$'deadline',a.started_at+interval '20 seconds','stage_no',a.stage_no$frag$,$frag$'deadline',a.started_at+interval '20 seconds','stage_no',a.stage_no,'server_now',clock_timestamp()$frag$),
   ($frag$public.blitz_inbox_counts(uuid)$frag$,$frag$started_at+interval '20 seconds'<clock_timestamp()$frag$,$frag$started_at+interval '22 seconds'<clock_timestamp()$frag$)
  ) AS changes(signature,old_sql,new_sql)
 LOOP
  SELECT pg_get_functiondef(rec.signature::regprocedure) INTO definition;
  EXECUTE replace(definition,rec.old_sql,rec.new_sql);
 END LOOP;
END;
$blitz_stage1$;
