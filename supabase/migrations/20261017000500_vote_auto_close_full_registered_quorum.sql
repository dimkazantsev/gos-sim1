-- Preserve public chair/teacher closure, add transactional automatic closure
-- when every registered voter eligible in the vote's immutable electorate snapshot has voted.
-- A valid quorum is mandatory; closed votes and past ballots remain untouched.
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
end;$function$;

revoke all on function private.finalize_procedural_vote(uuid,text) from public,anon,authenticated;

create or replace function public.close_procedural_vote(p_vote_id uuid,p_note text default null)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $manual$
declare
 uid uuid:=auth.uid();
 v public.game_votes%rowtype;
begin
 select * into v from public.game_votes where id=p_vote_id for update;
 if v.id is null or uid is null or not private.is_game_member(v.game_id) then
  raise exception 'Нет доступа к голосованию';
 end if;
 if not private.can_close_procedural_vote(v.game_id,uid,v.institution_key,v.formal_document_id)
 and not exists(
  select 1 from public.institution_units u
  where u.game_id=v.game_id and 'unit:'||u.id::text=v.institution_key and u.head_user_id=uid
 ) then
  raise exception 'Закрыть голосование может председательствующий или преподаватель';
 end if;
 return private.finalize_procedural_vote(p_vote_id,p_note);
end;$manual$;
revoke all on function public.close_procedural_vote(uuid,text) from public,anon;
grant execute on function public.close_procedural_vote(uuid,text) to authenticated;

create or replace function private.close_vote_after_last_registered_ballot()
returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $auto$
declare
 v public.game_votes%rowtype;
 eligible numeric;
 present numeric;
 required numeric;
 roster_count integer;
 missing_count integer;
begin
 -- The ballot RPC locks game_votes before writing. Re-locking that same vote
 -- keeps the final vote and closure in one transaction, serialising concurrent voters.
 select * into v from public.game_votes where id=new.vote_id for update;
 if v.id is null or v.status<>'open'
    or not coalesce((v.electorate_snapshot->>'attendance_required')::boolean,false)
    or v.institution_key is null then
  return new;
 end if;

 -- Only count registered users included in this vote's original electorate.
 -- In particular, KSRF has one ballot per registered faction leader;
 -- Duma mandate weights stay with the original voter snapshot.
 select count(*)::integer,
        count(*) filter(where b.voter_id is null)::integer
 into roster_count,missing_count
 from public.institution_session_registrations r
 left join public.game_ballots b on b.vote_id=v.id and b.voter_id=r.user_id
 where r.game_id=v.game_id
  and r.stage_no=v.stage_no
  and r.institution_key=v.institution_key
  and coalesce((v.electorate_snapshot->'weights'->>r.user_id::text)::numeric,0)>0
  and private.vote_eligible_weight(v,r.user_id)>0;
 if roster_count=0 or missing_count>0 then return new;end if;

 eligible:=private.vote_total_eligible_weight(v);
 present:=private.vote_present_weight(v);
 required:=case when v.quorum_kind='none' then 0
  when v.institution_key in ('gd','sf','committee','region','cec')
   and abs(v.quorum_value-0.5)<0.000001 then floor(eligible/2)+1
  else ceil(eligible*v.quorum_value-0.000001) end;
 if v.quorum_kind<>'none' and (eligible<=0 or present<required) then
  return new;
 end if;

 -- Share exactly the same quorum, majority, transitions, history and close triggers
 -- as the manual RPC; only the authorised way of initiating closure differs.
 perform private.finalize_procedural_vote(
  v.id,'Автоматически закрыто: проголосовали все зарегистрированные участники при наличии кворума.'
 );
 return new;
end;$auto$;
revoke all on function private.close_vote_after_last_registered_ballot() from public,anon,authenticated;
drop trigger if exists zz_auto_close_after_registered_ballots on public.game_ballots;
create trigger zz_auto_close_after_registered_ballots
 after insert or update of choice,weight,yes_weight,no_weight,abstain_weight
 on public.game_ballots for each row
 execute function private.close_vote_after_last_registered_ballot();
