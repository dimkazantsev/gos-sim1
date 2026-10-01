CREATE OR REPLACE FUNCTION public.set_student_mandates(p_party_id uuid, p_allocations jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare p public.game_parties%rowtype;total numeric;entry record;
begin
 select * into p from public.game_parties where id=p_party_id;
 if p.id is null or auth.uid() is null or not private.is_game_teacher(p.game_id) then raise exception 'Требуются права преподавателя';end if;
 perform 1 from public.games where id=p.game_id for update;
 select * into p from public.game_parties where id=p_party_id for update;
 if private.has_open_duma_mandate_vote(p.game_id) then raise exception 'Сначала завершите открытое голосование Государственной Думы';end if;
 if p_allocations is null then update public.game_parties set mandate_allocation_mode='equal' where id=p.id;perform private.rebalance_party_mandates(p.id);return;end if;
 if jsonb_typeof(p_allocations)<>'object' then raise exception 'Неверный формат распределения';end if;
 total:=0;
 for entry in select key,value from jsonb_each_text(p_allocations) loop
  if entry.value !~ '^[0-9]+$' or entry.value::numeric>450 then raise exception 'Число мандатов должно быть целым от 0 до 450';end if;
  if not exists(select 1 from public.game_members where game_id=p.game_id and user_id::text=entry.key and kind='student' and team=p.name) then raise exception 'Участник не входит в эту фракцию';end if;
  total:=total+entry.value::numeric;
 end loop;
 if total<>p.mandates then raise exception 'Распределите ровно % мандатов; сейчас распределено %',p.mandates,total;end if;
 if exists(select 1 from public.game_members m where m.game_id=p.game_id and m.kind='student' and m.team=p.name and not p_allocations ? m.user_id::text) then raise exception 'Укажите число мандатов для каждого участника';end if;
 insert into public.party_member_mandates(game_id,party_id,user_id,base_mandates,ghost_loss,effective_mandates)
 select p.game_id,p.id,key::uuid,value::int,0,value::int from jsonb_each_text(p_allocations)
 on conflict(game_id,party_id,user_id) do update set base_mandates=excluded.base_mandates;
 update public.game_parties set mandate_allocation_mode='custom' where id=p.id;
 perform private.rebalance_party_mandates(p.id);
end;$function$
;
CREATE OR REPLACE FUNCTION public.get_event_decision_feedback(p_case_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
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
 where coalesce((x.value->>'lawful')::boolean,true);
 return jsonb_build_object('role',d.role_snapshot,'authority_ok',coalesce(e.authority_ok,false),'lawful',coalesce(e.lawful,(o->>'lawful')::boolean,false),'legal_basis',coalesce(e.legal_basis,o->>'legal_basis'),'chosen_consequence',o->>'description','lawful_choices',answers);
end;$function$
;

