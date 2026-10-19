-- ГОС.ID · Публикация окончательного протокола ЦИК после досрочной фиксации.
-- Дата выборов, полномочия, зафиксированный победитель, блокировка и единственность
-- публикации по source_key сохраняются. Исправляется только повторный временной запрет.
DO $migration$
DECLARE
  v_publish text;
  v_time_check text:=E' IF now() AT TIME ZONE ''Asia/Barnaul'' < v_schedule::timestamp+interval ''20 hours''\n THEN RAISE EXCEPTION ''Публикация итогов возможна только после 20:00 третьего дня выборов'';END IF;';
  v_protocol text;
  v_manual_label text:='Игровой рейтинг (баллы кандидата / сумма баллов кандидатов × 100):';
BEGIN
  v_publish:=pg_get_functiondef('public.publish_presidential_cec_protocol(uuid,numeric,bigint,boolean,text)'::regprocedure);
  IF position(v_time_check IN v_publish)=0
    OR position('PERFORM private.require_active_presidential_teacher(p_game_id)' IN v_publish)=0
    OR position('IF v_s.status<>''finished''' IN v_publish)=0
    OR position('PERFORM pg_advisory_xact_lock(hashtextextended(v_source,0))' IN v_publish)=0
    OR position('SELECT id INTO v_post FROM public.political_posts' IN v_publish)=0
    OR position('private.compose_presidential_cec_protocol' IN v_publish)=0
    OR position('IF v_schedule IS NULL' IN v_publish)=0
  THEN
    RAISE EXCEPTION 'Механизм публикации ЦИК изменён: необходимо проверить новую версию перед миграцией';
  END IF;
  v_publish:=replace(v_publish,v_time_check,
    E' -- Окончательный результат уже подтверждён ЦИК; дополнительный срок публикации не требуется.\n'
    || E' IF v_s.result->>''winner_id'' IS NULL OR v_s.result->''calculation'' IS NULL\n'
    || E' THEN RAISE EXCEPTION ''Нет окончательного протокола ЦИК и утверждённого победителя'';END IF;');
  IF position('Публикация итогов возможна только после 20:00 третьего дня' IN v_publish)>0
    OR position('Нет окончательного протокола ЦИК и утверждённого победителя' IN v_publish)=0
  THEN RAISE EXCEPTION 'Не удалось безопасно снять повторный временной запрет'; END IF;
  EXECUTE v_publish;

  -- Официальное сообщение обязано воспроизводить тот же состав компонентов,
  -- что и утверждённый результат: решение о соцопросе на Этапе 6 и ручной
  -- процентный рейтинг преподавателя. Чужие формулы и итоги не меняем.
  v_protocol:=pg_get_functiondef('private.compose_presidential_cec_protocol(uuid,numeric,bigint,boolean,text)'::regprocedure);
  IF position(v_manual_label IN v_protocol)=0
    OR position('v_parts:=CASE WHEN s.poll_enabled THEN 4 ELSE 3 END;' IN v_protocol)=0
    OR position('s.result->''calculation''' IN v_protocol)=0
  THEN RAISE EXCEPTION 'Формирование протокола ЦИК изменилось: миграция не применена'; END IF;
  v_protocol:=replace(v_protocol,
    'v_parts:=CASE WHEN s.poll_enabled THEN 4 ELSE 3 END;',
    'v_parts:=CASE WHEN coalesce((s.result->''calculation''->>''poll_enabled'')::boolean,false) THEN 4 ELSE 3 END;');
  v_protocol:=replace(v_protocol,'s.poll_enabled',
    'coalesce((s.result->''calculation''->>''poll_enabled'')::boolean,false)');
  v_protocol:=replace(v_protocol,v_manual_label,
    'Игровой рейтинг (процент, установленный преподавателем от 0 до 100):');
  IF position(v_manual_label IN v_protocol)>0
    OR position('s.poll_enabled' IN v_protocol)>0
    OR position('Игровой рейтинг (процент, установленный преподавателем от 0 до 100):' IN v_protocol)=0
  THEN RAISE EXCEPTION 'Протокол не приведён к утверждённым процентам и соцопросу'; END IF;
  EXECUTE v_protocol;
END;
$migration$;
