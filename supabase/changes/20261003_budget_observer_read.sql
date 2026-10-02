-- Observers see the shared budget without mutating documents or event assignments.
create or replace function public.get_budget_simulator(p_game_id uuid) returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare row_id uuid;begin
 if auth.uid() is null or not private.is_game_member(p_game_id) then raise exception 'Нет доступа к бюджетному симулятору этой игры.';end if;
 perform private.ensure_budget_simulator(p_game_id);
 if private.is_game_teacher(p_game_id) or exists(select 1 from game_members where game_id=p_game_id and user_id=auth.uid() and kind='student') then
 perform private.seed_budget_cases(p_game_id);
 for row_id in select p.id from budget_simulator_plans p join formal_documents d on d.id=p.document_id and d.game_id=p.game_id where p.game_id=p_game_id and p.status='document' and d.status_code='published' order by d.updated_at loop perform private.apply_budget_simulator_plan(p_game_id,row_id);end loop;
 for row_id in select c.id from event_cases c join event_case_outcomes o on o.case_id=c.id and o.game_id=c.game_id where c.game_id=p_game_id and c.case_key like 'budget-risk-%' and not exists(select 1 from budget_simulator_ledger l where l.game_id=p_game_id and l.source_key='outcome:'||c.id) loop perform private.apply_budget_financial_outcome(p_game_id,row_id);end loop;
 perform private.dispatch_budget_risks(p_game_id);
 end if;
 return jsonb_build_object('state',(select to_jsonb(s) from budget_simulator_state s where game_id=p_game_id),
 'plans',(select coalesce(jsonb_agg(to_jsonb(p) order by p.updated_at desc),'[]') from (select pl.*,d.registry_no from budget_simulator_plans pl left join formal_documents d on d.id=pl.document_id where pl.game_id=p_game_id order by pl.updated_at desc limit 30)p),
 'requests',(select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc),'[]') from (select r.*,f.name region_name from budget_transfer_requests r join fiscal_region_reference f on f.code=r.region_code where game_id=p_game_id)r),
 'contracts',(select coalesce(jsonb_agg(to_jsonb(c) order by c.maturity_month,c.created_at),'[]') from budget_finance_contracts c where c.game_id=p_game_id),
 'ledger',(select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at desc,l.id desc),'[]') from (select * from budget_simulator_ledger where game_id=p_game_id order by created_at desc,id desc limit 80)l),
 'can_prepare',private.can_prepare_budget(p_game_id),'can_request',private.can_request_budget_transfer(p_game_id),
 'event_count',(select count(*) from event_assignments a join event_cases c on c.id=a.case_id where a.game_id=p_game_id and a.status in ('pending','accepted') and c.case_key like 'budget-%' and (a.recipient_id=auth.uid() or private.is_game_teacher(p_game_id))));
end$$;

