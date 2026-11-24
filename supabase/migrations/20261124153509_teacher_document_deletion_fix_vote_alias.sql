CREATE OR REPLACE FUNCTION private.teacher_delete_formal_document_internal(p_document_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE d public.formal_documents%rowtype; s public.government_sessions%rowtype; u uuid:=auth.uid();v_row record;accepted uuid;open_votes uuid[];a jsonb;
BEGIN
 SELECT * INTO d FROM public.formal_documents WHERE id=p_document_id;
 IF d.id IS NULL OR u IS NULL OR NOT private.is_game_teacher(d.game_id) OR NOT private.is_game_member(d.game_id) OR private.is_game_observer(d.game_id)
 THEN RAISE EXCEPTION 'Удалить документ может только преподаватель этой игры' USING ERRCODE='42501';END IF;
 -- Same order as the meeting procedures: session before document.
 IF d.doc_type='meeting_agenda' AND d.subject_key='government' THEN
  SELECT * INTO s FROM public.government_sessions WHERE agenda_document_id=d.id AND game_id=d.game_id FOR UPDATE;
 END IF;
 SELECT * INTO d FROM public.formal_documents WHERE id=p_document_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('deleted',false,'id',p_document_id);END IF;
 IF s.id IS NOT NULL AND private.government_agenda_adopted(s.id) THEN accepted:=s.agenda_vote_id;END IF;
 SELECT coalesce(array_agg(DISTINCT x.id),'{}'::uuid[]) INTO open_votes FROM (
  SELECT v.id FROM public.game_votes v WHERE v.game_id=d.game_id AND v.formal_document_id=d.id AND v.status='open'
  UNION SELECT v.id FROM public.game_votes v JOIN public.bill_amendment_packs p ON p.vote_id=v.id AND p.game_id=v.game_id WHERE p.document_id=d.id AND p.game_id=d.game_id AND v.status='open'
  UNION SELECT v.id FROM public.game_votes v JOIN public.budget_law_amendment_packs p ON p.vote_id=v.id AND p.game_id=v.game_id WHERE p.document_id=d.id AND p.game_id=d.game_id AND v.status='open'
 ) x;
 -- Store the deleted record and its immutable evidence privately, not in the working registry.
 a:=jsonb_build_object('document',to_jsonb(d),
  'history',(SELECT coalesce(jsonb_agg(to_jsonb(h)),'[]') FROM public.formal_document_history h WHERE h.document_id=d.id),
  'signatures',(SELECT coalesce(jsonb_agg(to_jsonb(h)),'[]') FROM public.formal_document_signatures h WHERE h.document_id=d.id),
  'bill_amendments',(SELECT coalesce(jsonb_agg(to_jsonb(h)),'[]') FROM public.bill_amendments h WHERE h.document_id=d.id),
  'budget_amendments',(SELECT coalesce(jsonb_agg(to_jsonb(h)),'[]') FROM public.budget_law_amendments h WHERE h.document_id=d.id),
  'bill_packs',(SELECT coalesce(jsonb_agg(to_jsonb(h)),'[]') FROM public.bill_amendment_packs h WHERE h.document_id=d.id),
  'budget_packs',(SELECT coalesce(jsonb_agg(to_jsonb(h)),'[]') FROM public.budget_law_amendment_packs h WHERE h.document_id=d.id),
  'linked_votes',(SELECT coalesce(jsonb_agg(to_jsonb(h)),'[]') FROM public.game_votes h WHERE h.formal_document_id=d.id OR h.id=ANY(open_votes)),
  'cancelled_ballots',(SELECT coalesce(jsonb_agg(to_jsonb(h)),'[]') FROM public.game_ballots h WHERE h.vote_id=ANY(open_votes)));
 INSERT INTO private.teacher_formal_document_deletions(document_id,game_id,actor_id,snapshot,accepted_agenda_vote_id) VALUES(d.id,d.game_id,u,a,accepted);
 PERFORM set_config('app.gos_teacher_delete_document',d.id::text,true);
 IF s.id IS NOT NULL THEN
  UPDATE public.government_sessions SET agenda_document_id=NULL,agenda_approved_at=NULL,agenda_approved_by=NULL,
   moderator_approval_hash=NULL,moderator_approved_by=NULL,moderator_approved_at=NULL,
   deleted_accepted_agenda_id=case when accepted IS NOT NULL then d.id else NULL end,
   agenda_vote_id=case when accepted IS NOT NULL then accepted else NULL end
  WHERE id=s.id AND agenda_document_id=d.id;
 END IF;
 UPDATE public.institution_meeting_records SET agenda_approved_at=NULL,agenda_approved_by=NULL,agenda_body=NULL,agenda_document_id=NULL,updated_at=now()
 WHERE game_id=d.game_id AND agenda_document_id=d.id;
 UPDATE public.presidential_election_schedule SET appointment_document_id=NULL WHERE game_id=d.game_id AND appointment_document_id=d.id;
 -- Unlink only the amendment records being removed; keep closed votes intact.
 UPDATE public.bill_amendment_packs SET vote_id=NULL WHERE game_id=d.game_id AND document_id=d.id AND vote_id=ANY(open_votes);
 UPDATE public.bill_amendments SET vote_id=NULL WHERE game_id=d.game_id AND document_id=d.id AND vote_id=ANY(open_votes);
 UPDATE public.budget_law_amendment_packs SET vote_id=NULL WHERE game_id=d.game_id AND document_id=d.id AND vote_id=ANY(open_votes);
 UPDATE public.budget_law_amendments SET vote_id=NULL WHERE game_id=d.game_id AND document_id=d.id AND vote_id=ANY(open_votes);
 FOR v_row IN SELECT id,procedure_key FROM public.game_votes WHERE game_id=d.game_id AND id=ANY(open_votes) AND status='open' ORDER BY id FOR UPDATE LOOP
  IF v_row.procedure_key='government_agenda' THEN
   DELETE FROM public.game_votes WHERE id=v_row.id;
  ELSE
   PERFORM public.delete_procedural_vote(v_row.id);
  END IF;
 END LOOP;
 UPDATE public.budget_simulator_plans SET document_id=NULL,status=case when status='document' then 'draft' else status end WHERE game_id=d.game_id AND document_id=d.id;
 DELETE FROM public.formal_documents WHERE id=d.id AND game_id=d.game_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Документ уже изменён';END IF;
 PERFORM set_config('app.gos_teacher_delete_document','',true);
 INSERT INTO public.audit_log(game_id,actor_id,action,entity_type,entity_id,payload)
 VALUES(d.game_id,u,'teacher_formal_document_deleted','formal_documents',d.id,jsonb_build_object('registry_no',d.registry_no,'doc_type',d.doc_type,'stage_no',d.stage_no,'cancelled_open_votes',cardinality(open_votes),'preserved_accepted_agenda_vote',accepted));
 RETURN jsonb_build_object('deleted',true,'id',d.id,'registry_no',d.registry_no);
END;$function$
;