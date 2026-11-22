-- Align Budget Lab program eligibility with the official federal simulator.
-- Only an adopted/signed state program with an approved commitment for the
-- scenario's year is eligible. Preserve all monetary values and scale.
-- No new client requests, subscriptions, UI components, tables, or formulas.
-- The existing program SELECT now checks an indexed annual commitment.
CREATE OR REPLACE FUNCTION public.set_budget_program_allocation(p_scenario_id uuid, p_program_id uuid, p_amount numeric, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare s public.budget_scenarios%rowtype;p public.state_programs%rowtype;v_uid uuid:=(select auth.uid());v_role text;v_id uuid;v_total numeric;
begin
 select * into s from public.budget_scenarios where id=p_scenario_id for update;
 if s.id is null then raise exception 'Budget scenario not found'; end if;
 if s.status is distinct from 'draft' or s.formal_document_id is not null then raise exception 'Зафиксированный бюджетный сценарий или связанный с законом проект нельзя изменять.'; end if;
 if v_uid is null or not private.is_game_member(s.game_id) then raise exception 'Game access required'; end if;
 v_role:=private.game_role(s.game_id,v_uid);
 if not private.is_game_teacher(s.game_id)
    and not private.has_effective_role_like(s.game_id,v_uid,ARRAY['%председател%правительств%','%министр%финанс%'])
 then raise exception 'Prime Minister / Finance Minister access required'; end if;

 -- The same eligibility rule as validate_budget_draft: only an adopted,
 -- personally signed program with an approved commitment for this year.
 -- Use the existing program lookup, not a second independent read/RPC.
 select * into p from public.state_programs prog
 where prog.id=p_program_id and prog.game_id=s.game_id and prog.status='adopted'
   and prog.signed_at is not null and prog.signed_by is not null
   and exists (
     select 1 from public.state_program_budget_commitments c
     where c.game_id=prog.game_id and c.program_id=prog.id
       and c.budget_year=s.budget_year and c.status='approved'
       and c.signed_by=prog.signed_by and c.amount>0
   );
 if p.id is null then
   raise exception 'Программа должна быть принята, подписана и иметь утверждённое финансирование выбранного бюджетного года.';
 end if;
 if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<=0 then
   raise exception 'Финансирование программы должно быть положительным конечным числом.';
 end if;

 select coalesce(sum(amount),0)-coalesce((select amount from public.budget_program_allocations where scenario_id=s.id and program_id=p.id),0)+p_amount
 into v_total
 from public.budget_program_allocations where scenario_id=s.id;

 if v_total>s.expenditure then raise exception 'Program allocations exceed total budget expenditure'; end if;

 insert into public.budget_program_allocations(scenario_id,game_id,program_id,amount,note,created_by)
 values(s.id,s.game_id,p.id,p_amount,nullif(trim(coalesce(p_note,'')),''),v_uid)
 on conflict(scenario_id,program_id) do update
 set amount=excluded.amount,note=excluded.note,updated_at=now()
 returning id into v_id;
 return v_id;
end;$function$
;
