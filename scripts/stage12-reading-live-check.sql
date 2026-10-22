-- Fictional fixture only. All writes are rolled back, including auth identities.
BEGIN;
DO $$
DECLARE g uuid:=gen_random_uuid();t uuid:=gen_random_uuid();a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();party uuid:=gen_random_uuid();unit uuid:=gen_random_uuid();d uuid:=gen_random_uuid();d2 uuid:=gen_random_uuid();steps jsonb;s uuid;bad boolean:=false;
BEGIN
 INSERT INTO auth.users(id,aud,role) VALUES(t,'authenticated','authenticated'),(a,'authenticated','authenticated'),(b,'authenticated','authenticated');
 INSERT INTO public.games(id,title,game_code,owner_id,status,current_round,turn_open) VALUES(g,'QA Stage12 release','QA'||substr(replace(g::text,'-',''),1,12),t,'running',12,true);
 INSERT INTO public.game_stages(game_id,stage_no,title,mode,summary,status) SELECT g,n,'QA stage '||n,'Учебная процедура','QA',CASE WHEN n=12 THEN 'open' ELSE 'locked' END FROM generate_series(1,16)n;
 INSERT INTO public.game_members(game_id,user_id,full_name,kind,role_title,team) VALUES(g,t,'QA teacher','teacher','Преподаватель',NULL),(g,a,'QA chair','student','Депутат Государственной Думы · Председатель Государственной Думы','QA release party'),(g,b,'QA deputy','student','Депутат Государственной Думы','QA release party');
 INSERT INTO public.game_parties(id,game_id,name,mandates,leader_user_id) VALUES(party,g,'QA release party',450,a);
 INSERT INTO public.institution_units(id,game_id,unit_kind,unit_key,title,head_user_id) VALUES(unit,g,'committee','qa-release-committee','QA release committee',a);
 steps:=private.formal_workflow('bill');
 INSERT INTO public.formal_documents(id,game_id,stage_no,registry_no,title,doc_type,subject_key,subject_label,author_id,body_text,workflow_key,workflow_steps,current_step,status_code,status_label,current_owner_key)
 SELECT x,g,12,'QA-'||substr(x::text,1,8),'QA release bill','fz_bill','gd_deputy','Депутат ГД',a,'Статья 1. Срок составляет десять дней.','bill',steps,(SELECT ordinality::integer-1 FROM jsonb_array_elements(steps) WITH ORDINALITY st WHERE st.value->>'code'='reading1'),'reading1','I чтение','gd' FROM unnest(array[d,d2])x;
 INSERT INTO public.bill_submission_profiles(document_id,game_id,committee_key) VALUES(d,g,'qa-release-committee'),(d2,g,'qa-release-committee');
 INSERT INTO public.bill_committee_conclusions(document_id,game_id,rapporteur_user_id,recommendation,finalized,updated_by) VALUES(d,g,a,'proceed',true,a),(d2,g,a,'proceed',false,a);
 PERFORM set_config('request.jwt.claim.sub',t::text,true);
 PERFORM public.set_student_mandates(party,jsonb_build_object(a::text,225,b::text,225));
 s:=public.create_duma_reading_session(g,1,'QA release first reading',now(),now()+interval '1 day');
 IF (SELECT count(*) FROM public.duma_agenda_items WHERE session_id=s)<>2 THEN RAISE EXCEPTION 'FAIL automatic agenda';END IF;
 BEGIN PERFORM public.approve_institution_meeting_agenda(g,12,'gd'); EXCEPTION WHEN OTHERS THEN IF sqlerrm NOT LIKE '%передать все пакеты%' THEN RAISE;END IF;bad:=true;END;
 IF NOT bad THEN RAISE EXCEPTION 'FAIL incomplete package approved';END IF;
 UPDATE public.bill_committee_conclusions SET finalized=true WHERE document_id=d2;
 PERFORM set_config('qa.release.game',g::text,true);PERFORM set_config('qa.release.teacher',t::text,true);PERFORM set_config('qa.release.a',a::text,true);PERFORM set_config('qa.release.b',b::text,true);PERFORM set_config('qa.release.document',d::text,true);PERFORM set_config('qa.release.session',s::text,true);
END;$$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE g uuid:=current_setting('qa.release.game')::uuid;t uuid:=current_setting('qa.release.teacher')::uuid;a uuid:=current_setting('qa.release.a')::uuid;b uuid:=current_setting('qa.release.b')::uuid;d uuid:=current_setting('qa.release.document')::uuid;s uuid:=current_setting('qa.release.session')::uuid;item uuid;bad boolean:=false;v uuid;result jsonb;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',t::text,true);
 PERFORM public.approve_institution_meeting_agenda(g,12,'gd');
 IF (SELECT status FROM public.duma_sessions WHERE id=s)<>'draft' THEN RAISE EXCEPTION 'FAIL approval opened without quorum';END IF;
 PERFORM set_config('request.jwt.claim.sub',a::text,true);PERFORM public.set_gd_session_attendance(g,12,225);
 IF (SELECT status FROM public.duma_sessions WHERE id=s)<>'draft' THEN RAISE EXCEPTION 'FAIL 225 opened session';END IF;
 PERFORM set_config('request.jwt.claim.sub',b::text,true);PERFORM public.set_gd_session_attendance(g,12,225);
 IF (SELECT status FROM public.duma_sessions WHERE id=s)<>'open' THEN RAISE EXCEPTION 'FAIL quorum did not open';END IF;
 PERFORM public.set_gd_session_attendance(g,12,225);
 PERFORM public.submit_stage12_bill_review(d,'gd_deputy','QA: Поддерживаю концепцию законопроекта при уточнении срока исполнения.',NULL);
 SELECT id INTO item FROM public.duma_agenda_items WHERE session_id=s AND formal_document_id=d;
 PERFORM set_config('request.jwt.claim.sub',a::text,true);PERFORM public.set_duma_agenda_item_status(item,'in_progress',NULL);
 IF EXISTS(SELECT 1 FROM public.game_votes WHERE formal_document_id=d AND status='open') THEN RAISE EXCEPTION 'FAIL vote before discussion';END IF;
 BEGIN PERFORM public.set_duma_discussion_phase(item,'vote',NULL,NULL);EXCEPTION WHEN OTHERS THEN IF sqlerrm NOT LIKE '%последовательно%' THEN RAISE;END IF;bad:=true;END;
 IF NOT bad THEN RAISE EXCEPTION 'FAIL phases skipped';END IF;
 PERFORM public.set_duma_discussion_phase(item,'report',a,60);
 PERFORM public.set_duma_discussion_phase(item,'committee',NULL,NULL);
 PERFORM public.set_duma_discussion_phase(item,'committee',a,60);
 PERFORM public.set_duma_discussion_phase(item,'questions',NULL,NULL);
 PERFORM public.set_duma_discussion_phase(item,'questions',b,60);
 PERFORM public.set_duma_discussion_phase(item,'debate',NULL,NULL);
 PERFORM public.set_duma_discussion_phase(item,'debate',b,60);
 PERFORM public.set_duma_discussion_phase(item,'vote',NULL,NULL);
 SELECT id INTO v FROM public.game_votes WHERE formal_document_id=d AND status='open';
 IF v IS NULL THEN RAISE EXCEPTION 'FAIL final phase did not open vote';END IF;
 PERFORM public.cast_vote_allocation(v,225,0,0);PERFORM set_config('request.jwt.claim.sub',b::text,true);PERFORM public.cast_vote_allocation(v,225,0,0);
 PERFORM set_config('request.jwt.claim.sub',t::text,true);result:=public.close_procedural_vote(v,'QA release vote');
 IF (SELECT status_code FROM public.formal_documents WHERE id=d)<>'amendments' THEN RAISE EXCEPTION 'FAIL first reading route: %',result;END IF;
 PERFORM public.close_duma_session(s,false);
 IF (SELECT status FROM public.duma_agenda_items WHERE id=item)<>'completed' THEN RAISE EXCEPTION 'FAIL decided reading carried';END IF;
END;$$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: full-schema RPC integration, automatic two-bill agenda, all-ready guard, approval, 225/450 block, quorum opening, repeated attendance, subject review, ordered discussion, automatic ballot, 450 votes, first-reading transition and completed-question close. Fictional writes rolled back.' AS result;
