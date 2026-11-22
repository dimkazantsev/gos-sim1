-- The federal simulator requires each program expense to equal the
-- signed and approved annual amount. Apply the SAME rule in Budget Lab.
-- Reuse its existing program query as one indexed join returning the amount;
-- the remaining aggregation/upsert is unchanged. Match BudgetLab's unit parser.
-- Remove unused private.game_role lookup. No RPCs, subscriptions, tables,
-- coefficient changes, published records or automatic budget recalculations.
CREATE OR REPLACE FUNCTION public.set_budget_program_allocation(p_scenario_id uuid, p_program_id uuid, p_amount numeric, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare s public.budget_scenarios%rowtype;v_program_id uuid;v_commitment numeric;v_scale numeric;v_uid uuid:=(select auth.uid());v_id uuid;v_total numeric;
begin
 select * into s from public.budget_scenarios where id=p_scenario_id for update;
 if s.id is null then raise exception 'Budget scenario not found'; end if;
 if s.status is distinct from 'draft' or s.formal_document_id is not null then raise exception 'Зафиксированный бюджетный сценарий или связанный с законом проект нельзя изменять.'; end if;
 if v_uid is null or not private.is_game_member(s.game_id) then raise exception 'Game access required'; end if;
  if not private.is_game_teacher(s.game_id)
    and not private.has_effective_role_like(s.game_id,v_uid,ARRAY['%председател%правительств%','%министр%финанс%'])
 then raise exception 'Prime Minister / Finance Minister access required'; end if;

 -- Same commitment validation as the official federal budget simulator:
 -- an adopted and signed program with approved funding for this exact year.
 -- Return both the program id and signed ruble amount in ONE existing query.
 if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<=0 then
   raise exception 'Финансирование программы должно быть положительным конечным числом.';
 end if;
 select prog.id,c.amount into v_program_id,v_commitment
 from public.state_programs prog
 join public.state_program_budget_commitments c
   on c.game_id=prog.game_id and c.program_id=prog.id
   and c.budget_year=s.budget_year and c.status='approved'
   and c.signed_by=prog.signed_by and c.amount>0
 where prog.id=p_program_id and prog.game_id=s.game_id and prog.status='adopted'
   and prog.signed_at is not null and prog.signed_by is not null;
 if v_program_id is null then
   raise exception 'Программа должна быть принята, подписана и иметь утверждённое финансирование выбранного бюджетного года.';
 end if;
 -- Match the existing BudgetLab scenarioUnit() precedence and compare
 -- rubles with rubles, as validate_budget_draft already requires.
 v_scale:=case
   when lower(coalesce(s.source_note,'')) ~ 'трлн|триллион' then 1000000000000::numeric
   when lower(coalesce(s.source_note,'')) ~ 'млрд|миллиард' then 1000000000::numeric
   when lower(coalesce(s.source_note,'')) ~ 'млн|миллион' then 1000000::numeric
   when lower(coalesce(s.source_note,'')) ~ 'тыс\\.?|тысяч' then 1000::numeric
   when lower(coalesce(s.source_note,'')) ~ 'рубл|₽' then 1::numeric
   else 1000000::numeric
 end;
 if p_amount*v_scale is distinct from v_commitment then
   raise exception 'Сумма госпрограммы должна совпадать с подписанным годовым финансированием. Измените обязательство в госпрограмме, а не сумму в бюджетном сценарии.';
 end if;

 select coalesce(sum(amount),0)-coalesce((select amount from public.budget_program_allocations where scenario_id=s.id and program_id=v_program_id),0)+p_amount
 into v_total
 from public.budget_program_allocations where scenario_id=s.id;

 if v_total>s.expenditure then raise exception 'Program allocations exceed total budget expenditure'; end if;

 insert into public.budget_program_allocations(scenario_id,game_id,program_id,amount,note,created_by)
 values(s.id,s.game_id,v_program_id,p_amount,nullif(trim(coalesce(p_note,'')),''),v_uid)
 on conflict(scenario_id,program_id) do update
 set amount=excluded.amount,note=excluded.note,updated_at=now()
 returning id into v_id;
 return v_id;
end;$function$
;
