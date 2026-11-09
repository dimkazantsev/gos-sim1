-- ГОС.ID: one Stage 05 Goust Voting decision -> one State Duma resolution.
-- Preserve all ballots; a duplicated ballot is archived, never silently counted
-- as an independent legal decision. Do not alter the adopted game's vote rules.

-- A recorded vote may be superseded without pretending it passed or failed.
ALTER TABLE public.game_votes DROP CONSTRAINT IF EXISTS game_votes_result_code_check;
ALTER TABLE public.game_votes ADD CONSTRAINT game_votes_result_code_check
 CHECK (result_code IS NULL OR result_code IN ('passed','rejected','no_quorum','superseded'));

CREATE UNIQUE INDEX IF NOT EXISTS formal_stage5_ghost_source_unique
 ON public.formal_documents (game_id, (metadata->>'source_vote_id'))
 WHERE stage_no=5 AND doc_type='gd_resolution'
  AND metadata->>'source_type'='ghost_voting_policies'
  AND metadata->>'source_vote_id' IS NOT NULL;

-- When a decision predates a manually prepared resolution, link that resolution,
-- retaining its authored text, document number and authorised signatory.
-- The same helper is used for existing and future Stage 05 results.
CREATE OR REPLACE FUNCTION private.stage5_attach_verified_ghost_resolution(p_vote_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
DECLARE
 v public.game_votes%ROWTYPE;
 p public.ghost_voting_policies%ROWTYPE;
 doc_id uuid;
 candidate_count integer;
 previous_status text;
 previous_owner text;
BEGIN
 SELECT * INTO v FROM public.game_votes WHERE id=p_vote_id FOR UPDATE;
 IF v.id IS NULL OR v.stage_no<>5 OR v.procedure_key<>'ghost_policy'
    OR v.status<>'closed' OR v.result_code<>'passed' OR v.institution_key<>'gd'
 THEN RETURN NULL; END IF;
 SELECT * INTO p FROM public.ghost_voting_policies
 WHERE game_id=v.game_id AND vote_id=v.id AND status='adopted' LIMIT 1;
 IF p.id IS NULL THEN RETURN NULL; END IF;

 SELECT id INTO doc_id FROM public.formal_documents
 WHERE game_id=v.game_id AND stage_no=5 AND doc_type='gd_resolution'
  AND metadata->>'source_type'='ghost_voting_policies'
  AND metadata->>'source_vote_id'=v.id::text LIMIT 1;
 IF doc_id IS NOT NULL THEN
  IF v.formal_document_id IS NULL THEN
   UPDATE public.game_votes SET formal_document_id=doc_id,formal_step_code='adopted'
    WHERE id=v.id AND formal_document_id IS NULL;
  END IF;
  RETURN doc_id;
 END IF;
 IF v.formal_document_id IS NOT NULL THEN RETURN NULL; END IF;

 SELECT count(*) INTO candidate_count FROM public.formal_documents d
 WHERE d.game_id=v.game_id AND d.stage_no=5
  AND d.doc_type='gd_resolution' AND d.workflow_key='gd_resolution'
  AND d.subject_key='gd' AND d.status_code IN ('draft','agenda')
  AND d.current_step IN (0,1)
  AND d.metadata->>'template_key'='gd_resolution'
  AND d.metadata->>'stage_form'='true'
  AND d.metadata->>'source_vote_id' IS NULL
  AND coalesce(d.body_text,'') ~* '(ghost|goust|гост)[[:space:]]*vot'
  AND (CASE p.policy_mode WHEN 'prohibited' THEN d.body_text ~* 'запрет|запрещ'
   WHEN 'justified' THEN d.body_text ~* 'уважительн'
   WHEN 'allowed' THEN d.body_text ~* 'разреш' ELSE false END);
 IF candidate_count<>1 THEN RETURN NULL; END IF;

 SELECT d.id,d.status_code,d.current_owner_key INTO doc_id,previous_status,previous_owner FROM public.formal_documents d
 WHERE d.game_id=v.game_id AND d.stage_no=5
  AND d.doc_type='gd_resolution' AND d.workflow_key='gd_resolution'
  AND d.subject_key='gd' AND d.status_code IN ('draft','agenda')
  AND d.current_step IN (0,1)
  AND d.metadata->>'template_key'='gd_resolution'
  AND d.metadata->>'stage_form'='true'
  AND d.metadata->>'source_vote_id' IS NULL
  AND coalesce(d.body_text,'') ~* '(ghost|goust|гост)[[:space:]]*vot'
  AND (CASE p.policy_mode WHEN 'prohibited' THEN d.body_text ~* 'запрет|запрещ'
   WHEN 'justified' THEN d.body_text ~* 'уважительн'
   WHEN 'allowed' THEN d.body_text ~* 'разреш' ELSE false END)
 FOR UPDATE;
 IF doc_id IS NULL THEN RETURN NULL; END IF;

 PERFORM set_config('app.gos_stage5_verified_link',v.id::text,true);
 UPDATE public.formal_documents d
 SET current_step=2,status_code='adopted',
     status_label='Принято на этапе 05 · ожидает оформления и опубликования',
     current_owner_key='gd_staff',updated_at=now(),
     metadata=d.metadata||jsonb_build_object(
       'document_kind','stage5_ghost_policy_resolution',
       'source_type','ghost_voting_policies',
       'source_vote_id',v.id::text,'source_entity_id',p.id::text,
       'vote_result','passed','source_vote_majority',v.majority_kind,
       'linked_to_stage5_vote_at',now())
 WHERE d.id=doc_id;
 UPDATE public.game_votes SET formal_document_id=doc_id,formal_step_code='adopted'
  WHERE id=v.id AND formal_document_id IS NULL;
 INSERT INTO public.formal_document_history
  (document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
 SELECT doc_id,v.game_id,NULL,
  'Постановление связано с принятым решением этапа 05', previous_status,'adopted',
  previous_owner,'gd_staff',
  'Первичное голосование: '||v.id||'; результат: '||v.result_label||
  '. Повторного голосования по тому же решению не требуется.';
 RETURN doc_id;
END;
$function$;
REVOKE ALL ON FUNCTION private.stage5_attach_verified_ghost_resolution(uuid)
 FROM PUBLIC,anon,authenticated;

-- Runs after trg_ghost_policy_vote adopts the policy but before
-- zzz_sync_verified_vote_decision_act generates a fallback official act.
CREATE OR REPLACE FUNCTION private.stage5_link_ghost_vote_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
BEGIN
 PERFORM private.stage5_attach_verified_ghost_resolution(NEW.id);
 RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS zzy_stage5_link_ghost_vote ON public.game_votes;
CREATE TRIGGER zzy_stage5_link_ghost_vote
 AFTER UPDATE OF status,result_code ON public.game_votes
 FOR EACH ROW WHEN (NEW.stage_no=5 AND NEW.procedure_key='ghost_policy'
  AND NEW.status='closed' AND NEW.result_code='passed'
  AND (OLD.status IS DISTINCT FROM NEW.status
       OR OLD.result_code IS DISTINCT FROM NEW.result_code))
 EXECUTE FUNCTION private.stage5_link_ghost_vote_trigger();

-- Prevent a second ballot for the accepted Stage 05 decision, including
-- a direct table write attempting to bypass the frontend.
CREATE OR REPLACE FUNCTION private.stage5_guard_duplicate_ghost_ballot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
DECLARE d public.formal_documents%ROWTYPE;
BEGIN
 SELECT * INTO d FROM public.formal_documents WHERE id=NEW.formal_document_id;
 IF d.stage_no=5 AND d.doc_type='gd_resolution'
  AND d.game_id=NEW.game_id AND d.workflow_key='gd_resolution'
  AND (d.metadata->>'source_type'='ghost_voting_policies'
       OR coalesce(d.body_text,'') ~* '(ghost|goust|гост)[[:space:]]*vot')
  AND EXISTS (SELECT 1 FROM public.ghost_voting_policies p
   WHERE p.game_id=NEW.game_id AND p.status='adopted')
 THEN
  RAISE EXCEPTION 'Режим Goust Voting уже утверждён на этапе 05. Повторное голосование не требуется; оформите принятое постановление.'
   USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS z_stage5_no_duplicate_ghost_ballot ON public.game_votes;
CREATE TRIGGER z_stage5_no_duplicate_ghost_ballot
 BEFORE INSERT ON public.game_votes
 FOR EACH ROW WHEN (NEW.procedure_key='gd_resolution'
   AND NEW.formal_document_id IS NOT NULL)
 EXECUTE FUNCTION private.stage5_guard_duplicate_ghost_ballot();

-- Editing a new manually authored copy after the decision must not create
-- a second official resolution. Other State Duma business remains possible.
CREATE OR REPLACE FUNCTION private.stage5_guard_duplicate_ghost_document()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
BEGIN
 IF NEW.stage_no=5 AND NEW.doc_type='gd_resolution'
  AND coalesce(NEW.body_text,'') ~* '(ghost|goust|гост)[[:space:]]*vot'
  AND coalesce(NEW.metadata->>'source_type','')<>'ghost_voting_policies'
  AND EXISTS (SELECT 1 FROM public.formal_documents d
    WHERE d.game_id=NEW.game_id AND d.stage_no=5
    AND d.doc_type='gd_resolution' AND d.id IS DISTINCT FROM NEW.id
    AND d.metadata->>'source_type'='ghost_voting_policies')
 THEN RAISE EXCEPTION 'Постановление по Goust Voting уже существует. Откройте принятое постановление в Реестре НПА.'
  USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS z_stage5_no_duplicate_ghost_document ON public.formal_documents;
CREATE TRIGGER z_stage5_no_duplicate_ghost_document
 BEFORE INSERT OR UPDATE OF body_text ON public.formal_documents
 FOR EACH ROW WHEN (NEW.stage_no=5 AND NEW.doc_type='gd_resolution')
 EXECUTE FUNCTION private.stage5_guard_duplicate_ghost_document();

-- Protect the verified origin of an existing student-authored act. Converting
-- an ordinary draft to a verified act is only possible within the private
-- synchronisation transaction, with the matching adopted source vote.
CREATE OR REPLACE FUNCTION private.stage5_guard_verified_ghost_provenance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
BEGIN
 IF TG_OP='INSERT' THEN
  RAISE EXCEPTION 'Источник постановления фиксируется только серверной процедурой'
   USING ERRCODE='42501';
 END IF;
 IF OLD.metadata->>'document_kind' IS DISTINCT FROM
      NEW.metadata->>'document_kind'
    OR OLD.metadata->>'source_vote_id' IS DISTINCT FROM
      NEW.metadata->>'source_vote_id'
    OR OLD.metadata->>'source_entity_id' IS DISTINCT FROM
      NEW.metadata->>'source_entity_id'
    OR OLD.metadata->>'source_type' IS DISTINCT FROM
      NEW.metadata->>'source_type'
    OR OLD.game_id IS DISTINCT FROM NEW.game_id
    OR OLD.stage_no IS DISTINCT FROM NEW.stage_no
    OR OLD.doc_type IS DISTINCT FROM NEW.doc_type
    OR OLD.subject_key IS DISTINCT FROM NEW.subject_key
 THEN
  IF OLD.metadata->>'document_kind' IS NULL
    AND NEW.metadata->>'document_kind'='stage5_ghost_policy_resolution'
    AND current_setting('app.gos_stage5_verified_link',true)=NEW.metadata->>'source_vote_id'
    AND NEW.stage_no=5 AND NEW.doc_type='gd_resolution'
    AND EXISTS (SELECT 1 FROM public.game_votes v
      JOIN public.ghost_voting_policies p ON p.vote_id=v.id
      WHERE v.id::text=NEW.metadata->>'source_vote_id'
       AND v.game_id=NEW.game_id AND v.stage_no=5
       AND v.procedure_key='ghost_policy' AND v.status='closed'
       AND v.result_code='passed' AND p.status='adopted'
       AND p.id::text=NEW.metadata->>'source_entity_id')
  THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Нельзя подменять источник принятого постановления'
   USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS stage5_guard_ghost_origin_insert ON public.formal_documents;
CREATE TRIGGER stage5_guard_ghost_origin_insert
 BEFORE INSERT ON public.formal_documents
 FOR EACH ROW WHEN (NEW.metadata->>'document_kind'='stage5_ghost_policy_resolution')
 EXECUTE FUNCTION private.stage5_guard_verified_ghost_provenance();
DROP TRIGGER IF EXISTS stage5_guard_ghost_origin_update ON public.formal_documents;
CREATE TRIGGER stage5_guard_ghost_origin_update
 BEFORE UPDATE OF metadata,game_id,stage_no,doc_type,subject_key
 ON public.formal_documents
 FOR EACH ROW WHEN (OLD.metadata->>'document_kind'='stage5_ghost_policy_resolution'
  OR NEW.metadata->>'document_kind'='stage5_ghost_policy_resolution')
 EXECUTE FUNCTION private.stage5_guard_verified_ghost_provenance();

-- Abandoned repeat ballots are archived (all ballots remain) without
-- producing a spurious vote_closed impact or a second "result" news item.
DROP TRIGGER IF EXISTS trg_impact_vote_close ON public.game_votes;
CREATE TRIGGER trg_impact_vote_close
 AFTER UPDATE OF status,result_code ON public.game_votes
 FOR EACH ROW WHEN (NEW.result_code IS DISTINCT FROM 'superseded')
 EXECUTE FUNCTION private.impact_vote_close_trigger();
DROP TRIGGER IF EXISTS publish_vote_process ON public.game_votes;
CREATE TRIGGER publish_vote_process
 AFTER UPDATE OF status ON public.game_votes
 FOR EACH ROW WHEN (NEW.result_code IS DISTINCT FROM 'superseded')
 EXECUTE FUNCTION private.publish_process_update();

-- Reconcile precisely one authored Stage 05 act per confirmed source.
DO $backfill$
DECLARE row record;
BEGIN
 FOR row IN SELECT v.id FROM public.game_votes v
  JOIN public.ghost_voting_policies p ON p.vote_id=v.id
  WHERE v.stage_no=5 AND v.procedure_key='ghost_policy'
    AND v.status='closed' AND v.result_code='passed' AND p.status='adopted'
 LOOP
  PERFORM private.stage5_attach_verified_ghost_resolution(row.id);
 END LOOP;
END;
$backfill$;

-- Terminate duplicate open ballots without affecting the first vote, signed
-- document, author, electorate snapshot or any individual ballot record.
WITH duplicates AS (
 SELECT v.id, d.metadata->>'source_vote_id' AS original_vote_id,
  coalesce(sum(b.weight),0) AS casted,
  coalesce(sum(b.yes_weight),0) AS yes_count,
  coalesce(sum(b.no_weight),0) AS no_count,
  coalesce(sum(b.abstain_weight),0) AS abstain_count
 FROM public.game_votes v JOIN public.formal_documents d ON d.id=v.formal_document_id
 LEFT JOIN public.game_ballots b ON b.vote_id=v.id
 WHERE v.status='open' AND v.procedure_key='gd_resolution'
  AND v.stage_no=5 AND d.status_code='adopted'
  AND d.metadata->>'source_type'='ghost_voting_policies'
  AND d.metadata->>'source_vote_id' IS NOT NULL
 GROUP BY v.id,d.metadata->>'source_vote_id'
)
UPDATE public.game_votes v
SET status='closed',closed_at=now(),result_code='superseded',
 result_label='Отменено: повторное голосование',
 result_yes=x.yes_count,result_no=x.no_count,
 result_abstain=x.abstain_count,result_cast=x.casted,
 result_eligible=coalesce((v.electorate_snapshot->>'eligible')::numeric,0),
 result_quorum_met=NULL,pass_transition='none',fail_transition='none',
 decision_note='Технически закрыто как дублирующее. Бюллетени сохранены; юридический источник — принятое голосование '||x.original_vote_id||'.'
FROM duplicates x WHERE v.id=x.id;

-- If another migration adds a verified act later, the partial unique index
-- prevents two definitive resolutions from the same source vote.
