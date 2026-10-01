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
do $check$
declare
 g uuid:=current_setting('qa.civic_game')::uuid;
 admin uuid:='9fdf732c-1a84-4435-979d-e0272c2b81db';
 student uuid:='89de1d45-8973-4f38-980d-26042af9e53e';
 assessment uuid; baseline_score int; baseline_signals jsonb; evidence jsonb;
begin
 perform set_config('request.jwt.claim.sub',admin::text,true);
 insert into public.game_stages(game_id,stage_no,title,mode,summary,status,opened_at)
 values(g,11,'Проверка оценивания','online','Изолированный этап для проверки','open',now()-interval '1 hour');
 assessment:=private.compute_vsn_assessment(g,student,11,'hourly');
 select auto_score,evidence_summary->'signals' into baseline_score,baseline_signals
 from public.stage_assessments where id=assessment;
 insert into public.political_posts(game_id,author_id,process_type,actor_key,actor_label,title,body,source_key,context)
 values(g,student,'information','participant','Проверка А','Автоматическая правовая новость','Закон, Конституция, полномочия, стратегия и интересы','qa:auto',jsonb_build_object('automatic',true));
 insert into public.political_posts(game_id,author_id,process_type,actor_key,actor_label,title,body,context)
 values(g,student,'information','participant','Проверка А','Автоматическая запись без ключа','Закон, Конституция, полномочия, стратегия и интересы',jsonb_build_object('automatic',true));
 assessment:=private.compute_vsn_assessment(g,student,11,'hourly');
 if exists(select 1 from public.stage_assessments where id=assessment and
   (auto_score<>baseline_score or evidence_summary->'signals'<>baseline_signals or (evidence_summary#>>'{counts,posts}')::int<>0))
 then raise exception 'FAIL automatic updates changed the student score';end if;
 evidence:=public.get_stage_assessment_evidence(g,student,11);
 if jsonb_array_length(evidence->'political_posts')<>0 then raise exception 'FAIL automatic news entered student evidence';end if;
 insert into public.political_posts(game_id,author_id,process_type,actor_key,actor_label,title,body)
 values(g,student,'initiative','participant','Проверка А','Самостоятельная публикация студента','Предлагаю законное решение в пределах полномочий.');
 assessment:=private.compute_vsn_assessment(g,student,11,'hourly');
 if (select (evidence_summary#>>'{counts,posts}')::int from public.stage_assessments where id=assessment)<>1
 then raise exception 'FAIL original publication was excluded';end if;
 evidence:=public.get_stage_assessment_evidence(g,student,11);
 if jsonb_array_length(evidence->'political_posts')<>1 or evidence#>>'{political_posts,0,title}'<>'Самостоятельная публикация студента'
 then raise exception 'FAIL original publication missing from evidence';end if;
end;$check$;
select jsonb_build_object('automatic_news_no_points','PASS','automatic_keywords_no_law_credit','PASS','original_post_counted','PASS','evidence_matches_original_work','PASS') as checks;
rollback;
