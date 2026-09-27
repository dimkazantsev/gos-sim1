-- Correct plenary State Duma quorum semantics: "majority of total membership"
-- means strictly more than one half (226 of 450), not ceil(50%) = 225.
create or replace function public.close_procedural_vote(p_vote_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_uid uuid:=(select auth.uid());
  v public.game_votes%rowtype;
  v_eligible numeric;
  v_cast numeric;
  v_yes numeric;
  v_no numeric;
  v_abstain numeric;
  v_needed numeric;
  v_quorum boolean;
  v_pass boolean;
  v_result text;
  v_label text;
  v_chair_choice text;
begin
  select * into v from public.game_votes where id=p_vote_id for update;
  if v.id is null then raise exception 'Vote not found'; end if;
  if v.status<>'open' then
    return jsonb_build_object('result',v.result_code,'label',v.result_label);
  end if;
  if v_uid is null or not private.is_game_member(v.game_id) then raise exception 'Game access required'; end if;
  if not private.can_close_procedural_vote(v.game_id,v_uid,v.institution_key,v.formal_document_id) then
    raise exception 'Only the presiding institution or teacher can close this vote';
  end if;

  v_eligible:=private.vote_total_eligible_weight(v);
  select
    coalesce(sum(weight),0),
    coalesce(sum(weight) filter(where choice='yes'),0),
    coalesce(sum(weight) filter(where choice='no'),0),
    coalesce(sum(weight) filter(where choice='abstain'),0)
  into v_cast,v_yes,v_no,v_abstain
  from public.game_ballots
  where vote_id=v.id;

  if v.quorum_kind='none' then
    v_quorum:=true;
    v_needed:=0;
  else
    if v.institution_key='gd' and abs(v.quorum_value-0.5)<0.000001 then
      v_needed:=floor(v_eligible/2)+1;
    else
      v_needed:=ceil(v_eligible*v.quorum_value);
    end if;
    v_quorum:=v_eligible>0 and v_cast>=v_needed;
  end if;

  if not v_quorum then
    v_pass:=false;
    v_result:='no_quorum';
    v_label:='Нет кворума';
  else
    if v.majority_kind='eligible_majority' then
      v_pass:=v_yes>v_eligible/2;
    elsif v.majority_kind='eligible_fraction' then
      v_pass:=v_yes>=ceil(v_eligible*v.majority_value);
    elsif v.majority_kind='present_majority' then
      v_pass:=v_yes>v_cast/2;
      if not v_pass and v.tie_breaker_chair and v_yes=v_no then
        select b.choice into v_chair_choice
        from public.game_ballots b
        join public.game_members gm
          on gm.user_id=b.voter_id and gm.game_id=v.game_id
        where b.vote_id=v.id
          and (
            coalesce(gm.role_title,'') ilike '%председател%правительств%'
            or coalesce(gm.role_title,'') ilike '%председател%дум%'
            or coalesce(gm.role_title,'') ilike '%председател%совет%федерац%'
          )
        limit 1;
        v_pass:=v_chair_choice='yes';
      end if;
    else
      v_pass:=v_yes>v_no;
    end if;
    v_result:=case when v_pass then 'passed' else 'rejected' end;
    v_label:=case when v_pass then 'Решение принято' else 'Решение отклонено' end;
  end if;

  update public.game_votes
     set status='closed',
         closed_at=now(),
         result_code=v_result,
         result_label=v_label,
         result_yes=v_yes,
         result_no=v_no,
         result_abstain=v_abstain,
         result_eligible=v_eligible,
         result_cast=v_cast,
         result_quorum_met=v_quorum,
         decision_note=nullif(trim(coalesce(p_note,'')),'')
   where id=v.id;

  if v_quorum then
    perform private.apply_formal_vote_transition(
      v.formal_document_id,
      case when v_pass then v.pass_transition else v.fail_transition end,
      v_uid,v.id,p_note
    );
  end if;

  return jsonb_build_object(
    'result',v_result,'label',v_label,'yes',v_yes,'no',v_no,'abstain',v_abstain,
    'eligible',v_eligible,'cast',v_cast,'quorum',v_quorum,'needed',v_needed
  );
end;
$$;

revoke all on function public.close_procedural_vote(uuid,text) from public,anon;
grant execute on function public.close_procedural_vote(uuid,text) to authenticated;
