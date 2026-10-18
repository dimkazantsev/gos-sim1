-- ГОС.ID: единственное принятое решение по президентской поправке,
-- а также загрузка документов кандидата действительными членами выдвинувшей партии.
-- Личные анкеты, подписи, программы и полномочия ЦИК не расширяются.

CREATE OR REPLACE FUNCTION private.can_upload_presidential_candidate_document(p_candidate uuid,p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $fn$
 SELECT p_user IS NOT NULL AND p_user=auth.uid()
 AND EXISTS (
  SELECT 1 FROM public.presidential_candidates c
  WHERE c.id=p_candidate AND (
   private.can_manage_presidential_candidate(c.id,p_user)
   OR (
    c.nomination_type='party' AND c.party_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.game_parties p
      JOIN public.game_members gm ON gm.game_id=p.game_id
       AND gm.user_id=p_user AND gm.kind='student'
       AND gm.roster_archived_at IS NULL AND gm.team=p.name
      WHERE p.id=c.party_id AND p.game_id=c.game_id
       AND p.registration_status='registered'
    )
   )
  )
 );
$fn$;
REVOKE ALL ON FUNCTION private.can_upload_presidential_candidate_document(uuid,uuid)
 FROM PUBLIC,anon,authenticated;

-- Keep the current implementation of both RPCs, adjusting only the authorization
-- predicate. Fail the whole migration if the current definitions differ.
DO $patch$
DECLARE v_name text;v_def text;v_new text;
BEGIN
 FOREACH v_name IN ARRAY ARRAY[
  'public.add_presidential_candidate_document(uuid,text,text,text,text,text,bigint)',
  'public.save_presidential_candidate_document_text(uuid,text,text)'
 ] LOOP
   SELECT pg_get_functiondef(to_regprocedure(v_name)) INTO v_def;
   IF v_def IS NULL THEN RAISE EXCEPTION 'Expected candidate document function missing: %',v_name; END IF;
   IF position('private.can_manage_presidential_candidate' IN v_def)>0 THEN
    v_new:=replace(v_def,'private.can_manage_presidential_candidate',
      'private.can_upload_presidential_candidate_document');
    EXECUTE v_new;
   ELSIF v_name LIKE 'public.add_presidential_candidate_document%' THEN
    RAISE EXCEPTION 'Upload RPC guard changed: %',v_name;
   END IF;
 END LOOP;
END $patch$;

-- Allow only a member of the same registered party to upload a file into this
-- candidate's document directory. All other storage paths stay unchanged.
DROP POLICY IF EXISTS gos_party_candidate_doc_upload ON storage.objects;
CREATE POLICY gos_party_candidate_doc_upload ON storage.objects
 FOR INSERT TO authenticated WITH CHECK(
  bucket_id='game-assets'
  AND split_part(name,'/',2)='presidential'
  AND split_part(name,'/',4)='docs'
  AND EXISTS(
    SELECT 1 FROM public.presidential_candidates c
    WHERE c.id::text=split_part(name,'/',3)
     AND c.game_id::text=split_part(name,'/',1)
     AND private.can_upload_presidential_candidate_document(c.id,auth.uid())
  )
 );

-- Close alternative proposals when one amendment is adopted, including their
-- open ballots. Do not fabricate votes cast or numerical voting results.
CREATE OR REPLACE FUNCTION private.finalize_alternative_presidential_proposals(
 p_game uuid,p_winner uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $fn$
BEGIN
 IF NOT EXISTS(
   SELECT 1 FROM public.presidential_system_proposals p
    WHERE p.id=p_winner AND p.game_id=p_game AND p.status='adopted'
 ) THEN RETURN; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('presidential-system-decision:'||p_game::text,0));

 UPDATE public.game_votes v SET status='closed',closed_at=clock_timestamp(),
    result_code='rejected',result_label='Отклонено в связи с принятием альтернативной поправки'
 FROM public.presidential_system_proposals p
 WHERE p.game_id=p_game AND p.id<>p_winner AND p.vote_id=v.id
   AND p.status IN ('draft','registered','vote_open') AND v.status='open';

 UPDATE public.presidential_system_proposals p SET
    status='rejected',updated_at=clock_timestamp()
 WHERE p.game_id=p_game AND p.id<>p_winner AND p.status IN ('draft','registered','vote_open');

 UPDATE public.formal_documents d SET
    status_code='rejected',
    status_label='Отклонён в связи с принятием альтернативной поправки',
    current_owner_key='system',updated_at=clock_timestamp()
 FROM public.presidential_system_proposals p
 WHERE p.game_id=p_game AND p.id<>p_winner AND p.bill_document_id=d.id
   AND p.status='rejected' AND d.status_code NOT IN ('rejected','published');
END;
$fn$;
REVOKE ALL ON FUNCTION private.finalize_alternative_presidential_proposals(uuid,uuid)
 FROM PUBLIC,anon,authenticated;

-- No new competing bill may appear after the election system was accepted.
-- Share the same advisory lock as vote closure to avoid a create/accept race.
CREATE OR REPLACE FUNCTION private.guard_new_presidential_system_proposal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $fn$
BEGIN
 IF NEW.status NOT IN ('draft','registered','vote_open','adopted')
 THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('presidential-system-decision:'||NEW.game_id::text,0));
 IF EXISTS(
  SELECT 1 FROM public.presidential_system_proposals p
  WHERE p.game_id=NEW.game_id AND p.id IS DISTINCT FROM NEW.id AND p.status='adopted'
 ) THEN
  RAISE EXCEPTION 'Избирательная система уже утверждена. Альтернативный проект отклонён'
   USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END;$fn$;
REVOKE ALL ON FUNCTION private.guard_new_presidential_system_proposal()
 FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS presidential_single_new_proposal ON public.presidential_system_proposals;
CREATE TRIGGER presidential_single_new_proposal
 BEFORE INSERT OR UPDATE OF status ON public.presidential_system_proposals
 FOR EACH ROW EXECUTE FUNCTION private.guard_new_presidential_system_proposal();

-- A late vote cannot replace the earlier adopted election system.
CREATE OR REPLACE FUNCTION private.guard_exclusive_presidential_system_decision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $fn$
BEGIN
 IF NEW.procedure_key IS DISTINCT FROM 'presidential_system'
    OR NEW.status<>'closed' OR NEW.result_code<>'passed'
    OR (OLD.status='closed' AND OLD.result_code='passed')
 THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('presidential-system-decision:'||NEW.game_id::text,0));
 IF EXISTS(
  SELECT 1 FROM public.presidential_system_proposals p
  WHERE p.game_id=NEW.game_id AND p.status='adopted' AND p.vote_id<>NEW.id
 ) THEN
  NEW.result_code:='rejected';
  NEW.result_label:='Отклонено: ранее принята другая поправка';
 END IF;
 RETURN NEW;
END;$fn$;
REVOKE ALL ON FUNCTION private.guard_exclusive_presidential_system_decision()
 FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS a_guard_exclusive_presidential_system_decision ON public.game_votes;
CREATE TRIGGER a_guard_exclusive_presidential_system_decision
 BEFORE UPDATE OF status,result_code ON public.game_votes
 FOR EACH ROW EXECUTE FUNCTION private.guard_exclusive_presidential_system_decision();

CREATE OR REPLACE FUNCTION private.on_presidential_proposal_adopted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $fn$
BEGIN
 IF NEW.status='adopted' AND OLD.status IS DISTINCT FROM NEW.status
 THEN PERFORM private.finalize_alternative_presidential_proposals(NEW.game_id,NEW.id); END IF;
 RETURN NEW;
END;$fn$;
REVOKE ALL ON FUNCTION private.on_presidential_proposal_adopted()
 FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS presidential_single_adopted_proposal ON public.presidential_system_proposals;
CREATE TRIGGER presidential_single_adopted_proposal
 AFTER UPDATE OF status ON public.presidential_system_proposals
 FOR EACH ROW EXECUTE FUNCTION private.on_presidential_proposal_adopted();

-- Existing games may already contain an adopted law alongside still-open
-- alternatives. Reconcile only games with exactly one adopted proposal.
DO $backfill$
DECLARE r record;
BEGIN
 FOR r IN
  SELECT game_id,max(id::text)::uuid AS winner
  FROM public.presidential_system_proposals
  WHERE status='adopted'
  GROUP BY game_id HAVING count(*)=1
 LOOP
  PERFORM private.finalize_alternative_presidential_proposals(r.game_id,r.winner);
 END LOOP;
END $backfill$;
