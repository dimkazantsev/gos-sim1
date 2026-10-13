-- Game-relevant publisher directory: actual federal entities and current game institutions.
-- Does not rewrite historical posts, game actors, author IDs or RLS policies.
create or replace function private.process_actor_catalog()
returns table(actor_key text,actor_label text)
language sql immutable set search_path to 'pg_catalog' as $catalog$
 select x.actor_key::text,x.actor_label::text from (values
 ('ministry:foreign','Министерство иностранных дел Российской Федерации'),
 ('ministry:defense','Министерство обороны Российской Федерации'),
 ('ministry:interior','Министерство внутренних дел Российской Федерации'),
 ('ministry:emergency','Министерство Российской Федерации по делам гражданской обороны, чрезвычайным ситуациям и ликвидации последствий стихийных бедствий'),
 ('ministry:justice','Министерство юстиции Российской Федерации'),
 ('ministry:health','Министерство здравоохранения Российской Федерации'),
 ('ministry:culture','Министерство культуры Российской Федерации'),
 ('ministry:education','Министерство просвещения Российской Федерации'),
 ('ministry:science','Министерство науки и высшего образования Российской Федерации'),
 ('ministry:finance','Министерство финансов Российской Федерации'),
 ('ministry:economy','Министерство экономического развития Российской Федерации'),
 ('ministry:industry','Министерство промышленности и торговли Российской Федерации'),
 ('ministry:agriculture','Министерство сельского хозяйства Российской Федерации'),
 ('ministry:labour','Министерство труда и социальной защиты Российской Федерации'),
 ('ministry:transport','Министерство транспорта Российской Федерации'),
 ('ministry:energy','Министерство энергетики Российской Федерации'),
 ('ministry:construction','Министерство строительства и жилищно-коммунального хозяйства Российской Федерации'),
 ('ministry:digital','Министерство цифрового развития, связи и массовых коммуникаций Российской Федерации'),
 ('ministry:nature','Министерство природных ресурсов и экологии Российской Федерации'),
 ('ministry:sport','Министерство спорта Российской Федерации'),
 ('ministry:far_east','Министерство Российской Федерации по развитию Дальнего Востока и Арктики'),
 ('federal:president_office','Администрация Президента Российской Федерации'),
 ('federal:security_council','Совет Безопасности Российской Федерации'),
 ('federal:state_council','Государственный Совет Российской Федерации'),
 ('federal:prosecutor','Генеральная прокуратура Российской Федерации'),
 ('federal:investigative','Следственный комитет Российской Федерации'),
 ('federal:fsb','Федеральная служба безопасности Российской Федерации'),
 ('federal:svr','Служба внешней разведки Российской Федерации'),
 ('federal:fso','Федеральная служба охраны Российской Федерации'),
 ('federal:national_guard','Федеральная служба войск национальной гвардии Российской Федерации'),
 ('federal:tax','Федеральная налоговая служба'),
 ('federal:customs','Федеральная таможенная служба'),
 ('federal:statistics','Федеральная служба государственной статистики'),
 ('federal:real_estate','Федеральная служба государственной регистрации, кадастра и картографии'),
 ('federal:treasury','Федеральное казначейство'),
 ('federal:antimonopoly','Федеральная антимонопольная служба'),
 ('federal:consumer','Федеральная служба по надзору в сфере защиты прав потребителей и благополучия человека'),
 ('federal:communications','Федеральная служба по надзору в сфере связи, информационных технологий и массовых коммуникаций'),
 ('federal:nature_watch','Федеральная служба по надзору в сфере природопользования'),
 ('federal:fin_monitoring','Федеральная служба по финансовому мониторингу'),
 ('federal:ombudsman','Уполномоченный по правам человека в Российской Федерации'),
 ('federal:public_chamber','Общественная палата Российской Федерации'),
 ('federal:social_fund','Фонд пенсионного и социального страхования Российской Федерации')
 ) as x(actor_key,actor_label)
$catalog$;
revoke all on function private.process_actor_catalog() from public,anon,authenticated;

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
 if p_actor_key='office' and length(trim(coalesce(gm.role_title,'')))>0 and lower(gm.role_title) not in ('участник','студент','гражданин') then v_label:=gm.role_title;
 elsif p_actor_key like 'office:%' then
 select a.role_title into v_label from public.game_office_assignments a where a.id=substr(p_actor_key,8)::uuid and a.game_id=p_game_id and (a.user_id=v_uid or private.is_game_teacher(p_game_id)) and a.status='active';
 if v_label is null then raise exception 'Должность не назначена этому участнику';end if;

 elsif p_actor_key like 'unit:%' then
  if p_actor_key !~ '^unit:[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}
 elsif p_actor_key='party' and gm.team is not null then v_label:=gm.team;
 elsif p_actor_key='president' and (private.is_game_teacher(p_game_id) or v_role like '%президент%') then v_label:='Президент Российской Федерации';
 elsif p_actor_key='government' and (private.is_game_teacher(p_game_id) or v_role like '%правительств%' or v_role like '%министр%') then v_label:='Правительство Российской Федерации';
 elsif p_actor_key='gd' and (private.is_game_teacher(p_game_id) or v_role like '%депутат%' or (v_role like '%государственн%' and v_role like '%дум%')) then v_label:='Государственная Дума';
 elsif p_actor_key='sf' and (private.is_game_teacher(p_game_id) or v_role like '%совет федерац%' or v_role like '%сенатор%') then v_label:='Совет Федерации';
 elsif p_actor_key='ministry' and (private.is_game_teacher(p_game_id) or v_role like '%министр%') then select role_title into v_label from (select gm.role_title where lower(coalesce(gm.role_title,'')) like '%министр%' union all select a.role_title from public.game_office_assignments a where a.game_id=p_game_id and a.user_id=v_uid and a.status='active' and lower(a.role_title) like '%министр%') roles limit 1;v_label:=coalesce(v_label,'Федеральный орган исполнительной власти');
 elsif p_actor_key='municipality' and (private.is_game_teacher(p_game_id) or v_role like '%муницип%' or v_role like '%глава города%') then v_label:='Орган местного самоуправления';
 elsif p_actor_key='media' and (private.is_game_teacher(p_game_id) or v_role like '%сми%' or v_role like '%журналист%') then v_label:='Средства массовой информации';
 elsif p_actor_key='minjust' and (private.is_game_teacher(p_game_id) or v_role like '%юстиц%') then v_label:='Министерство юстиции Российской Федерации';
 elsif p_actor_key='interior' and (private.is_game_teacher(p_game_id) or v_role like '%внутренн%') then v_label:='Министерство внутренних дел Российской Федерации';
 elsif p_actor_key in ('cec','ks','vs','central_bank','accounts') and (private.is_game_teacher(p_game_id) or private.vote_member_has_office(p_game_id,v_uid,p_actor_key)) then v_label:=case p_actor_key when 'cec' then 'Избирательная комиссия' when 'ks' then 'Конституционный Суд Российской Федерации' when 'vs' then 'Верховный Суд Российской Федерации' when 'central_bank' then 'Банк России' else 'Счётная палата Российской Федерации' end;
 else raise exception 'Нет полномочий для публикации от этого субъекта';
 end if;

 return v_label;end;$function$
 then raise exception 'Неверный идентификатор органа';end if;
  select u.title into v_label from public.institution_units u
  where u.id=substring(p_actor_key from 6)::uuid and u.game_id=p_game_id
  and (private.is_game_teacher(p_game_id) or u.head_user_id=v_uid or exists(
   select 1 from public.institution_assignments ia where ia.game_id=p_game_id
    and ia.unit_id=u.id and ia.user_id=v_uid));
  if v_label is null then raise exception 'Нет полномочий выбранного органа';end if;
 elsif p_actor_key like 'party:%' then
  if p_actor_key !~ '^party:[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}
 elsif p_actor_key='party' and gm.team is not null then v_label:=gm.team;
 elsif p_actor_key='president' and (private.is_game_teacher(p_game_id) or v_role like '%президент%') then v_label:='Президент Российской Федерации';
 elsif p_actor_key='government' and (private.is_game_teacher(p_game_id) or v_role like '%правительств%' or v_role like '%министр%') then v_label:='Правительство Российской Федерации';
 elsif p_actor_key='gd' and (private.is_game_teacher(p_game_id) or v_role like '%депутат%' or (v_role like '%государственн%' and v_role like '%дум%')) then v_label:='Государственная Дума';
 elsif p_actor_key='sf' and (private.is_game_teacher(p_game_id) or v_role like '%совет федерац%' or v_role like '%сенатор%') then v_label:='Совет Федерации';
 elsif p_actor_key='ministry' and (private.is_game_teacher(p_game_id) or v_role like '%министр%') then select role_title into v_label from (select gm.role_title where lower(coalesce(gm.role_title,'')) like '%министр%' union all select a.role_title from public.game_office_assignments a where a.game_id=p_game_id and a.user_id=v_uid and a.status='active' and lower(a.role_title) like '%министр%') roles limit 1;v_label:=coalesce(v_label,'Федеральный орган исполнительной власти');
 elsif p_actor_key='municipality' and (private.is_game_teacher(p_game_id) or v_role like '%муницип%' or v_role like '%глава города%') then v_label:='Орган местного самоуправления';
 elsif p_actor_key='media' and (private.is_game_teacher(p_game_id) or v_role like '%сми%' or v_role like '%журналист%') then v_label:='Средства массовой информации';
 elsif p_actor_key='minjust' and (private.is_game_teacher(p_game_id) or v_role like '%юстиц%') then v_label:='Министерство юстиции Российской Федерации';
 elsif p_actor_key='interior' and (private.is_game_teacher(p_game_id) or v_role like '%внутренн%') then v_label:='Министерство внутренних дел Российской Федерации';
 elsif p_actor_key in ('cec','ks','vs','central_bank','accounts') and (private.is_game_teacher(p_game_id) or private.vote_member_has_office(p_game_id,v_uid,p_actor_key)) then v_label:=case p_actor_key when 'cec' then 'Избирательная комиссия' when 'ks' then 'Конституционный Суд Российской Федерации' when 'vs' then 'Верховный Суд Российской Федерации' when 'central_bank' then 'Банк России' else 'Счётная палата Российской Федерации' end;
 else raise exception 'Нет полномочий для публикации от этого субъекта';
 end if;

 return v_label;end;$function$
 then raise exception 'Неверный идентификатор партии';end if;
  select gp.name into v_label from public.game_parties gp
  where gp.id=substring(p_actor_key from 7)::uuid and gp.game_id=p_game_id
  and (private.is_game_teacher(p_game_id) or gp.leader_user_id=v_uid
   or lower(gp.name)=lower(coalesce(gm.team,'')) or exists(
    select 1 from public.institution_assignments ia where ia.game_id=p_game_id
     and ia.party_id=gp.id and ia.user_id=v_uid));
  if v_label is null then raise exception 'Нет полномочий выбранной партии';end if;

 elsif p_actor_key like 'faction:%' then
  if p_actor_key !~ '^faction:[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}
  if not private.is_game_teacher(p_game_id) then raise exception 'Представлять этот орган может только преподаватель';end if;
  select c.actor_label into v_label from private.process_actor_catalog() c where c.actor_key=p_actor_key;
  if v_label is null then raise exception 'Неизвестный орган';end if;
 elsif p_actor_key='participant' then v_label:=gm.full_name;
 elsif p_actor_key='party' and gm.team is not null then v_label:=gm.team;
 elsif p_actor_key='president' and (private.is_game_teacher(p_game_id) or v_role like '%президент%') then v_label:='Президент Российской Федерации';
 elsif p_actor_key='government' and (private.is_game_teacher(p_game_id) or v_role like '%правительств%' or v_role like '%министр%') then v_label:='Правительство Российской Федерации';
 elsif p_actor_key='gd' and (private.is_game_teacher(p_game_id) or v_role like '%депутат%' or (v_role like '%государственн%' and v_role like '%дум%')) then v_label:='Государственная Дума';
 elsif p_actor_key='sf' and (private.is_game_teacher(p_game_id) or v_role like '%совет федерац%' or v_role like '%сенатор%') then v_label:='Совет Федерации';
 elsif p_actor_key='ministry' and (private.is_game_teacher(p_game_id) or v_role like '%министр%') then select role_title into v_label from (select gm.role_title where lower(coalesce(gm.role_title,'')) like '%министр%' union all select a.role_title from public.game_office_assignments a where a.game_id=p_game_id and a.user_id=v_uid and a.status='active' and lower(a.role_title) like '%министр%') roles limit 1;v_label:=coalesce(v_label,'Федеральный орган исполнительной власти');
 elsif p_actor_key='municipality' and (private.is_game_teacher(p_game_id) or v_role like '%муницип%' or v_role like '%глава города%') then v_label:='Орган местного самоуправления';
 elsif p_actor_key='media' and (private.is_game_teacher(p_game_id) or v_role like '%сми%' or v_role like '%журналист%') then v_label:='Средства массовой информации';
 elsif p_actor_key='minjust' and (private.is_game_teacher(p_game_id) or v_role like '%юстиц%') then v_label:='Министерство юстиции Российской Федерации';
 elsif p_actor_key='interior' and (private.is_game_teacher(p_game_id) or v_role like '%внутренн%') then v_label:='Министерство внутренних дел Российской Федерации';
 elsif p_actor_key in ('cec','ks','vs','central_bank','accounts') and (private.is_game_teacher(p_game_id) or private.vote_member_has_office(p_game_id,v_uid,p_actor_key)) then v_label:=case p_actor_key when 'cec' then 'Избирательная комиссия' when 'ks' then 'Конституционный Суд Российской Федерации' when 'vs' then 'Верховный Суд Российской Федерации' when 'central_bank' then 'Банк России' else 'Счётная палата Российской Федерации' end;
 else raise exception 'Нет полномочий для публикации от этого субъекта';
 end if;

 return v_label;end;$function$


create or replace function public.get_process_actors(p_game_id uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'public','private','pg_temp' as $new$
declare result jsonb:='[]'::jsonb;k text;label text;a record;
 v_uid uuid:=(select auth.uid());v_teacher boolean;
begin
 if not private.is_game_member(p_game_id) then raise exception 'Нет доступа к игре';end if;
 v_teacher:=private.is_game_teacher(p_game_id);
 foreach k in array array['participant','office','party','president','government',
 'gd','sf','ministry','municipality','media','minjust','interior',
 'cec','ks','vs','central_bank','accounts'] loop
  if v_teacher and k in ('ministry','minjust','interior') then continue;end if;
  begin
   label:=private.process_actor_label(p_game_id,k);
   if label is not null and btrim(label)<>'' then
    result:=result||jsonb_build_array(jsonb_build_object('key',k,'label',label));
   end if;
  exception when others then null;end;
 end loop;
 if v_teacher then
  for a in select actor_key,actor_label from private.process_actor_catalog()
   order by actor_label loop
   result:=result||jsonb_build_array(jsonb_build_object('key',a.actor_key,'label',a.actor_label));
  end loop;
 end if;
 for a in select u.id,u.title from public.institution_units u
  where u.game_id=p_game_id and (v_teacher or u.head_user_id=v_uid or exists(
   select 1 from public.institution_assignments ia where ia.game_id=p_game_id
    and ia.unit_id=u.id and ia.user_id=v_uid))
  order by u.title,u.id loop
  result:=result||jsonb_build_array(jsonb_build_object('key','unit:'||a.id::text,'label',a.title));
 end loop;
 for a in select gp.id,gp.name,gp.mandates from public.game_parties gp
  join public.game_members gm on gm.game_id=p_game_id and gm.user_id=v_uid
  where gp.game_id=p_game_id and (v_teacher or gp.leader_user_id=v_uid
    or lower(gp.name)=lower(coalesce(gm.team,'')) or exists(
      select 1 from public.institution_assignments ia where ia.game_id=p_game_id
       and ia.party_id=gp.id and ia.user_id=v_uid))
  order by gp.name,gp.id loop
  result:=result||jsonb_build_array(jsonb_build_object('key','party:'||a.id::text,'label',a.name));
  if coalesce(a.mandates,0)>0 then
   result:=result||jsonb_build_array(jsonb_build_object(
    'key','faction:'||a.id::text,'label','Фракция «'||a.name||'»'));
  end if;
 end loop;
 for a in select id from public.game_office_assignments
  where game_id=p_game_id and (v_teacher or user_id=v_uid) and status='active'
  order by created_at loop
  begin
   label:=private.process_actor_label(p_game_id,'office:'||a.id::text);
   result:=result||jsonb_build_array(jsonb_build_object('key','office:'||a.id::text,'label',label));
  exception when others then null;end;
 end loop;
 return result;
end
$new$;
 then raise exception 'Неверный идентификатор фракции';end if;
  select 'Фракция «'||gp.name||'»' into v_label from public.game_parties gp
  where gp.id=substring(p_actor_key from 9)::uuid and gp.game_id=p_game_id
    and coalesce(gp.mandates,0)>0 and
    (private.is_game_teacher(p_game_id) or gp.leader_user_id=v_uid
      or lower(gp.name)=lower(coalesce(gm.team,'')) or exists(
       select 1 from public.institution_assignments ia where ia.game_id=p_game_id
        and ia.party_id=gp.id and ia.user_id=v_uid));
  if v_label is null then raise exception 'Нет полномочий фракции';end if;
 elsif p_actor_key like 'ministry:%' or p_actor_key like 'federal:%' then
  if not private.is_game_teacher(p_game_id) then raise exception 'Представлять этот орган может только преподаватель';end if;
  select c.actor_label into v_label from private.process_actor_catalog() c where c.actor_key=p_actor_key;
  if v_label is null then raise exception 'Неизвестный орган';end if;
 elsif p_actor_key='participant' then v_label:=gm.full_name;
 elsif p_actor_key='party' and gm.team is not null then v_label:=gm.team;
 elsif p_actor_key='president' and (private.is_game_teacher(p_game_id) or v_role like '%президент%') then v_label:='Президент Российской Федерации';
 elsif p_actor_key='government' and (private.is_game_teacher(p_game_id) or v_role like '%правительств%' or v_role like '%министр%') then v_label:='Правительство Российской Федерации';
 elsif p_actor_key='gd' and (private.is_game_teacher(p_game_id) or v_role like '%депутат%' or (v_role like '%государственн%' and v_role like '%дум%')) then v_label:='Государственная Дума';
 elsif p_actor_key='sf' and (private.is_game_teacher(p_game_id) or v_role like '%совет федерац%' or v_role like '%сенатор%') then v_label:='Совет Федерации';
 elsif p_actor_key='ministry' and (private.is_game_teacher(p_game_id) or v_role like '%министр%') then select role_title into v_label from (select gm.role_title where lower(coalesce(gm.role_title,'')) like '%министр%' union all select a.role_title from public.game_office_assignments a where a.game_id=p_game_id and a.user_id=v_uid and a.status='active' and lower(a.role_title) like '%министр%') roles limit 1;v_label:=coalesce(v_label,'Федеральный орган исполнительной власти');
 elsif p_actor_key='municipality' and (private.is_game_teacher(p_game_id) or v_role like '%муницип%' or v_role like '%глава города%') then v_label:='Орган местного самоуправления';
 elsif p_actor_key='media' and (private.is_game_teacher(p_game_id) or v_role like '%сми%' or v_role like '%журналист%') then v_label:='Средства массовой информации';
 elsif p_actor_key='minjust' and (private.is_game_teacher(p_game_id) or v_role like '%юстиц%') then v_label:='Министерство юстиции Российской Федерации';
 elsif p_actor_key='interior' and (private.is_game_teacher(p_game_id) or v_role like '%внутренн%') then v_label:='Министерство внутренних дел Российской Федерации';
 elsif p_actor_key in ('cec','ks','vs','central_bank','accounts') and (private.is_game_teacher(p_game_id) or private.vote_member_has_office(p_game_id,v_uid,p_actor_key)) then v_label:=case p_actor_key when 'cec' then 'Избирательная комиссия' when 'ks' then 'Конституционный Суд Российской Федерации' when 'vs' then 'Верховный Суд Российской Федерации' when 'central_bank' then 'Банк России' else 'Счётная палата Российской Федерации' end;
 else raise exception 'Нет полномочий для публикации от этого субъекта';
 end if;

 return v_label;end;$function$


create or replace function public.get_process_actors(p_game_id uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'public','private','pg_temp' as $new$
declare result jsonb:='[]'::jsonb;k text;label text;a record;
 v_uid uuid:=(select auth.uid());v_teacher boolean;
begin
 if not private.is_game_member(p_game_id) then raise exception 'Нет доступа к игре';end if;
 v_teacher:=private.is_game_teacher(p_game_id);
 foreach k in array array['participant','office','party','president','government',
 'gd','sf','ministry','municipality','media','minjust','interior',
 'cec','ks','vs','central_bank','accounts'] loop
  if v_teacher and k in ('ministry','minjust','interior') then continue;end if;
  begin
   label:=private.process_actor_label(p_game_id,k);
   if label is not null and btrim(label)<>'' then
    result:=result||jsonb_build_array(jsonb_build_object('key',k,'label',label));
   end if;
  exception when others then null;end;
 end loop;
 if v_teacher then
  for a in select actor_key,actor_label from private.process_actor_catalog()
   order by actor_label loop
   result:=result||jsonb_build_array(jsonb_build_object('key',a.actor_key,'label',a.actor_label));
  end loop;
 end if;
 for a in select u.id,u.title from public.institution_units u
  where u.game_id=p_game_id and (v_teacher or u.head_user_id=v_uid or exists(
   select 1 from public.institution_assignments ia where ia.game_id=p_game_id
    and ia.unit_id=u.id and ia.user_id=v_uid))
  order by u.title,u.id loop
  result:=result||jsonb_build_array(jsonb_build_object('key','unit:'||a.id::text,'label',a.title));
 end loop;
 for a in select gp.id,gp.name from public.game_parties gp
  join public.game_members gm on gm.game_id=p_game_id and gm.user_id=v_uid
  where gp.game_id=p_game_id and (v_teacher or gp.leader_user_id=v_uid
    or lower(gp.name)=lower(coalesce(gm.team,'')) or exists(
      select 1 from public.institution_assignments ia where ia.game_id=p_game_id
       and ia.party_id=gp.id and ia.user_id=v_uid))
  order by gp.name,gp.id loop
  result:=result||jsonb_build_array(jsonb_build_object('key','party:'||a.id::text,'label',a.name));
 end loop;
 for a in select id from public.game_office_assignments
  where game_id=p_game_id and (v_teacher or user_id=v_uid) and status='active'
  order by created_at loop
  begin
   label:=private.process_actor_label(p_game_id,'office:'||a.id::text);
   result:=result||jsonb_build_array(jsonb_build_object('key','office:'||a.id::text,'label',label));
  exception when others then null;end;
 end loop;
 return result;
end
$new$;
