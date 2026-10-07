create or replace function public.get_stage_readiness(p_game_id uuid,p_stage_no integer)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,private,pg_temp
as $$
declare
 v_uid uuid:=(select auth.uid());
 v jsonb;
 v_reason text;
 v_at timestamptz;
 v_original jsonb;
 v_blockers jsonb;
begin
 if v_uid is null or not private.is_game_member(p_game_id) then raise exception 'Game access required'; end if;
 if p_stage_no<1 or p_stage_no>16 then raise exception 'Stage number must be 1-16'; end if;

 v:=private.stage_readiness_json(p_game_id,p_stage_no);

 if p_stage_no=6 and not exists(
   select 1 from public.presidential_system_proposals
   where game_id=p_game_id and status='adopted'
 ) then
   v_blockers:=coalesce(v->'blockers','[]'::jsonb)||jsonb_build_array('Государственная Дума ещё не утвердила тип избирательной системы выборов Президента');
   v:=jsonb_set(jsonb_set(v,'{blockers}',v_blockers),'{ready}','false'::jsonb);
   v:=jsonb_set(v,'{metrics,duma_system_decision}',to_jsonb(0),true);
 elsif p_stage_no=6 then
   v:=jsonb_set(v,'{metrics,duma_system_decision}',to_jsonb(1),true);
 end if;

 select reason,created_at into v_reason,v_at
 from public.stage_readiness_overrides
 where game_id=p_game_id and stage_no=p_stage_no and is_active
 order by created_at desc limit 1;

 if v_reason is not null then
  v_original:=coalesce(v->'blockers','[]'::jsonb);
  v:=jsonb_set(jsonb_set(v,'{ready}','true'::jsonb),'{blockers}','[]'::jsonb)
    ||jsonb_build_object(
      'overridden',true,'override_reason',v_reason,'override_at',v_at,'original_blockers',v_original,
      'warnings',(v->'warnings')||jsonb_build_array('Историческое прохождение подтверждено преподавателем; структурированные данные этого этапа могут отсутствовать')
    );
 else
  v:=v||jsonb_build_object('overridden',false,'original_blockers','[]'::jsonb);
 end if;
 return v;
end;
$$;

revoke all on function public.get_stage_readiness(uuid,integer) from public,anon;
grant execute on function public.get_stage_readiness(uuid,integer) to authenticated;
