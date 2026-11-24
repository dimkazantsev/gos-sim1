-- Distinct active government offices; profile role is a fallback, not an extra office.
CREATE OR REPLACE FUNCTION private.government_office_vote_weight(p_game uuid,p_user uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $f$
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM public.game_members m WHERE m.game_id=p_game AND m.user_id=p_user AND m.roster_archived_at IS NULL AND m.kind<>'observer')
 OR NOT private.vote_member_has_office(p_game,p_user,'government')
 OR NOT private.role_is_available(p_game,p_user)
 OR EXISTS(SELECT 1 FROM public.game_member_access_blocks b WHERE b.game_id=p_game AND b.user_id=p_user)
 THEN 0 ELSE greatest(1,(SELECT count(DISTINCT CASE
 WHEN lower(a.role_title) LIKE '%министерство по %' THEN substring(lower(a.role_title) FROM 'министерство по .+$')
 ELSE lower(btrim(a.role_title)) END)
 FROM public.game_office_assignments a WHERE a.game_id=p_game AND a.user_id=p_user AND a.status='active'
 AND (private.role_matches_voting_body(a.role_title,'government') OR a.role_title ~* '^министерство[[:space:]]+по[[:space:]]+'))) END
$f$;
REVOKE ALL ON FUNCTION private.government_office_vote_weight(uuid,uuid) FROM PUBLIC,anon,authenticated;
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
 if new.institution_key not in ('all','factions','ksrf','gd','government','municipality','sf','committee','region','cec','ks','vs','central_bank','accounts')
 and not exists(select 1 from public.institution_units u where u.game_id=new.game_id and 'unit:'||u.id::text=new.institution_key) then raise exception 'Орган не найден';end if;
 if new.institution_key='gd' then new.voting_mode:='mandate';end if;
 if new.institution_key not in ('gd','all','factions','ksrf') then new.voting_mode:='member';end if;
 if new.institution_key='gd' and (new.quorum_kind<>'fraction' or new.quorum_value<0.5) then raise exception 'Кворум Государственной Думы не может быть ниже 226 из 450';end if;
 if new.institution_key in ('gd','sf','committee','region','cec','government','municipality') and (new.quorum_kind<>'fraction' or new.quorum_value<0.5) then raise exception 'Кворум органа не может быть ниже установленного минимума';end if;
 if new.institution_key in ('vs','accounts') and (new.quorum_kind<>'fraction' or new.quorum_value<0.666666) then raise exception 'Требуется кворум не менее двух третей учебного состава';end if;
 if new.institution_key='ks' and (new.quorum_kind<>'fraction' or new.quorum_value<0.545454) then raise exception 'Учебный кворум КС масштабируется от шести из одиннадцати судей';end if;
 if new.quorum_value<0 or new.quorum_value>1 or new.majority_value<0 or new.majority_value>1 then raise exception 'Некорректный порог голосования';end if;
 select coalesce(jsonb_object_agg(x.user_id::text,x.weight),'{}'::jsonb) into roster from (
  select gm.user_id,case new.voting_mode
   when 'mandate' then case when new.institution_key='gd'
    then private.gd_member_capacity(new.game_id,gm.user_id)
    else coalesce((select a.effective_mandates from public.party_member_mandates a where a.game_id=new.game_id and a.user_id=gm.user_id limit 1),0) end
   when 'faction' then case when exists(select 1 from public.game_parties p where p.game_id=new.game_id and p.leader_user_id=gm.user_id) then 1 else 0 end
   else case when new.institution_key='government' then private.government_office_vote_weight(new.game_id,gm.user_id) else 1 end end as weight
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
 if new.institution_key='ksrf' then label:='КСРФ';end if;
 new.group_name:=selected_group;
 new.electorate_snapshot:=jsonb_build_object('weights',roster,'eligible',total,'group_name',selected_group,'institution_label',label,'attendance_required',new.institution_key not in ('all','factions'),'captured_at',now());
 return new;
end;$function$;
CREATE OR REPLACE FUNCTION public.cast_vote_allocation(p_vote_id uuid, p_yes numeric, p_no numeric, p_abstain numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v public.game_votes%rowtype;uid uuid:=auth.uid();allowed numeric;total numeric;choice text;
begin
 select * into v from public.game_votes where id=p_vote_id for update;
 if uid is null or v.id is null or not private.is_game_member(v.game_id) then raise exception 'Нет доступа к голосованию';end if;
 if v.status<>'open' then
  -- Exact retry of an already recorded choice: no new write and no new result.
  -- A different choice after closure remains forbidden.
  if exists(select 1 from public.game_ballots b
    where b.vote_id=v.id and b.voter_id=uid
     and b.yes_weight is not distinct from p_yes
     and b.no_weight is not distinct from p_no
     and b.abstain_weight is not distinct from p_abstain
     and b.weight is not distinct from (p_yes+p_no+p_abstain)
  ) then return; end if;
  raise exception 'Голосование завершено';
 end if;
 if v.procedure_key='state_program' and not exists(
   select 1 from public.government_program_agenda a
   join public.government_sessions s on s.id=a.session_id and s.game_id=a.game_id
   where a.game_id=v.game_id and a.vote_id=v.id and a.status='decision'
     and s.status='open' and s.stage_no=11
 ) then raise exception 'Голосование по программе доступно после доклада на заседании Правительства';end if;
 allowed:=private.vote_eligible_weight(v,uid);
 total:=p_yes+p_no+p_abstain;
 if p_yes is null or p_no is null or p_abstain is null or p_yes<0 or p_no<0 or p_abstain<0 or total<=0
 or p_yes<>trunc(p_yes) or p_no<>trunc(p_no) or p_abstain<>trunc(p_abstain) or total>allowed then raise exception 'Число голосов должно быть целым и не превышать ваш доступный пакет: %',allowed;end if;
 if v.institution_key='government' and v.voting_mode='member' then
  if total<>allowed then raise exception 'Распределите все доступные голоса Правительства: %',allowed;end if;
 elsif v.voting_mode<>'mandate' and (total<>1 or greatest(p_yes,p_no,p_abstain)<>1) then raise exception 'В этой процедуре у участника один неделимый голос';end if;
 if not v.allow_abstain and p_abstain>0 then raise exception 'Воздержание в этой процедуре не предусмотрено';end if;
 choice:=case when p_yes>=p_no and p_yes>=p_abstain then 'yes' when p_no>=p_abstain then 'no' else 'abstain' end;
 insert into public.game_ballots(vote_id,voter_id,choice,weight,yes_weight,no_weight,abstain_weight)
 values(v.id,uid,choice,total,p_yes,p_no,p_abstain)
 on conflict(vote_id,voter_id) do update set
  choice=excluded.choice,weight=excluded.weight,
  yes_weight=excluded.yes_weight,no_weight=excluded.no_weight,
  abstain_weight=excluded.abstain_weight
 where (game_ballots.choice,game_ballots.weight,
        game_ballots.yes_weight,game_ballots.no_weight,game_ballots.abstain_weight)
    is distinct from
       (excluded.choice,excluded.weight,
        excluded.yes_weight,excluded.no_weight,excluded.abstain_weight);
end;$function$;
-- Only the observed empty open agenda ballot; retain original roster and all other fields.
DO $repair$
DECLARE v public.game_votes%rowtype;w jsonb;n numeric;
BEGIN
 SELECT * INTO v FROM public.game_votes WHERE id='85423ecd-adbe-4b11-85cd-85d2cf2e4bbf' AND game_id='068dac89-00ea-447a-96bf-0cb11d85014a' AND institution_key='government' FOR UPDATE;
 IF v.id IS NOT NULL AND v.status='open' AND NOT EXISTS(SELECT 1 FROM public.game_ballots b WHERE b.vote_id=v.id) THEN
  SELECT coalesce(jsonb_object_agg(x.key,x.weight),'{}'::jsonb),coalesce(sum(x.weight),0) INTO w,n FROM
   (SELECT s.key,private.government_office_vote_weight(v.game_id,s.key::uuid) weight FROM jsonb_each_text(v.electorate_snapshot->'weights') s) x WHERE x.weight>0;
  UPDATE public.game_votes SET electorate_snapshot=electorate_snapshot||jsonb_build_object('weights',w,'eligible',n) WHERE id=v.id;
 END IF;
END;$repair$;
