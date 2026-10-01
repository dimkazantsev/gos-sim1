-- Future registration news only; no existing registration or post is rewritten.
CREATE OR REPLACE FUNCTION private.publish_process_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare detected_tags text[]:=array['этап_gpyasu','ходигры_gpyasu'];game uuid;uid uuid;heading text;body text;actor text:='teacher';label text:='GOS//SIMS';target text;ref text;key text;ctx jsonb:='{}';doc uuid;channel_kind text;author text;
begin
 game:=new.game_id;
 select coalesce(auth.uid(),owner_id) into uid from public.games where id=game;
 if uid is null then return new;end if;
 if tg_table_name='game_events' then
  if coalesce(new.audience->>'public','false')<>'true' or new.category='Регистрация партии' then return new;end if;
  heading:=new.title;body:=new.body;target:='events';ref:=new.id::text;key:='event:'||ref;ctx:=jsonb_build_object('category',new.category,'stage_no',new.round_no);
 elsif tg_table_name='game_stages' then
  if new.status=old.status then return new;end if;
  heading:=case when new.status='open' then 'Открыт этап ' else 'Завершён этап ' end||new.stage_no||': '||new.title;
  if new.status not in ('open','completed') then return new;end if;
  body:=coalesce(new.summary,'')||E'\n\nСтатус этапа: '||case new.status when 'open' then 'Открыт' else 'Завершён' end;target:='stages';ref:=new.id::text;key:='stage:'||ref||':'||new.status||':'||coalesce(new.opened_at,new.completed_at,now())::text;ctx:=jsonb_build_object('stage_no',new.stage_no,'stage_title',new.title);
 elsif tg_table_name='presidential_candidates' then
  if tg_op='UPDATE' and new.registration_status=old.registration_status then return new;end if;
  heading:=case new.registration_status when 'registered' then 'Зарегистрирован кандидат: ' when 'rejected' then 'Отказ в регистрации кандидата: ' when 'revision' then 'Документы кандидата возвращены на доработку: ' when 'withdrawn' then 'Кандидат снят с выборов: ' else 'Выдвинут кандидат: ' end||new.display_name;
  body:='Кандидат: '||new.display_name||E'\nСубъект выдвижения: '||coalesce((select name from public.game_parties where id=new.party_id),'Самовыдвижение')||E'\nПрограмма: '||coalesce(new.program_summary,'Не опубликована');actor:='cec';label:='Избирательная комиссия';target:='stages';ref:=new.id::text;key:='candidate:'||ref||':'||new.registration_status||':'||new.registration_attempts;ctx:=jsonb_build_object('party_id',new.party_id,'candidate_id',new.id);
  if new.registration_status='registered' then actor:='media';label:='Республиканский обозреватель';detected_tags:=array['выборы_gpyasu','цик_gpyasu','сми_gpyasu'];ctx:=ctx||jsonb_build_object('source_issuer','cec','stage_no',6);end if;
 elsif tg_table_name='formal_document_history' then
  if new.to_status is null or new.to_status=new.from_status then return new;end if;
  select title,body_text,id,subject_key,subject_label into heading,body,doc,actor,label from public.formal_documents where id=new.document_id and doc_type not in ('justice_response','party_certificate');
  if doc is null then return new;end if;
  heading:='Движение документа: '||heading;body:=new.action||E'\n\n'||coalesce(new.note,'')||E'\n\n'||coalesce(body,'');target:='documents';ref:=doc::text;key:='formal-history:'||new.id;ctx:=jsonb_build_object('document_id',doc,'status',new.to_status);
 elsif tg_table_name='game_votes' then
  if new.status<>'closed' or old.status='closed' then return new;end if;
  heading:='Итоги голосования: '||new.title;body:=coalesce(new.result_label,'Голосование завершено')||E'\n\nЗа: '||coalesce(new.result_yes,0)||'. Против: '||coalesce(new.result_no,0)||'. Воздержались: '||coalesce(new.result_abstain,0)||E'.\nПрисутствовало: '||coalesce(new.result_present,0)||' из '||coalesce(new.result_eligible,0)||'.';target:='votes';ref:=new.id::text;key:='vote:'||ref;doc:=new.formal_document_id;ctx:=jsonb_build_object('vote_id',new.id,'document_id',doc);
 elsif tg_table_name='chat_messages' then
  select kind::text into channel_kind from public.chat_channels where id=new.channel_id;
  if channel_kind<>'public' or new.kind<>'text' or new.text !~ '#(этап|ходигры|правила|партии|президент|гд|сф|правительство|министерства|минюст|цик|цб|регионы|муниципалитет|выборы|мандаты|голосование|законопроект|нпа|госпрограмма|бюджет|налоги|контроль|кризис|сми|итоги|рефлексия)_gpyasu' then return new;end if;
  select array_agg(distinct lower(m[1])||'_gpyasu') into detected_tags from regexp_matches(new.text,'#(этап|ходигры|правила|партии|президент|гд|сф|правительство|министерства|минюст|цик|цб|регионы|муниципалитет|выборы|мандаты|голосование|законопроект|нпа|госпрограмма|бюджет|налоги|контроль|кризис|сми|итоги|рефлексия)_gpyasu','gi') m;
  select full_name into author from public.game_members where game_id=game and user_id=new.author_id;
  heading:='Сообщение в политическом процессе: '||coalesce(author,'Участник');body:=new.text;target:='actions';ref:=new.id::text;key:='chat:'||ref;uid:=new.author_id;actor:='participant';label:=coalesce(author,'Участник');ctx:=jsonb_build_object('chat_message_id',new.id,'channel_id',new.channel_id);
 elsif tg_table_name='player_actions' then
  if new.status=old.status or new.status not in ('accepted','rejected') then return new;end if;
  select full_name into author from public.game_members where game_id=game and user_id=new.author_id;
  heading:=case new.status when 'accepted' then 'Принято решение: ' else 'Отклонено решение: ' end||new.title;
  body:=coalesce(author,'Участник')||E'\n\n'||new.body||E'\n\n'||coalesce(new.teacher_feedback,'');target:='actions';ref:=new.id::text;key:='action:'||ref||':'||new.status;ctx:=jsonb_build_object('stage_no',new.round_no,'action_id',new.id,'status',new.status);
 else return new;end if;
 insert into public.political_posts(game_id,author_id,process_type,actor_key,actor_label,title,body,tags,internal_view,internal_ref_id,source_key,context)
 values(game,uid,'information',actor,label,heading,coalesce(nullif(body,''),heading),detected_tags,target,ref,key,ctx||jsonb_build_object('automatic',true,'source_table',tg_table_name)) on conflict(game_id,source_key) where source_key is not null do nothing;
 if doc is not null then
  insert into public.political_post_formal_links(game_id,post_id,formal_document_id,created_by) select game,p.id,doc,uid from public.political_posts p where p.game_id=game and source_key=key on conflict do nothing;
 end if;
 return new;
end;$function$;

CREATE OR REPLACE FUNCTION public.issue_party_justice_response(p_party_id uuid, p_status text, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare p public.game_parties%rowtype;uid uuid:=auth.uid();doc uuid:=gen_random_uuid();cert uuid;post uuid;media_post uuid;stage integer;leader text;heading text;files jsonb;
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
end;$function$;

revoke all on function private.publish_process_update() from public,anon,authenticated;
revoke all on function public.issue_party_justice_response(uuid,text,text) from public,anon;
grant execute on function public.issue_party_justice_response(uuid,text,text) to authenticated;
