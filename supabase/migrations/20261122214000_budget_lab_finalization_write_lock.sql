-- Serialize writes to budget analytical components/allocations with
-- finalization by locking the same budget_scenarios row already used by
-- save_budget_scenario, finalize_budget_scenario and set_budget_program_allocation.
-- Keep the same SQL read count, financial formulas, permissions and payloads.
-- These rare write locks do not affect public reads, polling or subscriptions.
CREATE OR REPLACE FUNCTION public.submit_budget_workstream(p_scenario_id uuid, p_workstream text, p_summary text, p_assumptions jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare s public.budget_scenarios%rowtype;v_uid uuid:=(select auth.uid());v_id uuid;
begin
 select * into s from public.budget_scenarios where id=p_scenario_id for update;
 if s.id is null then raise exception 'Scenario not found'; end if;
 if v_uid is null or not private.is_game_member(s.game_id) then raise exception 'Game access required'; end if;
 if s.status is distinct from 'draft' or s.formal_document_id is not null then
  raise exception 'Зафиксированный бюджетный сценарий или связанный с законом проект нельзя изменять.';
 end if;
 if p_workstream not in ('central_bank','macro','revenue','expenditure','financing_debt') then raise exception 'Unsupported budget workstream'; end if;
 if length(trim(coalesce(p_summary,'')))<10 then raise exception 'Analytical summary is too short'; end if;
 insert into public.budget_workstreams(scenario_id,game_id,workstream,summary,assumptions,submitted_by)
 values(s.id,s.game_id,p_workstream,trim(p_summary),coalesce(p_assumptions,'{}'::jsonb),v_uid)
 on conflict(scenario_id,workstream) do update set summary=excluded.summary,assumptions=excluded.assumptions,submitted_by=v_uid,updated_at=now()
 returning id into v_id;
 return v_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.delete_budget_program_allocation(p_allocation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare a public.budget_program_allocations%rowtype;s public.budget_scenarios%rowtype;v_uid uuid:=(select auth.uid());v_role text;
begin
 select * into a from public.budget_program_allocations where id=p_allocation_id;
 if a.id is null then return; end if;
 select * into s from public.budget_scenarios where id=a.scenario_id for update;
 if s.id is null or s.status is distinct from 'draft' or s.formal_document_id is not null then
  raise exception 'Зафиксированный бюджетный сценарий или связанный с законом проект нельзя изменять.';
 end if;
 v_role:=private.game_role(a.game_id,v_uid);
 if not private.is_game_teacher(a.game_id)
    and not private.has_effective_role_like(a.game_id,v_uid,ARRAY['%председател%правительств%','%министр%финанс%'])
 then raise exception 'Prime Minister / Finance Minister access required'; end if;
 delete from public.budget_program_allocations where id=a.id;
end;$function$
;
