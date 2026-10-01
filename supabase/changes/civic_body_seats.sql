create or replace function public.save_civic_voting_body(p_game_id uuid,p_title text,p_seats integer,p_users uuid[],p_head uuid default null,p_unit uuid default null)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare id uuid:=coalesce(p_unit,gen_random_uuid());u uuid;roster uuid[];
begin
 if auth.uid() is null or not private.is_game_teacher(p_game_id) then raise exception 'Требуются права преподавателя';end if;
 select coalesce(array_agg(distinct x),'{}') into roster from unnest(p_users) x;
 if length(trim(p_title))<3 or p_seats is null or p_seats<1 or p_seats>10000 or cardinality(roster)>p_seats then raise exception 'Укажите название и целое число мест не меньше назначенного состава';end if;
 if p_head is not null and not p_head=any(roster) then raise exception 'Председатель должен входить в состав';end if;
 foreach u in array roster loop
  if not exists(select 1 from public.game_members where game_id=p_game_id and user_id=u and kind='student') then raise exception 'Участник не входит в эту игру';end if;
 end loop;
 if p_unit is not null then
  perform 1 from public.institution_units where institution_units.id=p_unit and game_id=p_game_id and unit_kind='public_body' for update;
  if not found then raise exception 'Орган не найден';end if;
  if exists(select 1 from public.game_votes where game_id=p_game_id and institution_key='unit:'||p_unit::text and status='open') then raise exception 'Завершите открытое голосование перед изменением состава';end if;
  update public.institution_units set title=trim(p_title),capacity_max=p_seats,mandate_capacity=p_seats,head_user_id=p_head where institution_units.id=p_unit;
  delete from public.game_voting_body_members where unit_id=p_unit and game_id=p_game_id;
 else
  insert into public.institution_units(id,game_id,unit_kind,unit_key,title,capacity_min,capacity_max,mandate_capacity,head_user_id) values(id,p_game_id,'public_body',id::text,trim(p_title),1,p_seats,p_seats,p_head);
 end if;
 insert into public.game_voting_body_members(game_id,unit_id,user_id) select p_game_id,id,x from unnest(roster) x;
 return id;
end;$$;
revoke all on function public.save_civic_voting_body(uuid,text,integer,uuid[],uuid,uuid) from public,anon;
grant execute on function public.save_civic_voting_body(uuid,text,integer,uuid[],uuid,uuid) to authenticated;

CREATE OR REPLACE FUNCTION private.snapshot_vote_electorate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare roster jsonb;total numeric;label text;selected_group text;
begin
 selected_group:=nullif(current_setting('app.vote_group',true),'');
 if selected_group is not null and not exists(select 1 from public.game_members where game_id=new.game_id and kind='student' and group_name=selected_group) then raise exception 'Учебная группа не найдена';end if;
 if new.institution_key not in ('all','factions','gd','government','municipality','sf','committee','region','cec','ks','vs','central_bank','accounts')
 and not exists(select 1 from public.institution_units u where u.game_id=new.game_id and 'unit:'||u.id::text=new.institution_key) then raise exception 'Орган не найден';end if;
 if new.institution_key='gd' then new.voting_mode:='mandate';end if;
 if new.institution_key not in ('gd','all','factions') then new.voting_mode:='member';end if;
 if new.institution_key='gd' and (new.quorum_kind<>'fraction' or new.quorum_value<0.5) then raise exception 'Кворум Государственной Думы не может быть ниже 226 из 450';end if;
 if new.institution_key in ('gd','sf','committee','region','cec','government','municipality') and (new.quorum_kind<>'fraction' or new.quorum_value<0.5) then raise exception 'Кворум органа не может быть ниже установленного минимума';end if;
 if new.institution_key in ('vs','accounts') and (new.quorum_kind<>'fraction' or new.quorum_value<0.666666) then raise exception 'Требуется кворум не менее двух третей учебного состава';end if;
 if new.institution_key='ks' and (new.quorum_kind<>'fraction' or new.quorum_value<0.545454) then raise exception 'Учебный кворум КС масштабируется от шести из одиннадцати судей';end if;
 if new.quorum_value<0 or new.quorum_value>1 or new.majority_value<0 or new.majority_value>1 then raise exception 'Некорректный порог голосования';end if;
 select coalesce(jsonb_object_agg(x.user_id::text,x.weight),'{}'::jsonb) into roster from (
  select gm.user_id,case new.voting_mode
   when 'mandate' then coalesce((select a.effective_mandates from public.party_member_mandates a where a.game_id=new.game_id and a.user_id=gm.user_id limit 1),0)
   when 'faction' then case when exists(select 1 from public.game_parties p where p.game_id=new.game_id and p.leader_user_id=gm.user_id) then 1 else 0 end
   else 1 end as weight
  from public.game_members gm where gm.game_id=new.game_id and gm.kind<>'observer' and (selected_group is null or gm.group_name=selected_group)
   and private.vote_member_has_office(new.game_id,gm.user_id,new.institution_key)
 ) x where x.weight>0;
 if new.institution_key='gd' then total:=450;
 elsif new.institution_key in ('government','municipality') then
  select count(*) into total from public.game_members where game_id=new.game_id and kind='student' and (selected_group is null or group_name=selected_group);
 elsif new.institution_key like 'unit:%' then
  select mandate_capacity into total from public.institution_units where game_id=new.game_id and 'unit:'||id::text=new.institution_key;
 else select coalesce(sum(value::numeric),0) into total from jsonb_each_text(roster);end if;
 select title into label from public.institution_units where game_id=new.game_id and 'unit:'||id::text=new.institution_key;
 new.group_name:=selected_group;
 new.electorate_snapshot:=jsonb_build_object('weights',roster,'eligible',total,'group_name',selected_group,'institution_label',label,'attendance_required',new.institution_key not in ('all','factions'),'captured_at',now());
 return new;
end;$function$
