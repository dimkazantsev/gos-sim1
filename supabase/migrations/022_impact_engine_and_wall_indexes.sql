-- Performance indexes for the political wall, metric history and impact engine.
create index if not exists impact_ledger_rule_idx on public.impact_ledger(rule_id);
create index if not exists impact_ledger_actor_idx on public.impact_ledger(actor_id,created_at desc);
create index if not exists impact_rules_creator_idx on public.impact_rules(created_by);
create index if not exists political_posts_author_time_idx on public.political_posts(author_id,created_at desc);
create index if not exists political_posts_game_status_time_idx on public.political_posts(game_id,status,created_at desc);
create index if not exists political_post_media_game_idx on public.political_post_media(game_id);
create index if not exists political_post_media_uploader_idx on public.political_post_media(uploader_id);
create index if not exists political_post_formal_links_game_idx on public.political_post_formal_links(game_id);
create index if not exists political_post_formal_links_document_idx on public.political_post_formal_links(formal_document_id);
create index if not exists political_post_formal_links_creator_idx on public.political_post_formal_links(created_by);
create index if not exists political_decisions_vote_idx on public.political_decisions(vote_id);
create index if not exists political_decisions_decided_by_idx on public.political_decisions(decided_by);
create index if not exists state_metric_history_metric_idx on public.state_metric_history(metric_id,recorded_at desc);
create index if not exists state_metric_history_actor_idx on public.state_metric_history(actor_id,recorded_at desc);
create index if not exists party_support_history_party_idx on public.party_support_history(party_id,recorded_at desc);
