# Offline blitz issuance: 2026-11-24

Applied migration: `supabase/migrations/20261124190637_skip_existing_blitz_daily_plans.sql`.

- Before: 5,194 cron runs, 146,528.47 ms recorded total, mean 28.211 ms. Current eligible roster: 10; all 10 already have today's plan. Candidate: 0 calls into blitz_issue_for_day. This is a call-count measurement, not a measured runtime reduction.
- Synthetic read-only SQL scenarios (100 participants): 0/70/100 existing plans => 100/30/0 calls. Previous-day plans, other-game plans, archived members and closed stages checked. No real participants or game data created.
- Existing unique index (game_id,user_id,assigned_day) reused. No new indices or jobs. Cron remains every five minutes. The inner issuance procedure and per-student advisory lock are unchanged. Concurrent issuance still rechecks the plan after acquiring its lock. If a stage reset deletes a plan after the outer cursor's snapshot, the next scheduled run can issue it; no duplicate issuance.
- Applied when active presence and executing cron were both zero. After installation, definition, SECURITY DEFINER, search_path, owner postgres and ACL {postgres=X/postgres} confirmed; remaining eligible calls 0. No production writes to game data performed by the verification. No 100-player live test or post-deployment runtime benchmark yet.
