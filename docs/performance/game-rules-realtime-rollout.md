# Game rule Realtime migration — phase 1

Current live RLS inspection: authenticated SELECT on all three rule tables uses private.is_game_member(game_id); same condition on existing private game channel. Party invitations, party chair ballots, and blitz assignments are intentionally untouched because their SELECT scope is narrower. State metrics, documents, votes and stages retain direct deltas.

Baseline: stage_deadline_rules 14 inserts/32 updates/22 deletes; regional_election_rules 0/4/3; parliamentary_election_rules 0/2/2 since recorded table statistics. Each had one realtime.subscription entry at inspection. These counts are cumulative, not a load benchmark. At 100 clients, three direct Postgres Changes bindings each become one Broadcast handler per existing socket (300 fewer WAL bindings, zero new sockets). Actual server improvement remains to be measured.

Deployment order:
1. Verify the isolated SQL and 100 synthetic hook client tests.
2. Install triggers with publication retained; confirm existing SELECT policies and private topics. Keep lock timeout bounded.
3. Publish compatible client and verify rules update in two authorized sessions, plus wrong-game isolation. Existing old clients still receive Postgres Changes.
4. Only after old clients are drained and the new client is verified, remove these three publication entries in a separate migration; confirm no other consumers. Never remove first.

No changes to CSS, rules, grants, subscription count for sensitive tables, or pricing. No production migration applied in this commit.
