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

do $$declare g uuid:=current_setting('qa.game')::uuid;t uuid:=current_setting('qa.teacher')::uuid;a uuid:=current_setting('qa.a')::uuid;p uuid;c uuid;begin
 perform set_config('request.jwt.claim.sub',t::text,true);
 insert into game_parties(game_id,name,mandates,regions,leader_user_id,ideology) values(g,'QA публичная партия',100,8,a,'Правовое государство') returning id into p;
 insert into party_documents(game_id,party_id,doc_kind,title,storage_path,file_name,uploaded_by,status)
 select g,p,k,k,g::text||'/qa/'||k,k||'.pdf',a,'accepted' from unnest(array['application','charter','program','fee','symbol','congress_minutes']) k;
 insert into presidential_candidates(game_id,party_id,display_name,nomination_type,registration_status,program_summary,created_by) values(g,p,'QA кандидат','fictional','submitted','Публичная программа научного развития',t) returning id into c;
 perform set_config('qa.party',p::text,true);perform set_config('qa.candidate',c::text,true);
end$$;
set local role authenticated;
do $$declare g uuid:=current_setting('qa.game')::uuid;t uuid:=current_setting('qa.teacher')::uuid;a uuid:=current_setting('qa.a')::uuid;p uuid:=current_setting('qa.party')::uuid;c uuid:=current_setting('qa.candidate')::uuid;doc uuid;post uuid;cert uuid;blocked boolean;begin
 perform set_config('request.jwt.claim.sub',a::text,true);
 blocked:=false;begin perform public.issue_party_justice_response(p,'registered','QA неподписанное решение');exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL student registers party';end if;
 perform set_config('request.jwt.claim.sub',t::text,true);
 doc:=public.issue_party_justice_response(p,'registered','QA публичный ответ Минюста: пакет соответствует требованиям учебной регистрации');
 select id into cert from formal_documents where game_id=g and doc_type='party_certificate' and metadata->>'party_id'=p::text;
 select id into post from political_posts where game_id=g and source_key='media-party-registration:'||cert and actor_key='media';
 if post is null or cert is null then raise exception 'FAIL party certificate/media link';end if;
 if (select count(*) from political_post_formal_links where post_id=post and formal_document_id in (doc,cert))<>2 then raise exception 'FAIL news signed documents';end if;
 if jsonb_array_length((select context->'party_document_ids' from political_posts where id=post))<>4 then raise exception 'FAIL public registration attachments';end if;
 if (select context->>'party_id' from political_posts where id=post)<>p::text then raise exception 'FAIL party news/logo identity';end if;
 perform public.issue_party_justice_response(p,'registered','QA повторный официальный ответ Минюста');
 if (select count(*) from political_posts where game_id=g and source_key='media-party-registration:'||cert)<>1 or (select count(*) from formal_documents where game_id=g and doc_type='party_certificate' and metadata->>'party_id'=p::text)<>1 then raise exception 'FAIL registration duplicated';end if;
 perform public.review_presidential_candidate(c,'registered',0,0);
 if (select count(*) from political_posts where game_id=g and context->>'candidate_id'=c::text and title like 'Зарегистрирован кандидат:%' and actor_key='media' and 'сми_gpyasu'=any(tags))<>1 then raise exception 'FAIL registered candidate media';end if;
 perform public.review_presidential_candidate(c,'registered',0,0);
 if (select count(*) from political_posts where game_id=g and context->>'candidate_id'=c::text and title like 'Зарегистрирован кандидат:%')<>1 then raise exception 'FAIL duplicate candidate story';end if;
end$$;
reset role;
select jsonb_build_object('teacher_only_registration','PASS','party_media_once','PASS','certificate_once','PASS','news_signed_documents','PASS','accepted_public_files','PASS','party_logo_identity','PASS','candidate_media_once','PASS','repeated_status_no_duplicate','PASS') checks;
rollback;
