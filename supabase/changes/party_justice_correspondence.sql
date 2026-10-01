alter table public.political_posts add column if not exists context jsonb not null default '{}'::jsonb;
alter table public.political_posts add column if not exists source_key text;
create unique index if not exists political_posts_source_unique on public.political_posts(game_id,source_key) where source_key is not null;

create or replace function public.issue_party_justice_response(p_party_id uuid,p_status text,p_note text)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.game_parties%rowtype;uid uuid:=auth.uid();doc uuid:=gen_random_uuid();cert uuid;post uuid;stage integer;leader text;heading text;files jsonb;
begin
 select * into p from public.game_parties where id=p_party_id for update;
 if uid is null or p.id is null or not private.is_game_teacher(p.game_id) then raise exception 'Требуются права преподавателя';end if;
 if length(trim(coalesce(p_note,'')))<10 then raise exception 'Подготовьте текст ответа Минюста';end if;
 perform public.review_party_registration(p.id,p_status,p_note);
 select current_round into stage from public.games where id=p.game_id;
 select full_name into leader from public.game_members where game_id=p.game_id and user_id=p.leader_user_id;
 heading:=case p_status when 'registered' then 'О регистрации политической партии' when 'revision' then 'О доработке документов политической партии' else 'Об отказе в регистрации политической партии' end;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'kind',doc_kind,'file_name',file_name) order by created_at),'[]') into files from public.party_documents where party_id=p.id;
 insert into public.formal_documents(id,game_id,stage_no,registry_no,title,doc_type,subject_key,subject_label,author_id,body_text,workflow_key,workflow_steps,status_code,status_label,current_owner_key,metadata)
 values(doc,p.game_id,stage,'МЮ-'||left(doc::text,8),heading||' «'||p.name||'»','justice_response','minjust','Министерство юстиции Российской Федерации',uid,trim(p_note),'official_correspondence','[{"code":"published","label":"Направлен партии","owner":"system","action":null}]','published','Направлен партии','system',jsonb_build_object('party_id',p.id,'issuer_name','Министерство юстиции Российской Федерации','party_name',p.name,'party_ideology',p.ideology,'party_leader',leader,'submitted_documents',files,'decision',p_status));
 insert into public.formal_document_history(document_id,game_id,actor_id,action,to_status,note) values(doc,p.game_id,uid,'Подписать ответ Минюста','signed','Подписано преподавателем от имени Минюста в учебной игре');
 if p_status='registered' then
  select id into cert from public.formal_documents where game_id=p.game_id and doc_type='party_certificate' and metadata->>'party_id'=p.id::text limit 1;
  if cert is null then
   cert:=gen_random_uuid();
   insert into public.formal_documents(id,game_id,stage_no,registry_no,title,doc_type,subject_key,subject_label,author_id,body_text,workflow_key,workflow_steps,status_code,status_label,current_owner_key,metadata)
   values(cert,p.game_id,stage,'МЮ-С-'||left(cert::text,8),'Свидетельство о регистрации политической партии «'||p.name||'»','party_certificate','minjust','Министерство юстиции Российской Федерации',uid,'Настоящим подтверждается регистрация политической партии «'||p.name||'» в деловой игре GOS//SIMS.'||E'\n\nПредседатель: '||coalesce(leader,'Не назначен')||E'\nИдеология: '||coalesce(p.ideology,'Не указана')||E'\nРегиональные отделения: '||p.regions||E'\n\nОснование: решение Министерства юстиции по представленному регистрационному пакету.','official_correspondence','[{"code":"published","label":"Свидетельство выдано","owner":"system","action":null}]','published','Свидетельство выдано','system',jsonb_build_object('party_id',p.id,'issuer_name','Министерство юстиции Российской Федерации','response_id',doc));
   insert into public.formal_document_history(document_id,game_id,actor_id,action,to_status,note) values(cert,p.game_id,uid,'Подписать свидетельство','signed','Подписано преподавателем от имени Минюста в учебной игре');
  end if;
 end if;
 insert into public.political_posts(game_id,author_id,process_type,actor_key,actor_label,title,body,tags,internal_view,internal_ref_id,context)
 values(p.game_id,uid,'information','minjust','Министерство юстиции Российской Федерации',heading||' «'||p.name||'»',trim(p_note)||E'\n\nПредседатель: '||coalesce(leader,'Не назначен')||E'\nИдеология: '||coalesce(p.ideology,'Не указана'),array['этап_gpyasu','ходигры_gpyasu','партии_gpyasu'],'parties',p.id::text,jsonb_build_object('party_id',p.id,'stage_no',stage,'party_document_ids',(select coalesce(jsonb_agg(id),'[]') from public.party_documents where party_id=p.id and doc_kind in ('charter','program','symbol','congress_minutes') and status='accepted'))) returning id into post;
 insert into public.political_post_formal_links(game_id,post_id,formal_document_id,created_by) values(p.game_id,post,doc,uid);
 if cert is not null then insert into public.political_post_formal_links(game_id,post_id,formal_document_id,created_by) values(p.game_id,post,cert,uid);end if;
 insert into public.chat_messages(game_id,channel_id,author_id,kind,text)
 select p.game_id,id,uid,'system','Министерство юстиции: '||heading||' «'||p.name||'». Ответ и свидетельство доступны в разделе «Партии» и реестре НПА.' from public.chat_channels where game_id=p.game_id and name='Фракция · '||p.name;
 return doc;
end;$$;
revoke all on function public.issue_party_justice_response(uuid,text,text) from public,anon;
grant execute on function public.issue_party_justice_response(uuid,text,text) to authenticated;
