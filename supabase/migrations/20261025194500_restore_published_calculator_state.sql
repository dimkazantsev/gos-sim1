-- Correct previously published teacher results without publishing another version.
-- Keep all calculator history, previous ballots, stage statuses and 89 region codes.
DO $backfill$
DECLARE v_calc record;v_party uuid;v_expected integer;
BEGIN
 FOR v_calc IN
  SELECT DISTINCT ON (game_id) id,game_id,result
  FROM public.electoral_calculator_results
  WHERE published
  ORDER BY game_id,created_at DESC,id DESC
 LOOP
  PERFORM 1 FROM public.games WHERE id=v_calc.game_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Игра опубликованного расчёта не найдена';END IF;
  IF NOT private.valid_party_numbers(v_calc.game_id,v_calc.result,450,true) THEN
   RAISE EXCEPTION 'Неполное утверждённое распределение мандатов';
  END IF;
  SELECT coalesce(sum(value::integer),0) INTO v_expected
  FROM jsonb_each_text(v_calc.result);
  IF v_expected<>450 THEN RAISE EXCEPTION 'Опубликованный результат не равен 450 мандатам';END IF;
  UPDATE public.game_parties p
  SET mandates=(v_calc.result->>p.id::text)::integer
  WHERE p.game_id=v_calc.game_id AND
    p.mandates IS DISTINCT FROM (v_calc.result->>p.id::text)::integer;
  -- A party update already invokes the established seat-rebalance trigger.
  -- Repair a missing legacy per-student roster even if party totals match.
  FOR v_party IN SELECT p.id FROM public.game_parties p WHERE p.game_id=v_calc.game_id
  LOOP
   IF (SELECT coalesce(sum(a.base_mandates),0)
       FROM public.party_member_mandates a WHERE a.party_id=v_party)
     <> (SELECT p.mandates FROM public.game_parties p WHERE p.id=v_party) THEN
    PERFORM private.rebalance_party_mandates(v_party);
   END IF;
  END LOOP;
 END LOOP;

 FOR v_calc IN
  SELECT DISTINCT ON (game_id) id,game_id,method,result
  FROM public.regional_calculator_results WHERE published
  ORDER BY game_id,created_at DESC,id DESC
 LOOP
  PERFORM 1 FROM public.games WHERE id=v_calc.game_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Игра регионального расчёта не найдена';END IF;
  IF NOT private.valid_party_numbers(v_calc.game_id,v_calc.result,89,true) THEN
   RAISE EXCEPTION 'Неполное утверждённое распределение регионов';
  END IF;
  SELECT coalesce(sum(value::integer),0) INTO v_expected
  FROM jsonb_each_text(v_calc.result);
  IF v_expected<>89 THEN RAISE EXCEPTION 'Опубликованный результат не равен 89 регионам';END IF;
  PERFORM private.apply_published_regional_calculator(
    v_calc.game_id,v_calc.method,v_calc.result,v_calc.id);
 END LOOP;
END;
$backfill$;