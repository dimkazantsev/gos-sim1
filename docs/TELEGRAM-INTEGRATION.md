# Telegram ↔ GOS//SIMS
The integration uses the **existing** Next.js application and Supabase backend.
- Run `supabase/changes/20261010_telegram_bridge.sql` once in the target database after review.
- The Telegram username is `@GosSimsGameBot` and is set as a nonsecret fallback in the profile component.\n- Set Vercel environment variables (server only): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (random 32+ chars), `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, and `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` (username without @). Existing `NEXT_PUBLIC_SUPABASE_URL` must be present.
- Optional: `NEXT_PUBLIC_GAME_URL` for deep links.
- After deployment register webhook: `https://api.telegram.org/bot<TOKEN>/setWebhook` with `url=https://gos-sim1.vercel.app/api/telegram/webhook`, `secret_token=<TELEGRAM_WEBHOOK_SECRET>`, `allowed_updates=[\"message\"]`; do not commit/share tokens.
- Create bot using @BotFather and /newbot; set name, description, username and commands.
- Every player links from their own game profile (10-minute, single-use code). Private chats only. Users of multiple games must supply game UUID; the bot does not persist a last-game selection.
- Commands: /games, /status, /stages, /votes, /docs, /channels, /channel <uuid>, /chat <text>.
- Vote casting and document editing remain on the website: links only. Teacher's modifying commands are disabled until explicit server-side scoped permission checks have been implemented.
- Server-only RPC functions use service_role; revoke access from anon/authenticated. The links/outbox tables have RLS and no browser table grants.
- Cron dispatcher is protected by CRON_SECRET. The provided `vercel.json` uses a once-daily 08:00 UTC cron compatible with Hobby limits, **not** real-time delivery. For real-time alerts replace this with a persistent worker or Pro-compatible higher frequency schedule after confirming account plan. Queue delivery is at-least-once (a crash after Telegram accepts a message can cause a duplicate). Upgrade to a leased outbox design for multi-worker concurrency.
- Ensure Vercel cron frequency is compatible with your account; adapt schedule if needed.
- TODO before production: webhook update-id idempotency; message outbox race/retry dedup; use least-privilege per-user authorization on future teacher write commands; validate migrations on a disposable database.\n- Test: invalid webhook secret => 401; expired/used codes rejected; guests cannot send chat; private channel cannot be accessed by outsiders; unsubscribe prevents notifications; old game chat remains intact.
