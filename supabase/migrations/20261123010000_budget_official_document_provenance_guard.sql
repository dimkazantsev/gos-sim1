-- Only the canonical budget simulator may register a federal budget law.
-- Check one existing primary-key plan at creation; all other document
-- categories keep exactly their current path and zero extra reads.
-- No new RPCs, subscriptions, formulas, tables, gameplay balance changes.
CREATE OR REPLACE FUNCTION private.guard_budget_document_direct_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare guarded boolean;
begin
 guarded:=(
  (tg_op<>'INSERT' and (old.workflow_key='budget' or old.doc_type='federal_budget'))
  or (tg_op<>'DELETE' and (new.workflow_key='budget' or new.doc_type='federal_budget')));
 -- Federal budget laws must come from the already validated, revisioned
 -- simulator. Merely choosing doc_type='federal_budget' is not financial proof.
 -- Inspect the indexed plan only for creation of such a document.
 if tg_op='INSERT' and (new.doc_type='federal_budget' or new.workflow_key='budget') then
  if current_setting('gos.official_budget_plan_creation',true)
      is distinct from new.metadata->>'budget_simulator_plan_id'
     or new.doc_type is distinct from 'federal_budget'
     or new.workflow_key is distinct from 'budget'
     or not exists (
       select 1 from public.budget_simulator_plans p
       where p.id::text=new.metadata->>'budget_simulator_plan_id'
         and p.scenario_id::text=new.metadata->>'budget_scenario_id'
         and p.game_id=new.game_id
         and p.document_id is null and p.status='draft'
         and p.draft=new.metadata->'budget_draft'
     ) then
    raise exception 'Проект федерального бюджета создаётся только из утверждённого расчёта раздела «Бюджет» с числовыми приложениями.';
  end if;
 end if;
 if guarded then
  if current_user in ('anon','authenticated') then raise exception 'Изменения бюджета проходят через защищённую процедуру реестра НПА.';end if;
  if tg_op<>'DELETE' and auth.uid() is not null then perform private.lock_budget_actor(new.game_id);end if;
 end if;
 return case when tg_op='DELETE' then old else new end;
end;$function$;
