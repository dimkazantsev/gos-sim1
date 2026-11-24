-- Exact two-thirds arithmetic for legislative mandate votes only.
-- Keep all other majority rules, quorum, frozen electorate and vote transitions unchanged.
CREATE OR REPLACE FUNCTION private.finalize_procedural_vote(p_vote_id uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare uid uuid:=auth.uid();v public.game_votes%rowtype;eligible numeric;casted numeric;present numeric;y numeric;n numeric;a numeric;needed numeric;q boolean;pass boolean;result text;label text;chair text;
begin
 select * into v from public.game_votes where id=p_vote_id for update;
 if v.id is null or uid is null or not private.is_game_member(v.game_id) then raise exception 'Нет доступа к голосованию';end if;
 -- Called exclusively by the authorised public close RPC or guarded ballot trigger.
 if v.status<>'open' then return jsonb_build_object('result',v.result_code,'label',v.result_label);end if;
 eligible:=private.vote_total_eligible_weight(v);present:=private.vote_present_weight(v);
 select coalesce(sum(weight),0),coalesce(sum(coalesce(yes_weight,case when choice='yes' then weight else 0 end)),0),coalesce(sum(coalesce(no_weight,case when choice='no' then weight else 0 end)),0),coalesce(sum(coalesce(abstain_weight,case when choice='abstain' then weight else 0 end)),0)
 into casted,y,n,a from public.game_ballots where vote_id=v.id;
 needed:=case when v.quorum_kind='none' then 0 when v.institution_key in ('gd','sf','committee','region','cec') and abs(v.quorum_value-0.5)<0.000001 then floor(eligible/2)+1 else ceil(eligible*v.quorum_value-0.000001) end;
 q:=v.quorum_kind='none' or (eligible>0 and present>=needed);
 if not q then pass:=false;result:='no_quorum';label:='Нет кворума';
 else
  pass:=case v.majority_kind when 'eligible_majority' then y>eligible/2 when 'eligible_fraction' then
   case when v.institution_key='gd' and v.voting_mode='mandate'
     and v.procedure_key in ('bill_reading1','bill_reading1_full','bill_reading2','bill_reading3','sf_veto_override','presidential_veto_override')
     and v.majority_value=2.0/3.0
    then 3*y>=2*eligible
    else y>=ceil(eligible*v.majority_value) end when 'present_majority' then y>present/2 else y>n end;
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
end;$function$;
