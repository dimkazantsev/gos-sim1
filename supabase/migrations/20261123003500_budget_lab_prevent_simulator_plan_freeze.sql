-- Keep Budget Lab finalization independent from revisioned official
-- simulator plans. The official create_budget_simulator_document path owns
-- finalization for plan-linked scenarios; lab-only scenarios still finalize
-- after all five workstreams are submitted. Avoid an unusable frozen draft.
-- Reuse existing indexed budget_simulator_plans_scenario lookup, one check
-- per finalization attempt only. Remove unused private.game_role lookup.
-- No new network requests, subscriptions, tables, formula or UI changes.
CREATE OR REPLACE FUNCTION public.finalize_budget_scenario(p_scenario_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare s public.budget_scenarios%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into s from public.budget_scenarios where id=p_scenario_id for update;
 if s.id is null then raise exception 'Scenario not found'; end if;
 if s.status is distinct from 'draft' or s.formal_document_id is not null then
  raise exception 'Сценарий уже зафиксирован или связан с проектом закона.';
 end if;
 if not private.is_game_teacher(s.game_id) and not private.has_effective_role_like(s.game_id,v_uid,ARRAY['%председател%правительств%','%министр%финанс%']) then
  raise exception 'Prime Minister / Finance Minister access required';
 end if;
 if (select count(*) from public.budget_workstreams where scenario_id=s.id)<5 then
  raise exception 'All five analytical workstreams must submit their conclusions';
 end if;
 -- A revisioned official simulator plan owns this scenario. Finalizing it
 -- through Budget Lab leaves the plan in draft but makes further official
 -- save attempts impossible; its legal document path must finalize it.
 -- Use the existing scenario index and only check at finalization time.
 if exists(select 1 from public.budget_simulator_plans p
           where p.scenario_id=s.id and p.game_id=s.game_id) then
  raise exception 'Этот сценарий связан с официальным бюджетным симулятором. Завершите оформление через раздел «Бюджет» и проект федерального закона.';
 end if;
 update public.budget_scenarios set status='final',updated_by=v_uid,updated_at=now() where id=s.id;
 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(s.game_id,13,'Федеральный бюджет','notice','Макроэкономический сценарий бюджета зафиксирован',
  s.title||'. Доходы: '||s.revenue||'; расходы: '||s.expenditure||'; баланс: '||s.balance||
  case when s.deficit_pct_gdp is not null then '; дефицит к ВВП: '||round(s.deficit_pct_gdp,2)||'%' else '' end,
  v_uid);
end;
$function$
;
