-- Event outcomes are the only moment students may receive the correct answer.
-- Do not change event grades, votes, teacher permissions or stored case data.
-- Deploy the safe RPC before revoking direct table access.
create or replace function public.list_visible_event_cases(
 p_game_id uuid,
 p_case_ids uuid[]
) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $body$
declare v_result jsonb;
begin
 if (select auth.uid()) is null then
  raise exception 'Game authentication required' using errcode='42501';
 end if;
 if p_game_id is null or p_case_ids is null or cardinality(p_case_ids)>400 then
  raise exception 'Invalid case request' using errcode='22023';
 end if;
 select coalesce(jsonb_agg(
   (to_jsonb(c)-'effect_plan')
    || jsonb_build_object('effect_plan',
      case
       when private.is_game_teacher(c.game_id) then c.effect_plan
       when exists (select 1 from public.event_case_outcomes outcome
                   where outcome.case_id=c.id and outcome.game_id=c.game_id)
       then jsonb_build_object(
        'best_option_key',c.effect_plan->'best_option_key',
        'options',(
         select coalesce(jsonb_agg(
           case when ('option_'||ordinal::text)=(c.effect_plan->>'best_option_key')
             then jsonb_build_object('trust',choice->'trust',
                 'description',choice->>'description','legal_basis',choice->>'legal_basis')
             else jsonb_build_object('trust',choice->'trust')
           end order by ordinal),'[]'::jsonb)
         from jsonb_array_elements(coalesce(c.effect_plan->'options','[]'::jsonb))
               with ordinality as alternatives(choice,ordinal)
        )
       )
       else null
      end
    ) order by c.created_at,c.id
  ),'[]'::jsonb)
  into v_result
  from public.event_cases c
  where c.game_id=p_game_id and c.id=any(p_case_ids)
    and (private.is_game_teacher(c.game_id)
         or (private.is_game_member(c.game_id) and private.assigned_game_case(c.id,c.game_id)));
 return v_result;
end $body$;

revoke all on function public.list_visible_event_cases(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.list_visible_event_cases(uuid,uuid[]) to authenticated,service_role;

-- Existing feedback RPC was historically accessible immediately after choosing.
-- Keep the RPC compatible, but block premature explanations at the server.
create or replace function public.get_event_decision_feedback(p_case_id uuid)
 returns jsonb
 language plpgsql security definer
 set search_path to 'public','private','pg_temp'
as $body$
declare c public.event_cases%rowtype;d public.event_decisions%rowtype;e public.event_authority_evidence%rowtype;o jsonb;i integer;answers jsonb;
begin
 select * into c from public.event_cases where id=p_case_id;
 if c.id is null or auth.uid() is null or not private.is_game_member(c.game_id) then
  raise exception 'Game access required' using errcode='42501';
 end if;
 if not private.is_game_teacher(c.game_id) and not exists (
  select 1 from public.event_case_outcomes where case_id=p_case_id and game_id=c.game_id
 ) then
  raise exception 'Explanation is available after final outcome' using errcode='42501';
 end if;
 select * into d from public.event_decisions where case_id=c.id and actor_id=auth.uid();
 if d.id is null then raise exception 'Submit your decision before opening the legal explanation';end if;
 select * into e from public.event_authority_evidence where decision_id=d.id;
 i:=case d.choice when 'accept' then 0 when 'reject' then 1 else substring(d.choice from 8)::int-1 end;
 o:=c.effect_plan->'options'->i;
 select coalesce(jsonb_agg(jsonb_build_object('label',c.decision_options->>(x.n::int-1),'description',x.value->>'description','roles',coalesce(x.value->'authorized_roles',to_jsonb(c.allowed_roles))) order by x.n),'[]'::jsonb)
 into answers from jsonb_array_elements(c.effect_plan->'options') with ordinality x(value,n)
 where coalesce((x.value->>'lawful')::boolean,true);
 return jsonb_build_object('role',d.role_snapshot,'authority_ok',coalesce(e.authority_ok,false),'delegated_ok',coalesce(e.delegated_ok,false),'best_option',coalesce(e.best_option,false),'score_share',coalesce(e.score_share,0),'lawful',coalesce(e.lawful,(o->>'lawful')::boolean,false),'legal_basis',coalesce(e.legal_basis,o->>'legal_basis'),'chosen_consequence',o->>'description','lawful_choices',answers);
end $body$;

