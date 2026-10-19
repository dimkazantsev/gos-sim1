-- ГОС.ID · Досрочная фиксация выборов в первом и втором турах.
-- Общая формула, проверка полномочий ЦИК, готовности, ничьих и протоколы не меняются.
-- Обычный маршрут сохраняет действующее ограничение 20:00 третьего дня.
-- Новый маршрут явно вызывается только после подтверждения преподавателем в интерфейсе.
DO $change$
DECLARE
  v_def text;
  v_header text:='CREATE OR REPLACE FUNCTION public.finalize_presidential_round(p_game_id uuid, p_round_no integer)';
  v_deadline text:=E' if not exists(select 1 from public.presidential_election_schedule where game_id=p_game_id\n and now() at time zone ''Asia/Barnaul'' >= voting_day::timestamp+interval ''20 hours'')';
BEGIN
 IF to_regprocedure('private.finalize_presidential_round_core(uuid,integer,boolean)') IS NOT NULL
 THEN RAISE EXCEPTION 'Общий механизм фиксации уже существует: требуется проверить повторный выпуск'; END IF;
 v_def:=pg_get_functiondef('public.finalize_presidential_round(uuid,integer)'::regprocedure);
 IF position(v_header IN v_def)=0 OR position(v_deadline IN v_def)=0
    OR position('private.presidential_author_result(p_game_id,p_round_no)' IN v_def)=0
    OR position('for update' IN lower(v_def))=0
    OR position('if s.status=''finished'' then return s.result;end if;' IN v_def)=0
 THEN RAISE EXCEPTION 'Фиксация президентских выборов изменена; безопасный перенос не выполнен'; END IF;
 v_def:=replace(v_def,v_header,
   'CREATE OR REPLACE FUNCTION private.finalize_presidential_round_core(p_game_id uuid, p_round_no integer, p_skip_deadline boolean)');
 -- Дата выборов обязана существовать и при досрочном решении.
 v_def:=replace(v_def,v_deadline,
   E' if not exists(select 1 from public.presidential_election_schedule where game_id=p_game_id)\n then raise exception ''Дата выборов ещё не назначена'';end if;\n'
   ||replace(v_deadline,'if not exists','if not p_skip_deadline and not exists'));
 IF position('if not p_skip_deadline and not exists' IN v_def)=0
 THEN RAISE EXCEPTION 'Не удалось настроить проверку срока фиксации'; END IF;
 EXECUTE v_def;
END;
$change$;

-- Уберечь внутреннюю реализацию от прямых вызовов студентов и любых клиентов.
REVOKE ALL ON FUNCTION private.finalize_presidential_round_core(uuid,integer,boolean)
  FROM PUBLIC,anon,authenticated;

-- Сохраняем старый контракт для текущих клиентов и обычной фиксации.
CREATE OR REPLACE FUNCTION public.finalize_presidential_round(
 p_game_id uuid,p_round_no integer
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER
SET search_path TO public,private,pg_temp
AS $standard$
 SELECT private.finalize_presidential_round_core(p_game_id,p_round_no,false)
$standard$;

-- Особое право преподавателя: не ждать 20:00 третьего дня, но выполнить те же проверки.
CREATE OR REPLACE FUNCTION public.finalize_presidential_round_early(
 p_game_id uuid,p_round_no integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,private,pg_temp
AS $early$
BEGIN
 PERFORM private.require_active_presidential_teacher(p_game_id);
 IF auth.uid() IS NULL OR NOT private.is_game_teacher(p_game_id) THEN
   RAISE EXCEPTION 'Только преподаватель вправе досрочно завершить тур';
 END IF;
 RETURN private.finalize_presidential_round_core(p_game_id,p_round_no,true);
END;
$early$;

REVOKE ALL ON FUNCTION public.finalize_presidential_round_early(uuid,integer)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.finalize_presidential_round_early(uuid,integer)
 TO authenticated;
