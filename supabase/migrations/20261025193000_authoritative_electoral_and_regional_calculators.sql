-- ГОС.ID: Teacher-approved calculations are the canonical source for GD mandates
-- and regional quotas. All changes are scoped by game and audited where region
-- assignments need to be moved. Existing votes and historic results stay intact.

CREATE TABLE IF NOT EXISTS private.calculator_region_change_log(
  game_id uuid NOT NULL,
  region_code text NOT NULL,
  old_party_id uuid NOT NULL,
  new_party_id uuid NOT NULL,
  calculator_result_id uuid NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON private.calculator_region_change_log FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.apply_published_regional_calculator(
 p_game uuid,p_method text,p_result jsonb,p_calculation uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path='public','private','pg_temp' AS $apply$
DECLARE v_rule uuid;v_count integer;v_source record;v_region text;v_destination uuid;v_current integer;
BEGIN
 SELECT r.id INTO v_rule FROM public.regional_election_rules r
 WHERE r.game_id=p_game AND r.method=p_method AND r.status IN ('allocated','adopted')
 ORDER BY r.updated_at DESC,r.created_at DESC,r.id DESC LIMIT 1;
 IF v_rule IS NULL AND EXISTS(SELECT 1 FROM public.regional_election_rules r
   WHERE r.game_id=p_game AND r.status='allocated') THEN
  RAISE EXCEPTION 'Метод калькулятора не соответствует уже утверждённому распределению КСРФ';
 END IF;
 -- Preserve regional penalties: change awarded quotas, not the effective-penalty formula.
 UPDATE public.game_parties p
 SET regional_seats_awarded=COALESCE((p_result->>p.id::text)::integer,0),updated_at=now()
 WHERE p.game_id=p_game
 AND p.regional_seats_awarded IS DISTINCT FROM COALESCE((p_result->>p.id::text)::integer,0);
 IF v_rule IS NULL THEN RETURN;END IF;
 INSERT INTO public.regional_allocations(rule_id,game_id,party_id,regions,source)
 SELECT v_rule,p_game,p.id,COALESCE((p_result->>p.id::text)::integer,0),p_method
 FROM public.game_parties p WHERE p.game_id=p_game
 ON CONFLICT(rule_id,party_id) DO UPDATE
 SET regions=excluded.regions,source=excluded.source,updated_at=now();
 UPDATE public.regional_election_rules SET status='allocated',updated_at=now()
 WHERE id=v_rule AND status<>'allocated';
 SELECT count(*) INTO v_count FROM public.game_region_party_control WHERE game_id=p_game;
 IF v_count=0 THEN
  PERFORM private.freeze_region_party_control(v_rule);
  RETURN;
 END IF;
 IF v_count<>89 THEN RAISE EXCEPTION 'Неполный реестр регионов. Необходимо проверить назначения вручную';END IF;
 -- Do not delete/reseed 89 regions. Transfer only surplus assignments to parties
 -- below their published quotas, retaining all other approved region codes.
 FOR v_source IN
  SELECT p.id AS party_id,
    count(c.region_code)::integer-COALESCE((p_result->>p.id::text)::integer,0) AS surplus
  FROM public.game_parties p LEFT JOIN public.game_region_party_control c
    ON c.game_id=p.game_id AND c.party_id=p.id
  WHERE p.game_id=p_game GROUP BY p.id
  HAVING count(c.region_code)::integer>COALESCE((p_result->>p.id::text)::integer,0)
  ORDER BY p.id
 LOOP
  FOR v_region IN SELECT c.region_code FROM public.game_region_party_control c
    WHERE c.game_id=p_game AND c.party_id=v_source.party_id
    ORDER BY c.region_code DESC LIMIT v_source.surplus
  LOOP
   SELECT p.id INTO v_destination FROM public.game_parties p
   WHERE p.game_id=p_game AND
     (SELECT count(*) FROM public.game_region_party_control c
      WHERE c.game_id=p_game AND c.party_id=p.id)
       <COALESCE((p_result->>p.id::text)::integer,0)
   ORDER BY p.id LIMIT 1;
   IF v_destination IS NULL THEN
    RAISE EXCEPTION 'Нет партии-получателя для остатка распределения регионов';
   END IF;
   UPDATE public.game_region_party_control
   SET party_id=v_destination,election_rule_id=v_rule
   WHERE game_id=p_game AND region_code=v_region AND party_id=v_source.party_id;
   INSERT INTO private.calculator_region_change_log(game_id,region_code,old_party_id,new_party_id,calculator_result_id)
   VALUES(p_game,v_region,v_source.party_id,v_destination,p_calculation);
  END LOOP;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.game_parties p WHERE p.game_id=p_game
  AND (SELECT count(*) FROM public.game_region_party_control c
       WHERE c.game_id=p_game AND c.party_id=p.id)
     <>COALESCE((p_result->>p.id::text)::integer,0)) THEN
   RAISE EXCEPTION 'Контрольная сумма распределения регионов не совпадает с утверждённой';
 END IF;
END;$apply$;
REVOKE ALL ON FUNCTION private.apply_published_regional_calculator(uuid,text,jsonb,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.publish_electoral_calculator_result(
 p_game_id uuid,p_system_type text,p_allocation_method text,p_proportional_share integer,
 p_support jsonb,p_district_seats jsonb,p_result jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path='public','private','pg_temp' AS $electoral$
DECLARE v_id uuid;party_ids uuid[];weights double precision[];
 allocation integer[];pool integer;district_pool integer;total integer;i integer;
BEGIN
 IF auth.uid() IS NULL OR NOT private.is_game_teacher(p_game_id) THEN
  RAISE EXCEPTION 'Сохранение расчёта доступно только преподавателю';END IF;
 IF p_system_type IS NULL OR p_system_type NOT IN ('proportional','majoritarian','mixed') THEN
  RAISE EXCEPTION 'Неизвестный тип избирательной системы';END IF;
 IF p_system_type<>'majoritarian' AND
  (p_allocation_method IS NULL OR p_allocation_method NOT IN ('hare','droop','dhondt','sainte_lague','imperiali')) THEN
  RAISE EXCEPTION 'Неизвестная формула распределения';END IF;
 IF p_system_type='mixed' AND (p_proportional_share IS NULL OR p_proportional_share NOT BETWEEN 1 AND 99) THEN
  RAISE EXCEPTION 'Для смешанной системы задайте долю пропорциональной части';END IF;
 PERFORM 1 FROM public.games WHERE id=p_game_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Игра не найдена';END IF;
 IF NOT private.valid_party_numbers(p_game_id,p_support,100,false)
  OR NOT private.valid_party_numbers(p_game_id,p_district_seats,450,true)
  OR NOT private.valid_party_numbers(p_game_id,p_result,450,true) THEN
  RAISE EXCEPTION 'Расчёт должен содержать числовые значения для всех партий этой игры';END IF;
 pool:=CASE p_system_type WHEN 'proportional' THEN 450 WHEN 'mixed' THEN round(450*p_proportional_share::numeric/100)::integer ELSE 0 END;
 district_pool:=450-pool;
 SELECT array_agg(id ORDER BY support DESC,created_at,id),
        array_agg((p_support->>id::text)::double precision ORDER BY support DESC,created_at,id)
 INTO party_ids,weights FROM public.game_parties WHERE game_id=p_game_id;
 allocation:=private.allocate_electoral_seats(weights,pool,p_allocation_method);
 IF district_pool>0 THEN
  SELECT sum(value::integer) INTO total FROM jsonb_each_text(p_district_seats);
  IF total<>district_pool THEN RAISE EXCEPTION 'Сумма мажоритарных мест не соответствует выбранной системе';END IF;
 END IF;
 FOR i IN 1..array_length(party_ids,1) LOOP
  IF (p_result->>party_ids[i]::text)::integer <>
      (allocation[i]+CASE WHEN district_pool>0 THEN (p_district_seats->>party_ids[i]::text)::integer ELSE 0 END) THEN
   RAISE EXCEPTION 'Итог не совпадает с рассчитанным распределением мандатов';
  END IF;
 END LOOP;
 INSERT INTO public.electoral_calculator_results(game_id,created_by,system_type,allocation_method,proportional_share,support,district_seats,result)
 VALUES(p_game_id,auth.uid(),p_system_type,
  CASE WHEN p_system_type='majoritarian' THEN NULL ELSE p_allocation_method END,
  CASE WHEN p_system_type='mixed' THEN p_proportional_share ELSE NULL END,
  p_support,p_district_seats,p_result) RETURNING id INTO v_id;
 -- The existing party trigger recalculates individual deputy capacities.
 UPDATE public.game_parties p
 SET mandates=COALESCE((p_result->>p.id::text)::integer,0),updated_at=now()
 WHERE p.game_id=p_game_id
 AND p.mandates IS DISTINCT FROM COALESCE((p_result->>p.id::text)::integer,0);
 RETURN v_id;
END;$electoral$;
REVOKE ALL ON FUNCTION public.publish_electoral_calculator_result(uuid,text,text,integer,jsonb,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.publish_electoral_calculator_result(uuid,text,text,integer,jsonb,jsonb,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.publish_regional_calculator_result(
 p_game_id uuid,p_method text,p_inputs jsonb,p_result jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path='public','private','pg_temp' AS $regional$
DECLARE v_id uuid;v_total integer;party_ids uuid[];weights double precision[];
 allocation integer[];total double precision:=0;i integer;v_mandates jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT private.is_game_teacher(p_game_id) THEN
  RAISE EXCEPTION 'Сохранение расчёта доступно только преподавателю';END IF;
 IF p_method IS NULL OR p_method NOT IN ('random','proportional','agreement') THEN
  RAISE EXCEPTION 'Неизвестный метод распределения';END IF;
 PERFORM 1 FROM public.games WHERE id=p_game_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Игра не найдена';END IF;
 IF p_inputs IS NULL OR jsonb_typeof(p_inputs)<>'object'
  OR NOT private.valid_party_numbers(p_game_id,p_result,89,true) THEN
  RAISE EXCEPTION 'Расчёт должен содержать числа для всех партий этой игры';END IF;
 SELECT sum(value::integer) INTO v_total FROM jsonb_each_text(p_result);
 IF v_total<>89 THEN RAISE EXCEPTION 'Итог должен распределять ровно 89 субъектов; сейчас: %',v_total;END IF;
 IF p_method='agreement' AND p_inputs->'agreement' IS DISTINCT FROM p_result THEN
  RAISE EXCEPTION 'Итог должен совпадать с договорным распределением';END IF;
 IF p_method='proportional' THEN
  SELECT jsonb_object_agg(id::text,greatest(0,mandates)),
   array_agg(id ORDER BY support DESC,created_at,id),
   array_agg(greatest(0,mandates)::double precision ORDER BY support DESC,created_at,id)
   INTO v_mandates,party_ids,weights FROM public.game_parties WHERE game_id=p_game_id;
  IF p_inputs->'mandates' IS DISTINCT FROM v_mandates THEN
   RAISE EXCEPTION 'Обновите расчёт: распределение мандатов изменилось';END IF;
  FOR i IN 1..array_length(weights,1) LOOP total:=total+weights[i];END LOOP;
  IF total<=0 THEN RAISE EXCEPTION 'Сначала распределите мандаты Государственной Думы';END IF;
  allocation:=private.largest_remainder_seats(weights,89,total/89);
  FOR i IN 1..array_length(party_ids,1) LOOP
   IF (p_result->>party_ids[i]::text)::integer<>allocation[i] THEN
    RAISE EXCEPTION 'Итог не совпадает с пропорциональным распределением субъектов';END IF;
  END LOOP;
 END IF;
 INSERT INTO public.regional_calculator_results(game_id,created_by,method,inputs,result)
 VALUES(p_game_id,auth.uid(),p_method,p_inputs,p_result) RETURNING id INTO v_id;
 PERFORM private.apply_published_regional_calculator(p_game_id,p_method,p_result,v_id);
 RETURN v_id;
END;$regional$;
REVOKE ALL ON FUNCTION public.publish_regional_calculator_result(uuid,text,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.publish_regional_calculator_result(uuid,text,jsonb,jsonb) TO authenticated;
