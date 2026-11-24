-- NULL-safe scope: ordinary federal laws have no cutoff_price_proposal flag.
-- Preserve every authorization and fiscal check for explicitly marked proposals.
CREATE OR REPLACE FUNCTION private.apply_cutoff_price_on_publication()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE p private.cutoff_price_law_proposals%rowtype;v_old jsonb;v_new jsonb;
BEGIN
 IF NEW.status_code<>'published' OR OLD.status_code='published'
   OR NEW.doc_type<>'fz_bill' OR NEW.workflow_key<>'bill'
   OR (NEW.metadata->>'cutoff_price_proposal') IS DISTINCT FROM 'true'
 THEN RETURN NEW;END IF;
 SELECT * INTO p FROM private.cutoff_price_law_proposals WHERE document_id=NEW.id FOR UPDATE;
 IF p.document_id IS NULL OR p.game_id<>NEW.game_id OR p.author_id<>NEW.author_id
   OR p.applied_at IS NOT NULL OR OLD.status_code NOT IN ('president','veto_overridden')
   OR NOT private.matches_formal_owner(NEW.game_id,auth.uid(),'president',NEW.author_id)
   OR NOT EXISTS(SELECT 1 FROM public.game_profiles gp WHERE
     gp.game_id=NEW.game_id AND gp.user_id=auth.uid() AND nullif(gp.signature_path,'') IS NOT NULL)
 THEN RAISE EXCEPTION 'Отсутствует подтверждённая подпись Президента или авторизация закона.' USING errcode='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.game_votes v WHERE
  v.formal_document_id=NEW.id AND v.formal_step_code='government'
  AND v.procedure_key='cutoff_government_submission'
  AND v.status='closed' AND v.result_code='passed' AND v.result_quorum_met)
 OR NOT EXISTS(SELECT 1 FROM public.game_votes v WHERE
  v.formal_document_id=NEW.id AND v.formal_step_code='reading3'
  AND v.status='closed' AND v.result_code='passed' AND v.result_quorum_met)
 OR NOT(p.sf_confirmed_at IS NOT NULL OR EXISTS(SELECT 1 FROM public.game_votes v WHERE
  v.formal_document_id=NEW.id AND v.formal_step_code='sf'
  AND v.procedure_key='cutoff_sf_review' AND v.status='closed'
  AND v.result_code='passed' AND v.result_quorum_met))
 THEN RAISE EXCEPTION 'Законопроект не прошёл Правительство, Государственную Думу и Совет Федерации.' USING errcode='42501';END IF;
 SELECT to_jsonb(f.*) INTO v_old FROM public.game_fiscal_policy f
 WHERE f.game_id=NEW.game_id FOR UPDATE;
 IF v_old IS NULL OR (v_old->>'cutoff_price')::numeric IS DISTINCT FROM p.old_price
 THEN RAISE EXCEPTION 'Цена отсечения изменилась. Подготовьте новую инициативу.' USING errcode='40001';END IF;
 UPDATE public.game_fiscal_policy SET cutoff_price=p.new_price,updated_at=now()
 WHERE game_id=NEW.game_id RETURNING to_jsonb(game_fiscal_policy.*) INTO v_new;
 UPDATE private.cutoff_price_law_proposals SET applied_at=now() WHERE document_id=NEW.id;
 INSERT INTO public.fiscal_change_ledger(game_id,source_type,source_id,note,before_values,after_values,actor_id)
 VALUES(NEW.game_id,'macro',NEW.id::text,
  'Цена отсечения изменена опубликованным федеральным законом '||NEW.registry_no,
  v_old,v_new,auth.uid());
 RETURN NEW;
END $function$;
