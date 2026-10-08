-- Cover foreign keys introduced by the stage workflow tables.
create index if not exists bill_amendments_author_idx on public.bill_amendments(author_id);
create index if not exists bill_amendments_game_idx on public.bill_amendments(game_id);
create index if not exists bill_amendments_vote_idx on public.bill_amendments(vote_id);
create index if not exists bill_amendment_packs_creator_idx on public.bill_amendment_packs(created_by);
create index if not exists bill_amendment_packs_game_idx on public.bill_amendment_packs(game_id);
create index if not exists state_program_commitments_signer_idx on public.state_program_budget_commitments(signed_by);
create index if not exists state_program_expenses_creator_idx on public.state_program_expenses(created_by);
