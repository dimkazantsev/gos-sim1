-- Procedural document votes use temporary, rolled-back fixtures only.
begin;
update public.game_members set kind='student',role_title='Министр здравоохранения' where game_id='541b6fde-16d5-4225-8f67-1fc2c7c15523' and user_id='89de1d45-8973-4f38-980d-26042af9e53e';
update public.game_members set kind='student',role_title='Министр культуры' where game_id='541b6fde-16d5-4225-8f67-1fc2c7c15523' and user_id='a4795eef-fbf3-4584-bc0b-f7bfee68b783';
select set_config('request.jwt.claim.sub','9fdf732c-1a84-4435-979d-e0272c2b81db',true);
set local role authenticated;
do $$ declare g uuid:='541b6fde-16d5-4225-8f67-1fc2c7c15523';admin uuid:='9fdf732c-1a84-4435-979d-e0272c2b81db';d uuid;v uuid;repeat_v uuid;result jsonb;scenario text;begin
 for scenario in select unnest(array['passed','stale','no_quorum']) loop
  perform set_config('request.jwt.claim.sub',admin::text,true);
  d:=public.create_formal_document(g,11,'Временная проверка связи НПА и голосования: '||scenario,'government_resolution','government','Правительство Российской Федерации','Учебный акт для проверки стадий документа. Все тестовые данные будут отменены.',null,null,null,'government_act','{}');
  perform public.advance_formal_document(d,'advance','Внести в повестку');
  if (select status_code from public.formal_documents where id=d)<>'agenda' then raise exception 'FAIL expected agenda';end if;
  v:=public.create_procedural_vote(g,'Голосование по тестовому НПА',null,'member','government','government_decision','fraction',0.5,'present_majority',0.5,true,false,d,'advance','reject');
  repeat_v:=public.create_procedural_vote(g,'Повторное открытие того же голосования',null,'member','government','government_decision','fraction',0.5,'present_majority',0.5,true,false,d,'advance','reject');
  if v<>repeat_v or (select count(*) from public.game_votes where formal_document_id=d and status='open')<>1 then raise exception 'FAIL duplicate document ballot';end if;
  if scenario<>'no_quorum' then
   perform set_config('request.jwt.claim.sub','89de1d45-8973-4f38-980d-26042af9e53e',true);perform public.cast_procedural_vote(v,'yes');
   perform set_config('request.jwt.claim.sub','a4795eef-fbf3-4584-bc0b-f7bfee68b783',true);perform public.cast_procedural_vote(v,'yes');
  end if;
  perform set_config('request.jwt.claim.sub',admin::text,true);
  if scenario='stale' then perform public.advance_formal_document(d,'advance','Ручное действие преподавателя');end if;
  result:=public.close_procedural_vote(v,'Проверка автоматического перехода');
  if scenario='no_quorum' then
   if result->>'result'<>'no_quorum' or (select status_code from public.formal_documents where id=d)<>'agenda' then raise exception 'FAIL no-quorum advanced document';end if;
  else
   if result->>'result'<>'passed' or (select status_code from public.formal_documents where id=d)<>'adopted' then raise exception 'FAIL document/vote stage mismatch: % / %',scenario,result;end if;
   if scenario='stale' and not exists(select 1 from public.game_votes where id=v and decision_note like '%без перехода%') then raise exception 'FAIL stale result unexplained';end if;
  end if;
  perform public.close_procedural_vote(v,'Повторное закрытие');
  if scenario<>'no_quorum' and (select status_code from public.formal_documents where id=d)<>'adopted' then raise exception 'FAIL repeated close advanced document twice';end if;
 end loop;
end;$$;
reset role;
select jsonb_build_object('linked_ballot','PASS','idempotent_open','PASS','automatic_stage_transition','PASS','stale_vote_guard','PASS','no_quorum_guard','PASS','idempotent_close','PASS') as checks;
rollback;
