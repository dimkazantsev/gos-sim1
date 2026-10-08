-- Use active assignments consistently for eligibility and attendance.
-- Existing ballot snapshots and closed results remain unchanged.
CREATE OR REPLACE FUNCTION private.vote_eligible_weight(p_vote game_votes, p_user uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare w numeric;
begin
 if not private.vote_member_has_office(p_vote.game_id,p_user,p_vote.institution_key) then return 0;end if;

 if (
   coalesce((p_vote.electorate_snapshot->>'attendance_required')::boolean,false)
   or p_vote.procedure_key in ('registered_session','presidential_system','sf_resolution','government_nomination')
 )
 and p_vote.institution_key not in ('all','factions')
 and not exists(
   select 1
   from public.institution_session_registrations r
   where r.game_id=p_vote.game_id
     and r.stage_no=p_vote.stage_no
     and r.institution_key=p_vote.institution_key
     and r.user_id=p_user
 ) then return 0;end if;

 if p_vote.electorate_snapshot is not null then
   return coalesce((p_vote.electorate_snapshot->'weights'->>p_user::text)::numeric,0);
 end if;

 if p_vote.voting_mode='faction' then
   return case when exists(
     select 1 from public.game_parties
     where game_id=p_vote.game_id and leader_user_id=p_user
   ) then 1 else 0 end;
 end if;

 if p_vote.voting_mode='mandate' then
   select effective_mandates into w
   from public.party_member_mandates
   where game_id=p_vote.game_id and user_id=p_user
   limit 1;
   return coalesce(w,0);
 end if;

 return 1;
end;
$function$;

CREATE OR REPLACE FUNCTION private.vote_total_eligible_weight(p_vote game_votes)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
begin
 if p_vote.status='closed' and p_vote.result_eligible is not null then return p_vote.result_eligible;end if;
 if p_vote.electorate_snapshot is not null then return coalesce((p_vote.electorate_snapshot->>'eligible')::numeric,0);end if;
 if p_vote.institution_key='gd' then return 450;end if;
 if p_vote.institution_key='government' then return (select count(*) from public.game_members where game_id=p_vote.game_id and (p_vote.group_name is null or group_name=p_vote.group_name) and private.vote_member_has_office(p_vote.game_id,user_id,'government'));end if;
 if p_vote.institution_key='municipality' then return (select count(*) from public.game_members where game_id=p_vote.game_id and (kind='student' or (kind='teacher' and private.vote_member_matches(p_vote.game_id,user_id,p_vote.institution_key))) and (p_vote.group_name is null or group_name=p_vote.group_name));end if;
 if p_vote.voting_mode='faction' then return (select count(*) from public.game_parties where game_id=p_vote.game_id and leader_user_id is not null);end if;
 if p_vote.voting_mode='mandate' then return (select coalesce(sum(mandates),0) from public.game_parties where game_id=p_vote.game_id);end if;
 return (select count(*) from public.game_members gm where gm.game_id=p_vote.game_id and private.vote_member_has_office(p_vote.game_id,gm.user_id,p_vote.institution_key));
end;$function$;

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
 elsif new.institution_key='government' then
  select coalesce(sum(value::numeric),0) into total from jsonb_each_text(roster);
 elsif new.institution_key='municipality' then
  select count(*) into total from public.game_members where game_id=new.game_id and kind='student' and (selected_group is null or group_name=selected_group);
 elsif new.institution_key like 'unit:%' then
  select mandate_capacity into total from public.institution_units where game_id=new.game_id and 'unit:'||id::text=new.institution_key;
 else select coalesce(sum(value::numeric),0) into total from jsonb_each_text(roster);end if;
 select title into label from public.institution_units where game_id=new.game_id and 'unit:'||id::text=new.institution_key;
 new.group_name:=selected_group;
 new.electorate_snapshot:=jsonb_build_object('weights',roster,'eligible',total,'group_name',selected_group,'institution_label',label,'attendance_required',new.institution_key not in ('all','factions'),'captured_at',now());
 return new;
end;$function$;
