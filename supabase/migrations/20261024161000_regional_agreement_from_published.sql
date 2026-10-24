-- Promote an already published teacher calculation to the draft agreement.
-- Never silently override existing agreements or finalize the game results.
CREATE OR REPLACE FUNCTION public.prepare_regional_agreement_from_calculation(
 p_rule_id uuid,p_calculation_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,private,pg_temp AS $$
DECLARE r public.regional_election_rules%rowtype;
 c public.regional_calculator_results%rowtype;
 p record; n integer;
BEGIN
 SELECT * INTO r FROM public.regional_election_rules WHERE id=p_rule_id FOR UPDATE;
 IF NOT FOUND OR r.method<>'agreement' OR r.status<>'adopted' THEN
  RAISE EXCEPTION 'Договор должен быть принят КСРФ и находиться в подготовке'; END IF;
 IF NOT private.is_game_teacher(r.game_id) THEN
  RAISE EXCEPTION 'Составить договор из расчёта может только преподаватель'; END IF;
 SELECT * INTO c FROM public.regional_calculator_results
  WHERE id=p_calculation_id AND game_id=r.game_id AND published=true FOR SHARE;
 IF NOT FOUND OR c.method<>'agreement' THEN
  RAISE EXCEPTION 'Выберите опубликованный договорной расчёт этой игры'; END IF;
 IF NOT private.valid_party_numbers(r.game_id,c.result,89,true) THEN
  RAISE EXCEPTION 'Опубликованный расчёт должен распределять ровно 89 субъектов между всеми партиями'; END IF;
 SELECT coalesce(sum(regions),0)::integer INTO n FROM public.regional_allocations WHERE rule_id=r.id;
 IF n<>0 THEN
  RAISE EXCEPTION 'Договорные значения уже введены. Отредактируйте их вручную, чтобы не потерять согласованные данные'; END IF;
 FOR p IN SELECT id FROM public.game_parties WHERE game_id=r.game_id ORDER BY id LOOP
  INSERT INTO public.regional_allocations(rule_id,game_id,party_id,regions,source)
  VALUES(r.id,r.game_id,p.id,(c.result->>p.id::text)::integer,'agreement')
  ON CONFLICT(rule_id,party_id) DO UPDATE
   SET regions=excluded.regions,source='agreement',updated_at=now();
 END LOOP;
 -- This is only a proposed allocation; closing and award remain the existing RPC.
END $$;
REVOKE ALL ON FUNCTION public.prepare_regional_agreement_from_calculation(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.prepare_regional_agreement_from_calculation(uuid,uuid) TO authenticated;
