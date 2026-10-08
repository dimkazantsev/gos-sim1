-- Isolated classroom and fictional student identities; all fixtures roll back.
begin;
do $fixture$
declare g uuid:=gen_random_uuid();admin uuid;a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();
begin
 select owner_id into admin from public.games order by created_at limit 1;
 if admin is null then raise exception 'QA requires an existing classroom owner';end if;
 insert into auth.users(id,aud,role) values(a,'authenticated','authenticated'),(b,'authenticated','authenticated');
 perform set_config('request.jwt.claim.sub',admin::text,true);
 insert into public.games(id,title,game_code,owner_id,status,current_round,turn_open)
 values(g,'QA formal vote stages','QA'||substr(replace(g::text,'-',''),1,12),admin,'running',11,true);
 insert into public.game_members(game_id,user_id,full_name,kind,role_title,group_name)
 values(g,admin,'QA teacher','teacher','Преподаватель','QA'),(g,a,'QA participant A','student','Участник','QA'),(g,b,'QA participant B','student','Участник','QA');
 insert into public.game_stages(game_id,stage_no,title,mode,summary,status)
 select g,n,'QA stage '||n,'Учебная процедура','QA',case when n=11 then 'open' else 'locked' end from generate_series(1,16) n;
 perform set_config('qa.formal_vote_game',g::text,true);perform set_config('qa.formal_vote_teacher',admin::text,true);
 perform set_config('qa.formal_vote_student_a',a::text,true);perform set_config('qa.formal_vote_student_b',b::text,true);
end;$fixture$;
set local role authenticated;
do $$ declare g uuid:=current_setting('qa.formal_vote_game')::uuid;admin uuid:=current_setting('qa.formal_vote_teacher')::uuid;
 a uuid:=current_setting('qa.formal_vote_student_a')::uuid;b uuid:=current_setting('qa.formal_vote_student_b')::uuid;
 d uuid;v uuid;repeat_v uuid;result jsonb;scenario text;begin
 perform public.appoint_game_office(g,a,'Министр здравоохранения','QA active office for document ballot',true);
 perform public.appoint_game_office(g,b,'Министр культуры','QA active office for document ballot',true);
 -- Attendance is shared by votes at one stage. Check absent quorum before
 -- registering the two ministers for the successful and stale-result cases.
 for scenario in select unnest(array['no_quorum','passed','stale']) loop
  perform set_config('request.jwt.claim.sub',admin::text,true);
  d:=public.create_formal_document(g,11,'Временная проверка связи НПА и голосования: '||scenario,'government_resolution','government','Правительство Российской Федерации','Учебный акт для проверки стадий документа. Все тестовые данные будут отменены.',null,null,null,'government_act','{}');
  perform public.advance_formal_document(d,'advance','Внести в повестку');
  if (select status_code from public.formal_documents where id=d)<>'agenda' then raise exception 'FAIL expected agenda';end if;
  v:=public.create_procedural_vote(g,'Голосование по тестовому НПА',null,'member','government','government_decision','fraction',0.5,'present_majority',0.5,true,false,d,'advance','reject');
  repeat_v:=public.create_procedural_vote(g,'Повторное открытие того же голосования',null,'member','government','government_decision','fraction',0.5,'present_majority',0.5,true,false,d,'advance','reject');
  if v<>repeat_v or (select count(*) from public.game_votes where formal_document_id=d and status='open')<>1 then raise exception 'FAIL duplicate document ballot';end if;
  if scenario<>'no_quorum' then
   perform set_config('request.jwt.claim.sub',a::text,true);perform public.register_institution_session_at_stage(g,'government',11);perform public.cast_procedural_vote(v,'yes');
   perform set_config('request.jwt.claim.sub',b::text,true);perform public.register_institution_session_at_stage(g,'government',11);perform public.cast_procedural_vote(v,'yes');
  end if;
  perform set_config('request.jwt.claim.sub',admin::text,true);
  if scenario='stale' then
   perform set_config('qa.formal_vote_stale_document',d::text,true);perform set_config('qa.formal_vote_stale_vote',v::text,true);
   continue;
  end if;
  result:=public.close_procedural_vote(v,'Проверка автоматического перехода');
  if scenario='no_quorum' then
   if result->>'result'<>'no_quorum' or (result->>'eligible')::numeric<>2 or (select status_code from public.formal_documents where id=d)<>'agenda' then raise exception 'FAIL no-quorum advanced document';end if;
  else
   if result->>'result'<>'passed' or (result->>'eligible')::numeric<>2 or (result->>'yes')::numeric<>2 or (select status_code from public.formal_documents where id=d)<>'adopted' then raise exception 'FAIL document/vote stage mismatch: % / %',scenario,result;end if;
  end if;
  perform public.close_procedural_vote(v,'Повторное закрытие');
  if scenario<>'no_quorum' and (select status_code from public.formal_documents where id=d)<>'adopted' then raise exception 'FAIL repeated close advanced document twice';end if;
 end loop;
end;$$;
reset role;
-- Privileged, isolated fixture setup simulates a concurrent stage transition.
-- The authenticated API must continue to require a vote for the agenda stage.
do $stale_fixture$
declare d uuid:=current_setting('qa.formal_vote_stale_document')::uuid;
begin
 update public.formal_documents
 set current_step=current_step+1,status_code=workflow_steps->(current_step+1)->>'code',status_label=workflow_steps->(current_step+1)->>'label',current_owner_key=workflow_steps->(current_step+1)->>'owner',updated_at=now()
 where id=d and game_id=current_setting('qa.formal_vote_game')::uuid;
 if (select status_code from public.formal_documents where id=d)<>'adopted' then raise exception 'FAIL stale fixture expected adopted';end if;
 perform set_config('qa.formal_vote_stale_snapshot',(select to_jsonb(fd)::text from public.formal_documents fd where fd.id=d),true);
 perform set_config('qa.formal_vote_stale_history',(select count(*)::text from public.formal_document_history where document_id=d),true);
end;$stale_fixture$;
set local role authenticated;
do $stale_checks$
declare d uuid:=current_setting('qa.formal_vote_stale_document')::uuid;v uuid:=current_setting('qa.formal_vote_stale_vote')::uuid;result jsonb;
begin
 perform set_config('request.jwt.claim.sub',current_setting('qa.formal_vote_teacher'),true);
 result:=public.close_procedural_vote(v,'Проверка результата после смены стадии');
 if result->>'result'<>'passed' or (result->>'eligible')::numeric<>2 or (result->>'yes')::numeric<>2 then raise exception 'FAIL stale ballot result: %',result;end if;
 if (select to_jsonb(fd) from public.formal_documents fd where fd.id=d) is distinct from current_setting('qa.formal_vote_stale_snapshot')::jsonb
  or (select count(*) from public.formal_document_history where document_id=d)<>current_setting('qa.formal_vote_stale_history')::integer
  then raise exception 'FAIL stale result advanced newer document';end if;
 if not exists(select 1 from public.game_votes where id=v and decision_note like '%без перехода%') then raise exception 'FAIL stale result unexplained';end if;
 perform public.close_procedural_vote(v,'Повторное закрытие');
 if (select to_jsonb(fd) from public.formal_documents fd where fd.id=d) is distinct from current_setting('qa.formal_vote_stale_snapshot')::jsonb
  or (select count(*) from public.formal_document_history where document_id=d)<>current_setting('qa.formal_vote_stale_history')::integer
  then raise exception 'FAIL repeated close advanced newer document';end if;
end;$stale_checks$;
reset role;
select jsonb_build_object('linked_ballot','PASS','idempotent_open','PASS','automatic_stage_transition','PASS','stale_vote_guard','PASS','no_quorum_guard','PASS','idempotent_close','PASS') as checks;
rollback;
