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
 else return new;end if;
 insert into public.political_posts(game_id,author_id,process_type,actor_key,actor_label,title,body,tags,internal_view,internal_ref_id,source_key,context)
 values(game,uid,'information',actor,label,heading,coalesce(nullif(body,''),heading),array['этап_gpyasu','ходигры_gpyasu'],target,ref,key,ctx||jsonb_build_object('automatic',true,'source_table',tg_table_name)) on conflict(game_id,source_key) where source_key is not null do nothing;
 if doc is not null then
  insert into public.political_post_formal_links(game_id,post_id,formal_document_id,created_by) select game,p.id,doc,uid from public.political_posts p where p.game_id=game and source_key=key on conflict do nothing;
 end if;
 return new;
end;$$;

create or replace function public.set_post_state_metric(p_post_id uuid,p_metric_id uuid,p_value numeric,p_note text)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.political_posts%rowtype;m public.state_metrics%rowtype;
begin
 select * into p from public.political_posts where id=p_post_id;
 select * into m from public.state_metrics where id=p_metric_id for update;
 if auth.uid() is null or p.id is null or m.id is null or m.game_id<>p.game_id or not private.is_game_teacher(p.game_id) then raise exception 'Требуются права преподавателя этой игры';end if;
 if p_value is null or p_value::text in ('NaN','Infinity','-Infinity') or length(trim(coalesce(p_note,'')))<1 then raise exception 'Укажите значение и обоснование';end if;
 if (m.min_value is not null and p_value<m.min_value) or (m.max_value is not null and p_value>m.max_value) then raise exception 'Значение вне диапазона';end if;
 perform private.record_metric_change(m.game_id,m.metric_key,p_value,'political_post',p.id::text,auth.uid(),trim(p_note));
end;$$;
