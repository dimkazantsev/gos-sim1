-- Attachments proposed to the media remain private until editorial approval.
create policy game_assets_news_insert on storage.objects for insert to authenticated with check (
 bucket_id='game-assets' and split_part(name,'/',2)='news' and split_part(name,'/',3)=(select auth.uid())::text
 and private.is_game_member(split_part(name,'/',1)::uuid) and not private.is_game_observer(split_part(name,'/',1)::uuid)
);
create policy game_assets_news_visibility on storage.objects as restrictive for select to authenticated using (
 bucket_id<>'game-assets' or split_part(name,'/',2)<>'news' or split_part(name,'/',3)=(select auth.uid())::text
 or private.is_game_teacher(split_part(name,'/',1)::uuid)
 or exists(select 1 from public.political_post_media pm join public.political_posts pp on pp.id=pm.post_id
 where pm.storage_path=objects.name and pp.deleted_at is null and private.is_game_member(pp.game_id))
);
create policy game_assets_news_cleanup on storage.objects for delete to authenticated using (
 bucket_id='game-assets' and split_part(name,'/',2)='news' and split_part(name,'/',3)=(select auth.uid())::text
 and private.is_game_member(split_part(name,'/',1)::uuid)
 and not exists(select 1 from public.media_news_proposals p where p.game_id=split_part(name,'/',1)::uuid and p.files @> jsonb_build_array(jsonb_build_object('storage_path',objects.name)))
 and not exists(select 1 from public.political_post_media m where m.storage_path=objects.name)
);
create index civic_comments_game on public.civic_comments(game_id);
create index civic_comments_author on public.civic_comments(author_id);
create index civic_reactions_user on public.civic_reactions(user_id);
create index civic_views_user on public.civic_views(user_id);
create index formal_deliveries_recipient on public.formal_document_deliveries(recipient_id);
create index formal_deliveries_sender on public.formal_document_deliveries(sender_id);
create index formal_revisions_editor on public.formal_document_revisions(editor_id);
create index media_proposals_author on public.media_news_proposals(author_id);
create index media_proposals_post on public.media_news_proposals(post_id);
create index media_proposals_reviewer on public.media_news_proposals(reviewed_by);
create index political_media_storage_path on public.political_post_media(storage_path);

-- An editor must not silently overwrite a concurrently saved revision.
create or replace function public.update_formal_draft(p_document_id uuid,p_title text,p_body_text text,p_metadata jsonb default null) returns void
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare d public.formal_documents%rowtype;u uuid:=auth.uid();access jsonb;rev integer;meta jsonb;change_note text;
begin
 select * into d from public.formal_documents where id=p_document_id for update;
 access:=public.get_formal_document_tools(p_document_id);
 if not (access->>'can_edit')::boolean then raise exception 'Редактирование недоступно. Завершите открытое голосование или проверьте полномочия';end if;
 if p_metadata ? 'expected_revision' and (p_metadata->>'expected_revision')::integer<>coalesce((d.metadata->>'revision')::integer,1) then raise exception 'Документ уже изменён другим участником. Откройте текущую редакцию и повторите правку';end if;
 if length(trim(coalesce(p_title,'')))<3 then raise exception 'Введите название документа';end if;
 if length(coalesce(p_body_text,''))>1000000 then raise exception 'Текст документа слишком большой';end if;
 meta:=d.metadata;
 if p_metadata ? 'issuer_name' then meta:=meta||jsonb_build_object('issuer_name',left(trim(p_metadata->>'issuer_name'),300));end if;
 if p_metadata ? 'place' then meta:=meta||jsonb_build_object('place',left(trim(p_metadata->>'place'),150));end if;
 if trim(p_title)=d.title and p_body_text is not distinct from d.body_text and meta=d.metadata then return;end if;
 rev:=coalesce((d.metadata->>'revision')::integer,1);
 insert into public.formal_document_revisions(game_id,document_id,revision,title,body_text,metadata,editor_id)
 values(d.game_id,d.id,rev,d.title,d.body_text,d.metadata,u);
 meta:=meta||jsonb_build_object('revision',rev+1,'revision_changed_at',clock_timestamp(),'revision_changed_by',u);
 update public.formal_documents set title=trim(p_title),body_text=p_body_text,metadata=meta,updated_at=clock_timestamp() where id=d.id;
 change_note:=nullif(left(trim(coalesce(p_metadata->>'edit_note','')),2000),'');
 insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
 values(d.id,d.game_id,u,'Сохранена редакция '||(rev+1),d.status_code,d.status_code,d.current_owner_key,d.current_owner_key,change_note);
end;$$;
revoke all on function public.update_formal_draft(uuid,text,text,jsonb) from public,anon;
grant execute on function public.update_formal_draft(uuid,text,text,jsonb) to authenticated;


create or replace function private.formal_user_roles(p_game uuid,p_user uuid) returns setof text
language sql stable security definer set search_path=public,private,pg_temp as $$
 select lower(coalesce(gm.role_title,'')) from public.game_members gm where gm.game_id=p_game and gm.user_id=p_user and gm.kind<>'observer' and private.role_is_available(p_game,p_user)
 union select lower(a.role_title) from public.game_office_assignments a
 where a.game_id=p_game and a.user_id=p_user and a.status='active'
 and exists(select 1 from public.game_members gm where gm.game_id=p_game and gm.user_id=p_user and gm.kind<>'observer' and private.role_is_available(p_game,p_user))
$$;
revoke all on function private.formal_user_roles(uuid,uuid) from public,anon,authenticated;


CREATE OR REPLACE FUNCTION private.can_create_formal_subject(p_game uuid, p_user uuid, p_subject text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
select case
 when p_user=auth.uid() and private.is_game_teacher(p_game) then true
 when not private.role_is_available(p_game,p_user) then false
 when p_subject='president' then exists(select 1 from private.formal_user_roles(p_game,p_user) r where r like '%президент%')
 when p_subject='gd_deputy' then exists(select 1 from private.formal_user_roles(p_game,p_user) r where r like '%депутат%')
 when p_subject='gd' then exists(select 1 from private.formal_user_roles(p_game,p_user) r where (r like '%председател%дум%' or r like '%совет%дум%'))
 when p_subject='sf' then exists(select 1 from private.formal_user_roles(p_game,p_user) r where (r like '%председател%совет%федерац%' or r like '%совет%федерац%'))
 when p_subject='sf_member' then exists(select 1 from private.formal_user_roles(p_game,p_user) r where r like '%сенатор%')
 when p_subject='government' then exists(select 1 from private.formal_user_roles(p_game,p_user) r where (r like '%правительств%' or r like '%министр%'))
 when p_subject='region' then exists(select 1 from private.formal_user_roles(p_game,p_user) r where (r like '%регион%' or r like '%субъект%' or r like '%законодательн%'))
 when p_subject='ks' then exists(select 1 from private.formal_user_roles(p_game,p_user) r where r like '%конституционн%суд%')
 when p_subject='vs' then exists(select 1 from private.formal_user_roles(p_game,p_user) r where r like '%верховн%суд%')
 when p_subject='ministry' then exists(select 1 from private.formal_user_roles(p_game,p_user) r where (r like '%министр%' or r like '%министерств%'))
 when p_subject='municipality' then exists(select 1 from private.formal_user_roles(p_game,p_user) r where (r like '%муницип%' or r like '%глава города%' or r like '%администрац%'))
 else false end;
$function$
;
create or replace function public.get_formal_subjects(p_game_id uuid) returns jsonb language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare result jsonb:='[]';k text;
begin
 if not private.is_game_member(p_game_id) then raise exception 'Нет доступа к игре';end if;
 foreach k in array array['president','gd_deputy','gd','sf','sf_member','government','region','ks','vs','ministry','municipality'] loop
 if private.can_create_formal_subject(p_game_id,auth.uid(),k) then result:=result||jsonb_build_array(k);end if;end loop;return result;
end;$$;
revoke all on function public.get_formal_subjects(uuid) from public,anon;grant execute on function public.get_formal_subjects(uuid) to authenticated;

-- Official publishers respect the active status of all assigned offices.
create or replace function private.process_actor_label(p_game_id uuid,p_actor_key text) returns text language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare v_uid uuid:=auth.uid();gm public.game_members%rowtype;v_label text;v_role text;
begin
 if v_uid is null or not private.is_game_member(p_game_id) then raise exception 'Нет доступа к игре';end if;
 select * into gm from public.game_members where game_id=p_game_id and user_id=v_uid;
 if gm.user_id is null or gm.kind='observer' then raise exception 'Публикации доступны участникам игры';end if;
 if not private.is_game_teacher(p_game_id) and not private.role_is_available(p_game_id,v_uid) and p_actor_key not in ('participant','party') then raise exception 'Полномочия должности временно недоступны';end if;
 select string_agg(r,' ') into v_role from private.formal_user_roles(p_game_id,v_uid) r;
 if p_actor_key='office' and length(trim(coalesce(gm.role_title,'')))>0 and lower(gm.role_title) not in ('участник','студент','гражданин') then v_label:=gm.role_title;
 elsif p_actor_key like 'office:%' then
 select a.role_title into v_label from public.game_office_assignments a where a.id=substr(p_actor_key,8)::uuid and a.game_id=p_game_id and a.user_id=v_uid and a.status='active';
 if v_label is null then raise exception 'Должность не назначена этому участнику';end if;
 elsif p_actor_key='participant' then v_label:=gm.full_name;
 elsif p_actor_key='party' and gm.team is not null then v_label:=gm.team;
 elsif p_actor_key='president' and (private.is_game_teacher(p_game_id) or v_role like '%президент%') then v_label:='Президент Российской Федерации';
 elsif p_actor_key='government' and (private.is_game_teacher(p_game_id) or v_role like '%правительств%' or v_role like '%министр%') then v_label:='Правительство Российской Федерации';
 elsif p_actor_key='gd' and (private.is_game_teacher(p_game_id) or v_role like '%депутат%' or (v_role like '%государственн%' and v_role like '%дум%')) then v_label:='Государственная Дума';
 elsif p_actor_key='sf' and (private.is_game_teacher(p_game_id) or v_role like '%совет федерац%' or v_role like '%сенатор%') then v_label:='Совет Федерации';
 elsif p_actor_key='ministry' and (private.is_game_teacher(p_game_id) or v_role like '%министр%') then select role_title into v_label from (select gm.role_title where lower(coalesce(gm.role_title,'')) like '%министр%' union all select a.role_title from public.game_office_assignments a where a.game_id=p_game_id and a.user_id=v_uid and a.status='active' and lower(a.role_title) like '%министр%') roles limit 1;v_label:=coalesce(v_label,'Федеральный орган исполнительной власти');
 elsif p_actor_key='municipality' and (private.is_game_teacher(p_game_id) or v_role like '%муницип%' or v_role like '%глава города%') then v_label:='Орган местного самоуправления';
 elsif p_actor_key='media' and (private.is_game_teacher(p_game_id) or v_role like '%сми%' or v_role like '%журналист%') then v_label:='Средства массовой информации';
 elsif p_actor_key='teacher' and private.is_game_teacher(p_game_id) then v_label:='GOS//SIMS';
 elsif p_actor_key='minjust' and (private.is_game_teacher(p_game_id) or v_role like '%юстиц%') then v_label:='Министерство юстиции Российской Федерации';
 elsif p_actor_key='interior' and (private.is_game_teacher(p_game_id) or v_role like '%внутренн%') then v_label:='Министерство внутренних дел Российской Федерации';
 elsif p_actor_key in ('cec','ks','vs','central_bank','accounts') and (private.is_game_teacher(p_game_id) or private.vote_member_has_office(p_game_id,v_uid,p_actor_key)) then v_label:=case p_actor_key when 'cec' then 'Избирательная комиссия' when 'ks' then 'Конституционный Суд Российской Федерации' when 'vs' then 'Верховный Суд Российской Федерации' when 'central_bank' then 'Банк России' else 'Счётная палата Российской Федерации' end;
 else raise exception 'Нет полномочий для публикации от этого субъекта';
 end if;

 return v_label;end;$$;
revoke all on function private.process_actor_label(uuid,text) from public,anon,authenticated;

create or replace function public.get_process_actors(p_game_id uuid) returns jsonb language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare result jsonb:='[]';k text;label text;a record;
begin
 if not private.is_game_member(p_game_id) then raise exception 'Нет доступа к игре';end if;
 foreach k in array array['teacher','participant','office','party','president','government','gd','sf','ministry','municipality','media','minjust','interior','cec','ks','vs','central_bank','accounts'] loop
 begin label:=private.process_actor_label(p_game_id,k);result:=result||jsonb_build_array(jsonb_build_object('key',k,'label',label));exception when others then null;end;
 end loop;
 for a in select id,role_title from public.game_office_assignments where game_id=p_game_id and user_id=auth.uid() and status='active' order by created_at loop
 begin label:=private.process_actor_label(p_game_id,'office:'||a.id::text);result:=result||jsonb_build_array(jsonb_build_object('key','office:'||a.id::text,'label',label));exception when others then null;end;end loop;return result;
end;$$;
revoke all on function public.get_process_actors(uuid) from public,anon;grant execute on function public.get_process_actors(uuid) to authenticated;

