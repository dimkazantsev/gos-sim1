-- Delete only a standalone draft budget version; enacted or linked plans are immutable.
create or replace function public.delete_budget_simulator_draft(p_game_id uuid,p_plan_id uuid,p_revision integer)
returns boolean language plpgsql security definer set search_path=public,private,pg_temp as $$
declare pl public.budget_simulator_plans%rowtype;begin
 if not private.can_prepare_budget(p_game_id) then raise exception 'Удаление черновиков бюджета недоступно.';end if;
 perform private.lock_budget_actor(p_game_id);
 perform pg_advisory_xact_lock(hashtextextended('budget:'||p_game_id::text,0));
 select * into pl from public.budget_simulator_plans where id=p_plan_id and game_id=p_game_id for update;
 if pl.id is null then raise exception 'Черновик не найден.';end if;
 if pl.revision is distinct from p_revision then raise exception 'Черновик изменён другим участником. Обновите список.';end if;
 if pl.status<>'draft' or pl.document_id is not null then raise exception 'Удалять можно только черновик без связанного НПА.';end if;
 if exists(select 1 from public.budget_simulator_state where game_id=p_game_id and last_plan_id=p_plan_id)
 or exists(select 1 from public.budget_finance_contracts where plan_id=p_plan_id)
 or exists(select 1 from public.budget_transfer_requests where plan_id=p_plan_id)
 or exists(select 1 from public.budget_faction_amendments where plan_id=p_plan_id)
 or exists(select 1 from public.budget_income_history where plan_id=p_plan_id)
 or exists(select 1 from public.formal_documents where game_id=p_game_id and (metadata->>'budget_simulator_plan_id')=p_plan_id::text)
 then raise exception 'Этот расчёт уже связан с бюджетными решениями, документами или операциями и не подлежит удалению.';end if;
 delete from public.budget_simulator_plans where id=pl.id;
 -- Associated scenario is kept: other scenario references remain intact.
 return true;
end $$;
revoke all on function public.delete_budget_simulator_draft(uuid,uuid,integer) from public,anon;
grant execute on function public.delete_budget_simulator_draft(uuid,uuid,integer) to authenticated;
