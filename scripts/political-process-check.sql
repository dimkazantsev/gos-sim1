-- Isolated game, real authenticated RPCs, complete rollback. No student data persists.
begin;
do $$ declare g uuid:=gen_random_uuid();p uuid:=gen_random_uuid();admin uuid:='9fdf732c-1a84-4435-979d-e0272c2b81db';a uuid:='89de1d45-8973-4f38-980d-26042af9e53e';b uuid:='a4795eef-fbf3-4584-bc0b-f7bfee68b783';begin
 perform set_config('request.jwt.claim.sub',admin::text,true);
 insert into public.games(id,title,game_code,owner_id,status,current_round,turn_open) values(g,'QA civic procedures','QA'||substr(replace(g::text,'-',''),1,10),admin,'running',11,true);
 insert into public.game_members(game_id,user_id,full_name,kind,role_title,group_name) values(g,admin,'Проверка преподавателя','teacher','Преподаватель',null);
 insert into public.game_parties(id,game_id,name,mandates,leader_user_id) values(p,g,'QA civic party',450,a);
 insert into public.game_members(game_id,user_id,full_name,kind,role_title,group_name,team) values(g,a,'Проверка А','student','Депутат Государственной Думы','QA','QA civic party'),(g,b,'Проверка Б','student','Депутат Государственной Думы','QA','QA civic party');
 perform set_config('qa.civic_game',g::text,true);perform set_config('qa.civic_party',p::text,true);
end;$$;

set local role authenticated;
do $$ declare g uuid:=current_setting('qa.civic_game')::uuid;admin uuid:='9fdf732c-1a84-4435-979d-e0272c2b81db';a uuid:='89de1d45-8973-4f38-980d-26042af9e53e';b uuid:='a4795eef-fbf3-4584-bc0b-f7bfee68b783';p uuid;v uuid;channel uuid;count_before integer;blocked boolean;m uuid;begin
 perform set_config('request.jwt.claim.sub',admin::text,true);
 select count(*) into count_before from public.political_posts where game_id=g;
 insert into public.game_events(game_id,title,body,audience,created_by) values(g,'Публичное событие QA','Реальное описание для проверки', '{"public":true}',admin);
 if (select count(*) from public.political_posts where game_id=g)<>count_before+1 then raise exception 'FAIL public event automation';end if;
 insert into public.game_events(game_id,title,body,audience,created_by) values(g,'Частное событие QA','Текст только для адресата', '{"public":false}',admin);
 if exists(select 1 from public.political_posts where game_id=g and title='Частное событие QA') then raise exception 'FAIL private event leaked';end if;
 insert into public.chat_channels(game_id,name,kind,created_by) values(g,'Общий чат QA','public',admin) returning id into channel;
 perform set_config('request.jwt.claim.sub',a::text,true);
 insert into public.chat_messages(game_id,channel_id,author_id,kind,text) values(g,channel,a,'text','Заявление партии #партии_gpyasu');
 if not exists(select 1 from public.political_posts where game_id=g and context->>'source_table'='chat_messages') then raise exception 'FAIL tagged public chat';end if;
 perform set_config('request.jwt.claim.sub',admin::text,true);
 perform public.save_presidential_candidate(g,null,a,null,'Кандидат QA','self','Программа QA');
 if not exists(select 1 from public.political_posts where game_id=g and title='Выдвинут кандидат: Кандидат QA') then raise exception 'FAIL candidate automation';end if;
 p:=public.create_political_post(g,'initiative','teacher','Проект решения QA','Текст проекта решения');
 if (select actor_label from public.political_posts where id=p)<>'GOS//SIMS' then raise exception 'FAIL neutral teacher publisher';end if;
 v:=public.open_process_vote(p,'gd',null);
 if public.open_process_vote(p,'gd',null)<>v then raise exception 'FAIL duplicate ballot';end if;
 perform public.close_procedural_vote(v);
 if (select result_eligible from public.game_votes where id=v)<>450 then raise exception 'FAIL post ballot fixed GD composition';end if;
 if not exists(select 1 from public.political_posts where game_id=g and context->>'vote_id'=v::text) then raise exception 'FAIL ballot result publication';end if;
 perform public.update_process_post(p,'Уточнённый проект QA','Уточнённый текст','initiative',array['ходигры_gpyasu'],null,'documents','{}');
 if (select title from public.political_posts where id=p)<>'Уточнённый проект QA' then raise exception 'FAIL text editing';end if;
 select id into m from public.state_metrics where game_id=g limit 1;
 if m is not null then
  perform public.set_post_state_metric(p,m,(select value from public.state_metrics where id=m),'Основание QA');
  if not exists(select 1 from public.state_metric_history where game_id=g and source_id=p::text) then raise exception 'FAIL metric post linkage';end if;
 end if;
 perform set_config('request.jwt.claim.sub',a::text,true);blocked:=false;
 begin perform public.update_process_post(p,'Чужой проект','Чужой текст','initiative','{}',null,null,'{}');exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL foreign post edit allowed';end if;
 blocked:=false;begin perform public.set_post_state_metric(p,m,10,'Чужая корректировка');exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL student metric access';end if;
 p:=public.create_political_post(g,'initiative','participant','Предложение студента QA','Предлагаю обсудить вопрос');
 v:=public.open_process_vote(p,'all',null);
 if not exists(select 1 from public.game_votes where id=v and source_post_id=p and voting_mode='member') then raise exception 'FAIL student class poll';end if;
 blocked:=false;begin perform public.open_process_vote(p,'gd',null);exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL student institutional poll allowed';end if;
end;$$;
select jsonb_build_object('public_event','PASS','private_event','PASS','tagged_chat','PASS','candidate','PASS','neutral_teacher','PASS','gd_450','PASS','duplicate_vote','PASS','vote_result_news','PASS','editing','PASS','teacher_metric_link','PASS','student_guards','PASS','student_poll','PASS') as checks;
rollback;
