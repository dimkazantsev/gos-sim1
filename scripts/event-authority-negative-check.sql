begin;
update public.game_members set kind='student',role_title='Депутат Государственной Думы' where game_id='541b6fde-16d5-4225-8f67-1fc2c7c15523' and user_id in ('89de1d45-8973-4f38-980d-26042af9e53e','a4795eef-fbf3-4584-bc0b-f7bfee68b783','3e656c79-61bd-4db2-ae89-9adfaa1e85e9');
select set_config('request.jwt.claim.sub','9fdf732c-1a84-4435-979d-e0272c2b81db',true);
do $$ declare c uuid;begin
 c:=public.create_assigned_event('541b6fde-16d5-4225-8f67-1fc2c7c15523','Проверка превышения полномочий','Временная ситуация: депутат пытается единолично распорядиться медицинскими препаратами.','Здравоохранение','serious','single','[{"label":"Выдать партию лекарств","trust":2,"description":"Выданная партия направлена пациентам"},{"label":"Отложить решение","trust":0,"description":"Решение пока не принято"}]',array['89de1d45-8973-4f38-980d-26042af9e53e']::uuid[],array['министр здравоохранения']);
 update public.event_cases set effect_plan=jsonb_build_object('options',jsonb_build_array(jsonb_build_object('trust',2,'description','Выданная партия','authorized_roles',jsonb_build_array('министр здравоохранения'),'lawful',true,'legal_basis','Компетенция министра здравоохранения'),jsonb_build_object('trust',0,'authorized_roles',jsonb_build_array('министр здравоохранения'),'lawful',true,'legal_basis','Компетенция министра здравоохранения'))) where id=c;
 perform set_config('qa.negative',c::text,true);
end $$;
select set_config('request.jwt.claim.sub','89de1d45-8973-4f38-980d-26042af9e53e',true);
set local role authenticated;
select public.submit_event_decision((select id from public.event_assignments where case_id=current_setting('qa.negative')::uuid),'option_1',null);
reset role;
do $$ begin
 if not exists(select 1 from public.event_authority_evidence where case_id=current_setting('qa.negative')::uuid and not authority_ok) then raise exception 'FAIL Unauthorized decision';end if;
 if not exists(select 1 from public.event_case_outcomes where case_id=current_setting('qa.negative')::uuid and trust_delta<0) then raise exception 'FAIL Trust must decrease';end if;
 if not exists(select 1 from public.state_metric_history where source_type='event_authority' and source_id=current_setting('qa.negative') and delta<0) then raise exception 'FAIL Lawfulness must decrease';end if;
end $$;
select set_config('request.jwt.claim.sub','9fdf732c-1a84-4435-979d-e0272c2b81db',true);
do $$ declare c uuid;begin
 c:=public.create_assigned_event('541b6fde-16d5-4225-8f67-1fc2c7c15523','Проверка отсутствия большинства','Временная проверка: один участник из трёх не может принять общее решение.','Государственное управление','serious','all','[{"label":"Вариант первый","trust":2,"description":"Один из вариантов решения"},{"label":"Вариант второй","trust":0,"description":"Второй вариант решения"}]',array['89de1d45-8973-4f38-980d-26042af9e53e','a4795eef-fbf3-4584-bc0b-f7bfee68b783','3e656c79-61bd-4db2-ae89-9adfaa1e85e9']::uuid[],array['депутат']);
 perform set_config('qa.majority',c::text,true);
end $$;
select set_config('request.jwt.claim.sub','89de1d45-8973-4f38-980d-26042af9e53e',true);
set local role authenticated;
select public.submit_event_decision((select id from public.event_assignments where case_id=current_setting('qa.majority')::uuid and recipient_id=auth.uid()),'option_1',null);
reset role;
select set_config('request.jwt.claim.sub','9fdf732c-1a84-4435-979d-e0272c2b81db',true);
select public.finalize_event_case(current_setting('qa.majority')::uuid);
do $$ begin
 if not exists(select 1 from public.event_case_outcomes where case_id=current_setting('qa.majority')::uuid and winner='tie' and trust_delta=0 and assignments_count=3 and votes_count=1) then raise exception 'FAIL Minority must not decide';end if;
end $$;
select jsonb_build_object('unauthorized_penalty','PASS','lawfulness_penalty','PASS','majority_of_all_participants','PASS') as checks;
rollback;
