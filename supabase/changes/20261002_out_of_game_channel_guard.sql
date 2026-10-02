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
  if exists(select 1 from public.chat_channels where id=new.channel_id and name='Вне игры') then return new;end if;
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
end;$function$
;

