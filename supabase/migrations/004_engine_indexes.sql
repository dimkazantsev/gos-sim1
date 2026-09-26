-- Cover foreign keys used by the Republic Politologia engine.
create index if not exists game_crises_created_by_idx on public.game_crises(created_by);
create index if not exists game_evaluations_evaluator_idx on public.game_evaluations(evaluator_id);
create index if not exists game_parties_leader_idx on public.game_parties(leader_user_id);
create index if not exists game_votes_created_by_idx on public.game_votes(created_by);
