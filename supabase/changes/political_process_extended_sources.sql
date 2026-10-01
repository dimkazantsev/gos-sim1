create or replace function private.prepare_political_context() returns trigger
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare stage integer;label text;
begin
 select current_round into stage from public.games where id=new.game_id;
 select title into label from public.game_stages where game_id=new.game_id and stage_no=stage;
 new.context:=jsonb_build_object('stage_no',stage,'stage_title',label)||coalesce(new.context,'{}');
 if new.actor_key='teacher' then new.actor_label:='GOS//SIMS';end if;
 if new.actor_key='minjust' and new.context ? 'party_document_ids' then new.context:=new.context||jsonb_build_object('automatic',true,'source_table','party_registration');end if;
 if new.actor_key='media' and new.effects_applied and new.internal_view='events' and new.internal_ref_id is not null then
  new.source_key:='case-outcome:'||new.internal_ref_id;
  new.tags:=array['этап_gpyasu','ходигры_gpyasu'];
  new.context:=new.context||jsonb_build_object('automatic',true,'source_table','event_case_outcomes');
 end if;
 return new;
end;$$;
create or replace function private.publish_process_update() returns trigger
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare game uuid;uid uuid;heading text;body text;actor text:='teacher';label text:='GOS//SIMS';target text;ref text;key text;ctx jsonb:='{}';doc uuid;channel_kind text;author text;
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
  if channel_kind<>'public' or new.kind<>'text' or new.text !~ '#(этап|ходигры|правила|партии)_gpyasu' then return new;end if;
  select full_name into author from public.game_members where game_id=game and user_id=new.author_id;
  heading:='Сообщение в политическом процессе: '||coalesce(author,'Участник');body:=new.text;target:='actions';ref:=new.id::text;key:='chat:'||ref;uid:=new.author_id;actor:='participant';label:=coalesce(author,'Участник');ctx:=jsonb_build_object('chat_message_id',new.id,'channel_id',new.channel_id);
 elsif tg_table_name='player_actions' then
  if new.status=old.status or new.status not in ('accepted','rejected') then return new;end if;
  select full_name into author from public.game_members where game_id=game and user_id=new.author_id;
  heading:=case new.status when 'accepted' then 'Принято решение: ' else 'Отклонено решение: ' end||new.title;
  body:=coalesce(author,'Участник')||E'\n\n'||new.body||E'\n\n'||coalesce(new.teacher_feedback,'');target:='actions';ref:=new.id::text;key:='action:'||ref||':'||new.status;ctx:=jsonb_build_object('stage_no',new.round_no,'action_id',new.id,'status',new.status);
 else return new;end if;
 insert into public.political_posts(game_id,author_id,process_type,actor_key,actor_label,title,body,tags,internal_view,internal_ref_id,source_key,context)
 values(game,uid,'information',actor,label,heading,coalesce(nullif(body,''),heading),array['этап_gpyasu','ходигры_gpyasu'],target,ref,key,ctx||jsonb_build_object('automatic',true,'source_table',tg_table_name)) on conflict(game_id,source_key) where source_key is not null do nothing;
 if doc is not null then
  insert into public.political_post_formal_links(game_id,post_id,formal_document_id,created_by) select game,p.id,doc,uid from public.political_posts p where p.game_id=game and source_key=key on conflict do nothing;
 end if;
 return new;
end;$$;

drop trigger if exists publish_player_action_process on public.player_actions;
create trigger publish_player_action_process after update of status on public.player_actions for each row execute function private.publish_process_update();
-- A student may propose a class poll on their own post.
create or replace function public.create_vote_from_post(p_post_id uuid,p_institution_key text default 'all',p_voting_mode text default 'member',p_quorum_value numeric default .6666667,p_majority_kind text default 'present_majority',p_majority_value numeric default .5)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.political_posts%rowtype;uid uuid:=auth.uid();id uuid;existing uuid;
begin
 select * into p from public.political_posts where political_posts.id=p_post_id for update;
 if uid is null or p.id is null or not private.is_game_member(p.game_id) then raise exception 'Нет доступа к публикации';end if;
 if p.status<>'published' then raise exception 'Голосование открывается по опубликованному проекту';end if;
 if not private.is_game_teacher(p.game_id) then
  if p.author_id<>uid or p.source_key is not null or p_institution_key<>'all' then raise exception 'Голосование органа открывает преподаватель';end if;
  p_voting_mode:='member';p_quorum_value:=2.0/3;p_majority_kind:='present_majority';p_majority_value:=.5;
 end if;
 select v.id into existing from public.game_votes v where v.game_id=p.game_id and v.source_post_id=p.id and v.institution_key=p_institution_key and v.status='open' order by opened_at limit 1;
 if existing is not null then return existing;end if;
 insert into public.game_votes(game_id,stage_no,title,body,voting_mode,status,created_by,institution_key,procedure_key,quorum_kind,quorum_value,majority_kind,majority_value,allow_abstain,tie_breaker_chair,source_post_id,pass_transition,fail_transition)
 values(p.game_id,(select current_round from public.games where games.id=p.game_id),'Решение: '||p.title,p.body,p_voting_mode,'open',uid,p_institution_key,'political_post','fraction',p_quorum_value,p_majority_kind,p_majority_value,true,false,p.id,'none','none') returning game_votes.id into id;
 return id;
end;$$;

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
 select p.game_id,id,uid,'system','Министерство юстиции: '||heading||' «'||p.name||'». '||case when p_status='registered' then 'Ответ и свидетельство доступны' else 'Ответ доступен' end||' в разделе «Партии» и реестре НПА.' from public.chat_channels where game_id=p.game_id and name='Фракция · '||p.name;
 return doc;
end;$$;
revoke all on function public.issue_party_justice_response(uuid,text,text) from public,anon;
grant execute on function public.issue_party_justice_response(uuid,text,text) to authenticated;
