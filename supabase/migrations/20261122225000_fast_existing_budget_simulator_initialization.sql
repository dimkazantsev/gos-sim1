-- Skip needless simulator initialization when both seeded state rows
-- already exist; preserve the existing 89-region seeding check and all first
-- load / repair logic. Zero new network requests, subscriptions, SQL tables,
-- coefficients, fiscal events or UI changes.
CREATE OR REPLACE FUNCTION private.ensure_budget_simulator(p_game uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare p game_fiscal_policy%rowtype;b jsonb;a jsonb;begin
 perform private.ensure_fiscal_game(p_game);
 -- All existing rows already satisfy the initialization contract.
 -- Avoid repeated conflict inserts, 89-region sums and anchor construction
 -- for every budget viewer, while preserving repairs for incomplete games.
 if exists(select 1 from game_fiscal_policy where game_id=p_game)
    and exists(select 1 from budget_simulator_state where game_id=p_game) then
   return;
 end if;
 insert into game_fiscal_policy(game_id,federal_expenditure,municipal_expenditure,baseline_economy,baseline_trust)
 select p_game,coalesce(sum(expenditure)*.6,0),coalesce(sum(expenditure)*.25,0),coalesce((select value from state_metrics where game_id=p_game and metric_key='economy'),50),coalesce((select value from state_metrics where game_id=p_game and metric_key='public_trust'),50)
 from game_fiscal_regions where game_id=p_game on conflict(game_id) do nothing;
 select * into p from game_fiscal_policy where game_id=p_game;
 select data into b from private.budget_baseline where year=2026;
 a:=jsonb_build_object('enterprises',greatest(1,(select sum(enterprises*activity_multiplier) from game_fiscal_regions where game_id=p_game)),
 'key_rate',p.key_rate,'fx_rate',p.fx_rate,'oil_price',greatest(.01,p.oil_price),'inflation',p.inflation,
 'economy',coalesce((select value from state_metrics where game_id=p_game and metric_key='economy'),50),'trust',coalesce((select value from state_metrics where game_id=p_game and metric_key='public_trust'),50));
 insert into budget_simulator_state(game_id,anchor,internal_debt,external_debt,reserve_remaining,last_financing)
 values(p_game,a,(b->>'internal_debt_end')::numeric,(b->>'external_debt_end')::numeric,(b->>'reserve_available_model')::numeric,b->'financing') on conflict(game_id) do nothing;
end$function$
;
