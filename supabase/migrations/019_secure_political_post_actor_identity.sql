-- Secure actor identity for political wall posts and allow only safe external URLs.
create or replace function public.create_political_post(
 p_game_id uuid,
 p_process_type text,
 p_actor_key text,
 p_title text,
 p_body text,
 p_tags text[] default '{}',
 p_external_url text default null,
 p_internal_view text default null,
 p_internal_ref_id text default null
) returns uuid
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare
 v_uid uuid:=(select auth.uid());
 gm public.game_members%rowtype;
 v_label text;
 v_id uuid:=gen_random_uuid();
 v_role text;
 v_url text:=nullif(trim(coalesce(p_external_url,'')),'');
begin
 if v_uid is null or not private.is_game_member(p_game_id) then raise exception 'Game access required';end if;
 select * into gm from public.game_members where game_id=p_game_id and user_id=v_uid;
 if gm.user_id is null then raise exception 'Member not found';end if;
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
 elsif p_actor_key='teacher' and private.is_game_teacher(p_game_id) then v_label:='Руководитель симуляции';
 else raise exception 'You cannot publish on behalf of this actor';
 end if;

 if length(trim(coalesce(p_title,'')))<3 or length(trim(coalesce(p_body,'')))<3 then raise exception 'Title and body are required';end if;
 if v_url is not null and v_url !~* '^https?://' then raise exception 'External URL must use http or https';end if;

 insert into public.political_posts(id,game_id,author_id,process_type,actor_key,actor_label,title,body,tags,external_url,internal_view,internal_ref_id)
 values(v_id,p_game_id,v_uid,coalesce(nullif(trim(p_process_type),''),'statement'),p_actor_key,v_label,trim(p_title),trim(p_body),coalesce(p_tags,'{}'),v_url,nullif(trim(coalesce(p_internal_view,'')),''),nullif(trim(coalesce(p_internal_ref_id,'')),''));
 return v_id;
end;
$$;
revoke all on function public.create_political_post(uuid,text,text,text,text,text[],text,text,text) from public,anon;
grant execute on function public.create_political_post(uuid,text,text,text,text,text[],text,text,text) to authenticated;
revoke insert on public.political_posts from authenticated;
