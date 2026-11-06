/** Temporary load-shedding switch for the 2026-11-06 classroom incident.
 * Keep the game, authorization, ballots, and general Realtime live.
 * Revert only after comparing actual Supabase request rates and timeout logs.
 */
export const CHAT_PAUSED = true;
export const TELEGRAM_PAUSED = true;
