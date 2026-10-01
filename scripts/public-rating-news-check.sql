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

do $$ declare g uuid:=current_setting('qa.civic_game')::uuid;begin
 insert into public.state_metrics(game_id,metric_key,label,value,unit,is_public,min_value,max_value) values(g,'qa_rating_public','Публичный показатель QA',60,'%',true,0,100),(g,'qa_rating_second','Второй публичный показатель QA',20,'%',true,0,100),(g,'qa_rating_secret','Закрытый показатель QA',50,'%',false,0,100);
end;$$;
set local role authenticated;
do $$ declare g uuid:=current_setting('qa.civic_game')::uuid;admin uuid:='9fdf732c-1a84-4435-979d-e0272c2b81db';p uuid;m1 uuid;m2 uuid;secret uuid;before_count integer;news uuid;changes jsonb;begin
 perform set_config('request.jwt.claim.sub',admin::text,true);
 select id into m1 from public.state_metrics where game_id=g and metric_key='qa_rating_public';
 select id into m2 from public.state_metrics where game_id=g and metric_key='qa_rating_second';
 select id into secret from public.state_metrics where game_id=g and metric_key='qa_rating_secret';
 p:=public.create_political_post(g,'initiative','teacher','Решение QA по показателям','Основание изменения показателей');
 select count(*) into before_count from public.political_posts where game_id=g and context->>'source_table'='rating_history';
 perform public.set_post_state_metric(p,m1,60,'Нулевое изменение QA');
 perform public.set_post_state_metric(p,secret,65,'Закрытое изменение QA');
 if (select count(*) from public.political_posts where game_id=g and context->>'source_table'='rating_history')<>before_count then raise exception 'FAIL zero/private metric news';end if;
 perform public.set_post_state_metric(p,m1,64,'Изменение общественного показателя QA');
 perform public.set_post_state_metric(p,m2,23,'Изменение второго показателя QA');
 select id,context->'rating_changes' into news,changes from public.political_posts where game_id=g and context->>'source_table'='rating_history';
 if news is null or jsonb_array_length(changes)<>2 then raise exception 'FAIL grouped public rating news: %',changes;end if;
 if not exists(select 1 from jsonb_array_elements(changes) c where c->>'key'='qa_rating_public' and (c->>'previous')::numeric=60 and (c->>'current')::numeric=64) then raise exception 'FAIL exact media values';end if;
 if (select value from public.state_metrics where id=m1)<>64 or (select value from public.state_metrics where id=m2)<>23 then raise exception 'FAIL reporting changed metrics recursively';end if;
 if (select context->>'origin_post_id' from public.political_posts where id=news)<>p::text then raise exception 'FAIL media origin link';end if;
 if exists(select 1 from public.political_posts where game_id=g and body like '%Закрытое изменение%') then raise exception 'FAIL secret note leaked';end if;
 perform public.set_post_state_metric(p,m1,66,'Повторное изменение показателя в операции QA');
 select context->'rating_changes' into changes from public.political_posts where id=news;
 if (select count(*) from public.political_posts where game_id=g and context->>'source_table'='rating_history')<>before_count+1 then raise exception 'FAIL duplicate media batch';end if;
 if not exists(select 1 from jsonb_array_elements(changes) c where c->>'key'='qa_rating_public' and (c->>'previous')::numeric=60 and (c->>'current')::numeric=66) then raise exception 'FAIL batch first/last values';end if;
end;$$;
select jsonb_build_object('actual_values','PASS','public_only','PASS','no_zero_news','PASS','grouped_changes','PASS','source_post_link','PASS','no_recursion','PASS','single_batch','PASS') as checks;
rollback;
