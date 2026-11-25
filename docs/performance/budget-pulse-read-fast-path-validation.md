# Budget pulse: read-only fast path (candidate, not deployed)

Source: live get_budget_pulse(uuid), pg_get_functiondef MD5 112efe704f7b3fc5bfdf565c8babdaf7. Separate branch from main 73e756ca0a0b6420dd5ea6a5993271838d155927. No production DDL was executed.

The existing RPC remains the only client endpoint. A private STABLE SECURITY INVOKER helper checks a single consistent snapshot and returns the exact existing response shape when all inputs, cached calculation, history and budget metric are current. The existing access check runs before this helper. EXECUTE is revoked from public/anon/authenticated. No new client request or subscription. Any missing or changed input, pending publication, outcome, financial risk, monetary decision, initialization or history/metric mismatch returns NULL and uses the unchanged original path. The guard is intentionally conservative for observers and archived games as well.

Observed on the actual production database, in read-only transactions with 2500ms statement timeout, no raw game identifiers or payloads returned:
- Existing RPC pg_stat_statements: 650 calls, mean 42.353 ms (historical, not matched baseline).
- One cached game; all readiness predicates true; full candidate result returned one row, response keys and cached calculation matched, history limit <=300.
- Standalone SELECT EXPLAIN ANALYZE: {"execution_ms":19.132,"shared_hits":2156,"shared_reads":0,"actual_rows":1}. Single warm-cache sample; not an end-to-end RPC comparison or evidence of 100 concurrent players.

Before activation: validate the exact SQL in isolated PostgreSQL/Supabase, including cache miss, input mutation, history mismatch, incomplete seeds, due risk/monetary decision, publication and event outcome, foreign game and observer access, and concurrency with 100 independent JWTs. Compare full JSON excluding as_of and verify side effects unchanged, including fast-path no writes and lock avoidance. Measure both paths under the same load. Do not publish until these pass. Recheck source definition hash before activation; if changed, reconcile with current code rather than overwrite it. No pricing, design, role or formula changes.
