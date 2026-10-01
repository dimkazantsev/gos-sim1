-- Configure qa.teacher_id, qa.student_a_id and qa.student_b_id for authorized test accounts.
-- Isolated game, real authenticated RPCs, complete rollback. No student data persists.
begin;
do $$ declare g uuid:=gen_random_uuid();p uuid:=gen_random_uuid();admin uuid:=current_setting('qa.teacher_id')::uuid;a uuid:=current_setting('qa.student_a_id')::uuid;b uuid:=current_setting('qa.student_b_id')::uuid;begin
 perform set_config('request.jwt.claim.sub',admin::text,true);
 insert into public.games(id,title,game_code,owner_id,status,current_round,turn_open) values(g,'QA civic procedures','QA'||substr(replace(g::text,'-',''),1,10),admin,'running',11,true);
 insert into public.game_members(game_id,user_id,full_name,kind,role_title,group_name) values(g,admin,'Проверка преподавателя','teacher','Преподаватель',null);
 insert into public.game_parties(id,game_id,name,mandates,leader_user_id) values(p,g,'QA civic party',450,a);
 insert into public.game_members(game_id,user_id,full_name,kind,role_title,group_name,team) values(g,a,'Проверка А','student','Депутат Государственной Думы','QA','QA civic party'),(g,b,'Проверка Б','student','Депутат Государственной Думы','QA','QA civic party');
 perform set_config('qa.civic_game',g::text,true);perform set_config('qa.civic_party',p::text,true);
end;$$;

do $$ declare g uuid:=current_setting('qa.civic_game')::uuid;a uuid:=current_setting('qa.student_a_id')::uuid;begin
 insert into storage.objects(bucket_id,name,owner_id) values('game-assets',g::text||'/news/'||a::text||'/qa.txt',a::text);
end;$$;
set local role authenticated;
do $$ declare g uuid:=current_setting('qa.civic_game')::uuid;a uuid:=current_setting('qa.student_a_id')::uuid;b uuid:=current_setting('qa.student_b_id')::uuid;t uuid:=current_setting('qa.teacher_id')::uuid;n uuid;p uuid;file_path text:=g::text||'/news/'||a::text||'/qa.txt';blocked boolean;begin
 perform set_config('request.jwt.claim.sub',a::text,true);
 if not exists(select 1 from storage.objects where bucket_id='game-assets' and name=file_path) then raise exception 'FAIL uploader cannot read attachment';end if;
 n:=public.submit_media_news(g,'Новость с приложением','Проверка согласования приложенного текста','participant','{}',null,null,'{}',jsonb_build_array(jsonb_build_object('storage_path',file_path,'file_name','qa.txt','file_size',12,'mime_type','text/plain','media_kind','file')));
 perform set_config('request.jwt.claim.sub',b::text,true);
 if exists(select 1 from storage.objects where bucket_id='game-assets' and name=file_path) then raise exception 'FAIL pending media attachment leaked';end if;
 blocked:=false;begin perform public.submit_media_news(g,'Чужое вложение','Текст новости с чужим файлом','participant','{}',null,null,'{}',jsonb_build_array(jsonb_build_object('storage_path',file_path,'file_name','qa.txt','file_size',12,'media_kind','file')));exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL foreign media attachment accepted';end if;
 perform set_config('request.jwt.claim.sub',t::text,true);
 if not exists(select 1 from storage.objects where bucket_id='game-assets' and name=file_path) then raise exception 'FAIL reviewer cannot read attachment';end if;
 p:=public.review_media_news(n,true,null);
 perform set_config('request.jwt.claim.sub',b::text,true);
 if not exists(select 1 from storage.objects where bucket_id='game-assets' and name=file_path) then raise exception 'FAIL approved attachment unavailable';end if;
 perform set_config('request.jwt.claim.sub',t::text,true);perform public.delete_process_post(p);
 perform set_config('request.jwt.claim.sub',b::text,true);
 if exists(select 1 from storage.objects where bucket_id='game-assets' and name=file_path) then raise exception 'FAIL removed news attachment visible';end if;
end;$$;
select jsonb_build_object('uploader_access','PASS','private_pending_attachment','PASS','foreign_attachment_guard','PASS','reviewer_access','PASS','approved_attachment_read','PASS','deleted_attachment_hidden','PASS') as checks;
rollback;
