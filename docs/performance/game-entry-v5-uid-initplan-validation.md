# get_game_entry_v5: evaluate current user once (2026-11-25)

Status: candidate, not applied. Baseline live function definition MD5 `130b019350db1a5ca4e08b9dde86320b`. Existing function is STABLE, SECURITY INVOKER, search_path empty; anon EXECUTE false, authenticated EXECUTE true. The candidate changes exactly one predicate in the personal member subquery: `m.user_id=auth.uid()` to `m.user_id=(select auth.uid())`. No new index, table, grant, RLS policy, client call, or payload key.

## Live read-only evidence

Under an existing student JWT, a single read-only EXPLAIN (ANALYZE, BUFFERS, TIMING OFF) with the candidate first, original second, and candidate third produced:
- cold-first candidate: 102 shared buffer hits (includes setup/catalog work);
- warm original: sequential scan, 28 member rows examined, 27 removed, 114 shared buffer hits;
- warm candidate: index scan using game_members_user_idx, 1 returned row, 6 shared buffer hits.
- 94.74% fewer shared buffer hits for this subquery (not entire RPC latency or production throughput). Existing primary key (game_id,user_id). No claim for a 100-client live workload.

The exact old and candidate subqueries returned equal JSON for student, teacher and observer in the current game; an unrelated authenticated UUID returned null for both. All four checks passed. No personal data exported; no writes, no new accounts, no production schema changes.

## Deployment gate
1. Execute the isolated full JSON regression using the actual reference and candidate function, with fixture RLS and two games.
2. Publish preceding PRs in order. Recheck current function MD5, owner, ACL, volatility, search_path and no active gameplay.
3. Apply guarded migration in a transaction; record actual migration version, verify function metadata and full response equivalence for permitted roles and denial for nonmember.
4. Keep existing RLS and public API. Do not apply if verification fails.
