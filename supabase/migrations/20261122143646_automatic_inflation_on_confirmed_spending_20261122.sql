-- ГОС.ID. Auto inflation from actual fiscal spending, without new client requests.
-- Annual source model: 2026 baseline federal expense = 44,069,700 million RUB.
-- Sensitivity: +0.20 inflation percentage points per +1% of baseline expenditure.
-- Per confirmed action: +/-0.50 pp; never overwrite an explicit teacher value.
CREATE OR REPLACE FUNCTION private.budget_discretionary_expenditure(p_calculation jsonb)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $body$
 SELECT coalesce(sum(
  coalesce((item->>'base_amount')::numeric,0)
  -coalesce((item->>'baseline')::numeric,0)*coalesce((p_calculation->>'cost')::numeric,1)
  +coalesce((item->>'items_amount')::numeric,0)
 ),0)
 FROM jsonb_array_elements(coalesce(p_calculation->'expense_lines','[]'::jsonb)) item
 WHERE item->>'key'<>'13'
$body$;
REVOKE ALL ON FUNCTION private.budget_discretionary_expenditure(jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.apply_spending_inflation(p_game uuid,p_source text,p_spending_delta numeric,p_note text,p_actor uuid DEFAULT NULL)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','private','pg_temp'
AS $body$
DECLARE v_before numeric;v_after numeric;v_delta numeric;v_id text;
BEGIN
 IF p_spending_delta IS NULL OR p_spending_delta=0 OR nullif(p_source,'') IS NULL THEN RETURN 0;END IF;
 v_delta:=greatest(-.5,least(.5,round(p_spending_delta*20/44069700,8)));
 IF v_delta=0 THEN RETURN 0;END IF;
 v_id:='inflation:'||p_source;
 SELECT inflation INTO v_before FROM public.game_fiscal_policy WHERE game_id=p_game FOR UPDATE;
 IF NOT FOUND THEN RETURN 0;END IF;
 IF EXISTS(SELECT 1 FROM public.fiscal_change_ledger
   WHERE game_id=p_game AND source_type='macro' AND source_id=v_id AND region_code='00') THEN RETURN 0;END IF;
 -- Preserve the teacher's manually selected value; future events add a bounded delta to it.
 v_after:=greatest(0,v_before+v_delta);
 IF v_before=v_after THEN RETURN 0;END IF;
 UPDATE public.game_fiscal_policy SET inflation=v_after,updated_at=now() WHERE game_id=p_game;
 INSERT INTO public.fiscal_change_ledger
 (game_id,region_code,source_type,source_id,note,before_values,after_values,actor_id)
 VALUES(p_game,'00','macro',v_id,'Автоматическая инфляция: '||left(coalesce(p_note,'изменение расходов'),450),
 jsonb_build_object('inflation',v_before,'spending_delta_mln',p_spending_delta),
 jsonb_build_object('inflation',v_after,'spending_delta_mln',p_spending_delta),p_actor);
 RETURN v_after-v_before;
END
$body$;
REVOKE ALL ON FUNCTION private.apply_spending_inflation(uuid,text,numeric,text,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.apply_inflation_from_fiscal_ledger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','private','pg_temp'
AS $body$
DECLARE v_delta numeric:=0;
BEGIN
 IF NEW.source_type IN ('event','budget_transfer','act') THEN
  v_delta:=coalesce((NEW.after_values->>'expenditure')::numeric,0)
       -coalesce((NEW.before_values->>'expenditure')::numeric,0);
 ELSIF NEW.source_type='macro' THEN
  -- An explicit inflation edit by the teacher must win over this macro action.
  IF (NEW.before_values->'inflation') IS DISTINCT FROM (NEW.after_values->'inflation') THEN RETURN NEW;END IF;
  v_delta:=coalesce((NEW.after_values->>'federal_expenditure')::numeric,0)
    -coalesce((NEW.before_values->>'federal_expenditure')::numeric,0)
    +coalesce((NEW.after_values->>'municipal_expenditure')::numeric,0)
    -coalesce((NEW.before_values->>'municipal_expenditure')::numeric,0);
 END IF;
 IF v_delta<>0 THEN
  PERFORM private.apply_spending_inflation(NEW.game_id,'fiscal:'||NEW.id::text,v_delta,NEW.note,NEW.actor_id);
 END IF;
 RETURN NEW;
END
$body$;
REVOKE ALL ON FUNCTION private.apply_inflation_from_fiscal_ledger() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS apply_inflation_from_fiscal_ledger ON public.fiscal_change_ledger;
-- Filter irrelevant ledger entries before entering PL/pgSQL; no polling/subscription.
CREATE TRIGGER apply_inflation_from_fiscal_ledger
 AFTER INSERT ON public.fiscal_change_ledger FOR EACH ROW
 WHEN (
  (NEW.source_type IN ('event','budget_transfer','act')
    AND (NEW.before_values->'expenditure') IS DISTINCT FROM (NEW.after_values->'expenditure'))
  OR
  (NEW.source_type='macro'
    AND (NEW.before_values->'inflation') IS NOT DISTINCT FROM (NEW.after_values->'inflation')
    AND ((NEW.before_values->'federal_expenditure') IS DISTINCT FROM (NEW.after_values->'federal_expenditure')
      OR (NEW.before_values->'municipal_expenditure') IS DISTINCT FROM (NEW.after_values->'municipal_expenditure')))
 )
 EXECUTE FUNCTION private.apply_inflation_from_fiscal_ledger();

CREATE OR REPLACE FUNCTION private.apply_inflation_from_published_budget()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','private','pg_temp'
AS $body$
DECLARE v_prior jsonb;v_meta jsonb;v_new numeric;v_old numeric:=0;v_delta numeric;
BEGIN
 IF NEW.status<>'published' OR OLD.status='published' THEN RETURN NEW;END IF;
 SELECT d.metadata INTO v_meta FROM public.formal_documents d
 WHERE d.id=NEW.document_id AND d.game_id=NEW.game_id
 AND d.status_code='published' AND d.doc_type='federal_budget' AND d.workflow_key='budget';
 IF NOT FOUND THEN RETURN NEW;END IF;
 SELECT p.calculation INTO v_prior FROM public.budget_simulator_plans p
 WHERE p.game_id=NEW.game_id AND p.id::text=v_meta->>'budget_base_plan_id' AND p.status='published'
 LIMIT 1;
 IF v_prior IS NOT NULL THEN v_old:=private.budget_discretionary_expenditure(v_prior);END IF;
 v_new:=private.budget_discretionary_expenditure(NEW.calculation);
 v_delta:=v_new-v_old;
 IF v_delta<>0 THEN
  PERFORM private.apply_spending_inflation(NEW.game_id,
   'budget:'||NEW.id::text,v_delta,
   'Опубликованный бюджет: прямые расходы и госпрограммы; трансферты считаются отдельно при исполнении',
   NEW.updated_by);
 END IF;
 RETURN NEW;
END
$body$;
REVOKE ALL ON FUNCTION private.apply_inflation_from_published_budget() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS apply_inflation_from_published_budget ON public.budget_simulator_plans;
-- After the law has changed status AND state has been updated; avoids stale simulation during publication.
CREATE CONSTRAINT TRIGGER apply_inflation_from_published_budget
 AFTER UPDATE OF status ON public.budget_simulator_plans DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW WHEN (NEW.status='published' AND OLD.status IS DISTINCT FROM NEW.status)
 EXECUTE FUNCTION private.apply_inflation_from_published_budget();
