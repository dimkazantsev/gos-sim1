-- ГОС.ID: применяем утверждённые калькуляторы без переписывания
-- существующих проверенных RPC, закрытых голосований или 89 закреплённых регионов.

CREATE OR REPLACE FUNCTION private.sync_published_gd_mandates()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $sync$
DECLARE v_parties integer; v_total integer;
BEGIN
 IF NOT new.published THEN RETURN new; END IF;
 PERFORM 1 FROM public.games WHERE id=new.game_id FOR UPDATE;
 IF EXISTS (SELECT 1 FROM public.game_votes
            WHERE game_id=new.game_id AND institution_key='gd' AND status='open') THEN
   RAISE EXCEPTION 'Сначала завершите открытое голосование ГД';
 END IF;
 SELECT count(*) INTO v_parties FROM public.game_parties WHERE game_id=new.game_id;
 SELECT coalesce(sum(value::integer),0) INTO v_total FROM jsonb_each_text(new.result);
 IF v_parties=0 OR v_total<>450
    OR v_parties<>(SELECT count(*) FROM jsonb_object_keys(new.result))
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(new.result) AS keys(party_id)
               WHERE NOT EXISTS (SELECT 1 FROM public.game_parties p
                                 WHERE p.game_id=new.game_id AND p.id::text=keys.party_id)) THEN
   RAISE EXCEPTION 'Необходимо распределить ровно 450 мандатов между партиями игры';
 END IF;
 -- Штатный триггер game_parties уже выполняет rebalance для каждой партии,
 -- с учётом индивидуальных мандатов, Goust Voting и санкций.
 UPDATE public.game_parties p
 SET mandates=(new.result->>p.id::text)::integer, updated_at=now()
 WHERE p.game_id=new.game_id
   AND p.mandates IS DISTINCT FROM (new.result->>p.id::text)::integer;
 RETURN new;
END;
$sync$;

DROP TRIGGER IF EXISTS trg_sync_published_gd_mandates ON public.electoral_calculator_results;
CREATE TRIGGER trg_sync_published_gd_mandates
AFTER INSERT ON public.electoral_calculator_results
FOR EACH ROW EXECUTE FUNCTION private.sync_published_gd_mandates();

CREATE OR REPLACE FUNCTION private.sync_published_regional_control()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $sync$
DECLARE v_rule uuid; v_method text; v_existing integer; v_total integer;
BEGIN
 IF NOT new.published THEN RETURN new; END IF;
 PERFORM 1 FROM public.games WHERE id=new.game_id FOR UPDATE;
 SELECT id,method INTO v_rule,v_method FROM public.regional_election_rules
 WHERE game_id=new.game_id AND status IN ('adopted','allocated')
 ORDER BY updated_at DESC,created_at DESC,id DESC LIMIT 1 FOR UPDATE;
 IF v_rule IS NULL OR v_method<>new.method THEN
  RAISE EXCEPTION 'Метод распределения сначала должен быть утверждён КСРФ';
 END IF;
 SELECT coalesce(sum(value::integer),0) INTO v_total FROM jsonb_each_text(new.result);
 IF v_total<>89 OR EXISTS (
  SELECT 1 FROM jsonb_object_keys(new.result) AS keys(party_id)
  WHERE NOT EXISTS (SELECT 1 FROM public.game_parties p
                    WHERE p.game_id=new.game_id AND p.id::text=keys.party_id)
 ) OR (SELECT count(*) FROM public.game_parties WHERE game_id=new.game_id)
      <> (SELECT count(*) FROM jsonb_object_keys(new.result)) THEN
  RAISE EXCEPTION 'Необходимо распределить 89 субъектов между партиями игры';
 END IF;
 SELECT count(*) INTO v_existing FROM public.game_region_party_control
 WHERE game_id=new.game_id;
 IF v_existing>0 AND (
  v_existing<>89 OR EXISTS (
    SELECT 1 FROM public.game_parties p WHERE p.game_id=new.game_id
    AND (SELECT count(*) FROM public.game_region_party_control c
         WHERE c.game_id=new.game_id AND c.party_id=p.id)
        IS DISTINCT FROM (new.result->>p.id::text)::integer
  )
 ) THEN
  RAISE EXCEPTION 'Закреплённые регионы отличаются от расчёта. Нужен отдельный пересмотр';
 END IF;
 IF v_existing=0 THEN
  DELETE FROM public.regional_allocations WHERE rule_id=v_rule;
  INSERT INTO public.regional_allocations(rule_id,game_id,party_id,regions,source)
  SELECT v_rule,new.game_id,p.id,(new.result->>p.id::text)::integer,new.method
  FROM public.game_parties p WHERE p.game_id=new.game_id
    AND (new.result->>p.id::text)::integer>0;
  UPDATE public.regional_election_rules SET status='allocated',updated_at=now()
  WHERE id=v_rule;
  PERFORM private.freeze_region_party_control(v_rule);
 END IF;
 UPDATE public.game_parties p
 SET regions=(new.result->>p.id::text)::integer,updated_at=now()
 WHERE p.game_id=new.game_id
   AND p.regions IS DISTINCT FROM (new.result->>p.id::text)::integer;
 RETURN new;
END;
$sync$;

DROP TRIGGER IF EXISTS trg_sync_published_regional_control ON public.regional_calculator_results;
CREATE TRIGGER trg_sync_published_regional_control
AFTER INSERT ON public.regional_calculator_results
FOR EACH ROW EXECUTE FUNCTION private.sync_published_regional_control();

-- Однократно устраняем подтверждённый разрыв: есть опубликованные
-- 450 мандатов, но ни одной записи mandates в game_parties.
-- Если мандаты уже назначены или голосование ГД открыто, ничего не меняем.
DO $repair$
DECLARE rec record; v_count integer; v_total integer;
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
                WHERE game_id=rec.game_id AND mandates<>0) THEN
   CONTINUE;
  END IF;
  SELECT count(*) INTO v_count FROM public.game_parties WHERE game_id=rec.game_id;
  SELECT coalesce(sum(value::integer),0) INTO v_total FROM jsonb_each_text(rec.result);
  IF v_count=0 OR v_total<>450
     OR v_count<>(SELECT count(*) FROM jsonb_object_keys(rec.result))
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(rec.result) AS keys(party_id)
                WHERE NOT EXISTS (SELECT 1 FROM public.game_parties p
                   WHERE p.game_id=rec.game_id AND p.id::text=keys.party_id)) THEN
   CONTINUE;
  END IF;
  UPDATE public.game_parties p
  SET mandates=(rec.result->>p.id::text)::integer,updated_at=now()
  WHERE p.game_id=rec.game_id
    AND p.mandates IS DISTINCT FROM (rec.result->>p.id::text)::integer;
 END LOOP;
END;
$repair$;

REVOKE ALL ON FUNCTION private.sync_published_gd_mandates() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.sync_published_regional_control() FROM PUBLIC,anon,authenticated;
