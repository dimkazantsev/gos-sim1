-- Isolated classroom, authenticated RPC checks, complete rollback, no real IDs in source.
begin;
do $$declare g uuid:=gen_random_uuid();admin uuid;a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();begin
 select owner_id into admin from public.games where game_code='8.414';
 -- Two temporary identities avoid inheriting platform-admin rights. Both are
 -- rolled back; real users, logins and classroom roles are never changed.
 if admin is null then raise exception 'QA requires an existing classroom owner';end if;
 insert into auth.users(id,aud,role) values(a,'authenticated','authenticated'),(b,'authenticated','authenticated');
 perform set_config('request.jwt.claim.sub',admin::text,true);
 insert into public.games(id,title,game_code,owner_id,status,turn_open) values(g,'QA fiscal integration','QA'||substr(replace(g::text,'-',''),1,12),admin,'running',true);
 insert into public.game_members(game_id,user_id,full_name,kind,role_title,group_name) values(g,admin,'QA преподаватель','teacher','Преподаватель','QA'),(g,a,'QA участник А','student','Депутат Государственной Думы','QA'),(g,b,'QA участник Б','student','Министр финансов','QA');
 insert into game_stages(game_id,stage_no,title,mode,summary,status) select g,stage_no,title,mode,summary,case when stage_no=1 then 'open' else 'locked' end from game_stages where game_id=(select id from games where game_code='8.414');
 insert into state_metrics(game_id,metric_key,label,value,unit,is_public,group_key,min_value,max_value,sort_order) select g,metric_key,label,value,unit,is_public,group_key,min_value,max_value,sort_order from state_metrics where game_id=(select id from games where game_code='8.414') on conflict(game_id,metric_key) do nothing;
 perform set_config('qa.game',g::text,true);perform set_config('qa.teacher',admin::text,true);perform set_config('qa.a',a::text,true);perform set_config('qa.b',b::text,true);
end$$;


do $$declare g uuid:=current_setting('qa.game')::uuid;t uuid:=current_setting('qa.teacher')::uuid;a uuid:=current_setting('qa.a')::uuid;d uuid;v uuid;ch uuid;begin
 perform set_config('request.jwt.claim.sub',t::text,true);
 d:=public.create_formal_document(g,10,'QA государственная программа','state_program','government','Правительство Российской Федерации','Паспорт программы. Цель: доступность. Показатели, мероприятия и финансовое обеспечение.',null,null,null,'generic','{"template_key":"state_program"}');
 insert into game_votes(game_id,stage_no,title,body,voting_mode,status,created_by,institution_key,procedure_key) values(g,10,'QA программа','QA','personal','open',t,'government','generic') returning id into v;
 insert into chat_channels(game_id,name,kind,created_by) values(g,'QA общая площадь','public',t) returning id into ch;
 insert into game_activity(game_id,actor_id,event_type,label,view_key) values(g,a,'qa_action','QA действие с документом','documents');
 perform set_config('qa.document',d::text,true);perform set_config('qa.vote',v::text,true);perform set_config('qa.public_channel',ch::text,true);
end$$;
set local role authenticated;
do $$declare g uuid:=current_setting('qa.game')::uuid;a uuid:=current_setting('qa.a')::uuid;b uuid:=current_setting('qa.b')::uuid;t uuid:=current_setting('qa.teacher')::uuid;r jsonb;c uuid;msg uuid;blocked boolean;before_activity integer;before_doc integer;begin
 perform set_config('request.jwt.claim.sub',a::text,true);
 r:=public.get_section_updates(g);if (r->>'documents')::int<>1 or (r->>'votes')::int<>1 then raise exception 'FAIL document/vote new counters';end if;
 perform public.mark_section_read(g,'documents','9999-12-31');perform public.mark_section_read(g,'votes',clock_timestamp());
 r:=public.get_section_updates(g);if (r->>'documents')::int<>0 or (r->>'votes')::int<>0 then raise exception 'FAIL marked sections stay new';end if;
 if (select seen_at from section_reads where game_id=g and section_key='documents')>clock_timestamp() then raise exception 'FAIL future section cursor';end if;
 perform set_config('request.jwt.claim.sub',b::text,true);r:=public.get_section_updates(g);if (r->>'documents')::int<>1 then raise exception 'FAIL another member counter erased';end if;
 if exists(select 1 from section_reads where game_id=g and user_id=a) then raise exception 'FAIL another member read cursor exposed';end if;
 perform set_config('request.jwt.claim.sub',a::text,true);
 c:=public.open_direct_conversation(g,b);if c<>public.open_direct_conversation(g,b) or c<>public.open_direct_conversation(g,b) then raise exception 'FAIL duplicate DM conversation';end if;
 if (select count(*) from channel_members where channel_id=c)<>2 then raise exception 'FAIL DM members';end if;
 insert into chat_messages(game_id,channel_id,author_id,kind,text) values(g,c,a,'text','QA частный текст с тегом #президент_gpyasu') returning id into msg;
 if exists(select 1 from political_posts where game_id=g and source_key='chat:'||msg) then raise exception 'FAIL private chat published';end if;
 insert into chat_messages(game_id,channel_id,author_id,kind,text) values(g,current_setting('qa.public_channel')::uuid,a,'text','QA публичное обсуждение программы #госпрограмма_gpyasu') returning id into msg;
 if (select count(*) from political_posts where game_id=g and source_key='chat:'||msg)<>1 then raise exception 'FAIL public tag news';end if;
 blocked:=false;begin perform public.open_direct_conversation(g,a);exception when others then blocked:=true;end;if not blocked then raise exception 'FAIL self DM';end if;
 blocked:=false;begin perform public.clear_classroom_journal(g);exception when others then blocked:=true;end;if not blocked then raise exception 'FAIL student clears journal';end if;
 perform set_config('request.jwt.claim.sub',t::text,true);
 select count(*) into before_activity from game_activity where game_id=g;select count(*) into before_doc from formal_documents where game_id=g;
 perform public.clear_classroom_journal(g);
 if not exists(select 1 from games where id=g and settings ? 'classroom_journal_cleared_at') then raise exception 'FAIL teacher journal cutoff';end if;
 if (select count(*) from game_activity where game_id=g)<>before_activity or (select count(*) from formal_documents where game_id=g)<>before_doc then raise exception 'FAIL legal/grading evidence deleted';end if;
end$$;
reset role;
select jsonb_build_object('docs_votes_counters','PASS','seen_cursor_persisted','PASS','read_cursor_private','PASS','future_cursor_clamped','PASS','DM_idempotent','PASS','DM_only_two','PASS','private_chat_not_published','PASS','public_tag_news_once','PASS','self_DM_denied','PASS','teacher_clear_only','PASS','journal_keeps_evidence','PASS') checks;
rollback;
