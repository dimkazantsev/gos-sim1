create or replace function private.prepare_political_context() returns trigger
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare stage integer;label text;
begin
 select current_round into stage from public.games where id=new.game_id;
 select title into label from public.game_stages where game_id=new.game_id and stage_no=stage;
 new.context:=jsonb_build_object('stage_no',stage,'stage_title',label)||coalesce(new.context,'{}');
 if new.actor_key='teacher' then new.actor_label:='GOS//SIMS';end if;
 return new;
end;$$;
create trigger prepare_political_context before insert on public.political_posts for each row execute function private.prepare_political_context();

-- System reporting must not recursively change the indicators it reports.
create or replace function private.impact_post_insert_trigger() returns trigger
language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 if new.source_key is not null or coalesce((new.context->>'automatic')::boolean,false) or (new.actor_key='minjust' and new.context ? 'party_document_ids') then return new;end if;
 perform private.run_impact_rules(new.game_id,'post_published','political_post',new.id::text,new.author_id,jsonb_build_object('process_type',new.process_type,'actor_key',new.actor_key),'Публикация: '||new.title);
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
 else return new;end if;
 insert into public.political_posts(game_id,author_id,process_type,actor_key,actor_label,title,body,tags,internal_view,internal_ref_id,source_key,context)
 values(game,uid,'information',actor,label,heading,coalesce(nullif(body,''),heading),array['этап_gpyasu','ходигры_gpyasu'],target,ref,key,ctx||jsonb_build_object('automatic',true,'source_table',tg_table_name)) on conflict(game_id,source_key) where source_key is not null do nothing;
 if doc is not null then
  insert into public.political_post_formal_links(game_id,post_id,formal_document_id,created_by) select game,p.id,doc,uid from public.political_posts p where p.game_id=game and source_key=key on conflict do nothing;
 end if;
 return new;
end;$$;
create trigger publish_game_event_process after insert on public.game_events for each row execute function private.publish_process_update();
create trigger publish_stage_process after update of status on public.game_stages for each row execute function private.publish_process_update();
create trigger publish_candidate_process after insert or update of registration_status on public.presidential_candidates for each row execute function private.publish_process_update();
create trigger publish_formal_process after insert on public.formal_document_history for each row execute function private.publish_process_update();
create trigger publish_vote_process after update of status on public.game_votes for each row execute function private.publish_process_update();
create trigger publish_chat_process after insert on public.chat_messages for each row execute function private.publish_process_update();

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
revoke all on function public.set_post_state_metric(uuid,uuid,numeric,text) from public,anon;
grant execute on function public.set_post_state_metric(uuid,uuid,numeric,text) to authenticated;
revoke all on function private.prepare_political_context(),private.publish_process_update(),private.impact_post_insert_trigger() from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.create_political_post(p_game_id uuid, p_process_type text, p_actor_key text, p_title text, p_body text, p_tags text[] DEFAULT '{}'::text[], p_external_url text DEFAULT NULL::text, p_internal_view text DEFAULT NULL::text, p_internal_ref_id text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
 v_uid uuid:=(select auth.uid());
 gm public.game_members%rowtype;
 v_label text;
 v_id uuid:=gen_random_uuid();
 v_role text;
 v_url text:=nullif(trim(coalesce(p_external_url,'')),'');
begin
 if v_uid is null or not private.is_game_member(p_game_id) then raise exception 'Game access required'; end if;
 select * into gm from public.game_members where game_id=p_game_id and user_id=v_uid;
 if gm.user_id is null then raise exception 'Member not found'; end if;
 v_role:=lower(coalesce(gm.role_title,''));

 if p_actor_key='participant' then v_label:=gm.full_name;
 elsif p_actor_key='party' and gm.team is not null then v_label:=gm.team;
 elsif p_actor_key='president' and (private.is_game_teacher(p_game_id) or v_role like '%президент%') then v_label:='Президент Российской Федерации';
 elsif p_actor_key='government' and (private.is_game_teacher(p_game_id) or v_role like '%правительств%' or v_role like '%министр%') then v_label:='Правительство Российской Федерации';
 elsif p_actor_key='gd' and (private.is_game_teacher(p_game_id) or v_role like '%депутат%' or (v_role like '%государственн%' and v_role like '%дум%')) then v_label:='Государственная Дума';
 elsif p_actor_key='sf' and (private.is_game_teacher(p_game_id) or v_role like '%совет федерац%' or v_role like '%сенатор%') then v_label:='Совет Федерации';
 elsif p_actor_key='ministry' and (private.is_game_teacher(p_game_id) or v_role like '%министр%') then v_label:=coalesce(nullif(gm.role_title,''),'Федеральный орган исполнительной власти');
 elsif p_actor_key='municipality' and (private.is_game_teacher(p_game_id) or v_role like '%муницип%' or v_role like '%глава города%') then v_label:='Орган местного самоуправления';
 elsif p_actor_key='media' and (private.is_game_teacher(p_game_id) or v_role like '%сми%' or v_role like '%журналист%') then v_label:='Средства массовой информации';
 elsif p_actor_key='teacher' and private.is_game_teacher(p_game_id) then v_label:='GOS//SIMS';
 elsif p_actor_key='minjust' and (private.is_game_teacher(p_game_id) or v_role like '%юстиц%') then v_label:='Министерство юстиции Российской Федерации';
 elsif p_actor_key='interior' and (private.is_game_teacher(p_game_id) or v_role like '%внутренн%') then v_label:='Министерство внутренних дел Российской Федерации';
 elsif p_actor_key in ('cec','ks','vs','central_bank','accounts') and (private.is_game_teacher(p_game_id) or private.vote_member_has_office(p_game_id,v_uid,p_actor_key)) then v_label:=case p_actor_key when 'cec' then 'Избирательная комиссия' when 'ks' then 'Конституционный Суд Российской Федерации' when 'vs' then 'Верховный Суд Российской Федерации' when 'central_bank' then 'Банк России' else 'Счётная палата Российской Федерации' end;
 else raise exception 'You cannot publish on behalf of this actor';
 end if;

 if length(trim(coalesce(p_title,'')))<3 or length(trim(coalesce(p_body,'')))<3 then raise exception 'Title and body are required'; end if;
 if v_url is not null and v_url !~* '^https?://' then raise exception 'External URL must use http or https'; end if;

 insert into public.political_posts(id,game_id,author_id,process_type,actor_key,actor_label,title,body,tags,external_url,internal_view,internal_ref_id)
 values(v_id,p_game_id,v_uid,coalesce(nullif(trim(p_process_type),''),'statement'),p_actor_key,v_label,trim(p_title),trim(p_body),coalesce(p_tags,'{}'),v_url,nullif(trim(coalesce(p_internal_view,'')),''),nullif(trim(coalesce(p_internal_ref_id,'')),''));
 return v_id;
end;
$function$
