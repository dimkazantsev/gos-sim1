-- Configure qa.teacher_id, qa.student_a_id and qa.student_b_id for authorized test accounts.
-- Isolated game, real authenticated RPCs, complete rollback. No student data persists.
begin;
do $$ declare g uuid:=gen_random_uuid();p uuid:=gen_random_uuid();admin uuid:=current_setting('qa.teacher_id');a uuid:=current_setting('qa.student_a_id');b uuid:=current_setting('qa.student_b_id');begin
 perform set_config('request.jwt.claim.sub',admin::text,true);
 insert into public.games(id,title,game_code,owner_id,status,current_round,turn_open) values(g,'QA civic procedures','QA'||substr(replace(g::text,'-',''),1,10),admin,'running',11,true);
 insert into public.game_members(game_id,user_id,full_name,kind,role_title,group_name) values(g,admin,'Проверка преподавателя','teacher','Преподаватель',null);
 insert into public.game_parties(id,game_id,name,mandates,leader_user_id) values(p,g,'QA civic party',450,a);
 insert into public.game_members(game_id,user_id,full_name,kind,role_title,group_name,team) values(g,a,'Проверка А','student','Депутат Государственной Думы','QA','QA civic party'),(g,b,'Проверка Б','student','Депутат Государственной Думы','QA','QA civic party');
 perform set_config('qa.civic_game',g::text,true);perform set_config('qa.civic_party',p::text,true);
end;$$;

do $$ declare g uuid:=current_setting('qa.civic_game')::uuid;begin
 insert into public.game_office_assignments(game_id,user_id,role_title,status,appointed_by,approved_by,legal_basis,educational_exception)
 values(g,current_setting('qa.student_a_id')::uuid,'Министр юстиции Российской Федерации','active',current_setting('qa.teacher_id')::uuid,current_setting('qa.teacher_id')::uuid,'Учебное совмещение',true);
end;$$;
set local role authenticated;
do $$ declare g uuid:=current_setting('qa.civic_game')::uuid;a uuid:=current_setting('qa.student_a_id')::uuid;b uuid:=current_setting('qa.student_b_id')::uuid;t uuid:=current_setting('qa.teacher_id')::uuid;p uuid;c uuid;n uuid;np uuid;auto_post uuid;office_id uuid;blocked boolean;stats jsonb;begin
 perform set_config('request.jwt.claim.sub',a::text,true);
 select id into office_id from public.game_office_assignments where game_id=g and user_id=a and status='active' and role_title='Министр юстиции Российской Федерации';
 p:=public.create_political_post(g,'statement','office:'||office_id::text,'Проверка публикации от должности','Официальное заявление участника');
 if (select actor_label from public.political_posts where id=p)<>'Министр юстиции Российской Федерации' then raise exception 'FAIL active office publication';end if;
 if not exists(select 1 from jsonb_array_elements(public.get_process_actors(g)) x where x->>'key'='office:'||office_id::text) then raise exception 'FAIL active office missing from publisher picker';end if;
 perform public.record_civic_view('post',p);perform public.record_civic_view('post',p);
 perform public.react_to_civic_content('post',p,1::smallint);perform public.react_to_civic_content('post',p,(-1)::smallint);
 stats:=public.get_civic_discussion('post',p);
 if (stats->>'likes')::integer<>0 or (stats->>'dislikes')::integer<>1 or (stats->>'views')::integer<>1 then raise exception 'FAIL reaction replacement or unique view';end if;
 perform public.react_to_civic_content('post',p,0::smallint);
 n:=public.submit_media_news(g,'Предложение в СМИ','Текст новости участника','office:'||office_id::text,array['ходигры_gpyasu']);
 if exists(select 1 from public.political_posts where game_id=g and title='Предложение в СМИ') then raise exception 'FAIL pending news public';end if;
 perform set_config('request.jwt.claim.sub',b::text,true);
 if exists(select 1 from public.media_news_proposals where id=n) then raise exception 'FAIL private proposal leaked';end if;
 perform public.record_civic_view('post',p);c:=public.comment_on_civic_content('post',p,'Комментарий к документу');
 blocked:=false;begin perform public.create_political_post(g,'statement','office:'||office_id::text,'Чужая должность','Текст чужого субъекта');exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL office impersonation allowed';end if;
 blocked:=false;begin perform public.delete_process_post(p);exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL foreign deletion allowed';end if;
 blocked:=false;begin perform public.review_media_news(n,true,null);exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL student moderation allowed';end if;
 blocked:=false;begin insert into public.political_posts(game_id,author_id,actor_key,actor_label,title,body) values(g,b,'teacher','Подмена преподавателя','Незаконный пост','Текст подмены');exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL direct publication bypass';end if;
 perform set_config('request.jwt.claim.sub',a::text,true);
 blocked:=false;begin perform public.delete_civic_comment(c);exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL foreign comment deletion';end if;
 perform set_config('request.jwt.claim.sub',t::text,true);
 np:=public.review_media_news(n,true,'Согласовано');
 if public.review_media_news(n,true,'Повторное нажатие')<>np then raise exception 'FAIL repeated approval duplicates';end if;
 if not exists(select 1 from public.political_posts where id=np and author_id=a and actor_key='media') then raise exception 'FAIL approved news attribution';end if;
 if (select count(*) from public.political_posts where game_id=g and title='Предложение в СМИ')<>1 then raise exception 'FAIL duplicated media news';end if;
 perform public.delete_civic_comment(c);
 stats:=public.get_civic_discussion('post',p);
 if (stats->>'views')::integer<>2 or (stats->>'comment_count')::integer<>0 then raise exception 'FAIL discussion counts';end if;
 insert into public.game_events(game_id,title,body,audience,created_by) values(g,'Автоматическое событие для удаления','Текст публичного события','{"public":true}',t);
 select id into auto_post from public.political_posts where game_id=g and title='Автоматическое событие для удаления';
 if auto_post is null then raise exception 'FAIL automatic publication fixture';end if;
 perform public.delete_process_post(auto_post);perform set_config('qa.deleted_post',auto_post::text,true);
 if exists(select 1 from public.political_posts where id=auto_post) then raise exception 'FAIL deleted publication visible';end if;
end;$$;
reset role;
do $$ begin if not exists(select 1 from public.political_posts where id=current_setting('qa.deleted_post')::uuid and deleted_at is not null and source_key is not null) then raise exception 'FAIL automatic source audit lost';end if;end;$$;
select jsonb_build_object('assigned_office_publisher','PASS','office_impersonation_guard','PASS','unique_views','PASS','reaction_switching','PASS','comment_guards','PASS','private_news_proposal','PASS','teacher_approval','PASS','approval_idempotency','PASS','direct_insert_guard','PASS','teacher_automatic_deletion','PASS','source_audit_preserved','PASS') as checks;
rollback;
