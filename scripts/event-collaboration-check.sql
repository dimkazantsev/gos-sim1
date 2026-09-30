-- Exercise existing test accounts in one rolled-back transaction. No real votes survive.
begin;
update public.game_members set kind='student',role_title='Депутат Государственной Думы' where game_id='541b6fde-16d5-4225-8f67-1fc2c7c15523' and user_id='89de1d45-8973-4f38-980d-26042af9e53e';
update public.game_members set kind='student',role_title='Министр здравоохранения' where game_id='541b6fde-16d5-4225-8f67-1fc2c7c15523' and user_id='a4795eef-fbf3-4584-bc0b-f7bfee68b783';
select set_config('request.jwt.claim.sub','9fdf732c-1a84-4435-979d-e0272c2b81db',true);
do $$ declare c uuid;begin
 c:=public.create_assigned_event('541b6fde-16d5-4225-8f67-1fc2c7c15523','Проверка совместного решения','Это временное проверочное задание, оно полностью откатывается.','Здравоохранение','serious','single','[{"label":"Проверить качество лекарств","trust":2,"description":"Безопасная партия направлена пациентам"},{"label":"Выдать непроверенные лекарства","trust":-2,"description":"Создан риск безопасности пациентов"}]',array['89de1d45-8973-4f38-980d-26042af9e53e']::uuid[],array['министр здравоохранения']);
 update public.event_cases set effect_plan=jsonb_build_object('options',jsonb_build_array(jsonb_build_object('trust',2,'description','Безопасное решение','authorized_roles',jsonb_build_array('министр здравоохранения'),'lawful',true,'protects_role_interest',true,'legal_basis','Контроль качества лекарств: учебная компетенция министра здравоохранения'),jsonb_build_object('trust',-2,'authorized_roles',jsonb_build_array('министр здравоохранения'),'lawful',false,'legal_basis','Нарушение контроля качества'))) where id=c;
 perform set_config('qa.event',c::text,true);
end $$;
select set_config('request.jwt.claim.sub','89de1d45-8973-4f38-980d-26042af9e53e',true);
set local role authenticated;
select public.invite_event_collaborator(current_setting('qa.event')::uuid,'a4795eef-fbf3-4584-bc0b-f7bfee68b783');
do $$ declare blocked boolean:=false;a uuid;begin
 select id into a from public.event_assignments where case_id=current_setting('qa.event')::uuid and recipient_id=auth.uid();
 begin perform public.submit_event_decision(a,'option_1',null);exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL Voting before invitation response';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','a4795eef-fbf3-4584-bc0b-f7bfee68b783',true);
set local role authenticated;
select public.respond_event_invitation((select id from public.event_collaboration_invites where case_id=current_setting('qa.event')::uuid),true);
select public.send_event_discussion(current_setting('qa.event')::uuid,'Проверим качество партии перед выдачей.');
select public.submit_event_decision((select id from public.event_assignments where case_id=current_setting('qa.event')::uuid and recipient_id=auth.uid()),'option_1',null);
reset role;
select set_config('request.jwt.claim.sub','89de1d45-8973-4f38-980d-26042af9e53e',true);
set local role authenticated;
select public.submit_event_decision((select id from public.event_assignments where case_id=current_setting('qa.event')::uuid and recipient_id=auth.uid()),'option_1',null);
do $$ declare blocked boolean:=false;a uuid;begin
 select id into a from public.event_assignments where case_id=current_setting('qa.event')::uuid and recipient_id=auth.uid();
 begin perform public.submit_event_decision(a,'option_1',null);exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL Duplicate decision';end if;
end $$;
reset role;
do $$ begin
 if (select count(*) from public.event_case_outcomes where case_id=current_setting('qa.event')::uuid)<>1 then raise exception 'FAIL Single outcome';end if;
 if (select count(*) from public.event_authority_evidence where case_id=current_setting('qa.event')::uuid and authority_ok and lawful)<>2 then raise exception 'FAIL Qualified coalition';end if;
 if not exists(select 1 from public.event_case_outcomes where case_id=current_setting('qa.event')::uuid and trust_delta>=0) then raise exception 'FAIL Positive effect';end if;
 perform private.compute_vsn_assessment('541b6fde-16d5-4225-8f67-1fc2c7c15523','89de1d45-8973-4f38-980d-26042af9e53e',1,'manual');
 if not exists(select 1 from public.stage_assessments where game_id='541b6fde-16d5-4225-8f67-1fc2c7c15523' and user_id='89de1d45-8973-4f38-980d-26042af9e53e' and stage_no=1 and criterion_law and auto_score between 0 and 3) then raise exception 'FAIL Legal criterion';end if;
end $$;
select jsonb_build_object('invitation_gate','PASS','qualified_coalition','PASS','single_outcome','PASS','duplicate_guard','PASS','vsn_legal_point','PASS','discussion','PASS') as checks;
rollback;
