create or replace function public.get_event_decision_feedback(p_case_id uuid)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare c public.event_cases%rowtype;d public.event_decisions%rowtype;e public.event_authority_evidence%rowtype;o jsonb;i integer;answers jsonb;
begin
 select * into c from public.event_cases where id=p_case_id;
 if auth.uid() is null or not private.is_game_member(c.game_id) then raise exception 'Game access required';end if;
 select * into d from public.event_decisions where case_id=c.id and actor_id=auth.uid();
 if d.id is null then raise exception 'Submit your decision before opening the legal explanation';end if;
 select * into e from public.event_authority_evidence where decision_id=d.id;
 i:=case d.choice when 'accept' then 0 when 'reject' then 1 else substring(d.choice from 8)::int-1 end;
 o:=c.effect_plan->'options'->i;
 select coalesce(jsonb_agg(jsonb_build_object('label',c.decision_options->>(x.n::int-1),'description',x.value->>'description','roles',coalesce(x.value->'authorized_roles',to_jsonb(c.allowed_roles))) order by x.n),'[]'::jsonb)
 into answers from jsonb_array_elements(c.effect_plan->'options') with ordinality x(value,n)
 where coalesce((x.value->>'lawful')::boolean,true)
 and coalesce((x.value->>'trust')::numeric,0)>=coalesce((select max(coalesce((z->>'trust')::numeric,0)) from jsonb_array_elements(c.effect_plan->'options') z where coalesce((z->>'lawful')::boolean,true)),0);
 return jsonb_build_object('role',d.role_snapshot,'authority_ok',coalesce(e.authority_ok,false),'lawful',coalesce(e.lawful,(o->>'lawful')::boolean,false),'legal_basis',coalesce(e.legal_basis,o->>'legal_basis'),'chosen_consequence',o->>'description','lawful_choices',answers);
end;$$;
revoke all on function public.get_event_decision_feedback(uuid) from public,anon;
grant execute on function public.get_event_decision_feedback(uuid) to authenticated;
