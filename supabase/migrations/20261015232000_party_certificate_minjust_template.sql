-- Certificate generated atomically with party registration; uses simulation-only unique number.
CREATE OR REPLACE FUNCTION public.issue_party_justice_response(p_party_id uuid, p_status text, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare p public.game_parties%rowtype;uid uuid:=auth.uid();doc uuid:=gen_random_uuid();cert uuid;post uuid;media_post uuid;stage integer;leader text;heading text;files jsonb;v_certificate_number text;v_issued_on date;
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
   v_issued_on:=(now() at time zone 'Asia/Novosibirsk')::date;
   -- Number is generated only once, checked against all issued certificates.
   perform pg_advisory_xact_lock(hashtextextended('party-certificate-number',0));
   loop
     v_certificate_number:='1'||lpad(floor(random()*1000000000000)::bigint::text,12,'0');
     exit when not exists (
       select 1 from public.formal_documents fd
       where fd.doc_type='party_certificate'
       and fd.metadata->>'certificate_number'=v_certificate_number
     );
   end loop;
   insert into public.formal_documents(id,game_id,stage_no,registry_no,title,doc_type,subject_key,subject_label,author_id,body_text,workflow_key,workflow_steps,status_code,status_label,current_owner_key,metadata)
   values(cert,p.game_id,stage,'МЮ-С-'||v_certificate_number,'Свидетельство о регистрации политической партии «'||p.name||'»','party_certificate','minjust','Министерство юстиции Российской Федерации',uid,'Решение о регистрации политической партии «'||p.name||'» принято '||to_char(v_issued_on,'DD.MM.YYYY')||'. Запись в реестр политических партий ГОС.ID внесена '||to_char(v_issued_on,'DD.MM.YYYY')||'. Регистрационный номер: '||v_certificate_number||'.','official_correspondence','[{"code":"published","label":"Свидетельство выдано","owner":"system","action":null}]','published','Свидетельство выдано','system',jsonb_build_object('party_id',p.id,'issuer_name','Министерство юстиции Российской Федерации','response_id',doc,'certificate_number',v_certificate_number,'decision_date',v_issued_on,'registry_date',v_issued_on,'issue_date',v_issued_on,'signatory_name','Казанцев Д.А.','signatory_title','Директор Департамента по делам некоммерческих организаций Министерства юстиции Российской Федерации','certificate_template','minjust_2021'));
   insert into public.formal_document_history(document_id,game_id,actor_id,action,to_status,note) values(cert,p.game_id,uid,'Подписать свидетельство','signed','Подписано преподавателем от имени Минюста в учебной игре');
  end if;
 end if;
 insert into public.political_posts(game_id,author_id,process_type,actor_key,actor_label,title,body,tags,internal_view,internal_ref_id,context)
 values(p.game_id,uid,'information','minjust','Министерство юстиции Российской Федерации',heading||' «'||p.name||'»',trim(p_note)||E'\n\nПредседатель: '||coalesce(leader,'Не назначен')||E'\nИдеология: '||coalesce(p.ideology,'Не указана'),array['этап_gpyasu','ходигры_gpyasu','партии_gpyasu'],'parties',p.id::text,jsonb_build_object('party_id',p.id,'stage_no',stage,'party_document_ids',(select coalesce(jsonb_agg(id),'[]') from public.party_documents where party_id=p.id and doc_kind in ('charter','program','symbol','congress_minutes') and status='accepted'))) returning id into post;
 insert into public.political_post_formal_links(game_id,post_id,formal_document_id,created_by) values(p.game_id,post,doc,uid);
 if cert is not null then insert into public.political_post_formal_links(game_id,post_id,formal_document_id,created_by) values(p.game_id,post,cert,uid);end if;

 -- The official response remains the legal source. The news desk reports only
 -- public facts and links the signed response/certificate; repeated clicks do
 -- not issue another registration story.
 if p_status='registered' and cert is not null then
  insert into public.political_posts(game_id,author_id,process_type,actor_key,actor_label,title,body,tags,internal_view,internal_ref_id,source_key,context)
  values(p.game_id,uid,'news','media','Республиканский обозреватель','Минюст зарегистрировал партию «'||p.name||'»',
   'В реестр участников политического процесса включена партия «'||p.name||'».'||E'\nПредседатель: '||coalesce(leader,'Не назначен')||E'\nПубличная позиция: '||coalesce(p.ideology,'Не указана')||E'\nРегиональные отделения: '||p.regions||E'\nСвидетельство и официальный ответ Минюста приложены к публикации.',
   array['партии_gpyasu','минюст_gpyasu','сми_gpyasu'],'parties',p.id::text,'media-party-registration:'||cert,
   jsonb_build_object('automatic',true,'source_table','game_parties','source_issuer','minjust','party_id',p.id,'stage_no',1,'official_post_id',post,'party_document_ids',(select coalesce(jsonb_agg(id),'[]') from public.party_documents where party_id=p.id and status='accepted' and doc_kind in ('charter','program','symbol','congress_minutes'))))
  on conflict(game_id,source_key) where source_key is not null do nothing returning id into media_post;
  if media_post is not null then
   insert into public.political_post_formal_links(game_id,post_id,formal_document_id,created_by) values(p.game_id,media_post,doc,uid),(p.game_id,media_post,cert,uid) on conflict do nothing;
  end if;
 end if;
 insert into public.chat_messages(game_id,channel_id,author_id,kind,text)
 select p.game_id,id,uid,'system','Министерство юстиции: '||heading||' «'||p.name||'». '||case when p_status='registered' then 'Ответ и свидетельство доступны' else 'Ответ доступен' end||' в разделе «Партии» и реестре НПА.' from public.chat_channels where game_id=p.game_id and name='Фракция · '||p.name;
 return doc;
end;$function$
;
