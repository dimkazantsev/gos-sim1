-- Fictional actors and classroom, all writes roll back.
BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='5s';
DO $seed$
DECLARE g uuid:=gen_random_uuid();t uuid:=gen_random_uuid();a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();p uuid:=gen_random_uuid();pm uuid:=gen_random_uuid();m uuid:=gen_random_uuid();party uuid:=gen_random_uuid();
BEGIN
 INSERT INTO auth.users(id,aud,role) SELECT x,'authenticated','authenticated' FROM unnest(array[t,a,b,p,pm,m]) x;
 PERFORM set_config('request.jwt.claim.sub',t::text,true);
 INSERT INTO public.games(id,title,game_code,owner_id,status,current_round,turn_open) VALUES(g,'QA cutoff 2027 law','QA'||substr(replace(g::text,'-',''),1,12),t,'running',13,true);
 INSERT INTO public.game_stages(game_id,stage_no,title,mode,summary,status) SELECT g,n,'QA '||n,'Учебная процедура','QA',CASE WHEN n IN (1,12,13) THEN 'open' ELSE 'locked' END FROM generate_series(1,16)n ON CONFLICT(game_id,stage_no) DO NOTHING;
 INSERT INTO public.game_members(game_id,user_id,full_name,kind,role_title,team) VALUES
 (g,t,'QA teacher','teacher','Преподаватель',null),(g,a,'QA chair','student','Депутат Государственной Думы · Председатель Государственной Думы','QA party'),(g,b,'QA deputy','student','Депутат Государственной Думы','QA party'),(g,p,'QA president','student','Президент Российской Федерации',null),(g,pm,'QA PM','student','Председатель Правительства Российской Федерации',null),(g,m,'QA minister','student','Министр экономики',null);
 INSERT INTO public.game_parties(id,game_id,name,mandates,leader_user_id) VALUES(party,g,'QA party',450,a);
 INSERT INTO public.institution_units(game_id,unit_kind,unit_key,title,head_user_id) VALUES(g,'committee','qa-cutoff-committee','QA committee',a);
 INSERT INTO public.game_office_assignments(game_id,user_id,role_title,status,appointed_by,approved_by,legal_basis) VALUES(g,a,'Председатель Государственной Думы','active',t,t,'QA'),(g,p,'Президент Российской Федерации','active',t,t,'QA'),(g,pm,'Председатель Правительства Российской Федерации','active',t,t,'QA'),(g,m,'Министерство по экономической политике','active',t,t,'QA') ON CONFLICT DO NOTHING;
 INSERT INTO public.game_profiles(game_id,user_id,signature_path) SELECT g,x,g::text||'/profiles/'||x::text||'/signature-qa.png' FROM unnest(array[a,p,pm]) x;
 INSERT INTO storage.objects(bucket_id,name) SELECT 'game-assets',g::text||'/profiles/'||x::text||'/signature-qa.png' FROM unnest(array[a,p,pm]) x;
 PERFORM public.set_student_mandates(party,jsonb_build_object(a::text,225,b::text,225));
 PERFORM private.ensure_budget_simulator(g);
 UPDATE public.game_fiscal_policy SET oil_price=45,cutoff_price=40 WHERE game_id=g;
 PERFORM set_config('qa.cutoff.game',g::text,true);
 PERFORM set_config('qa.cutoff.users',jsonb_build_object('teacher',t,'chair',a,'deputy',b,'president',p,'pm',pm,'minister',m)::text,true);
END;$seed$;
SET LOCAL ROLE authenticated;
DO $submission$
DECLARE g uuid:=current_setting('qa.cutoff.game')::uuid;ids jsonb:=current_setting('qa.cutoff.users')::jsonb;d uuid;v uuid;req uuid:=gen_random_uuid();k text;r jsonb;denied boolean:=false;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',ids->>'deputy',true);
 BEGIN PERFORM public.propose_cutoff_price_bill(g,42,40,'QA unauthorized proposal',req);EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Unauthorized cutoff proposal';END IF;
 PERFORM set_config('request.jwt.claim.sub',ids->>'minister',true);
 r:=public.propose_cutoff_price_bill(g,42,40,'QA lawful proposal to amend budget rule',req);d:=(r->>'document_id')::uuid;
 IF (SELECT stage_no FROM public.formal_documents WHERE id=d)<>12 OR (SELECT body_text FROM public.formal_documents WHERE id=d) NOT LIKE '%в 2027 году%' THEN RAISE EXCEPTION 'Wrong cutoff legislative year or stage';END IF;
 IF (public.propose_cutoff_price_bill(g,42,40,'QA lawful proposal to amend budget rule',req)->>'document_id')::uuid<>d THEN RAISE EXCEPTION 'Duplicate proposal';END IF;
 IF (SELECT cutoff_price FROM public.game_fiscal_policy WHERE game_id=g)<>40 THEN RAISE EXCEPTION 'Premature cutoff change';END IF;
 PERFORM public.save_bill_submission_profile(d,false,false,'qa-cutoff-committee',(ids->>'minister')::uuid,'QA bill package');
 FOREACH k IN ARRAY ARRAY['explanatory_note','affected_acts','collegial_decision'] LOOP
  PERFORM public.add_bill_package_file(d,k,'QA fixture',g::text||'/formal/'||d::text||'/package/qa-'||k||'.txt','qa-'||k||'.txt','text/plain',10);
 END LOOP;
 PERFORM public.advance_formal_document(d,'advance','QA submission');
 IF (SELECT status_code FROM public.formal_documents WHERE id=d)<>'government' THEN RAISE EXCEPTION 'No government stage';END IF;
 PERFORM set_config('request.jwt.claim.sub',ids->>'pm',true);
 PERFORM public.save_institution_meeting_document(g,12,'government','agenda','Рассмотрение законодательной инициативы по бюджетному правилу.',null);
 PERFORM public.approve_institution_meeting_agenda(g,12,'government');
 v:=public.create_procedural_vote(g,'QA Government cutoff','QA','member','government','cutoff_government_submission','fraction',.5,'present_majority',.5,true,true,d,'advance','return_author');
 PERFORM public.register_institution_session_at_stage(g,'government',12);PERFORM public.cast_procedural_vote(v,'yes');
 PERFORM set_config('request.jwt.claim.sub',ids->>'minister',true);PERFORM public.register_institution_session_at_stage(g,'government',12);PERFORM public.cast_procedural_vote(v,'yes');
 PERFORM set_config('request.jwt.claim.sub',ids->>'teacher',true);r:=public.close_procedural_vote(v,'QA Government approval');
 IF r->>'result'<>'passed' OR (SELECT status_code FROM public.formal_documents WHERE id=d)<>'registered' THEN RAISE EXCEPTION 'Government cutoff vote failed: %',r;END IF;
 PERFORM set_config('request.jwt.claim.sub',ids->>'chair',true);
 PERFORM public.advance_formal_document(d,'advance','QA committee assignment');
 PERFORM public.save_bill_committee_conclusion(d,(ids->>'chair')::uuid,'QA правовая экспертиза выполнена','QA внутренняя логика проверена','QA комплект документов проверен','proceed',true);
 IF (SELECT status_code FROM public.formal_documents WHERE id=d)<>'council' THEN RAISE EXCEPTION 'Committee route failed';END IF;
 PERFORM public.advance_formal_document(d,'advance','QA first reading assignment');
 IF (SELECT status_code FROM public.formal_documents WHERE id=d)<>'reading1' THEN RAISE EXCEPTION 'First reading route failed';END IF;
 PERFORM set_config('qa.cutoff.doc',d::text,true);
END;$submission$;
RESET ROLE;
UPDATE public.institution_session_registrations SET presence_updated_at=now()-interval '1 second' WHERE game_id=current_setting('qa.cutoff.game')::uuid;

SET LOCAL ROLE authenticated;
DO $reading1$
DECLARE g uuid:=current_setting('qa.cutoff.game')::uuid;ids jsonb:=current_setting('qa.cutoff.users')::jsonb;d uuid:=current_setting('qa.cutoff.doc')::uuid;s uuid;item uuid;v uuid;r jsonb;a uuid:=(ids->>'chair')::uuid;b uuid:=(ids->>'deputy')::uuid;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',ids->>'teacher',true);
 s:=public.create_duma_reading_session(g,1,'QA cutoff reading 1',now(),now()+interval '1 day');
 PERFORM set_config('request.jwt.claim.sub',a::text,true);
 
 PERFORM public.approve_institution_meeting_agenda(g,12,'gd');
 PERFORM public.set_gd_session_attendance(g,12,225);
 PERFORM set_config('request.jwt.claim.sub',b::text,true);PERFORM public.set_gd_session_attendance(g,12,225);
 SELECT id INTO item FROM public.duma_agenda_items WHERE session_id=s AND formal_document_id=d;
 IF item IS NULL THEN RAISE EXCEPTION 'No cutoff bill on reading agenda 1';END IF;
 PERFORM set_config('request.jwt.claim.sub',a::text,true);PERFORM public.set_duma_agenda_item_status(item,'in_progress',NULL);
 PERFORM public.set_duma_discussion_phase(item,'report',a,60);
 PERFORM public.set_duma_discussion_phase(item,'committee',NULL,NULL);PERFORM public.set_duma_discussion_phase(item,'committee',a,60);PERFORM public.set_duma_discussion_phase(item,'questions',NULL,NULL);PERFORM public.set_duma_discussion_phase(item,'questions',b,60);
 PERFORM public.set_duma_discussion_phase(item,'debate',NULL,NULL);PERFORM public.set_duma_discussion_phase(item,'debate',b,60);
 
 PERFORM public.set_duma_discussion_phase(item,'vote',NULL,NULL);
 SELECT id INTO v FROM public.game_votes WHERE formal_document_id=d AND status='open';
 IF v IS NULL THEN RAISE EXCEPTION 'No cutoff ballot reading 1';END IF;
 PERFORM public.cast_vote_allocation(v,225,0,0);PERFORM set_config('request.jwt.claim.sub',b::text,true);PERFORM public.cast_vote_allocation(v,1,224,0);
 PERFORM set_config('request.jwt.claim.sub',ids->>'teacher',true);r:=public.close_procedural_vote(v,'QA cutoff reading 1 passed');
 IF r->>'result'<>'passed' OR (SELECT status_code FROM public.formal_documents WHERE id=d)<>'amendments' THEN RAISE EXCEPTION 'Cutoff reading 1 failed: %, status %',r,(SELECT status_code FROM public.formal_documents WHERE id=d);END IF;
 PERFORM public.close_duma_session(s,false);
 IF (SELECT cutoff_price FROM public.game_fiscal_policy WHERE game_id=g)<>40 THEN RAISE EXCEPTION 'Cutoff applied before publication';END IF;
END;$reading1$;
RESET ROLE;
UPDATE public.institution_session_registrations SET presence_updated_at=now()-interval '1 second' WHERE game_id=current_setting('qa.cutoff.game')::uuid;

SET LOCAL ROLE authenticated;
DO $reading2$
DECLARE g uuid:=current_setting('qa.cutoff.game')::uuid;ids jsonb:=current_setting('qa.cutoff.users')::jsonb;d uuid:=current_setting('qa.cutoff.doc')::uuid;s uuid;item uuid;v uuid;r jsonb;a uuid:=(ids->>'chair')::uuid;b uuid:=(ids->>'deputy')::uuid;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',ids->>'teacher',true);
 s:=public.create_duma_reading_session(g,2,'QA cutoff reading 2',now(),now()+interval '1 day');
 PERFORM set_config('request.jwt.claim.sub',a::text,true);
 PERFORM public.advance_formal_document(d,'advance','QA no textual amendments');
 PERFORM public.approve_institution_meeting_agenda(g,12,'gd');
 PERFORM public.set_gd_session_attendance(g,12,225);
 PERFORM set_config('request.jwt.claim.sub',b::text,true);PERFORM public.set_gd_session_attendance(g,12,225);
 SELECT id INTO item FROM public.duma_agenda_items WHERE session_id=s AND formal_document_id=d;
 IF item IS NULL THEN RAISE EXCEPTION 'No cutoff bill on reading agenda 2';END IF;
 PERFORM set_config('request.jwt.claim.sub',a::text,true);PERFORM public.set_duma_agenda_item_status(item,'in_progress',NULL);
 PERFORM public.set_duma_discussion_phase(item,'report',a,60);
 
 PERFORM public.set_duma_discussion_phase(item,'debate',NULL,NULL);PERFORM public.set_duma_discussion_phase(item,'debate',b,60);
 PERFORM public.set_duma_discussion_phase(item,'amendments',NULL,NULL);
 PERFORM public.set_duma_discussion_phase(item,'vote',NULL,NULL);
 SELECT id INTO v FROM public.game_votes WHERE formal_document_id=d AND status='open';
 IF v IS NULL THEN RAISE EXCEPTION 'No cutoff ballot reading 2';END IF;
 PERFORM public.cast_vote_allocation(v,225,0,0);PERFORM set_config('request.jwt.claim.sub',b::text,true);PERFORM public.cast_vote_allocation(v,1,224,0);
 PERFORM set_config('request.jwt.claim.sub',ids->>'teacher',true);r:=public.close_procedural_vote(v,'QA cutoff reading 2 passed');
 IF r->>'result'<>'passed' OR (SELECT status_code FROM public.formal_documents WHERE id=d)<>'reading3' THEN RAISE EXCEPTION 'Cutoff reading 2 failed: %, status %',r,(SELECT status_code FROM public.formal_documents WHERE id=d);END IF;
 PERFORM public.close_duma_session(s,false);
 IF (SELECT cutoff_price FROM public.game_fiscal_policy WHERE game_id=g)<>40 THEN RAISE EXCEPTION 'Cutoff applied before publication';END IF;
END;$reading2$;
RESET ROLE;
UPDATE public.institution_session_registrations SET presence_updated_at=now()-interval '1 second' WHERE game_id=current_setting('qa.cutoff.game')::uuid;
UPDATE public.state_metrics SET value=70 WHERE game_id=current_setting('qa.cutoff.game')::uuid AND metric_key='lawfulness';
SET LOCAL ROLE authenticated;
DO $reading3$
DECLARE g uuid:=current_setting('qa.cutoff.game')::uuid;ids jsonb:=current_setting('qa.cutoff.users')::jsonb;d uuid:=current_setting('qa.cutoff.doc')::uuid;s uuid;item uuid;v uuid;r jsonb;a uuid:=(ids->>'chair')::uuid;b uuid:=(ids->>'deputy')::uuid;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',ids->>'teacher',true);
 s:=public.create_duma_reading_session(g,3,'QA cutoff reading 3',now(),now()+interval '1 day');
 PERFORM set_config('request.jwt.claim.sub',a::text,true);
 
 PERFORM public.approve_institution_meeting_agenda(g,12,'gd');
 PERFORM public.set_gd_session_attendance(g,12,225);
 PERFORM set_config('request.jwt.claim.sub',b::text,true);PERFORM public.set_gd_session_attendance(g,12,225);
 SELECT id INTO item FROM public.duma_agenda_items WHERE session_id=s AND formal_document_id=d;
 IF item IS NULL THEN RAISE EXCEPTION 'No cutoff bill on reading agenda 3';END IF;
 PERFORM set_config('request.jwt.claim.sub',a::text,true);PERFORM public.set_duma_agenda_item_status(item,'in_progress',NULL);
 PERFORM public.set_duma_discussion_phase(item,'report',a,60);
 
 PERFORM public.set_duma_discussion_phase(item,'debate',NULL,NULL);PERFORM public.set_duma_discussion_phase(item,'debate',b,60);
 
 PERFORM public.set_duma_discussion_phase(item,'vote',NULL,NULL);
 SELECT id INTO v FROM public.game_votes WHERE formal_document_id=d AND status='open';
 IF v IS NULL THEN RAISE EXCEPTION 'No cutoff ballot reading 3';END IF;
 PERFORM public.cast_vote_allocation(v,225,0,0);PERFORM set_config('request.jwt.claim.sub',b::text,true);PERFORM public.cast_vote_allocation(v,1,224,0);
 PERFORM set_config('request.jwt.claim.sub',ids->>'teacher',true);r:=public.close_procedural_vote(v,'QA cutoff reading 3 passed');
 IF r->>'result'<>'passed' OR (SELECT status_code FROM public.formal_documents WHERE id=d)<>'sf' THEN RAISE EXCEPTION 'Cutoff reading 3 failed: %, status %',r,(SELECT status_code FROM public.formal_documents WHERE id=d);END IF;
 PERFORM public.close_duma_session(s,false);
 IF (SELECT cutoff_price FROM public.game_fiscal_policy WHERE game_id=g)<>40 THEN RAISE EXCEPTION 'Cutoff applied before publication';END IF;
END;$reading3$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $decision$
DECLARE g uuid:=current_setting('qa.cutoff.game')::uuid;ids jsonb:=current_setting('qa.cutoff.users')::jsonb;d uuid:=current_setting('qa.cutoff.doc')::uuid;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',ids->>'teacher',true);
 BEGIN
 PERFORM public.confirm_cutoff_sf_review(d,false,'QA SF rejects cutoff law');
 IF (SELECT status_code FROM public.formal_documents WHERE id=d)<>'rejected' OR (SELECT cutoff_price FROM public.game_fiscal_policy WHERE game_id=g)<>40 THEN RAISE EXCEPTION 'Rejected cutoff law changed price';END IF;
 RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='rollback rejected branch';
 EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;END;
 PERFORM public.confirm_cutoff_sf_review(d,true,'QA confirms SF decision in absence of senators');
 IF (SELECT status_code FROM public.formal_documents WHERE id=d)<>'president' OR (SELECT cutoff_price FROM public.game_fiscal_policy WHERE game_id=g)<>40 THEN RAISE EXCEPTION 'SF approval changed price';END IF;
 PERFORM set_config('request.jwt.claim.sub',ids->>'president',true);
 PERFORM public.advance_formal_document(d,'advance','QA President signs cutoff law');
 IF (SELECT status_code FROM public.formal_documents WHERE id=d)<>'published' OR (SELECT cutoff_price FROM public.game_fiscal_policy WHERE game_id=g)<>42 THEN RAISE EXCEPTION 'Cutoff law did not apply';END IF;
END;$decision$;
RESET ROLE;
DO $once$
DECLARE g uuid:=current_setting('qa.cutoff.game')::uuid;d uuid:=current_setting('qa.cutoff.doc')::uuid;
BEGIN
 IF (SELECT applied_at FROM private.cutoff_price_law_proposals WHERE document_id=d) IS NULL OR (SELECT count(*) FROM public.fiscal_change_ledger WHERE game_id=g AND source_type='macro' AND source_id=d::text)<>1 THEN RAISE EXCEPTION 'Cutoff application not unique';END IF;
END;$once$;
ROLLBACK;
SELECT 'PASS: authorized minister, real Government, dossier, three readings, SF rejection/approval, presidential signature, cutoff 40->42 only upon publication, single ledger, rollback' result;