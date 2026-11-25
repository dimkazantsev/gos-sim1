# get_game_entry_v5: evaluate current user once (2026-11-25)

Status: applied to production as migration `20261125105301`. Baseline live function definition MD5 `130b019350db1a5ca4e08b9dde86320b`. Existing function is STABLE, SECURITY INVOKER, search_path empty; anon EXECUTE false, authenticated EXECUTE true. The candidate changes exactly one predicate in the personal member subquery: `m.user_id=auth.uid()` to `m.user_id=(select auth.uid())`. No new index, table, grant, RLS policy, client call, or payload key.

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

## Production verification

PR #667 passed all four workflows and was merged as `e4c4743a6607b31b6a6f70e35f8481acfbb818a1`. Before migration the baseline hash and ACL matched, and there were zero presence heartbeats in the preceding three minutes (one in the preceding 15 minutes). A single atomic DO block used a 2-second lock timeout, rechecked the presence and baseline guards, compared the full JSON before and after for one existing teacher, student and observer in the same game, checked a random nonmember was denied, and compared owner, ACL, security mode, volatility and search_path. All checks passed; any failure would have rolled back the DDL. Follow-up metadata confirmed function hash `8b8570d0b5fd3438dfd4bbe2580275b4`, SECURITY INVOKER, STABLE, empty search_path, postgres owner, authenticated EXECUTE true, anon EXECUTE false. The repository migration records the equivalent DDL without requiring production-only fixtures on a fresh database. No gameplay rows or policies modified; no throughput claim.
