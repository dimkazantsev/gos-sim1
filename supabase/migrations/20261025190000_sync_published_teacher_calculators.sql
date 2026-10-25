-- ГОС.ID. Согласованные результаты калькулятора становятся источником
-- мандатов ГД и распределения субъектов только через полномочия преподавателя.
-- Существующие бюллетени, закрытые голосования и закреплённые регионы не меняем.

CREATE OR REPLACE FUNCTION public.publish_electoral_calculator_result(
 p_game_id uuid, p_system_type text, p_allocation_method text,
 p_proportional_share integer, p_support jsonb, p_district_seats jsonb,
 p_result jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
DECLARE
 v_id uuid;
 party_ids uuid[];
 weights double precision[];
 allocation integer[];
 pool integer;
 district_pool integer;
 district_total integer;
 i integer;
BEGIN
 IF auth.uid() IS NULL OR NOT private.is_game_teacher(p_game_id) THEN
  RAISE EXCEPTION 'Утверждать расчёт может только преподаватель';
 END IF;
 IF p_system_type IS NULL OR p_system_type NOT IN ('proportional','majoritarian','mixed') THEN
  RAISE EXCEPTION 'Неизвестный тип избирательной системы';
 END IF;
 IF p_system_type<>'majoritarian' AND
    (p_allocation_method IS NULL OR p_allocation_method NOT IN ('hare','droop','dhondt','sainte_lague','imperiali')) THEN
  RAISE EXCEPTION 'Неизвестная формула распределения';
 END IF;
 IF p_system_type='mixed' AND
    (p_proportional_share IS NULL OR p_proportional_share NOT BETWEEN 1 AND 99) THEN
  RAISE EXCEPTION 'Некорректная доля пропорциональной части';
 END IF;
 PERFORM 1 FROM public.games WHERE id=p_game_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Игра не найдена'; END IF;
 IF NOT private.valid_party_numbers(p_game_id,p_support,100,false)
    OR NOT private.valid_party_numbers(p_game_id,p_district_seats,450,true)
    OR NOT private.valid_party_numbers(p_game_id,p_result,450,true) THEN
  RAISE EXCEPTION 'Результат должен включать все партии и целые мандаты';
 END IF;
 IF EXISTS (SELECT 1 FROM public.game_votes
            WHERE game_id=p_game_id AND institution_key='gd' AND status='open') THEN
  RAISE EXCEPTION 'Нельзя менять мандаты при открытом голосовании ГД';
 END IF;
 pool:=CASE p_system_type WHEN 'proportional' THEN 450
       WHEN 'mixed' THEN round(450*p_proportional_share::numeric/100)::integer ELSE 0 END;
 district_pool:=450-pool;
 SELECT array_agg(id ORDER BY support DESC,created_at,id),
        array_agg((p_support->>id::text)::double precision ORDER BY support DESC,created_at,id)
 INTO party_ids,weights FROM public.game_parties WHERE game_id=p_game_id;
 allocation:=private.allocate_electoral_seats(weights,pool,p_allocation_method);
 SELECT coalesce(sum(value::integer),0) INTO district_total
 FROM jsonb_each_text(p_district_seats);
 IF district_pool>0 AND district_total<>district_pool THEN
  RAISE EXCEPTION 'Сумма мажоритарных мандатов не совпадает с установленным числом';
 END IF;
 FOR i IN 1..coalesce(array_length(party_ids,1),0) LOOP
  IF (p_result->>party_ids[i]::text)::integer IS DISTINCT FROM
     coalesce(allocation[i],0)+CASE WHEN district_pool>0 THEN (p_district_seats->>party_ids[i]::text)::integer ELSE 0 END THEN
   RAISE EXCEPTION 'Итог не совпадает с расчётом мандатов';
  END IF;
 END LOOP;
 IF (SELECT coalesce(sum(value::integer),0) FROM jsonb_each_text(p_result))<>450 THEN
  RAISE EXCEPTION 'Результат должен содержать 450 мандатов';
 END IF;
 INSERT INTO public.electoral_calculator_results(
  game_id,created_by,system_type,allocation_method,proportional_share,support,district_seats,result
 ) VALUES (
  p_game_id,auth.uid(),p_system_type,
  CASE WHEN p_system_type='majoritarian' THEN NULL ELSE p_allocation_method END,
  CASE WHEN p_system_type='mixed' THEN p_proportional_share ELSE NULL END,
  p_support,p_district_seats,p_result
 ) RETURNING id INTO v_id;
 -- Существующий триггер trg_rebalance_party распределяет мандаты
 -- участников, учитывая гоствойтинг, санкции и режим ручного назначения.
 UPDATE public.game_parties p
 SET mandates=(p_result->>p.id::text)::integer, updated_at=now()
 WHERE p.game_id=p_game_id
   AND p.mandates IS DISTINCT FROM (p_result->>p.id::text)::integer;
 RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.publish_regional_calculator_result(
 p_game_id uuid,p_method text,p_inputs jsonb,p_result jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
DECLARE
 v_id uuid;
 v_rule_id uuid;
 v_rule_status text;
 v_existing integer;
 v_total integer;
 party_ids uuid[];
 weights double precision[];
 allocation integer[];
 total double precision:=0;
 i integer;
 v_mandates jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT private.is_game_teacher(p_game_id) THEN
  RAISE EXCEPTION 'Утверждать расчёт может только преподаватель';
 END IF;
 IF p_method IS NULL OR p_method NOT IN ('random','proportional','agreement') THEN
  RAISE EXCEPTION 'Неизвестный метод распределения';
 END IF;
 PERFORM 1 FROM public.games WHERE id=p_game_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Игра не найдена'; END IF;
 IF p_inputs IS NULL OR jsonb_typeof(p_inputs)<>'object'
    OR NOT private.valid_party_numbers(p_game_id,p_result,89,true) THEN
  RAISE EXCEPTION 'Укажите распределение субъектов для всех партий';
 END IF;
 SELECT coalesce(sum(value::integer),0) INTO v_total FROM jsonb_each_text(p_result);
 IF v_total<>89 THEN RAISE EXCEPTION 'Необходимо распределить ровно 89 субъектов'; END IF;
 IF p_method='agreement' AND p_inputs->'agreement' IS DISTINCT FROM p_result THEN
  RAISE EXCEPTION 'Результат не совпадает с согласованным распределением';
 END IF;
 IF p_method='proportional' THEN
  SELECT jsonb_object_agg(id::text,greatest(0,mandates)),
         array_agg(id ORDER BY support DESC,created_at,id),
         array_agg(greatest(0,mandates)::double precision ORDER BY support DESC,created_at,id)
  INTO v_mandates,party_ids,weights FROM public.game_parties WHERE game_id=p_game_id;
  IF p_inputs->'mandates' IS DISTINCT FROM v_mandates THEN
   RAISE EXCEPTION 'Мандаты ГД изменились, пересчитайте распределение';
  END IF;
  FOR i IN 1..coalesce(array_length(weights,1),0) LOOP total:=total+weights[i]; END LOOP;
  IF total<=0 THEN RAISE EXCEPTION 'Сначала распределите мандаты ГД'; END IF;
  allocation:=private.largest_remainder_seats(weights,89,total/89);
  FOR i IN 1..coalesce(array_length(party_ids,1),0) LOOP
   IF (p_result->>party_ids[i]::text)::integer IS DISTINCT FROM allocation[i] THEN
    RAISE EXCEPTION 'Результат не совпадает с пропорциональным расчётом';
   END IF;
  END LOOP;
 END IF;
 SELECT id,status INTO v_rule_id,v_rule_status
 FROM public.regional_election_rules
 WHERE game_id=p_game_id AND status IN ('adopted','allocated')
 ORDER BY updated_at DESC,created_at DESC,id DESC
 LIMIT 1 FOR UPDATE;
 IF v_rule_id IS NULL THEN
  RAISE EXCEPTION 'Сначала КСРФ должен принять метод распределения';
 END IF;
 IF (SELECT method FROM public.regional_election_rules WHERE id=v_rule_id)<>p_method THEN
  RAISE EXCEPTION 'Метод калькулятора не совпадает с решением КСРФ';
 END IF;
 SELECT count(*) INTO v_existing FROM public.game_region_party_control
 WHERE game_id=p_game_id;
 IF v_existing>0 THEN
  IF v_existing<>89 OR EXISTS (
   SELECT 1 FROM public.game_parties p
   WHERE p.game_id=p_game_id AND
     (SELECT count(*) FROM public.game_region_party_control x
      WHERE x.game_id=p_game_id AND x.party_id=p.id)
       IS DISTINCT FROM (p_result->>p.id::text)::integer
  ) THEN
   RAISE EXCEPTION 'Регионы уже закреплены по иному результату; требуется отдельное согласование';
  END IF;
 END IF;
 INSERT INTO public.regional_calculator_results(game_id,created_by,method,inputs,result)
 VALUES(p_game_id,auth.uid(),p_method,p_inputs,p_result)
 RETURNING id INTO v_id;
 IF v_existing=0 THEN
  DELETE FROM public.regional_allocations WHERE rule_id=v_rule_id;
  INSERT INTO public.regional_allocations(rule_id,game_id,party_id,regions,source)
  SELECT v_rule_id,p_game_id,p.id,(p_result->>p.id::text)::integer,p_method
  FROM public.game_parties p
  WHERE p.game_id=p_game_id AND (p_result->>p.id::text)::integer>0;
  UPDATE public.regional_election_rules SET status='allocated',updated_at=now()
  WHERE id=v_rule_id;
  PERFORM private.freeze_region_party_control(v_rule_id);
 END IF;
 UPDATE public.game_parties p
 SET regions=(p_result->>p.id::text)::integer,updated_at=now()
 WHERE p.game_id=p_game_id
   AND p.regions IS DISTINCT FROM (p_result->>p.id::text)::integer;
 RETURN v_id;
END;
$function$;

-- Восстановление уже опубликованного решения ГД только для игр,
-- в которых мандаты ещё не были записаны. Закрытые голоса не пересчитываем.
DO $backfill$
DECLARE rec record;
BEGIN
 FOR rec IN
  SELECT DISTINCT ON (game_id) game_id,result
  FROM public.electoral_calculator_results WHERE published
  ORDER BY game_id,created_at DESC,id DESC
 LOOP
  PERFORM 1 FROM public.games WHERE id=rec.game_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.game_votes
             WHERE game_id=rec.game_id AND institution_key='gd' AND status='open')
   OR EXISTS (SELECT 1 FROM public.game_parties
              WHERE game_id=rec.game_id AND mandates<>0)
   OR (SELECT count(*) FROM public.game_parties WHERE game_id=rec.game_id)=0
   OR (SELECT count(*) FROM public.game_parties WHERE game_id=rec.game_id)
      <> (SELECT count(*) FROM jsonb_object_keys(rec.result))
   OR EXISTS (SELECT 1 FROM jsonb_object_keys(rec.result) k
              WHERE NOT EXISTS (SELECT 1 FROM public.game_parties p
                                WHERE p.game_id=rec.game_id AND p.id::text=k))
   OR (SELECT coalesce(sum(value::integer),0) FROM jsonb_each_text(rec.result))<>450
  THEN CONTINUE; END IF;
  UPDATE public.game_parties p
  SET mandates=(rec.result->>p.id::text)::integer, updated_at=now()
  WHERE p.game_id=rec.game_id
    AND p.mandates IS DISTINCT FROM (rec.result->>p.id::text)::integer;
 END LOOP;
END;
$backfill$;

REVOKE ALL ON FUNCTION public.publish_electoral_calculator_result(uuid,text,text,integer,jsonb,jsonb,jsonb)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.publish_electoral_calculator_result(uuid,text,text,integer,jsonb,jsonb,jsonb)
 TO authenticated;
REVOKE ALL ON FUNCTION public.publish_regional_calculator_result(uuid,text,jsonb,jsonb)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.publish_regional_calculator_result(uuid,text,jsonb,jsonb)
 TO authenticated;
