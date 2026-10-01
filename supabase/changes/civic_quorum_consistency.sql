CREATE OR REPLACE FUNCTION public.close_procedural_vote(p_vote_id uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare uid uuid:=auth.uid();v public.game_votes%rowtype;eligible numeric;casted numeric;present numeric;y numeric;n numeric;a numeric;needed numeric;q boolean;pass boolean;result text;label text;chair text;
begin
 select * into v from public.game_votes where id=p_vote_id for update;
 if v.id is null or uid is null or not private.is_game_member(v.game_id) then raise exception 'Нет доступа к голосованию';end if;
 if not private.can_close_procedural_vote(v.game_id,uid,v.institution_key,v.formal_document_id)
 and not exists(select 1 from public.institution_units u where u.game_id=v.game_id and 'unit:'||u.id::text=v.institution_key and u.head_user_id=uid)
 then raise exception 'Закрыть голосование может председательствующий или преподаватель';end if;
 if v.status<>'open' then return jsonb_build_object('result',v.result_code,'label',v.result_label);end if;
 eligible:=private.vote_total_eligible_weight(v);present:=private.vote_present_weight(v);
 select coalesce(sum(weight),0),coalesce(sum(coalesce(yes_weight,case when choice='yes' then weight else 0 end)),0),coalesce(sum(coalesce(no_weight,case when choice='no' then weight else 0 end)),0),coalesce(sum(coalesce(abstain_weight,case when choice='abstain' then weight else 0 end)),0)
 into casted,y,n,a from public.game_ballots where vote_id=v.id;
 needed:=case when v.quorum_kind='none' then 0 when v.institution_key in ('gd','sf','committee','region','cec') and abs(v.quorum_value-0.5)<0.000001 then floor(eligible/2)+1 else ceil(eligible*v.quorum_value-0.000001) end;
 q:=v.quorum_kind='none' or (eligible>0 and present>=needed);
 if not q then pass:=false;result:='no_quorum';label:='Нет кворума';
 else
  pass:=case v.majority_kind when 'eligible_majority' then y>eligible/2 when 'eligible_fraction' then y>=ceil(eligible*v.majority_value) when 'present_majority' then y>present/2 else y>n end;
  if not pass and v.tie_breaker_chair and y=n and y>0 then
   select b.choice into chair from public.game_ballots b join public.game_members m on m.game_id=v.game_id and m.user_id=b.voter_id
   where b.vote_id=v.id and m.role_title ~* 'председател.*правительств|председател.*дум|председател.*совет.*федерац' limit 1;
   pass:=coalesce(chair='yes',false);
  end if;
  result:=case when pass then 'passed' else 'rejected' end;label:=case when pass then 'Решение принято' else 'Решение отклонено' end;
 end if;
 update public.game_votes set status='closed',closed_at=now(),result_code=result,result_label=label,result_yes=y,result_no=n,result_abstain=a,result_eligible=eligible,result_cast=casted,result_present=present,result_quorum_met=q,decision_note=nullif(trim(p_note),'') where id=v.id;
 if q then perform private.apply_formal_vote_transition(v.formal_document_id,case when pass then v.pass_transition else v.fail_transition end,uid,v.id,p_note);end if;
 return jsonb_build_object('result',result,'label',label,'yes',y,'no',n,'abstain',a,'eligible',eligible,'cast',casted,'present',present,'quorum',q,'needed',needed);
end;$function$
;
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
 else select coalesce(sum(value::numeric),0) into total from jsonb_each_text(roster);end if;
 select title into label from public.institution_units where game_id=new.game_id and 'unit:'||id::text=new.institution_key;
 new.group_name:=selected_group;
 new.electorate_snapshot:=jsonb_build_object('weights',roster,'eligible',total,'group_name',selected_group,'institution_label',label,'attendance_required',new.institution_key not in ('all','factions'),'captured_at',now());
 return new;
end;$function$
;

