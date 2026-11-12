-- Skip re-seeding already present budget event cases during a view-only read.
-- The original idempotent seed routines still run on partial/missing data.
-- Plan publication, case outcomes, deferred risk dispatch, RLS and formulae unchanged.
-- Canonical 16 regional keys match private.seed_budget_regional_cases as audited.
CREATE OR REPLACE FUNCTION private.budget_seed_status(p_game uuid)
RETURNS TABLE(templates_missing boolean,regions_missing boolean)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO 'public','private','pg_temp'
AS $function$
 SELECT EXISTS(
    SELECT 1 FROM private.budget_case_templates t
    WHERE NOT EXISTS(
      SELECT 1 FROM public.event_cases e
      WHERE e.game_id=p_game AND e.case_key=t.case_key
    )
  ), EXISTS(
    SELECT 1 FROM unnest(ARRAY[
   'budget-region-2026-05-essential-services-gap',
   'budget-region-2026-10-hospital-equipment',
   'budget-region-2026-22-drought-irrigation',
   'budget-region-2026-25-bridge-detour',
   'budget-region-2026-38-forest-recovery',
   'budget-region-2026-40-industrial-grid',
   'budget-region-2026-42-employment-retraining',
   'budget-region-2026-43-rural-cultural-centres',
   'budget-region-2026-45-rural-broadband',
   'budget-region-2026-47-food-logistics',
   'budget-region-2026-54-school-capacity',
   'budget-region-2026-56-flood-drainage',
   'budget-region-2026-59-heating-network',
   'budget-region-2026-63-technical-college',
   'budget-region-2026-64-wastewater-cleaning',
   'budget-region-2026-72-temporary-family-housing'
    ]::text[]) expected(case_key)
    WHERE NOT EXISTS(
      SELECT 1 FROM public.event_cases e
      WHERE e.game_id=p_game AND e.case_key=expected.case_key
    )
  );
$function$;
REVOKE ALL ON FUNCTION private.budget_seed_status(uuid)
 FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_budget_simulator(p_game_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare row_id uuid;reason text;v_templates_missing boolean;v_regions_missing boolean;begin
 if auth.uid() is null or not private.is_game_member(p_game_id) then raise exception 'Нет доступа к бюджетному симулятору этой игры.';end if;
 if exists(select 1 from games where id=p_game_id and status not in ('finished','archived')) and exists(select 1 from game_members m where m.game_id=p_game_id and m.user_id=auth.uid() and m.roster_archived_at is null) then perform private.ensure_budget_simulator(p_game_id);end if;
 if private.active_budget_actor(p_game_id) then
 select templates_missing,regions_missing into v_templates_missing,v_regions_missing
 from private.budget_seed_status(p_game_id);
 if v_templates_missing then perform private.seed_budget_cases(p_game_id);end if;
 if v_regions_missing then perform private.seed_budget_regional_cases(p_game_id);end if;
 for row_id in select p.id from budget_simulator_plans p join formal_documents d on d.id=p.document_id and d.game_id=p.game_id where p.game_id=p_game_id and p.status='document' and d.status_code='published' order by d.updated_at loop
  begin perform private.apply_budget_simulator_plan(p_game_id,row_id);
  exception when others then
   get stacked diagnostics reason=MESSAGE_TEXT;
   insert into budget_simulator_ledger(game_id,kind,note,source_key) values(p_game_id,'publication_blocked',
    'Расчет '||row_id||' не применен: '||case when sqlstate='P0001' then reason else 'Проверьте связанный проект бюджета и числовые приложения.' end,'blocked:'||row_id) on conflict do nothing;
  end;
 end loop;
 for row_id in select c.id from event_cases c join event_case_outcomes o on o.case_id=c.id and o.game_id=c.game_id where c.game_id=p_game_id and c.case_key like 'budget-risk-%' and not exists(select 1 from budget_simulator_ledger l where l.game_id=p_game_id and l.source_key='outcome:'||c.id) loop perform private.apply_budget_financial_outcome(p_game_id,row_id);end loop;
 perform private.dispatch_budget_risks(p_game_id);
 end if;
 return jsonb_build_object('state',(select to_jsonb(s) from budget_simulator_state s where game_id=p_game_id),
 'plans',(select coalesce(jsonb_agg(to_jsonb(p) order by p.updated_at desc),'[]') from (select pl.*,d.registry_no from budget_simulator_plans pl left join formal_documents d on d.id=pl.document_id where pl.game_id=p_game_id order by pl.updated_at desc limit 30)p),
 'requests',(select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc),'[]') from (select r.*,f.name region_name,c.title event_title from budget_transfer_requests r join fiscal_region_reference f on f.code=r.region_code left join event_cases c on c.id=r.event_case_id and c.game_id=r.game_id where r.game_id=p_game_id)r),
 'regional_events',(select coalesce(jsonb_agg(to_jsonb(e) order by e.region_code,e.title),'[]'::jsonb) from (
  select c.id,c.title,c.situation,c.comic_scene->>'region_code' region_code,c.comic_scene->'budget_request' budget_request,
   case when exists(select 1 from event_case_outcomes o where o.case_id=c.id and o.game_id=c.game_id) then 'resolved'
    when exists(select 1 from event_assignments a where a.case_id=c.id and a.game_id=c.game_id) then 'assigned' else 'ready' end status,
   exists(select 1 from event_assignments a where a.case_id=c.id and a.game_id=c.game_id and a.recipient_id=auth.uid()) assigned
  from event_cases c where c.game_id=p_game_id and c.status='ready'
   and jsonb_typeof(c.comic_scene->'budget_request')='object'
   and exists(select 1 from fiscal_region_reference f where f.code=c.comic_scene->>'region_code')
   and (c.case_key like 'budget-region-2026-%' or private.is_game_teacher(p_game_id) or private.can_prepare_budget(p_game_id)
    or exists(select 1 from event_assignments a where a.case_id=c.id and a.game_id=c.game_id and a.recipient_id=auth.uid()))
 ) e),
 'contracts',(select coalesce(jsonb_agg(to_jsonb(c) order by c.maturity_month,c.created_at),'[]') from budget_finance_contracts c where c.game_id=p_game_id),
 'ledger',(select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at desc,l.id desc),'[]') from (select * from budget_simulator_ledger where game_id=p_game_id order by created_at desc,id desc limit 80)l),
 'can_prepare',private.can_prepare_budget(p_game_id),'can_request',private.can_request_budget_transfer(p_game_id),
 'event_count',(select count(*) from event_assignments a join event_cases c on c.id=a.case_id where a.game_id=p_game_id and a.status in ('pending','accepted') and c.case_key like 'budget-%' and (a.recipient_id=auth.uid() or private.is_game_teacher(p_game_id))));
end$function$

