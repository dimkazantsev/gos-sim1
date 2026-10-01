-- Publication deletion is soft: decision and metric evidence remain in the audit trail.
alter table public.political_posts add column deleted_at timestamptz,add column deleted_by uuid references auth.users(id);
drop policy political_posts_read on public.political_posts;
create policy political_posts_read on public.political_posts for select to authenticated using(deleted_at is null and private.is_game_member(game_id));
-- Publishing goes through the guarded RPC, including identity validation.
drop policy political_posts_insert on public.political_posts;

create or replace function public.delete_process_post(p_post_id uuid) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.political_posts%rowtype;
begin
 select * into p from public.political_posts where id=p_post_id for update;
 if p.id is null or not private.is_game_member(p.game_id) or not (private.is_game_teacher(p.game_id) or (p.author_id=auth.uid() and p.source_key is null and coalesce((p.context->>'automatic')::boolean,false)=false)) then raise exception 'Удаление публикации недоступно';end if;
 if not exists(select 1 from public.game_members where game_id=p.game_id and user_id=auth.uid() and kind<>'observer') and not private.is_game_teacher(p.game_id) then raise exception 'Наблюдатель не может удалять публикации';end if;
 update public.political_posts set deleted_at=clock_timestamp(),deleted_by=auth.uid() where id=p.id and deleted_at is null;
end;$$;
revoke all on function public.delete_process_post(uuid) from public,anon;grant execute on function public.delete_process_post(uuid) to authenticated;

create table public.civic_reactions(game_id uuid not null references public.games(id) on delete cascade,target_kind text not null check(target_kind in ('post','document')),target_id uuid not null,user_id uuid not null references auth.users(id),value smallint not null check(value in (-1,1)),primary key(target_kind,target_id,user_id));
create table public.civic_views(game_id uuid not null references public.games(id) on delete cascade,target_kind text not null check(target_kind in ('post','document')),target_id uuid not null,user_id uuid not null references auth.users(id),first_seen timestamptz not null default clock_timestamp(),primary key(target_kind,target_id,user_id));
create table public.civic_comments(id uuid primary key default gen_random_uuid(),game_id uuid not null references public.games(id) on delete cascade,target_kind text not null check(target_kind in ('post','document')),target_id uuid not null,author_id uuid not null references auth.users(id),body text not null check(length(trim(body)) between 1 and 6000),created_at timestamptz not null default clock_timestamp());
create index civic_reactions_game on public.civic_reactions(game_id);
create index civic_views_game on public.civic_views(game_id);
create index civic_comments_target on public.civic_comments(target_kind,target_id,created_at);
alter table public.civic_reactions enable row level security;alter table public.civic_views enable row level security;alter table public.civic_comments enable row level security;
create policy civic_reactions_read on public.civic_reactions for select to authenticated using(private.is_game_member(game_id));
create policy civic_views_read on public.civic_views for select to authenticated using(private.is_game_member(game_id));
create policy civic_comments_read on public.civic_comments for select to authenticated using(private.is_game_member(game_id));
grant select on public.civic_reactions,public.civic_views,public.civic_comments to authenticated;

create or replace function private.civic_target_game(p_kind text,p_target uuid) returns uuid language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare g uuid;
begin
 if p_kind='post' then select game_id into g from public.political_posts where id=p_target and deleted_at is null;
 elsif p_kind='document' then select game_id into g from public.formal_documents where id=p_target;else raise exception 'Неизвестный вид материала';end if;
 if g is null or not private.is_game_member(g) then raise exception 'Материал недоступен';end if;return g;
end;$$;
revoke all on function private.civic_target_game(text,uuid) from public,anon,authenticated;

create or replace function public.get_civic_discussion(p_kind text,p_target uuid,p_limit integer default 30) returns jsonb language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare g uuid:=private.civic_target_game(p_kind,p_target);result jsonb;
begin
 select jsonb_build_object('likes',count(*) filter(where value=1),'dislikes',count(*) filter(where value=-1),'mine',coalesce(max(value) filter(where user_id=auth.uid()),0)) into result from public.civic_reactions where target_kind=p_kind and target_id=p_target;
 return result||jsonb_build_object('views',(select count(*) from public.civic_views where target_kind=p_kind and target_id=p_target),'comment_count',(select count(*) from public.civic_comments where target_kind=p_kind and target_id=p_target),
 'comments',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from(select c.id,c.author_id,c.body,c.created_at,gm.full_name from public.civic_comments c join public.game_members gm on gm.game_id=c.game_id and gm.user_id=c.author_id where c.target_kind=p_kind and c.target_id=p_target order by c.created_at desc limit least(greatest(p_limit,1),200)) x),'[]'::jsonb));
end;$$;
revoke all on function public.get_civic_discussion(text,uuid,integer) from public,anon;grant execute on function public.get_civic_discussion(text,uuid,integer) to authenticated;

create or replace function public.record_civic_view(p_kind text,p_target uuid) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare g uuid:=private.civic_target_game(p_kind,p_target);
begin insert into public.civic_views(game_id,target_kind,target_id,user_id) values(g,p_kind,p_target,auth.uid()) on conflict do nothing;end;$$;
revoke all on function public.record_civic_view(text,uuid) from public,anon;grant execute on function public.record_civic_view(text,uuid) to authenticated;

create or replace function public.react_to_civic_content(p_kind text,p_target uuid,p_value smallint) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare g uuid:=private.civic_target_game(p_kind,p_target);
begin
 if not exists(select 1 from public.game_members where game_id=g and user_id=auth.uid() and kind<>'observer') then raise exception 'Реакции доступны участникам игры';end if;
 if p_value not in (-1,0,1) or p_value is null then raise exception 'Неизвестная реакция';end if;
 if p_value=0 then delete from public.civic_reactions where target_kind=p_kind and target_id=p_target and user_id=auth.uid();
 else insert into public.civic_reactions(game_id,target_kind,target_id,user_id,value) values(g,p_kind,p_target,auth.uid(),p_value) on conflict(target_kind,target_id,user_id) do update set value=excluded.value;end if;
end;$$;
revoke all on function public.react_to_civic_content(text,uuid,smallint) from public,anon;grant execute on function public.react_to_civic_content(text,uuid,smallint) to authenticated;

create or replace function public.comment_on_civic_content(p_kind text,p_target uuid,p_body text) returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare g uuid:=private.civic_target_game(p_kind,p_target);c uuid;
begin
 if not exists(select 1 from public.game_members where game_id=g and user_id=auth.uid() and kind<>'observer') then raise exception 'Комментарии доступны участникам игры';end if;
 if length(trim(coalesce(p_body,''))) not between 1 and 6000 then raise exception 'Комментарий должен содержать от 1 до 6000 символов';end if;
 insert into public.civic_comments(game_id,target_kind,target_id,author_id,body) values(g,p_kind,p_target,auth.uid(),trim(p_body)) returning id into c;return c;
end;$$;
revoke all on function public.comment_on_civic_content(text,uuid,text) from public,anon;grant execute on function public.comment_on_civic_content(text,uuid,text) to authenticated;

create or replace function public.delete_civic_comment(p_comment_id uuid) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare c public.civic_comments%rowtype;
begin
 select * into c from public.civic_comments where id=p_comment_id;
 if c.id is null or not private.is_game_member(c.game_id) or not (c.author_id=auth.uid() or private.is_game_teacher(c.game_id)) then raise exception 'Удаление комментария недоступно';end if;
 delete from public.civic_comments where id=c.id;
end;$$;
revoke all on function public.delete_civic_comment(uuid) from public,anon;grant execute on function public.delete_civic_comment(uuid) to authenticated;

create table public.media_news_proposals(
 id uuid primary key default gen_random_uuid(),game_id uuid not null references public.games(id) on delete cascade,author_id uuid not null references auth.users(id),
 title text not null,body text not null,tags text[] not null default '{}',external_url text,internal_view text,formal_ids uuid[] not null default '{}',files jsonb not null default '[]',
 submitted_actor text not null,status text not null default 'pending' check(status in ('pending','approved','rejected')),
 review_note text,reviewed_by uuid references auth.users(id),post_id uuid references public.political_posts(id),created_at timestamptz not null default clock_timestamp(),reviewed_at timestamptz
);
create index media_proposals_queue on public.media_news_proposals(game_id,status,created_at);
alter table public.media_news_proposals enable row level security;
create policy media_proposals_read on public.media_news_proposals for select to authenticated using(private.is_game_member(game_id) and (author_id=(select auth.uid()) or private.is_game_teacher(game_id)));
grant select on public.media_news_proposals to authenticated;

create or replace function private.process_actor_label(p_game_id uuid,p_actor_key text) returns text language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare v_uid uuid:=auth.uid();gm public.game_members%rowtype;v_label text;v_role text;
begin
 if v_uid is null or not private.is_game_member(p_game_id) then raise exception 'Нет доступа к игре';end if;
 select * into gm from public.game_members where game_id=p_game_id and user_id=v_uid;
 if gm.user_id is null or gm.kind='observer' then raise exception 'Публикации доступны участникам игры';end if;
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
 elsif p_actor_key='ministry' and (private.is_game_teacher(p_game_id) or v_role like '%министр%') then v_label:=coalesce(nullif(gm.role_title,''),'Федеральный орган исполнительной власти');
 elsif p_actor_key='municipality' and (private.is_game_teacher(p_game_id) or v_role like '%муницип%' or v_role like '%глава города%') then v_label:='Орган местного самоуправления';
 elsif p_actor_key='media' and (private.is_game_teacher(p_game_id) or v_role like '%сми%' or v_role like '%журналист%') then v_label:='Средства массовой информации';
 elsif p_actor_key='teacher' and private.is_game_teacher(p_game_id) then v_label:='GOS//SIMS';
 elsif p_actor_key='minjust' and (private.is_game_teacher(p_game_id) or v_role like '%юстиц%') then v_label:='Министерство юстиции Российской Федерации';
 elsif p_actor_key='interior' and (private.is_game_teacher(p_game_id) or v_role like '%внутренн%') then v_label:='Министерство внутренних дел Российской Федерации';
 elsif p_actor_key in ('cec','ks','vs','central_bank','accounts') and (private.is_game_teacher(p_game_id) or private.vote_member_has_office(p_game_id,v_uid,p_actor_key)) then v_label:=case p_actor_key when 'cec' then 'Избирательная комиссия' when 'ks' then 'Конституционный Суд Российской Федерации' when 'vs' then 'Верховный Суд Российской Федерации' when 'central_bank' then 'Банк России' else 'Счётная палата Российской Федерации' end;
 else raise exception 'You cannot publish on behalf of this actor';
 end if;

 return v_label;end;$$;
revoke all on function private.process_actor_label(uuid,text) from public,anon,authenticated;

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
 v_label:=private.process_actor_label(p_game_id,p_actor_key);
 if p_process_type not in ('statement','initiative','decision','event','negotiation','crisis_response','information','news') then raise exception 'Неизвестный вид публикации';end if;
 if p_internal_view is not null and p_internal_view not in ('actions','documents','votes','parties','stages','events','dashboard') then raise exception 'Неизвестный раздел игры';end if;

 if length(trim(coalesce(p_title,'')))<3 or length(trim(coalesce(p_body,'')))<3 then raise exception 'Title and body are required'; end if;
 if v_url is not null and v_url !~* '^https?://' then raise exception 'External URL must use http or https'; end if;

 insert into public.political_posts(id,game_id,author_id,process_type,actor_key,actor_label,title,body,tags,external_url,internal_view,internal_ref_id)
 values(v_id,p_game_id,v_uid,coalesce(nullif(trim(p_process_type),''),'statement'),p_actor_key,v_label,trim(p_title),trim(p_body),coalesce(p_tags,'{}'),v_url,nullif(trim(coalesce(p_internal_view,'')),''),nullif(trim(coalesce(p_internal_ref_id,'')),''));
 return v_id;
end;
$function$
;
create or replace function public.get_process_actors(p_game_id uuid) returns jsonb language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare result jsonb:='[]';k text;label text;a record;
begin
 if not private.is_game_member(p_game_id) then raise exception 'Нет доступа к игре';end if;
 foreach k in array array['teacher','participant','office','party','president','government','gd','sf','ministry','municipality','media','minjust','interior','cec','ks','vs','central_bank','accounts'] loop
 begin label:=private.process_actor_label(p_game_id,k);result:=result||jsonb_build_array(jsonb_build_object('key',k,'label',label));exception when others then null;end;
 end loop;
 for a in select id,role_title from public.game_office_assignments where game_id=p_game_id and user_id=auth.uid() and status='active' order by created_at loop
 result:=result||jsonb_build_array(jsonb_build_object('key','office:'||a.id::text,'label',a.role_title));end loop;return result;
end;$$;
revoke all on function public.get_process_actors(uuid) from public,anon;grant execute on function public.get_process_actors(uuid) to authenticated;

create or replace function public.submit_media_news(p_game_id uuid,p_title text,p_body text,p_actor_key text default 'participant',p_tags text[] default '{}',p_external_url text default null,p_internal_view text default null,p_formal_ids uuid[] default '{}',p_files jsonb default '[]') returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare label text;id uuid;f jsonb;
begin
 label:=private.process_actor_label(p_game_id,p_actor_key);
 if length(trim(coalesce(p_title,'')))<3 or length(trim(coalesce(p_body,'')))<3 then raise exception 'Заполните заголовок и текст';end if;
 if p_external_url is not null and p_external_url !~* '^https?://' then raise exception 'Укажите ссылку http или https';end if;
 if p_internal_view is not null and p_internal_view not in ('actions','documents','votes','parties','stages','events','dashboard') then raise exception 'Неизвестный раздел игры';end if;
 if cardinality(p_formal_ids)>100 or exists(select 1 from unnest(p_formal_ids) ref(id) where not exists(select 1 from public.formal_documents d where d.id=ref.id and d.game_id=p_game_id)) then raise exception 'Документ не относится к текущей игре';end if;
 if jsonb_typeof(p_files)<>'array' or jsonb_array_length(p_files)>12 then raise exception 'Можно приложить до 12 файлов';end if;
 for f in select value from jsonb_array_elements(p_files) loop
 if (f->>'storage_path') not like p_game_id::text||'/news/'||auth.uid()::text||'/%' or coalesce(f->>'media_kind','') not in ('image','audio','video','file') or coalesce((f->>'file_size')::bigint,0) not between 1 and 104857600 then raise exception 'Некорректное вложение';end if;
 if not exists(select 1 from storage.objects o where o.bucket_id='game-assets' and o.name=f->>'storage_path') then raise exception 'Вложение ещё не загружено';end if;
 end loop;
 insert into public.media_news_proposals(game_id,author_id,title,body,tags,external_url,internal_view,formal_ids,files,submitted_actor)
 values(p_game_id,auth.uid(),trim(p_title),trim(p_body),coalesce(p_tags,'{}'),p_external_url,p_internal_view,coalesce(p_formal_ids,'{}'),p_files,label) returning media_news_proposals.id into id;return id;
end;$$;
revoke all on function public.submit_media_news(uuid,text,text,text,text[],text,text,uuid[],jsonb) from public,anon;grant execute on function public.submit_media_news(uuid,text,text,text,text[],text,text,uuid[],jsonb) to authenticated;

create or replace function public.review_media_news(p_proposal_id uuid,p_approve boolean,p_note text default null) returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare n public.media_news_proposals%rowtype;p uuid;f jsonb;
begin
 select * into n from public.media_news_proposals where id=p_proposal_id for update;
 if n.id is null or not private.is_game_teacher(n.game_id) then raise exception 'Согласование доступно преподавателю';end if;
 if n.status='approved' then return n.post_id;end if;
 if n.status<>'pending' then raise exception 'Предложение уже рассмотрено';end if;
 if p_approve is null then raise exception 'Выберите решение';end if;
 if not p_approve and length(trim(coalesce(p_note,'')))<3 then raise exception 'Укажите причину отказа';end if;
 if p_approve then
 insert into public.political_posts(game_id,author_id,process_type,actor_key,actor_label,title,body,tags,external_url,internal_view,context)
 values(n.game_id,n.author_id,'news','media','Средства массовой информации',n.title,n.body,n.tags,n.external_url,n.internal_view,
 jsonb_build_object('media_proposal_id',n.id,'submitted_actor',n.submitted_actor,'reviewed_by',auth.uid(),'review_note',p_note)) returning id into p;
 insert into public.political_post_formal_links(game_id,post_id,formal_document_id,created_by)
 select n.game_id,p,d.id,auth.uid() from public.formal_documents d where d.game_id=n.game_id and d.id=any(n.formal_ids);
 for f in select value from jsonb_array_elements(n.files) loop
 insert into public.political_post_media(game_id,post_id,uploader_id,media_kind,storage_path,file_name,mime_type,file_size)
 values(n.game_id,p,n.author_id,f->>'media_kind',f->>'storage_path',f->>'file_name',f->>'mime_type',(f->>'file_size')::bigint);
 end loop;end if;
 update public.media_news_proposals set status=case when p_approve then 'approved' else 'rejected' end,review_note=nullif(trim(p_note),''),reviewed_by=auth.uid(),reviewed_at=clock_timestamp(),post_id=p where id=n.id;return p;
end;$$;
revoke all on function public.review_media_news(uuid,boolean,text) from public,anon;grant execute on function public.review_media_news(uuid,boolean,text) to authenticated;

CREATE OR REPLACE FUNCTION public.update_process_post(p_post_id uuid, p_title text, p_body text, p_process_type text, p_tags text[], p_external_url text, p_internal_view text, p_formal_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare p public.political_posts%rowtype;uid uuid:=auth.uid();ids uuid[];
begin
 select * into p from public.political_posts where political_posts.id=p_post_id for update;
 if uid is null or p.id is null or p.deleted_at is not null or not private.is_game_member(p.game_id) or not(private.is_game_teacher(p.game_id) or p.author_id=uid and p.source_key is null and coalesce((p.context->>'automatic')::boolean,false)=false) then raise exception 'Нет прав на редактирование публикации';end if;
 if length(trim(coalesce(p_title,'')))<3 or length(trim(coalesce(p_body,'')))<3 then raise exception 'Укажите заголовок и текст';end if;
 if p_process_type not in ('statement','initiative','decision','event','negotiation','crisis_response','information','news') then raise exception 'Неизвестный вид публикации';end if;
 if nullif(trim(p_external_url),'') is not null and trim(p_external_url)!~* '^https?://' then raise exception 'Внешняя ссылка должна начинаться с https:// или http://';end if;
 if nullif(p_internal_view,'') is not null and p_internal_view<>all(array['dashboard','stages','parties','votes','documents','actions','grades','profile','teacher','events']) then raise exception 'Неизвестный раздел игры';end if;
 select coalesce(array_agg(distinct id),'{}') into ids from unnest(coalesce(p_formal_ids,'{}')) as id;
 if exists(select 1 from unnest(ids) as chosen(id) where not exists(select 1 from public.formal_documents d where d.id=chosen.id and d.game_id=p.game_id)) then raise exception 'Документ не относится к текущей игре';end if;
 update public.political_posts set title=trim(p_title),body=trim(p_body),process_type=p_process_type,tags=coalesce(p_tags,'{}'),external_url=nullif(trim(p_external_url),''),internal_view=nullif(p_internal_view,''),updated_at=now(),context=context||jsonb_build_object('edited_at',now(),'edited_by',uid) where id=p.id;
 delete from public.political_post_formal_links where post_id=p.id;
 insert into public.political_post_formal_links(game_id,post_id,formal_document_id,created_by) select p.game_id,p.id,id,uid from unnest(ids) id;
end;$function$
;
