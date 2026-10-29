-- 2026-10-29: Keep teacher publishing roles aligned with game rules; deduplicate identical appointments.
-- Security: students still require a live office or authorized institutional role.
CREATE OR REPLACE FUNCTION private.process_actor_label(p_game_id uuid, p_actor_key text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_uid uuid:=auth.uid();gm public.game_members%rowtype;v_label text;v_role text;
begin
 if v_uid is null or not private.is_game_member(p_game_id) then raise exception 'Нет доступа к игре';end if;
 select * into gm from public.game_members where game_id=p_game_id and user_id=v_uid;
 if gm.user_id is null or gm.kind='observer' then raise exception 'Публикации доступны участникам игры';end if;
 if not private.is_game_teacher(p_game_id) and not private.role_is_available(p_game_id,v_uid) and p_actor_key not in ('participant','party') then raise exception 'Полномочия должности временно недоступны';end if;
 select string_agg(r,' ') into v_role from private.formal_user_roles(p_game_id,v_uid) r;
 if p_actor_key in ('participant','office','party','president','government','gd','sf','ministry',
  'minjust','interior','municipality','media','cec','ks','vs','central_bank','accounts')
  and not private.is_game_teacher(p_game_id)
 and not private.process_actor_active_now(p_game_id,p_actor_key)
 then raise exception 'Субъект не сформирован в текущей игре';end if;
 if p_actor_key='office' and length(trim(coalesce(gm.role_title,'')))>0 and lower(gm.role_title) not in ('участник','студент','гражданин') then v_label:=gm.role_title;
 elsif p_actor_key like 'office:%' then
 select a.role_title into v_label from public.game_office_assignments a where a.id=substr(p_actor_key,8)::uuid and a.game_id=p_game_id and (a.user_id=v_uid or private.is_game_teacher(p_game_id)) and a.status='active';
 if v_label is null then raise exception 'Должность не назначена этому участнику';end if;

 elsif p_actor_key like 'unit:%' then
  if p_actor_key !~ '^unit:[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then raise exception 'Неверный идентификатор органа';end if;
  select u.title into v_label from public.institution_units u where u.id=substring(p_actor_key from 6)::uuid and u.game_id=p_game_id
    and (private.is_game_teacher(p_game_id) or u.head_user_id=v_uid or exists(select 1 from public.institution_assignments ia
      where ia.game_id=p_game_id and ia.unit_id=u.id and ia.user_id=v_uid));
  if v_label is null then raise exception 'Нет полномочий выбранного органа';end if;
 elsif p_actor_key like 'party:%' or p_actor_key like 'faction:%' then
  if p_actor_key !~ '^(party|faction):[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then raise exception 'Неверный идентификатор партии';end if;
  select case when p_actor_key like 'faction:%' then 'Фракция «'||gp.name||'»' else gp.name end into v_label
   from public.game_parties gp where gp.id=split_part(p_actor_key,':',2)::uuid and gp.game_id=p_game_id
    and gp.registration_status='registered'
    and (p_actor_key not like 'faction:%' or coalesce(gp.mandates,0)>0)
    and (private.is_game_teacher(p_game_id) or gp.leader_user_id=v_uid or lower(gp.name)=lower(coalesce(gm.team,'')) or exists(
      select 1 from public.institution_assignments ia where ia.game_id=p_game_id and ia.party_id=gp.id and ia.user_id=v_uid));
  if v_label is null then raise exception 'Нет полномочий выбранной партии или фракции';end if;
 elsif p_actor_key like 'portfolio:%' then
  if not private.is_game_teacher(p_game_id) then raise exception 'Нет полномочий выбранного министерства';end if;
  v_label:=case split_part(p_actor_key,':',2)
   when 'social' then 'Министерство по социальной политике'
   when 'economic' then 'Министерство по экономической политике'
   when 'defence' then 'Министерство по обороне и внутренней безопасности'
   when 'foreign' then 'Министерство по внешней политике'
   when 'internal' then 'Министерство по внутренней политике и государству'
   else null end;
  if v_label is null then raise exception 'Министерство не предусмотрено правилами игры';end if;
 elsif p_actor_key like 'ministry:%' or p_actor_key like 'federal:%' then
  raise exception 'Нельзя публиковать от имени органа, отсутствующего в текущей игре';
 elsif p_actor_key='ksrf' and (gm.kind='student' or private.is_game_teacher(p_game_id)) then v_label:='КСРФ';
 elsif p_actor_key='participant' then v_label:=gm.full_name;
 elsif p_actor_key='party' and gm.team is not null then v_label:=gm.team;
 elsif p_actor_key='president' and (private.is_game_teacher(p_game_id) or v_role like '%президент%') then v_label:='Президент Российской Федерации';
 elsif p_actor_key='government' and (private.is_game_teacher(p_game_id) or v_role like '%правительств%' or v_role like '%министр%') then v_label:='Правительство Российской Федерации';
 elsif p_actor_key='gd' and (private.is_game_teacher(p_game_id) or v_role like '%депутат%' or (v_role like '%государственн%' and v_role like '%дум%')) then v_label:='Государственная Дума';
 elsif p_actor_key='sf' and (private.is_game_teacher(p_game_id) or v_role like '%совет федерац%' or v_role like '%сенатор%') then v_label:='Совет Федерации';
 elsif p_actor_key='ministry' and (private.is_game_teacher(p_game_id) or v_role like '%министр%') then select role_title into v_label from (select gm.role_title where lower(coalesce(gm.role_title,'')) like '%министр%' union all select a.role_title from public.game_office_assignments a where a.game_id=p_game_id and (a.user_id=v_uid or private.is_game_teacher(p_game_id)) and a.status='active' and lower(a.role_title) like '%министр%') roles limit 1;v_label:=coalesce(v_label,'Федеральный орган исполнительной власти');
 elsif p_actor_key='municipality' and (private.is_game_teacher(p_game_id) or v_role like '%муницип%' or v_role like '%глава города%') then v_label:='Орган местного самоуправления';
 elsif p_actor_key='media' and (private.is_game_teacher(p_game_id) or v_role like '%сми%' or v_role like '%журналист%') then v_label:='Средства массовой информации';
 
 elsif p_actor_key='minjust' and (private.is_game_teacher(p_game_id) or v_role like '%юстиц%') then v_label:='Министерство юстиции Российской Федерации';
 elsif p_actor_key='interior' and (private.is_game_teacher(p_game_id) or v_role like '%внутренн%') then v_label:='Министерство внутренних дел Российской Федерации';
 elsif p_actor_key in ('cec','ks','vs','central_bank','accounts') and (private.is_game_teacher(p_game_id) or private.vote_member_has_office(p_game_id,v_uid,p_actor_key)) then v_label:=case p_actor_key when 'cec' then 'Избирательная комиссия' when 'ks' then 'Конституционный Суд Российской Федерации' when 'vs' then 'Верховный Суд Российской Федерации' when 'central_bank' then 'Банк России' else 'Счётная палата Российской Федерации' end;
 else raise exception 'Нет полномочий для публикации от этого субъекта';
 end if;

 return v_label;end;$function$
;

CREATE OR REPLACE FUNCTION public.get_process_actors(p_game_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare result jsonb:='[]'::jsonb;k text;label text;a record;
 v_uid uuid:=(select auth.uid());v_teacher boolean;
begin
 if not private.is_game_member(p_game_id) then raise exception 'Нет доступа к игре';end if;
 v_teacher:=private.is_game_teacher(p_game_id);
 foreach k in array array['participant','ksrf','office','party','president','government',
 'gd','sf','ministry','municipality','media','minjust','interior',
 'cec','ks','vs','central_bank','accounts'] loop
  if v_teacher and k in ('ministry','minjust','interior') then continue;end if;
  begin
   if not v_teacher and not private.process_actor_active_now(p_game_id,k) then continue;end if;
   label:=private.process_actor_label(p_game_id,k);
   if label is not null and btrim(label)<>'' then
    result:=result||jsonb_build_array(jsonb_build_object('key',k,'label',label));
   end if;
  exception when others then null;end;
 end loop;
 -- The five ministries are those established by the game rules, not extra ministries.
 if v_teacher then
  foreach k in array array['portfolio:social','portfolio:economic','portfolio:foreign','portfolio:defence','portfolio:internal'] loop
   label:=private.process_actor_label(p_game_id,k);
   result:=result||jsonb_build_array(jsonb_build_object('key',k,'label',label));
  end loop;
 end if;
 -- Only game-instantiated units, parties and official appointments follow.
 for a in select u.id,u.title from public.institution_units u
  where u.game_id=p_game_id and (v_teacher or u.head_user_id=v_uid or exists(
   select 1 from public.institution_assignments ia where ia.game_id=p_game_id
    and ia.unit_id=u.id and ia.user_id=v_uid))
  order by u.title,u.id loop
  result:=result||jsonb_build_array(jsonb_build_object('key','unit:'||a.id::text,'label',a.title));
 end loop;
 for a in select gp.id,gp.name,gp.mandates from public.game_parties gp
  join public.game_members gm on gm.game_id=p_game_id and gm.user_id=v_uid
  where gp.game_id=p_game_id and gp.registration_status='registered' and (v_teacher or gp.leader_user_id=v_uid
    or lower(gp.name)=lower(coalesce(gm.team,'')) or exists(
      select 1 from public.institution_assignments ia where ia.game_id=p_game_id
       and ia.party_id=gp.id and ia.user_id=v_uid))
  order by gp.name,gp.id loop
  result:=result||jsonb_build_array(jsonb_build_object('key','party:'||a.id::text,'label',a.name));
  if coalesce(a.mandates,0)>0 then
   result:=result||jsonb_build_array(jsonb_build_object('key','faction:'||a.id::text,'label','Фракция «'||a.name||'»'));
  end if;
 end loop;
 for a in select distinct on (lower(btrim(role_title))) id from public.game_office_assignments
  where game_id=p_game_id and (v_teacher or user_id=v_uid) and status='active'
  order by lower(btrim(role_title)),created_at loop
  begin
   label:=private.process_actor_label(p_game_id,'office:'||a.id::text);
   result:=result||jsonb_build_array(jsonb_build_object('key','office:'||a.id::text,'label',label));
  exception when others then null;end;
 end loop;
 return result;
end
$function$
;

-- Atomic party rename: update the party and member team references together.
-- Existing signed acts and historical posts remain unchanged archival records.
create or replace function public.rename_game_party(p_party_id uuid,p_new_name text)
returns text language plpgsql security definer set search_path to 'public','private','pg_temp' as $$
declare
 p public.game_parties%rowtype;
 v_uid uuid:=(select auth.uid());
 v_name text:=btrim(regexp_replace(coalesce(p_new_name,''),'[[:space:]]+',' ','g'));
begin
 if v_uid is null then raise exception 'Необходимо войти в игру' using errcode='42501';end if;
 if length(v_name)<3 or length(v_name)>100 then
  raise exception 'Название партии должно содержать от 3 до 100 символов';
 end if;
 select * into p from public.game_parties where id=p_party_id for update;
 if not found then raise exception 'Партия не найдена';end if;
 if not (private.is_game_teacher(p.game_id) or p.leader_user_id=v_uid and exists(
  select 1 from public.game_members m where m.game_id=p.game_id
   and m.user_id=v_uid and m.kind='student' and m.roster_archived_at is null
 )) then raise exception 'Изменить название может только председатель партии или преподаватель' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p.game_id::text,0));
 if exists(select 1 from public.game_parties other
  where other.game_id=p.game_id and other.id<>p.id and lower(btrim(other.name))=lower(v_name))
 then raise exception 'Партия с таким названием уже существует';end if;
 if p.name=v_name then return v_name;end if;
 update public.game_parties set name=v_name where id=p.id;
 update public.game_members set team=v_name where game_id=p.game_id and kind='student' and team=p.name;
 update public.chat_channels set name=case
  when name='Фракция · '||p.name then 'Фракция · '||v_name
  when name='Партия · '||p.name then 'Партия · '||v_name
  else name end
 where game_id=p.game_id and name in ('Фракция · '||p.name,'Партия · '||p.name);
 return v_name;
end;$$;
revoke all on function public.rename_game_party(uuid,text) from public,anon;
grant execute on function public.rename_game_party(uuid,text) to authenticated;
