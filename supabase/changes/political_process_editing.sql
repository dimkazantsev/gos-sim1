-- Publication editing preserves the recorded source and author.
create or replace function public.update_process_post(p_post_id uuid,p_title text,p_body text,p_process_type text,p_tags text[],p_external_url text,p_internal_view text,p_formal_ids uuid[])
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.political_posts%rowtype;uid uuid:=auth.uid();ids uuid[];
begin
 select * into p from public.political_posts where political_posts.id=p_post_id for update;
 if uid is null or p.id is null or not private.is_game_member(p.game_id) or not(private.is_game_teacher(p.game_id) or p.author_id=uid and p.source_key is null) then raise exception 'Нет прав на редактирование публикации';end if;
 if length(trim(coalesce(p_title,'')))<3 or length(trim(coalesce(p_body,'')))<3 then raise exception 'Укажите заголовок и текст';end if;
 if nullif(trim(p_external_url),'') is not null and trim(p_external_url)!~* '^https?://' then raise exception 'Внешняя ссылка должна начинаться с https:// или http://';end if;
 if nullif(p_internal_view,'') is not null and p_internal_view<>all(array['dashboard','stages','parties','votes','documents','actions','grades','profile','teacher','events']) then raise exception 'Неизвестный раздел игры';end if;
 select coalesce(array_agg(distinct id),'{}') into ids from unnest(coalesce(p_formal_ids,'{}')) as id;
 if exists(select 1 from unnest(ids) as chosen(id) where not exists(select 1 from public.formal_documents d where d.id=chosen.id and d.game_id=p.game_id)) then raise exception 'Документ не относится к текущей игре';end if;
 update public.political_posts set title=trim(p_title),body=trim(p_body),process_type=p_process_type,tags=coalesce(p_tags,'{}'),external_url=nullif(trim(p_external_url),''),internal_view=nullif(p_internal_view,''),updated_at=now(),context=context||jsonb_build_object('edited_at',now(),'edited_by',uid) where id=p.id;
 delete from public.political_post_formal_links where post_id=p.id;
 insert into public.political_post_formal_links(game_id,post_id,formal_document_id,created_by) select p.game_id,p.id,id,uid from unnest(ids) id;
end;$$;
revoke all on function public.update_process_post(uuid,text,text,text,text[],text,text,uuid[]) from public,anon;
grant execute on function public.update_process_post(uuid,text,text,text,text[],text,text,uuid[]) to authenticated;

-- Narrow the legacy entry point too: a student may propose a class poll on their own post.
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

create or replace function public.open_process_vote(p_post_id uuid,p_institution_key text default 'all',p_group_name text default null)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.political_posts%rowtype;id uuid;q numeric;majority text;groups integer;
begin
 select * into p from public.political_posts where political_posts.id=p_post_id;
 if p.id is null or auth.uid() is null or not private.is_game_member(p.game_id) then raise exception 'Нет доступа к публикации';end if;
 if p_institution_key<>all(array['all','gd','government','municipality','sf','committee','region','cec','ks','vs','central_bank','accounts']) then raise exception 'Выберите орган голосования';end if;
 if p_group_name is not null and not exists(select 1 from public.game_members where game_id=p.game_id and kind='student' and group_name=p_group_name) then raise exception 'Выберите группу этой игры';end if;
 if p_institution_key in ('government','municipality') then
  select count(distinct coalesce(group_name,'')) into groups from public.game_members where game_id=p.game_id and kind='student';
  if groups>1 and nullif(p_group_name,'') is null then raise exception 'Укажите учебную группу для состава органа';end if;
 end if;
 q:=case when p_institution_key in ('all','vs','accounts') then 2.0/3 when p_institution_key='ks' then 6.0/11 else .5 end;
 majority:=case when p_institution_key='gd' then 'eligible_majority' else 'present_majority' end;
 perform set_config('app.vote_group',coalesce(p_group_name,''),true);
 id:=public.create_vote_from_post(p.id,p_institution_key,case when p_institution_key='gd' then 'mandate' else 'member' end,q,majority,.5);
 perform set_config('app.vote_group','',true);
 return id;
end;$$;
revoke all on function public.open_process_vote(uuid,text,text) from public,anon;
grant execute on function public.open_process_vote(uuid,text,text) to authenticated;
