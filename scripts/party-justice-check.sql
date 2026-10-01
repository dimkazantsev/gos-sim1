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
do $$ declare g uuid:=current_setting('qa.civic_game')::uuid;p uuid:=current_setting('qa.civic_party')::uuid;d uuid;blocked boolean:=false;n integer;begin
 begin perform public.issue_party_justice_response(p,'registered','Принято решение о регистрации.');exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL incomplete package registered';end if;
end;$$;
reset role;
insert into public.party_documents(game_id,party_id,doc_kind,title,storage_path,file_name,uploaded_by,status)
select current_setting('qa.civic_game')::uuid,current_setting('qa.civic_party')::uuid,k,k,'qa/'||k,k||'.txt','89de1d45-8973-4f38-980d-26042af9e53e','accepted' from unnest(array['application','charter','program','fee','symbol','congress_minutes']) k;
set local role authenticated;
do $$ declare g uuid:=current_setting('qa.civic_game')::uuid;p uuid:=current_setting('qa.civic_party')::uuid;d uuid;n integer;blocked boolean:=false;begin
 d:=public.issue_party_justice_response(p,'registered','Министерство юстиции рассмотрело пакет. Принято решение о регистрации партии.');
 if (select count(*) from public.formal_documents where game_id=g and doc_type='party_certificate')<>1 then raise exception 'FAIL certificate';end if;
 if (select metadata->>'signed_by' from public.formal_documents where id=d)<>'9fdf732c-1a84-4435-979d-e0272c2b81db' then raise exception 'FAIL signer';end if;
 if (select count(*) from public.political_post_formal_links where game_id=g)<>2 then raise exception 'FAIL links';end if;
 perform public.issue_party_justice_response(p,'registered','Повторное направление подписанного ответа о регистрации партии.');
 if (select count(*) from public.formal_documents where game_id=g and doc_type='party_certificate')<>1 then raise exception 'FAIL duplicate certificate';end if;
 perform set_config('request.jwt.claim.sub','89de1d45-8973-4f38-980d-26042af9e53e',true);
 begin perform public.issue_party_justice_response(p,'rejected','Попытка студента отказать своей партии в регистрации.');exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL student privilege';end if;
end;$$;
select 'PASS: registration package, automatic certificate, signature, links, idempotency and privileges' result;
rollback;